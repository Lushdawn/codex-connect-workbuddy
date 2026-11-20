/**
 * 面板数据：把「账号 + 模型目录 + 积分 + 签到」聚成一个响应。
 *
 * 缓存 30 秒是刻意的：拉目录是 GET `/v3/config`，签到状态是另一条 GET，
 * 都是只读但会消耗往返；面板刷新按钮不该变成对上游的压力测试。写操作
 * （签到）会主动作废缓存，所以「签完立刻看到新数字」不依赖等待。
 */

import { regionOf } from '../core/upstream.ts'
import type { WorkBuddyUpstreamModel } from '../core/upstream.ts'
import { selectPromoBadge, selectPromoMultiplier } from '../core/promo.ts'
import { fallbackModelsFor } from '../core/catalog.ts'
import { WORKBUDDY_CONNECT_VERSION } from '../core/version.ts'
import { budgetFor, isModelEnabled, readSettings } from './settings.ts'
import type { RegionSettings } from './settings.ts'
import { log } from './store.ts'
import type { BridgeDeps } from './store.ts'

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  at: number
  value: Record<string, unknown>
}

let cache: CacheEntry | undefined

export function invalidateOverview(): void {
  cache = undefined
}

function shapeModel(model: WorkBuddyUpstreamModel, region: RegionSettings): Record<string, unknown> {
  const now = Date.now()
  // 倍率有两层：目录里的基础倍率，和「此刻正在生效」的促销价。原版卡片画的
  // 是后者（夜间折扣时那一行会显示 0.00），所以这里也按同一个时钟计算，
  // 避免面板显示原价、账单按折扣价扣——两个数字对不上最难解释。
  const promoRate = selectPromoMultiplier(model.promos, now)
  const badge = selectPromoBadge(model.promos, now)
  const efforts = model.reasoning?.supportedEfforts ?? []
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    nativeContextWindow: model.contextWindow,
    budget: budgetFor(region, model.id, model.contextWindow),
    creditMultiplier: model.creditMultiplier ?? null,
    rate: promoRate ?? model.creditMultiplier ?? null,
    badge: badge === undefined
      ? null
      : { label: badge.badge.label, color: badge.badge.color ?? null },
    efforts,
    defaultEffort: model.reasoning?.defaultEffort ?? null,
    supportsToolCall: model.supportsToolCall === true,
    // catalog 只发布「上游声明」的图片能力，运行时开关由用户选择决定；
    // 面板展示的是前者，所以两者取或。
    multimodal: model.multimodal === true || model.supportsImages === true,
    // 用户侧的三个开关：是否启用、是否声明图片、是否可关闭思考。
    enabled: isModelEnabled(region, model.id),
    imageOn: region.imageOff.includes(model.id)
      ? false
      : region.image.includes(model.id) || model.supportsImages === true,
    offOn: region.off.includes(model.id),
    offBlocked: model.reasoning?.refusesOff === true,
    effort: region.efforts[model.id] ?? '',
  }
}

export async function buildOverview(deps: BridgeDeps): Promise<Record<string, unknown>> {
  if (cache !== undefined && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  const credential = await deps.store.current().catch((error: unknown) => {
    log('读取凭据失败:', (error as Error).message)
    return undefined
  })

  if (credential === undefined) {
    const value = {
      ok: false,
      version: WORKBUDDY_CONNECT_VERSION,
      reason: '未读到 WorkBuddy 登录态：先在桌面端登录，再运行 wbx doctor 确认。',
    }
    cache = { at: Date.now(), value }
    return value
  }

  const region = deps.region ?? regionOf(credential.domain)
  // 三个请求互相独立：任何一个失败都只让对应卡片空着，而不是整页报错。
  const [modelsResult, creditsResult, checkinResult] = await Promise.allSettled([
    deps.client.fetchModels(credential),
    deps.client.fetchCredits(credential),
    deps.client.fetchCheckinStatus(credential),
  ])

  if (modelsResult.status === 'rejected') {
    log('拉取模型目录失败，回落内置目录:', (modelsResult.reason as Error).message)
  }

  const models = modelsResult.status === 'fulfilled'
    ? modelsResult.value
    : fallbackModelsFor(region)

  const credits = creditsResult.status === 'fulfilled' ? creditsResult.value : undefined
  const checkin = checkinResult.status === 'fulfilled' ? checkinResult.value : undefined
  const settings = readSettings()
  const regionSettings = settings.regions[region === 'global' ? 'global' : 'cn']

  const value = {
    ok: true,
    version: WORKBUDDY_CONNECT_VERSION,
    source: modelsResult.status === 'fulfilled' ? '上游目录' : '内置目录',
    account: {
      uid: credential.uid,
      domain: credential.domain,
      region,
      name: credential.displayName ?? credential.nickname ?? credential.enterpriseUserName ?? '',
      expiresAt: new Date(credential.expiresAtMs).toISOString(),
    },
    credits: credits === undefined
      ? null
      : {
          total: credits.total,
          expiringSoon: credits.expiringSoon,
          nearestExpiry: credits.nearestExpiryMs === undefined ? null : new Date(credits.nearestExpiryMs).toISOString(),
        },
    checkin: checkin ?? null,
    models: models.map(model => shapeModel(model, regionSettings)),
    settings: {
      activeRegion: settings.activeRegion,
      regionOn: { cn: settings.regions.cn.on, global: settings.regions.global.on },
      enabledCount: models.filter(model => isModelEnabled(regionSettings, model.id)).length,
    },
  }
  cache = { at: Date.now(), value }
  return value
}

export async function claimCheckin(deps: BridgeDeps): Promise<Record<string, unknown>> {
  const credential = await deps.store.current()
  if (credential === undefined) {
    return { ok: false, reason: '未读到 WorkBuddy 登录态' }
  }
  const result = await deps.client.claimDailyCheckin(credential)
  invalidateOverview()
  return { ok: true, credit: result.credit, streakDays: result.streakDays, isStreakDay: result.isStreakDay }
}

let modelCache: { at: number; value: readonly WorkBuddyUpstreamModel[] } | undefined

/** 丢掉模型缓存，供「刷新目录」按钮用。 */
export function invalidateModels(): void {
  modelCache = undefined
}

/**
 * `/v1/models` 用的模型清单（带缓存）。
 *
 * Codex++ 面板上的「从上游获取」按钮就是打这个接口，所以这里必须给真实目录：
 * 内置快照会少几个账号上真实存在的模型，而用户正是靠这个按钮避免手填。
 */
export async function cachedModels(deps: BridgeDeps): Promise<readonly WorkBuddyUpstreamModel[]> {
  if (modelCache !== undefined && Date.now() - modelCache.at < CACHE_TTL_MS) return modelCache.value
  const credential = await deps.store.current().catch(() => undefined)
  const region = credential === undefined ? 'cn' : deps.region ?? regionOf(credential.domain)
  let models: readonly WorkBuddyUpstreamModel[] = fallbackModelsFor(region)
  if (credential !== undefined) {
    try {
      models = await deps.client.fetchModels(credential)
    } catch (error) {
      log('拉取模型目录失败，回落内置目录:', (error as Error).message)
    }
  }
  modelCache = { at: Date.now(), value: models }
  return models
}
