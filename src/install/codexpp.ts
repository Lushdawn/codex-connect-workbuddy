/**
 * Codex++ 侧的只读探测与安装指引。
 *
 * 这里刻意**不写** `gateway.json`。原因不是懒：那个文件里每个供应商都带一份
 * `relay.configContents`——Codex++ 切换供应商时用它整份覆盖 `~/.codex/config.toml`。
 * 凭空构造一条供应商，等于让用户下次切换时把现有配置（模型目录、插件启用状态、
 * 项目信任级别）整体替换成我们猜的内容。所以安装只输出参数，写盘留给 Codex++
 * 自己的面板。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fallbackModelsFor } from '../core/catalog.ts'
import type { WorkBuddyModelInfo } from '../core/catalog.ts'

/** Codex++ 把自己的状态放在这个目录（名字沿用它的历史，不是我们起的）。 */
const CODEXPP_STATE_DIR = join(homedir(), '.codex-session-delete')

export interface GatewayInfo {
  /** Codex 当前指向的本地网关端口，未接管时为 null。 */
  readonly port: number | null
  /** 是否发现 Codex++ 状态目录。 */
  readonly installed: boolean
  /** 池内已有供应商 id，用于提醒重名。 */
  readonly providerIds: readonly string[]
  /** 池内每个供应商当前配置的上游地址，用于发现「端口已变但地址没改」。 */
  readonly endpoints: readonly { readonly id: string; readonly baseUrl: string }[]
}

function readCodexConfig(): string {
  const path = join(homedir(), '.codex', 'config.toml')
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function readGatewayInfo(): GatewayInfo {
  const config = readCodexConfig()
  // Codex 的 provider 段里 base_url 指向网关；取最后一个匹配是刻意的：
  // Codex++ 托管的 `codex_plus_managed` 段写在文件末尾，它才是实际生效的那条。
  const matches = [...config.matchAll(/base_url\s*=\s*"http:\/\/127\.0\.0\.1:(\d+)\/v1"/g)]
  const last = matches[matches.length - 1]
  const port = last?.[1] === undefined ? null : Number.parseInt(last[1], 10)

  const gatewayPath = join(CODEXPP_STATE_DIR, 'gateway.json')
  if (!existsSync(gatewayPath)) {
    return { port, installed: false, providerIds: [], endpoints: [] }
  }
  let providerIds: string[] = []
  let endpoints: { id: string; baseUrl: string }[] = []
  try {
    const doc = JSON.parse(readFileSync(gatewayPath, 'utf8')) as Record<string, unknown>
    const providers = doc['providers']
    if (Array.isArray(providers)) {
      providerIds = providers.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return []
        const relay = (entry as Record<string, unknown>)['relay']
        if (typeof relay !== 'object' || relay === null) return []
        const id = (relay as Record<string, unknown>)['id']
        return typeof id === 'string' ? [id] : []
      })
      // 顺带记下每个供应商配置的上游地址：端口一旦顺延，唯一会「静默失效」
      // 的就是 Codex++ 里已经存好的那条地址，必须能主动发现它。
      endpoints = providers.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return []
        const relay = (entry as Record<string, unknown>)['relay']
        if (typeof relay !== 'object' || relay === null) return []
        const id = (relay as Record<string, unknown>)['id']
        const url = (relay as Record<string, unknown>)['upstreamBaseUrl']
        if (typeof id !== 'string' || typeof url !== 'string') return []
        return [{ id, baseUrl: url }]
      })
    }
  } catch {
    providerIds = []
    endpoints = []
  }
  return { port, installed: true, providerIds, endpoints }
}

/**
 * 建议放进 Codex++ 的模型清单。
 *
 * 顺序不是按目录原序：`/v3/config` 的返回里视觉模型与轻量模型排在前，
 * 而 Codex 要的是长上下文 + 工具调用稳的编程主力；把视觉模型塞进去只会让
 * 选择器变长并诱导错误选择。这里按「已知适合编程」的偏好排，再补足数量。
 */
const PREFERRED_FOR_CODING = [
  'deepseek-v4.1-flash',
  'glm-5.3',
  'deepseek-v4-pro',
  'hy4flash-free',
  'kimi-k3-1',
] as const

export function suggestedModels(models: readonly WorkBuddyModelInfo[], limit = 5): readonly WorkBuddyModelInfo[] {
  const byId = new Map(models.map(model => [model.id, model]))
  const picked: WorkBuddyModelInfo[] = []
  for (const id of PREFERRED_FOR_CODING) {
    const model = byId.get(id)
    if (model !== undefined) picked.push(model)
    if (picked.length >= limit) return picked
  }
  for (const model of models) {
    if (picked.length >= limit) break
    if (!picked.includes(model)) picked.push(model)
  }
  return picked
}

export interface InstallGuideOptions {
  readonly proxyPort: number
  readonly region: 'cn' | 'global'
  readonly models: readonly WorkBuddyModelInfo[]
}

