/**
 * 面板设置：每个模型一行上的那些开关，落到 `~/.wb-codex-bridge/panel.json`。
 *
 * 为什么必须持久化而不是只放在页面上：这些开关不是装饰。`enabled` 决定
 * `/v1/models` 报不报这个名字（Codex++ 的「从上游获取」直接照着它建模型
 * 下拉），`budget` 决定报出去的 `context_window`（Codex 按它算自动压缩的
 * 时机）。勾了却不生效比没有勾选框更坏，所以状态一律写盘、由服务端读取。
 *
 * 结构按区域分开：国内版与国际版是两个独立供应商，各有各的账号与倍率，
 * 关掉一边不该影响另一边。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome, writeFileAtomic } from '../core/host-peers.ts'

export type RegionKey = 'cn' | 'global'

export interface RegionSettings {
  /** 这一侧供应商是否启用；关掉后它的模型不再出现在 `/v1/models`。 */
  on: boolean
  /** 启用的模型 id；`null` 表示「没动过」——全部启用，随上游目录走。 */
  enabled: string[] | null
  /** 声明支持图片输入的模型 id。 */
  image: string[]
  /**
   * 用户显式关掉图片的模型 id。
   *
   * 为什么需要这一份「反向名单」：上游目录里 `supportsImages` 为真的模型默认
   * 勾选，用户取消勾选时如果只从 `image` 里删，下一个读到的仍是「上游声明支持」，
   * 勾选框会自己弹回去。取消勾选必须留下一条明确的否定记录。
   */
  imageOff: string[]
  /** 勾了「可关闭思考」的模型 id。 */
  off: string[]
  /** 逐模型上下文预算（token）；缺省或 0 表示用模型原生窗口。 */
  budgets: Record<string, number>
  /** 逐模型默认推理强度；缺省表示跟随上游默认。 */
  efforts: Record<string, string>
}

export interface PanelSettings {
  version: 1
  activeRegion: RegionKey
  regions: Record<RegionKey, RegionSettings>
}

function emptyRegion(on: boolean): RegionSettings {
  return { on, enabled: null, image: [], imageOff: [], off: [], budgets: {}, efforts: {} }
}

function defaultSettings(): PanelSettings {
  // 第一次打开时两侧都算启用：用户已经登录的那一侧立刻可用，没登录的那一侧
  // 由卡片自己显示「该区域没有账号」，不需要他先去勾一个勾选框。
  return {
    version: 1,
    activeRegion: 'cn',
    regions: { cn: emptyRegion(true), global: emptyRegion(true) },
  }
}

export function settingsPath(): string {
  return join(resolveDshHome(), 'panel.json')
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

function asNumberMap(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) out[key] = Math.round(raw)
  }
  return out
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw !== '') out[key] = raw
  }
  return out
}

function readRegion(raw: unknown): RegionSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyRegion(true)
  const value = raw as Record<string, unknown>
  const enabled = value['enabled'] === null ? null : asStringArray(value['enabled']) ?? null
  return {
    on: value['on'] !== false,
    enabled,
    image: asStringArray(value['image']) ?? [],
    imageOff: asStringArray(value['imageOff']) ?? [],
    off: asStringArray(value['off']) ?? [],
    budgets: asNumberMap(value['budgets']),
    efforts: asStringMap(value['efforts']),
  }
}

export function readSettings(): PanelSettings {
  const path = settingsPath()
  if (!existsSync(path)) return defaultSettings()
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultSettings()
    const record = value as Record<string, unknown>
    const regions = typeof record['regions'] === 'object' && record['regions'] !== null
      ? record['regions'] as Record<string, unknown>
      : {}
    return {
      version: 1,
      activeRegion: record['activeRegion'] === 'global' ? 'global' : 'cn',
      regions: { cn: readRegion(regions['cn']), global: readRegion(regions['global']) },
    }
  } catch {
    // 文件坏了退回默认值，不让面板因为一份设置起不来。
    return defaultSettings()
  }
}

