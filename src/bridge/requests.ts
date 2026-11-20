/**
 * 请求日志：一次转发一条记录，内存环形 + JSONL 落盘。
 *
 * 字段照抄 Codex++ 的 `request_log.rs`（`RequestLogEntry`）：时间、入口路径、
 * 状态码、是否流式、请求模型与上游模型、协议面、尝试次数、首字耗时、token
 * 用量（含缓存与推理）、错误原文。理由很实际——它那张日志页能回答的问题
 * （「这次为什么慢」「是不是被限流」「缓存命中多少」）和我们这张要回答的完全
 * 一样，换一套字段只会让人对不上号。
 *
 * 落盘策略也照它：JSONL 逐行追加、按体积滚动。单文件上限 8 MB，超过后只保留
 * 尾部 2 MB——再往前翻也没有线索，只会让每次打开日志变慢。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '../core/host-peers.ts'

export interface RequestUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
}

export interface RequestAttemptDetail {
  attempt: number
  code?: string
  message?: string
  delayMs?: number
}

export interface RequestLogEntry {
  id: string
  /** 请求开始时间（unix ms）。 */
  startedAtMs: number
  durationMs: number
  method: string
  path: string
  statusCode: number
  success: boolean
  stream: boolean
  /** 客户端请求的模型名。 */
  model: string
  /** 真正发给上游的模型名（当前与 model 相同，保留字段以便将来映射）。 */
  upstreamModel: string
  /** 协议面：本代理只提供 chatCompletions。 */
  wireApi: string
  /** 使用的账号（对应 Codex++ 的 relayName）。 */
  account: string
  /** 上游请求总次数，含重试。 */
  attempts: number
  autoRetries: number
  retryReasons: string[]
  attemptDetails: RequestAttemptDetail[]
  /** 首字耗时（请求开始到第一段上游输出）。 */
  firstTokenMs?: number
  usage?: RequestUsage
  cacheHitRatio?: number
  error?: string
}

const MAX_MEMORY = 500
const MAX_FILE_BYTES = 8 * 1024 * 1024
const KEEP_FILE_BYTES = 2 * 1024 * 1024
/** 体积检查最密每 30 秒一次；每写一条都 stat 一次是在给磁盘做压力测试。 */
const SIZE_CHECK_INTERVAL_MS = 30_000

const memory: RequestLogEntry[] = []
let lastSizeCheck = 0

export function requestLogPath(): string {
  return join(resolveDshHome(), 'requests.jsonl')
}

function ensureDir(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
}

/**
 * 按体积滚动：保留文件尾部 `KEEP_FILE_BYTES`，并且从下一个换行处开始，避免把
 * 一行的 JSON 从中间切断（切断的那半行读出来是坏 JSON，整份日志都会被丢弃）。
 */
function compactIfNeeded(path: string): void {
  const now = Date.now()
  if (now - lastSizeCheck < SIZE_CHECK_INTERVAL_MS) return
  lastSizeCheck = now
  const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0
  if (size <= MAX_FILE_BYTES) return
  const raw = readFileSync(path)
  const tail = raw.subarray(Math.max(0, raw.length - KEEP_FILE_BYTES))
  const firstNewline = tail.indexOf(0x0a)
  const kept = firstNewline === -1 ? Buffer.alloc(0) : tail.subarray(firstNewline + 1)
  writeFileSync(path, kept, { mode: 0o600 })
}

export function recordRequest(entry: RequestLogEntry): void {
  memory.push(entry)
  if (memory.length > MAX_MEMORY) memory.splice(0, memory.length - MAX_MEMORY)
  try {
    const path = requestLogPath()
    ensureDir(path)
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    compactIfNeeded(path)
  } catch {
    // 写日志失败不能影响转发：这条请求已经答完了，丢一行日志比丢响应好。
  }
}

function readFileEntries(limit: number): RequestLogEntry[] {
  const path = requestLogPath()
  if (!existsSync(path)) return []
  try {
    const lines = readFileSync(path, 'utf8').split('\n')
    const out: RequestLogEntry[] = []
    // 只从尾部取：日志文件可能有几 MB，正序解析全部再截断是白做功。
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const line = lines[i]
      if (line === undefined || line.trim() === '') continue
      try {
        out.push(JSON.parse(line) as RequestLogEntry)
      } catch {
        // 半行（进程被杀时可能出现）跳过即可。
      }
    }
    return out
  } catch {
    return []
  }
}

export interface LogQuery {
  readonly limit: number
  readonly model?: string
  readonly onlyFailed: boolean
  readonly q?: string
}

export interface LogPage {
  entries: RequestLogEntry[]
  total: number
  success: number
  failed: number
  avgMs: number
  p95Ms: number
  avgFirstTokenMs: number
  inputTokens: number
  outputTokens: number
  models: string[]
}

/**
 * 读一页日志。
 *
 * 统计口径按「全部命中筛选的记录」算，不是只算这一页：面板上「平均耗时」如果
 * 只反映最近 100 条，看着会比真实情况好得多。
 */
export function readLogs(query: LogQuery): LogPage {
  const all = [...readFileEntries(2000), ...memory]
  // 内存里的这条可能与文件里同 id 的记录重复（刚写完还没滚出内存），按 id 去重。
  const seen = new Set<string>()
  const deduped = all.filter(entry => {
    if (entry === undefined || entry.id === undefined || seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
  deduped.sort((a, b) => b.startedAtMs - a.startedAtMs)

  const q = query.q?.trim().toLowerCase() ?? ''
  const matched = deduped.filter(entry => {
    if (query.model !== undefined && query.model !== '' && entry.model !== query.model) return false
    if (query.onlyFailed && entry.success) return false
    if (q !== '') {
      const hay = `${entry.model} ${entry.path} ${entry.error ?? ''} ${entry.account}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const durations = matched.map(entry => entry.durationMs).sort((a, b) => a - b)
  const firstTokens = matched
    .map(entry => entry.firstTokenMs)
    .filter((value): value is number => typeof value === 'number')
  const p95 = durations.length === 0
    ? 0
    : durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)

  return {
    entries: matched.slice(0, query.limit),
    total: matched.length,
    success: matched.filter(entry => entry.success).length,
    failed: matched.filter(entry => !entry.success).length,
    avgMs: durations.length === 0 ? 0 : Math.round(sum(durations) / durations.length),
    p95Ms: p95,
    avgFirstTokenMs: firstTokens.length === 0 ? 0 : Math.round(sum(firstTokens) / firstTokens.length),
    inputTokens: sum(matched.map(entry => entry.usage?.inputTokens ?? 0)),
    outputTokens: sum(matched.map(entry => entry.usage?.outputTokens ?? 0)),
    models: [...new Set(deduped.map(entry => entry.model).filter(model => model !== ''))].sort(),
  }
}

/** 清空日志（内存与文件都清）：面板上的「清空」按钮用。 */
export function clearLogs(): void {
  memory.length = 0
  try {
    writeFileSync(requestLogPath(), '', { mode: 0o600 })
  } catch {
    // 文件被占用时至少内存已清空，下次滚动会覆盖。
  }
}

/** 旧版面板用的计数器，保留给「诊断」页的概览行。 */
export function requestCounters(): { total: number; failures: number } {
  const all = [...readFileEntries(2000), ...memory]
  return { total: all.length, failures: all.filter(entry => !entry.success).length }
}

/** 兼容旧调用：最近的原始记录。 */
export function recentRequests(limit = 20): RequestLogEntry[] {
  return readLogs({ limit, onlyFailed: false }).entries
}