export function renderInstallGuide(options: InstallGuideOptions): string {
  const { proxyPort, region, models } = options
  const gateway = readGatewayInfo()
  const picked = suggestedModels(models)
  const lines: string[] = []

  lines.push('一、确认代理在跑')
  lines.push(`   wbx serve --port ${proxyPort}`)
  lines.push(`   curl http://127.0.0.1:${proxyPort}/wb/health`)
  lines.push('')

  if (!gateway.installed) {
    lines.push('二、没有发现 Codex++，改用 Codex 原生 provider（退路）')
    lines.push(`   在 ~/.codex/wb.config.toml 写入：`)
    lines.push('')
    lines.push('     model_provider = "workbuddy"')
    lines.push(`     model = "${picked[0]?.id ?? 'deepseek-v4-flash'}"`)
    lines.push('')
    lines.push('   并在 ~/.codex/config.toml 追加：')
    lines.push('')
    lines.push('     [model_providers.workbuddy]')
    lines.push('     name = "WorkBuddy"')
    lines.push(`     base_url = "http://127.0.0.1:${proxyPort}/v1"`)
    lines.push('     wire_api = "chat"')
    lines.push('     requires_openai_auth = false')
    lines.push('     experimental_bearer_token = "wbx-local"')
    lines.push('')
    lines.push('   然后用 `codex --profile wb` 启动。')
    return lines.join('\n')
  }

  lines.push('二、在 Codex++ 面板添加供应商')
  lines.push('   打开 Codex++ 管理工具 → 供应商 → 添加 → 自定义（纯 API）')
  lines.push('')
  lines.push('   字段                      值')
  lines.push('   ─────────────────────────────────────────────────────────')
  lines.push('   名称                      WorkBuddy')
  lines.push(`   供应商 ID                wb-${region}`)
  lines.push(`   上游地址                  http://127.0.0.1:${proxyPort}/v1`)
  lines.push('   协议                      chatCompletions   ← 关键，路径 A 靠它转换')
  lines.push('   模式                      pureApi')
  lines.push('   鉴权                      无（或占位值 wbx-local，代理不校验）')
  lines.push(`   模型                      ${picked.map(model => model.id).join(', ')}`)
  lines.push('')
  lines.push('   上下文窗口建议：单个模型按上游原生窗口的 1/4～1/2 填写。')
  lines.push('   WorkBuddy 目录里的窗口是理论上限，Codex 会据此推迟压缩，')
  lines.push('   填满容易在中途撞上上游限流。')
  lines.push('')
  if (gateway.providerIds.includes(`wb-${region}`)) {
    lines.push(`   注意：池里已经有 id 为 wb-${region} 的供应商，换一个 id 避免路由歧义。`)
    lines.push('')
  }
  lines.push('三、验证')
  lines.push(`   1. Codex++ 里选中 WorkBuddy 供应商，新建会话（供应商与模型逐会话绑定）`)
  lines.push('   2. 问一句：用 read_file 读一下 package.json')
  lines.push('   3. 代理侧应打印请求日志；工具调用能跑通就说明链路完整')
  lines.push('')
  lines.push(`   现有供应商：${gateway.providerIds.length === 0 ? '(无)' : gateway.providerIds.join(', ')}`)
  lines.push(`   当前网关端口：${gateway.port === null ? '(未接管)' : String(gateway.port)}`)
  return lines.join('\n')
}

export function modelTable(models: readonly WorkBuddyModelInfo[]): string {
  return models
    .map((model) => `${model.id.padEnd(24)} ${String(Math.round(model.contextWindow / 1000)).padStart(5)}K  ${model.name}`)
    .join('\n')
}

/**
 * 面板「接入」页要用的结构化参数。
 *
 * 为什么不直接把 `renderInstallGuide` 的文本搬上网页：那段是给终端看的对齐
 * 文本，网页上没法逐字段复制。这里给出字段名与值的对应关系，页面负责排版和
 * 复制按钮，`install` 命令仍走原来的文本版——两处共用同一份建议模型与窗口
 * 推算，不会给出互相矛盾的数字。
 */
export interface InstallPayload {
  proxyPort: number
  baseUrl: string
  providerId: string
  name: string
  protocol: string
  relayMode: string
  apiKey: string
  defaultModel: string
  /** 可直接粘进「模型列表」的多行文本，每行 `模型[窗口]`。 */
  modelList: string
  models: { id: string; name: string; nativeWindow: number; window: number; rate: number | null; enabled: boolean }[]
  gateway: {
    installed: boolean
    port: number | null
    providerIds: readonly string[]
  }
  warnings: string[]
  endpoints: { health: string; models: string; chat: string }
}

/**
 * 建议窗口：原生窗口的一半，上限 500K。
 *
 * 上限不是审美：上游目录里的 1M 是理论上限，Codex 按这个数字推迟自动压缩，
 * 填满会在中途撞上 14003 限流。留一半余量，既不浪费窗口，也不至于压缩过频。
 */