export async function writeSettings(settings: PanelSettings): Promise<void> {
  await writeFileAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/** 某个模型在当前区域是否被启用。`enabled === null` 时视为全部启用。 */
export function isModelEnabled(region: RegionSettings, id: string): boolean {
  return region.enabled === null || region.enabled.includes(id)
}

/** 模型实际报出去的窗口：显式预算优先，否则用原生窗口。 */
export function budgetFor(region: RegionSettings, id: string, native: number): number {
  const saved = region.budgets[id]
  return saved === undefined || saved <= 0 ? native : saved
}

/** 面板上「加入/移出启用」的写入口，保持 `enabled` 的 `null` 语义。 */
export function toggleEnabled(region: RegionSettings, id: string, allIds: readonly string[], next: boolean): void {
  const current = region.enabled === null ? [...allIds] : [...region.enabled]
  const has = current.includes(id)
  if (next && !has) current.push(id)
  if (!next && has) current.splice(current.indexOf(id), 1)
  region.enabled = current
}

/** 数组型开关（图片、可关闭思考）的通用增删。 */
export function toggleMember(list: string[], id: string, next: boolean): void {
  const has = list.includes(id)
  if (next && !has) list.push(id)
  if (!next && has) list.splice(list.indexOf(id), 1)
}

/** 一个模型在一次提交里可以改的字段。 */
export interface ModelPatch {
  enabled?: boolean
  image?: boolean
  off?: boolean
  /** 上下文预算（token）。0 或 null 表示回到原生窗口。 */
  budget?: number | null
  /** 默认推理强度；空串表示跟随上游默认。 */
  effort?: string
}

function applyOne(region: RegionSettings, id: string, patch: ModelPatch, allIds: readonly string[]): void {
  if (typeof patch.enabled === 'boolean') toggleEnabled(region, id, allIds, patch.enabled)
  if (typeof patch.image === 'boolean') {
    toggleMember(region.image, id, patch.image)
    toggleMember(region.imageOff, id, !patch.image)
  }
  if (typeof patch.off === 'boolean') toggleMember(region.off, id, patch.off)
  if (patch.budget === null || patch.budget === 0) delete region.budgets[id]
  else if (typeof patch.budget === 'number' && patch.budget > 0) region.budgets[id] = Math.round(patch.budget)
  if (typeof patch.effort === 'string') {
    if (patch.effort === '') delete region.efforts[id]
    else region.efforts[id] = patch.effort
  }
}

export interface SettingsPatchBody {
  region?: unknown
  patch?: unknown
  all?: unknown
}

/**
 * 应用一次面板提交。
 *
 * `patch` 是「逐模型」的改动（勾选框、窗口档位、推理强度），`all` 是「批量」
 * 的改动（一键把某档窗口套到所有模型）——两者的字段语义完全相同，只是作用域
 * 不同，所以共用 {@link ModelPatch}。
 */
export async function applyPanelSettings(body: SettingsPatchBody, allIds: readonly string[]): Promise<Record<string, unknown>> {
  const settings = readSettings()
  const regionKey: RegionKey = body.region === 'global' ? 'global' : 'cn'
  const region = settings.regions[regionKey]
  settings.activeRegion = regionKey

  const all = typeof body.all === 'object' && body.all !== null && !Array.isArray(body.all)
    ? body.all as ModelPatch
    : undefined
  if (all !== undefined) {
    for (const id of allIds) applyOne(region, id, all, allIds)
  }

  const patch = typeof body.patch === 'object' && body.patch !== null && !Array.isArray(body.patch)
    ? body.patch as Record<string, ModelPatch>
    : {}
  for (const [id, one] of Object.entries(patch)) {
    if (typeof one !== 'object' || one === null) continue
    applyOne(region, id, one, allIds)
  }

  await writeSettings(settings)
  return {
    region: regionKey,
    on: region.on,
    enabled: region.enabled,
    image: region.image,
    imageOff: region.imageOff,
    off: region.off,
    budgets: region.budgets,
    efforts: region.efforts,
  }
}
