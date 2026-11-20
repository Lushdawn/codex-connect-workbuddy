/**
 * 本地 HTTP 面：一个 OpenAI 兼容的 `/v1/chat/completions`。
 *
 * 走的是「路径 A」——代理只讲 chat completions，Responses 的转换交给
 * Codex++ 网关自己做。这样上游 `/v2/chat/completions` 的 SSE 可以逐字节
 * 透传给客户端，中间没有一层会丢字段的重编码。
 */

import { spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { resolveDshHome } from '../core/host-peers.ts'
import { killLiveWorkers } from '../core/turing-sdk.ts'
import { prepareChatBody } from '../core/upstream.ts'
import { regionOf } from '../core/upstream.ts'
import { selectPromoMultiplier } from '../core/promo.ts'
import type { WorkBuddyRegion, WorkBuddyUpstreamModel } from '../core/upstream.ts'
import type { WorkBuddyCredential } from '../core/auth.ts'
import { fallbackModelsFor } from '../core/catalog.ts'
import { WORKBUDDY_CONNECT_VERSION } from '../core/version.ts'
import { createBridgeDeps, log, NoCredentialError, requireCredential } from './store.ts'
import type { BridgeDeps } from './store.ts'
import { applyAppPath, readConfig } from './config.ts'
import { buildOverview, cachedModels, claimCheckin, invalidateModels, invalidateOverview } from './overview.ts'
import { applyPanelSettings, budgetFor, isModelEnabled, readSettings, writeSettings } from './settings.ts'
import { listAccounts, pollLogin, removeAccount, selectAccount, startLogin } from './accounts.ts'
import { claimBenefit, listBenefits, mediaModels, probeModel, refreshModels } from './tools.ts'
import { deviceStatus, measureSpeed, saveSdkDir, switchDeviceMode } from './device.ts'
import { clearLogs, readLogs, recordRequest, recentRequests, requestCounters } from './requests.ts'
import type { RequestAttemptDetail, RequestLogEntry, RequestUsage } from './requests.ts'
import { accountBalances, invalidateBalances, MIN_USABLE, NoQuotaError, routeAccount, shouldFailover, SWITCH_FLOOR } from './router.ts'
import { installPayload } from '../install/codexpp.ts'
import { renderPage } from '../web/page.ts'

/** 默认端口与 codexwb 保持一致，省掉用户记两个数字。 */
export const DEFAULT_PORT = 8787

/** 请求体上限：长上下文会话的 body 可以很大，但也要防一次误发的巨型文件。 */
const MAX_BODY_BYTES = 32 * 1024 * 1024

export interface ServerOptions {
  readonly port?: number
  /** 原定端口。与实际端口不同即说明启动时发生过顺延（面板据此弹窗）。 */
  readonly preferredPort?: number
  readonly host?: string
  /** 就绪后自动用默认浏览器打开面板（双击启动器用）。 */
  readonly open?: boolean
}

export interface RunningServer {
  readonly port: number
  close(): Promise<void>
}

// ─────────────────────────── 运行状态 ───────────────────────────

/**
 * 端口与 pid 落到 `~/.wb-codex-bridge/runtime.json`。
 *
 * 为什么需要这个文件：`wbx stop` 得知道该停哪个进程。只读 `bridge.json` 的
 * `port` 不够——用户可能用 `--port` 起过另一个实例，也可能同时开着开发态与
 * 单文件程序。以「实际监听的端口」为准，才不会让停止命令打在空气上。
 */
export function runtimePath(): string {
  return join(resolveDshHome(), 'runtime.json')
}

export function readRuntime(): { port: number; pid: number } | undefined {
  try {
    const value = JSON.parse(readFileSync(runtimePath(), 'utf8')) as unknown
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (typeof record['port'] !== 'number' || typeof record['pid'] !== 'number') return undefined
    return { port: record['port'], pid: record['pid'] }
  } catch {
    return undefined
  }
}

function writeRuntime(port: number): void {
  try {
    const body = { port, pid: process.pid, startedAt: new Date().toISOString() }
    writeFileSync(runtimePath(), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  } catch (error) {
    // 写不进去只影响 `wbx stop` 的定位，不影响代理本身，别因此起不来。
    log(`写运行状态失败：${(error as Error).message}`)
  }
}

export function clearRuntime(): void {
  try {
    rmSync(runtimePath(), { force: true })
  } catch {
    // 同上：删不掉也不该拦住退出。
  }
}

// ─────────────────────────── 工具函数 ───────────────────────────

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** OpenAI 形状的错误体：Codex 与 Codex++ 都按这个读 message。 */
function sendError(res: ServerResponse, status: number, message: string, code = 'upstream_error'): void {
  sendJson(res, status, { error: { message, type: code, code } })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`请求体超过 ${MAX_BODY_BYTES} 字节上限`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 读一个 JSON 请求体；非法时返回 undefined，由调用方决定默认值。 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readBody(req)) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * 模型名归一化。
 *
 * Codex 侧看到的是 Codex++ 生成的 `cpx-<供应商>/<模型>`，网关解析后通常
 * 已经把前缀去掉；但「供应商被删/被排除」等情形下它会把整串原样转发。
 * 上游只认裸模型名，所以这里统一取最后一段，避免把前缀发给上游换来 400。
 */
function normalizeModelId(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return ''
  const slash = text.lastIndexOf('/')
  return slash === -1 ? text : text.slice(slash + 1)
}

// ─────────────────────── 非流式：本地聚合 ───────────────────────

interface ToolCallDraft {
  id?: string
  type?: string
  function: { name?: string; arguments: string }
}

interface Aggregated {
  content: string
  reasoning: string
  toolCalls: ToolCallDraft[]
  finishReason: string
  usage: Record<string, unknown> | undefined
}

/** 读 SSE 行，产出 `data:` 之后的 JSON 对象；`[DONE]` 结束。 */
async function* iterSse(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        try {
          yield JSON.parse(payload) as Record<string, unknown>
        } catch {
          // 上游偶尔会插入非 JSON 的心跳行；忽略比中断整轮更安全。
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function aggregateChunks(chunks: readonly Record<string, unknown>[], model: string): Record<string, unknown> {
  const acc: Aggregated = { content: '', reasoning: '', toolCalls: [], finishReason: 'stop', usage: undefined }
  for (const chunk of chunks) {
    if (chunk['usage'] !== undefined && chunk['usage'] !== null) {
      acc.usage = chunk['usage'] as Record<string, unknown>
    }
    const choices = chunk['choices']
    if (!Array.isArray(choices)) continue
    for (const choice of choices) {
      if (typeof choice !== 'object' || choice === null) continue
      const entry = choice as Record<string, unknown>
      const delta = entry['delta']
      if (typeof delta === 'object' && delta !== null) {
        const d = delta as Record<string, unknown>
        if (typeof d['content'] === 'string') acc.content += d['content']
        if (typeof d['reasoning_content'] === 'string') acc.reasoning += d['reasoning_content']
        const calls = d['tool_calls']
        if (Array.isArray(calls)) {
          for (const call of calls) {
            const c = call as Record<string, unknown>
            const index = typeof c['index'] === 'number' ? c['index'] : acc.toolCalls.length
            while (acc.toolCalls.length <= index) {
              acc.toolCalls.push({ function: { arguments: '' } })
            }
            const slot = acc.toolCalls[index]
            if (slot === undefined) continue
            if (typeof c['id'] === 'string' && c['id'] !== '') slot.id = c['id']
            if (typeof c['type'] === 'string') slot.type = c['type']
            const fn = c['function']
            if (typeof fn === 'object' && fn !== null) {
              const f = fn as Record<string, unknown>
              if (typeof f['name'] === 'string' && f['name'] !== '') slot.function.name = f['name']
              if (typeof f['arguments'] === 'string') slot.function.arguments += f['arguments']
            }
          }
        }
      }
      if (typeof entry['finish_reason'] === 'string') acc.finishReason = entry['finish_reason']
    }
  }
  const message: Record<string, unknown> = { role: 'assistant', content: acc.content }
  // reasoning_content 只在真有内容时出现：空串会被部分客户端当成「思考为空」
  // 而不是「没有思考」，从而吃掉一个回合。
  if (acc.reasoning !== '') message['reasoning_content'] = acc.reasoning
  if (acc.toolCalls.length > 0) {
    message['tool_calls'] = acc.toolCalls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      type: call.type ?? 'function',
      function: { name: call.function.name ?? '', arguments: call.function.arguments },
    }))
  }
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: acc.finishReason }],
    ...(acc.usage === undefined ? {} : { usage: acc.usage }),
  }
}