export function suggestedWindow(native: number): number {
  if (native <= 200_000) return native
  const half = Math.min(500_000, Math.floor(native / 2))
  return Math.round(half / 1000) * 1000
}

export function installPayload(options: {
  readonly proxyPort: number
  /** 原定端口（配置里的值）。与实际端口不同时说明发生过顺延。 */
  readonly preferredPort?: number
  readonly region: 'cn' | 'global'
  readonly models: readonly WorkBuddyModelInfo[]
  readonly enabledIds?: readonly string[]
  readonly budgets?: Readonly<Record<string, number>>
}): InstallPayload {
  const { proxyPort, region, models } = options
  const enabled = options.enabledIds
  const usable = enabled === undefined ? models : models.filter(model => enabled.includes(model.id))
  const rows = usable
    .map((model) => {
      const saved = options.budgets?.[model.id]
      const window = saved !== undefined && saved > 0 ? saved : suggestedWindow(model.contextWindow)
      return {
        id: model.id,
        name: model.name,
        nativeWindow: model.contextWindow,
        window,
        rate: model.creditMultiplier ?? null,
        enabled: true,
      }
    })
    .sort((a, b) => (a.rate ?? 99) - (b.rate ?? 99))

  const gateway = readGatewayInfo()
  const providerId = `wb-${region}`
  const warnings: string[] = []
  if (gateway.providerIds.includes(providerId)) {
    warnings.push(`供应商池里已经有 id 为 ${providerId} 的条目：重复添加会抢同一条路由，换一个 id 或用面板改现有那条。`)
  } else {
    const existing = gateway.providerIds.find(id => id === 'workbuddy' || id.startsWith('wb-'))
    if (existing !== undefined) {
      warnings.push(`供应商池里已有「${existing}」：如果你已经用它接上了 WorkBuddy，就不必再加一条；下面的 ID 只是建议值。`)
    }
  }
  if (!gateway.installed) {
    warnings.push('没有发现 Codex++：可以改用 Codex 原生 provider，见本页底部。')
  }
  // 端口顺延必须显式说出来：下面每一行地址都按实际端口生成了，但 Codex++ 里
  // 若已经保存过一条指向原定端口的供应商，它不会自己改——用户会看到「地址明明
  // 对着却连不上」，这一类问题最难自查。
  const stale = (gateway.endpoints ?? [])
    .map((entry) => {
      const match = /^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/.exec(entry.baseUrl)
      const portInUrl = match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10)
      return portInUrl === undefined || portInUrl === proxyPort ? undefined : { id: entry.id, port: portInUrl }
    })
    .filter((entry): entry is { id: string; port: number } => entry !== undefined)
  if (stale.length > 0) {
    const detail = stale.map(entry => `「${entry.id}」→ 127.0.0.1:${entry.port}`).join('、')
    warnings.push(
      `Codex++ 里有供应商指向上一个端口：${detail}；本代理现在在 ${proxyPort}。`
      + `请在 Codex++ 面板里把那条的上游地址改成 ${`http://127.0.0.1:${proxyPort}/v1`}，否则会连不上。`,
    )
  }

  const preferred = options.preferredPort
  if (preferred !== undefined && preferred !== proxyPort) {
    warnings.push(
      `端口 ${preferred} 被占用，本次实际使用 ${proxyPort}：下面所有地址已按 ${proxyPort} 生成。`
      + `如果 Codex++ 里已经保存过指向 ${preferred} 的供应商，请把那条的上游地址改成本页的 Base URL。`,
    )
  }

  return {
    proxyPort,
    baseUrl: `http://127.0.0.1:${proxyPort}/v1`,
    providerId,
    name: 'WorkBuddy',
    protocol: 'chatCompletions',
    relayMode: 'pureApi',
    apiKey: 'wbx-local',
    // 默认模型取「适合写代码」的那一档，而不是最便宜的那一档：按倍率排序
    // 会把 0 倍率的小模型排在首位，拿它当 Codex 默认模型只会让人误判质量。
    defaultModel: suggestedModels(models)[0]?.id ?? rows[0]?.id ?? 'deepseek-v4.1-flash',
    modelList: rows.map(row => `${row.id}[${formatWindow(row.window)}]`).join('\n'),
    models: rows,
    gateway: {
      installed: gateway.installed,
      port: gateway.port,
      providerIds: gateway.providerIds,
    },
    warnings,
    endpoints: {
      health: `http://127.0.0.1:${proxyPort}/wb/health`,
      models: `http://127.0.0.1:${proxyPort}/v1/models`,
      chat: `http://127.0.0.1:${proxyPort}/v1/chat/completions`,
    },
  }
}

/** `500000` → `500K`，`1000000` → `1M`（Codex++ 的模型列表就是这种写法）。 */
function formatWindow(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  return `${Math.round(value / 1000)}K`
}

export function fallbackModels(region: 'cn' | 'global'): readonly WorkBuddyModelInfo[] {
  return fallbackModelsFor(region)
}