// ─────────────────────────── 路由 ───────────────────────────

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 把上游的 usage 对象规整成日志字段（兼容 chat 与 responses 两套命名）。 */
function readUsage(raw: unknown): RequestUsage | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const prompt = record['prompt_tokens_details']
  const completion = record['completion_tokens_details']
  const details = typeof prompt === 'object' && prompt !== null ? prompt as Record<string, unknown> : {}
  const completionDetails = typeof completion === 'object' && completion !== null
    ? completion as Record<string, unknown>
    : {}
  const inputTokens = toNumber(record['prompt_tokens'] ?? record['input_tokens'])
  const outputTokens = toNumber(record['completion_tokens'] ?? record['output_tokens'])
  if (inputTokens === 0 && outputTokens === 0) return undefined
  return {
    inputTokens,
    outputTokens,
    cachedTokens: toNumber(details['cached_tokens']),
    reasoningTokens: toNumber(completionDetails['reasoning_tokens']),
  }
}

/**
 * 从流式响应的尾部刮出 usage。
 *
 * 为什么只看尾部：上游把 usage 放在最后一段 chunk 里，而一次长回答可以是几百
 * KB。整段缓存再正则解析等于把每个响应复制一遍并全量扫一遍；只留最后 8 KB、
 * 再从最后一个 `"usage"` 往后做括号配平，代价是常数级的。
 *
 * 不用正则是因为 usage 里带嵌套对象（`prompt_tokens_details`），`[^}]*` 会在
 * 第一个内层 `}` 处截断，得到一段坏 JSON。
 */
function readUsageFromTail(tail: string): RequestUsage | undefined {
  const at = tail.lastIndexOf('"usage"')
  if (at === -1) return undefined
  const start = tail.indexOf('{', at)
  if (start === -1) return undefined
  let depth = 0
  for (let i = start; i < tail.length; i += 1) {
    const ch = tail[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return readUsage(JSON.parse(tail.slice(start, i + 1)) as unknown)
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BridgeDeps,
): Promise<void> {
  const startedAt = Date.now()
  let modelLabel = ''
  let upstreamLabel = ''
  let accountLabel = ''
  let streamFlag = false
  let firstTokenAt: number | undefined
  let usage: RequestUsage | undefined
  // 换号痕迹：`attempts` 是真实发出去的上游请求数，`autoRetries` 是其中因为
  // 账号原因自动重来的次数。两者分开记，因为「试了三次」和「换了两个号」在
  // 排查时不是同一件事。
  const retryReasons: string[] = []
  const attemptDetails: RequestAttemptDetail[] = []
  let attempts = 1
  const note = (status: number, error?: string): void => {
    const entry: RequestLogEntry = {
      id: `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      startedAtMs: startedAt,
      durationMs: Date.now() - startedAt,
      method: req.method ?? 'POST',
      path: '/v1/chat/completions',
      statusCode: status,
      success: status >= 200 && status < 300 && error === undefined,
      stream: streamFlag,
      model: modelLabel,
      upstreamModel: upstreamLabel === '' ? modelLabel : upstreamLabel,
      wireApi: 'chatCompletions',
      account: accountLabel,
      attempts,
      autoRetries: retryReasons.length,
      retryReasons,
      attemptDetails,
      ...(firstTokenAt === undefined ? {} : { firstTokenMs: firstTokenAt - startedAt }),
      ...(usage === undefined ? {} : { usage }),
      ...(usage === undefined || usage.inputTokens === 0
        ? {}
        : { cacheHitRatio: Number((usage.cachedTokens / usage.inputTokens).toFixed(4)) }),
      ...(error === undefined ? {} : { error }),
    }
    recordRequest(entry)
  }

  let raw: string
  try {
    raw = await readBody(req)
  } catch (error) {
    const message = `读取请求体失败：${(error as Error).message}`
    note(413, message)
    sendError(res, 413, message, 'invalid_request')
    return
  }

  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('顶层不是对象')
    parsed = value as Record<string, unknown>
  } catch (error) {
    const message = `请求体不是合法 JSON：${(error as Error).message}`
    note(400, message)
    sendError(res, 400, message, 'invalid_request')
    return
  }

  const model = normalizeModelId(parsed['model'])
  if (model === '') {
    note(400, '缺少 model 字段')
    sendError(res, 400, '请求缺少 model 字段', 'invalid_request')
    return
  }
  parsed['model'] = model
  modelLabel = model
  // 面板上那两个控件必须真的改变请求，否则它们只是装饰：
  // - 「推理强度」写成 `reasoning_effort`，且只在客户端没指定时补（用户显式
  //   指定优先）；
  // - 「可关闭思考」写成 `reasoning_effort: "off"`，内核会在模型明确拒绝 off
  //   时把它删掉（issue #83 的行为），不会把一个注定 400 的字段发出去。
  const panelSettings = readSettings()
  const panel = panelSettings.regions[panelSettings.activeRegion]
  if (parsed['reasoning_effort'] === undefined) {
    const savedEffort = panel.efforts[model]
    if (savedEffort !== undefined) parsed['reasoning_effort'] = savedEffort
    else if (panel.off.includes(model)) parsed['reasoning_effort'] = 'off'
  }
  // 本代理不做模型映射，上游收到的就是同一个名字；字段保留是为了日志与
  // Codex++ 那张表对得上（它按 upstreamModel 区分聚合前缀）。
  upstreamLabel = model
  // OpenAI 的缺省是**非流式**：只有显式 `stream: true` 才回 SSE。
  // 早先按「缺省即流式」写，导致 Codex++ 的供应商测试（不带 stream 字段）
  // 收到 `data: {...}` 而解析失败，弹窗判红——HTTP 明明是 200。
  // 真实会话里 Codex 一定带 `stream: true`，所以这条只影响探测类请求。
  const wantStream = parsed['stream'] === true
  streamFlag = wantStream

  // 按余额选账号：当前账号还够用就不换（换了上游缓存全废），掉到 20 分以下
  // 才换下一个；全都不足 50 分则直接拒，不把注定失败的请求发出去。
  let routed
  try {
    routed = await routeAccount(deps)
  } catch (error) {
    if (error instanceof NoQuotaError) {
      log(`无额度拒绝：${error.message.slice(0, 200)}`)
      note(402, error.code)
      sendError(res, 402, error.message, error.code)
      return
    }
    const message = error instanceof NoCredentialError ? error.message : (error as Error).message
    note(401, message)
    sendError(res, 401, message, 'no_credential')
    return
  }
  let credential: WorkBuddyCredential = routed.credential
  accountLabel = routed.name

  accountLabel = credential.displayName ?? credential.nickname ?? credential.uid

  // prepareChatBody 是内核里唯一「按网关规则改写请求体」的地方：强制 stream、
  // 扁平 tool_choice、developer→system、保证首条 system，并把第三方 agent 的
  // 系统提示移出 11128 的渠道指纹。少了这一步，Codex 的 system prompt 会被
  // 直接判成「渠道校验失败」。
  let prepared: string
  try {
    prepared = prepareChatBody(JSON.stringify(parsed))
  } catch (error) {
    const message = `请求体无法规范化：${(error as Error).message}`
    note(400, message)
    sendError(res, 400, message, 'invalid_request')
    return
  }

  // 客户端断开时一并取消上游，避免白烧一次预填充。
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  let result = await deps.client.chatStream(credential, prepared, controller.signal)
  // 换号重试：只在「关于账号」的失败上做（积分不足 / 账号限流 / 凭据失效 /
  // 账号被限制）。MODEL busy 不换——那是模型侧负载，换谁都是同一堵墙。
  // 重试只发生在响应头发出之前，所以客户端看不到半截内容。
  const tried = [routed.accountId]
  while (!result.ok && shouldFailover(result.kind)) {
    const next = await routeAccount(deps, { exclude: tried }).catch(() => undefined)
    if (next === undefined || next.accountId === routed.accountId) break
    const detail = result.detail
    const reason = detail?.rawMsg ?? detail?.displayMsg ?? result.message
    retryReasons.push(result.kind)
    attemptDetails.push({
      attempt: attempts,
      code: result.kind,
      message: reason.slice(0, 200),
    })
    log(`账号失败换号：${routed.name} -> ${next.name}（${result.kind}）`)
    routed = next
    credential = next.credential
    accountLabel = next.name
    tried.push(next.accountId)
    attempts += 1
    result = await deps.client.chatStream(next.credential, prepared, controller.signal)
  }
  if (!result.ok) {
    const detail = result.detail
    // displayMsg 是上游面向用户的句子；rawMsg 才是诊断（11128 家族里它会指明
    // 是哪一条网关规则被触发）。两者都缺时退回原始失败体。
    const message = detail?.displayMsg ?? detail?.rawMsg ?? detail?.tips ?? result.message
    const status = result.status === 0 ? 502 : result.status
    log(`上游错误 status=${result.status} kind=${result.kind} model=${model} :: ${message.slice(0, 200)}`)
    note(status, `${result.kind}: ${message.slice(0, 160)}`)
    sendError(res, status, message, result.kind)
    return
  }

  const upstream = result.response
  if (!wantStream) {
    try {
      const chunks: Record<string, unknown>[] = []
      if (upstream.body !== null) {
        for await (const event of iterSse(upstream.body)) chunks.push(event)
      }
      const aggregated = aggregateChunks(chunks, model)
      // 非流式没有「首字」概念，按整段响应到达计：这个数字与流式的首字不可
      // 直接比较，所以面板上会明确标出「非流式」。
      firstTokenAt = Date.now()
      usage = readUsage(aggregated['usage'])
      sendJson(res, 200, aggregated)
      note(200)
    } catch (error) {
      const message = `聚合非流式响应失败：${(error as Error).message}`
      note(502, message)
      sendError(res, 502, message, 'upstream_error')
    } finally {
      upstream.body?.cancel().catch(() => undefined)
    }
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'close',
    'X-Accel-Buffering': 'no',
  })
  if (upstream.body === null) {
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }
  // 逐字节透传：上游产出的就是 chat completions SSE，重编码只会丢字段。
  const reader = upstream.body.getReader()
  let interrupted: string | undefined
  // 只留尾部 8 KB：usage 在最后一段，整段缓存等于把每次响应复制一遍。
  let tail = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (firstTokenAt === undefined) firstTokenAt = Date.now()
      if (value !== undefined) {
        tail = (tail + Buffer.from(value).toString('utf8')).slice(-8192)
      }
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>(resolve => res.once('drain', () => resolve()))
      }
    }
    res.write('data: [DONE]\n\n')
  } catch (error) {
    // Windows 上客户端取消会抛 ConnectionAbortedError，属预期路径。
    const name = (error as Error).name
    log(`流式转发中断：${name}`)
    interrupted = name
  } finally {
    reader.releaseLock()
    usage = readUsageFromTail(tail)
    res.end()
    // 头已经发出去了，状态码只能是 200；中断信息记在 error 里，
    // 这样「用户点了停止」与「上游中途断流」在流水里仍然可区分。
    note(200, interrupted)
  }
}

/**
 * 用系统默认浏览器打开面板。
 *
 * Windows 走 `cmd /c start`（这是壳里唯一能可靠唤起默认浏览器的方式）；
 * 其他平台交给各自的开箱工具。失败一律吞掉：打不开浏览器不该让代理退出。
 */
export function openPanel(port: number, host = '127.0.0.1'): void {
  const url = `http://${host}:${port}/`
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch (error) {
    log(`打开浏览器失败：${(error as Error).message}`)
  }
}

async function handleStatus(res: ServerResponse, deps: BridgeDeps, port: number, preferredPort: number): Promise<void> {
  const credential = await deps.store.current().catch(() => undefined)
  if (credential === undefined) {
    sendJson(res, 200, {
      ok: false,
      version: WORKBUDDY_CONNECT_VERSION,
      port,
      preferredPort,
      // 面板靠这一个布尔值决定要不要弹窗：端口被占而顺延时，唯一会「静默失效」
      // 的就是 Codex++ 里已经存好的地址，必须主动告知而不是等人来排查。
      shifted: port !== preferredPort,
      account: null,
      reason: 'no_credential',
    })
    return
  }
  const region = deps.region ?? regionOf(credential.domain)
  sendJson(res, 200, {
    ok: true,
    version: WORKBUDDY_CONNECT_VERSION,
    port,
    preferredPort,
    shifted: port !== preferredPort,
    account: {
      uid: credential.uid,
      domain: credential.domain,
      region,
      name: credential.displayName ?? credential.nickname ?? credential.enterpriseUserName ?? '',
      expiresAt: new Date(credential.expiresAtMs).toISOString(),
    },
    models: (await cachedModels(deps)).length,
  })
}

/** 模型在选择器里的显示名：原名 + 当前生效倍率（促销价优先）。 */
function describeRate(model: WorkBuddyUpstreamModel): string {
  const rate = selectPromoMultiplier(model.promos, Date.now()) ?? model.creditMultiplier
  if (rate === undefined) return model.name
  return `${model.name} ×${Number(rate).toFixed(2)}`
}

async function handleModels(res: ServerResponse, deps: BridgeDeps): Promise<void> {
  const credential = await deps.store.current().catch(() => undefined)
  const region = deps.region ?? (credential === undefined ? 'cn' : regionOf(credential.domain))
  const settings = readSettings()
  const regionSettings = settings.regions[region === 'global' ? 'global' : 'cn']
  // 供应商被关掉时一个模型都不报：Codex++ 的「从上游获取」会照这份清单建
  // 下拉，报出去就等于把已关闭的供应商又带回来了。
  if (!regionSettings.on) {
    sendJson(res, 200, { object: 'list', data: [] })
    return
  }
  const models = (await cachedModels(deps)).filter(model => isModelEnabled(regionSettings, model.id))
  // 上下文窗口在这里给三个同义键：不同客户端各读一个（Codex++ 读哪个没有公开
  // 文档，冗余字段无害，缺字段才会让它退回默认长度）。窗口用面板上选的预算，
  // 不是原生窗口——Codex 按这个值决定何时自动压缩，报太大就不会压缩。
  sendJson(res, 200, {
    object: 'list',
    data: models.map(model => {
      const window = budgetFor(regionSettings, model.id, model.contextWindow)
      return {
        id: model.id,
        object: 'model',
        created: 0,
        owned_by: 'workbuddy',
        // 名字带倍率：Codex/Codex++ 的模型选择器只显示 display_name，不显示
        // 我们自己算的倍率；不写在这里，用户就没法在选模型时看到价格差异。
        name: model.name,
        display_name: describeRate(model),
        context_window: window,
        context_length: window,
        max_context_tokens: window,
        max_output_tokens: Math.min(model.maxTokens, window),
        supports_tools: model.supportsToolCall === true,
        supports_vision: regionSettings.imageOff.includes(model.id)
          ? false
          : regionSettings.image.includes(model.id) || model.supportsImages === true,
      }
    }),
  })
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const config = readConfig()
  // 与 CLI 同一条规则：先把桌面端路径钉进环境，再碰凭据。
  applyAppPath(config)
  const port = options.port ?? config.port ?? DEFAULT_PORT
  // 「原定端口」不能等于 `port`：CLI 顺延后传进来的 `port` 已经是新端口了，
  // 拿它当基准会让 shifted 永远是 false，弹窗也就永远不出现。
  const preferredPort = options.preferredPort ?? config.port ?? port
  const host = options.host ?? '127.0.0.1'
  const deps = createBridgeDeps()
  let shuttingDown = false

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`)
    const path = url.pathname
    void (async () => {
      try {
        if (req.method === 'POST' && path === '/v1/chat/completions') {
          await handleChat(req, res, deps)
          return
        }
        if (req.method === 'POST' && path === '/v1/responses') {
          // 路径 A 下不该有人调这里。给明确指引，好过 404 让人以为是端口错了。
          sendError(
            res,
            501,
            '本代理只提供 chat completions（路径 A）。请在 Codex++ 里把该供应商的协议设为 chatCompletions。',
            'not_implemented',
          )
          return
        }
        if (req.method === 'GET' && path === '/v1/models') {
          await handleModels(res, deps)
          return
        }
        if (req.method === 'GET' && path === '/wb/logs') {
          const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10)
          const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 100
          const model = url.searchParams.get('model')
          const q = url.searchParams.get('q')
          sendJson(res, 200, {
            ok: true,
            ...readLogs({
              limit,
              onlyFailed: url.searchParams.get('failed') === '1',
              ...(model === null || model === '' ? {} : { model }),
              ...(q === null || q === '' ? {} : { q }),
            }),
          })
          return
        }
        if (req.method === 'POST' && path === '/wb/logs/clear') {
          clearLogs()
          sendJson(res, 200, { ok: true })
          return
        }
        if (req.method === 'GET' && path === '/wb/overview') {
          // 流水不进食谱缓存：缓存 30 秒的是上游目录与积分，而「刚才那次请求」
          // 必须立刻可见，否则刷新面板看不到自己刚发起的那一轮。
          const overview = await buildOverview(deps)
          sendJson(res, 200, { ...overview, requests: recentRequests(), counters: requestCounters() })
          return
        }
        if (req.method === 'POST' && path === '/wb/checkin') {
          try {
            sendJson(res, 200, await claimCheckin(deps))
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'POST' && path === '/wb/settings') {
          // 面板上每改一个开关都会打这里。写盘后立刻作废目录缓存：`/v1/models`
          // 读的是同一份设置，不能等 30 秒缓存过期才反映「刚取消勾选的模型」。
          const body = await readJsonBody(req)
          try {
            const allIds = (await cachedModels(deps)).map(model => model.id)
            sendJson(res, 200, { ok: true, ...(await applyPanelSettings(body ?? {}, allIds)) })
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'POST' && path === '/wb/region') {
          const body = await readJsonBody(req)
          const region = body?.['region'] === 'global' ? 'global' : body?.['region'] === 'cn' ? 'cn' : undefined
          if (region === undefined) {
            sendJson(res, 400, { ok: false, reason: 'region 必须是 cn 或 global' })
            return
          }
          const settings = readSettings()
          settings.activeRegion = region
          if (typeof body?.['on'] === 'boolean') settings.regions[region].on = body['on']
          await writeSettings(settings)
          invalidateModels()
          invalidateOverview()
          invalidateBalances()
          // 切区域不只是换个 tab：两边的账号与积分池本来就是分开的，所以顺手
          // 把该区域本机已有的账号选上。没有账号时不假装成功，回 selected:false
          // 让面板显示「这一侧还没登录」。
          let selected = false
          if (body?.['select'] !== false) {
            const list = await listAccounts(deps)
            const hit = list.accounts.find(account => account.region === region && !account.expired)
            if (hit !== undefined) {
              selectAccount(deps, hit.id)
              selected = true
            }
          }
          sendJson(res, 200, {
            ok: true,
            activeRegion: settings.activeRegion,
            regionOn: settings.regions[region].on,
            selected,
          })
          return
        }
        if (req.method === 'GET' && path === '/wb/accounts') {
          // 余额随列表一起给：用户不该为了知道某个号还剩多少分而先切过去。
          // 「切换后才刷新」的老问题一半出在这里——列表本来就没有余额字段。
          const force = url.searchParams.get('refresh') === '1'
          if (force) invalidateBalances()
          const [list, balances] = await Promise.all([listAccounts(deps), accountBalances(deps, force)])
          sendJson(res, 200, {
            ...list,
            accounts: list.accounts.map((account) => {
              const row = balances.find(item => item.id === account.id)
              return {
                ...account,
                total: row?.total ?? null,
                usable: row?.usable ?? true,
                ...(row?.balanceError === undefined ? {} : { balanceError: row.balanceError }),
              }
            }),
            policy: { switchFloor: SWITCH_FLOOR, minUsable: MIN_USABLE },
          })
          return
        }
        if (req.method === 'POST' && path === '/wb/accounts/select') {
          const body = await readJsonBody(req)
          const id = typeof body?.['id'] === 'string' ? body['id'] : ''
          selectAccount(deps, id)
          // 换号后必须让两个缓存失效，否则面板还会显示上一个账号的积分与模型
          // 目录（用户报的就是这个：切过去了，数字没变）。
          invalidateOverview()
          invalidateBalances()
          sendJson(res, 200, { ok: true, ...(await listAccounts(deps)) })
          return
        }
        if (req.method === 'POST' && path === '/wb/accounts/remove') {
          const body = await readJsonBody(req)
          const id = typeof body?.['id'] === 'string' ? body['id'] : ''
          if (id === '') {
            sendJson(res, 400, { ok: false, reason: '缺少 id' })
            return
          }
          try {
            sendJson(res, 200, { ok: await removeAccount(deps, id) })
          } catch (error) {
            sendJson(res, 400, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'POST' && path === '/wb/oauth/start') {
          const body = await readJsonBody(req)
          const region: WorkBuddyRegion = body?.['region'] === 'global' ? 'global' : 'cn'
          const started = await startLogin(region)
          sendJson(res, 200, 'error' in started ? { ok: false, reason: started.error } : { ok: true, ...started })
          return
        }
        if (req.method === 'GET' && path === '/wb/device') {
          try {
            sendJson(res, 200, { ok: true, ...(await deviceStatus()) })
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'POST' && path === '/wb/device/mode') {
          const body = await readJsonBody(req)
          const mode = body?.['mode'] === 'real' ? 'real' : body?.['mode'] === 'virtual' ? 'virtual' : undefined
          if (mode === undefined) {
            sendJson(res, 400, { ok: false, reason: 'mode 必须是 virtual 或 real' })
            return
          }
          try {
            sendJson(res, 200, { ok: true, ...(await switchDeviceMode(mode)), restartRequired: true })
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'POST' && path === '/wb/device/sdk') {
          const body = await readJsonBody(req)
          const sdkDir = typeof body?.['sdkDir'] === 'string' ? body['sdkDir'] : undefined
          const fallback = typeof body?.['sdkFallbackToVirtual'] === 'boolean' ? body['sdkFallbackToVirtual'] : undefined
          try {
            sendJson(res, 200, {
              ok: true,
              ...(await saveSdkDir({
                ...(sdkDir === undefined ? {} : { sdkDir }),
                ...(fallback === undefined ? {} : { sdkFallbackToVirtual: fallback }),
              })),
              restartRequired: true,
            })
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'GET' && path === '/wb/tps') {
          const modelId = normalizeModelId(url.searchParams.get('model') ?? '')
          if (modelId === '') {
            sendJson(res, 400, { ok: false, reason: '缺少 model 参数' })
            return
          }
          try {
            sendJson(res, 200, { ok: true, model: modelId, sample: await measureSpeed(deps, modelId) })
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'GET' && path === '/wb/probe') {
          const modelId = normalizeModelId(url.searchParams.get('model') ?? '')
          if (modelId === '') {
            sendJson(res, 400, { ok: false, message: '缺少 model 参数' })
            return
          }
          try {
            sendJson(res, 200, { model: modelId, ...(await probeModel(deps, modelId)) })
          } catch (error) {
            sendJson(res, 200, { ok: false, model: modelId, status: 0, retryAfter: null, message: (error as Error).message })
          }
          return
        }
        if (req.method === 'GET' && path === '/wb/install') {
          // 「接入」页的数据源：字段、建议模型与窗口都由这里算，页面只负责
          // 排版和复制。与 CLI 的 `install` 共用同一套推算，不会给出两套数字。
          const credential = await deps.store.current().catch(() => undefined)
          const region = deps.region ?? (credential === undefined ? 'cn' : regionOf(credential.domain))
          const regionSettings = readSettings().regions[region === 'global' ? 'global' : 'cn']
          const catalogue = await cachedModels(deps)
          const enabledIds = catalogue.filter(model => isModelEnabled(regionSettings, model.id)).map(model => model.id)
          sendJson(res, 200, {
            ok: true,
            ...installPayload({
              proxyPort: actualPort,
              preferredPort,
              region,
              models: catalogue,
              enabledIds,
              budgets: regionSettings.budgets,
            }),
          })
          return
        }
        if (req.method === 'POST' && path === '/wb/models/refresh') {
          sendJson(res, 200, await refreshModels(deps))
          return
        }
        if (req.method === 'GET' && path === '/wb/media-models') {
          try {
            sendJson(res, 200, { ok: true, models: await mediaModels(deps) })
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message, models: [] })
          }
          return
        }
        if (req.method === 'GET' && path === '/wb/benefits') {
          try {
            sendJson(res, 200, { ok: true, benefits: await listBenefits(deps) })
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message, benefits: [] })
          }
          return
        }
        if (req.method === 'POST' && path === '/wb/benefits/claim') {
          const body = await readJsonBody(req)
          const raw = body?.['kind']
          const kind = raw === 'gift' ? 'gift' : raw === 'compensation' ? 'compensation' : undefined
          if (kind === undefined) {
            sendJson(res, 400, { ok: false, reason: 'kind 必须是 compensation 或 gift' })
            return
          }
          try {
            sendJson(res, 200, await claimBenefit(deps, kind))
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: (error as Error).message })
          }
          return
        }
        if (req.method === 'GET' && path === '/wb/oauth/poll') {
          const loginId = url.searchParams.get('loginId') ?? ''
          const region: WorkBuddyRegion = url.searchParams.get('region') === 'global' ? 'global' : 'cn'
          if (loginId === '') {
            sendJson(res, 400, { ok: false, done: true, error: '缺少 loginId' })
            return
          }
          try {
            sendJson(res, 200, await pollLogin(deps, loginId, region))
          } catch (error) {
            sendJson(res, 200, { ok: false, done: true, error: (error as Error).message })
          }
          return
        }
        if (req.method === 'POST' && path === '/wb/shutdown') {
          // 停止通道只服务本机：浏览器发起的跨站请求一定带 Origin，而本服务
          // 不返回任何 CORS 头，因此「Origin 不是本机」一律拒绝。命令行与
          // curl 不带 Origin，照常允许。这样任意网页没法偷偷把代理关掉。
          const origin = req.headers.origin
          if (origin !== undefined && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
            sendError(res, 403, '只接受本机来源的停止请求', 'forbidden')
            return
          }
          sendJson(res, 200, { ok: true, shuttingDown: true, port: actualPort, pid: process.pid })
          // 先把响应刷出去再关：直接 close 会让客户端看到一个断掉的连接，
          // 分不清「停成功了」还是「刚才那次请求坏了」。
          setImmediate(() => requestShutdown())
          return
        }
        if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
          const html = renderPage()
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(html),
            'Cache-Control': 'no-store',
          })
          res.end(html)
          return
        }
        if (req.method === 'GET' && (path === '/wb/health' || path === '/wb/status')) {
          await handleStatus(res, deps, actualPort, preferredPort)
          return
        }
        sendError(res, 404, `未知路径 ${path}`, 'not_found')
      } catch (error) {
        log('未捕获异常:', (error as Error).stack ?? String(error))
        if (!res.headersSent) sendError(res, 500, (error as Error).message, 'internal_error')
        else res.end()
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port
  writeRuntime(actualPort)

  /**
   * 正常停止：关监听 → 退进程。
   *
   * 不等在途请求：用户点「停止」就是要它停。但 SSE 流是长连接，`server.close`
   * 在还有活跃连接时不会回调，所以留一个 4 秒兜底强制退出——否则点了停止却
   * 什么都不发生，比直接不响应更让人困惑。
   */
  function requestShutdown(): void {
    if (shuttingDown) return
    shuttingDown = true
    // 先把归我们管的子进程收掉，再关监听。顺序不能反：worker 是当前进程的
    // 子进程，一旦本进程先退出，它们会被 Windows 变成孤儿继续跑，用户就还
    // 得去任务管理器里收拾——这正是「关闭按钮」要避免的事。
    const killed = killLiveWorkers()
    log(`收到关闭请求：已结束 ${killed} 个辅助进程，正在关闭监听`)
    clearRuntime()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 4000).unref()
  }
  const panelUrl = `http://${host}:${actualPort}/`
  log(`listening on http://${host}:${actualPort}/v1`)
  log(`面板 ${panelUrl}`)

  if (options.open === true) {
    // 就绪之后才开浏览器：提前开只会看到一个「无法连接」的白页。
    openPanel(actualPort, host)
  }

  return {
    port: actualPort,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => (error === undefined ? resolve() : reject(error)))
    }),
  }
}
