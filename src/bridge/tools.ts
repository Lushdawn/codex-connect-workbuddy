/**
 * 面板上的「动作」类接口：探测、刷新目录、媒体模型、福利领取。
 *
 * 与 `overview.ts` 的分界：那边只读且带缓存，这边每条都可能有副作用
 * （花积分、改上游状态），所以一律不缓存、只在用户明确点击时调用。
 */

import { prepareChatBody } from '../core/upstream.ts'
import type { WorkBuddyBenefit } from '../core/upstream.ts'
import { requireCredential } from './store.ts'
import type { BridgeDeps } from './store.ts'
import { cachedModels, invalidateModels, invalidateOverview } from './overview.ts'

export interface ProbeResult {
  ok: boolean
  status: number
  /** 上游给的冷却秒数（从 `Retry-After` 解析），没有则为 null。 */
  retryAfter: string | null
  message: string
}

/**
 * 用一次极小的真实请求判断「这个模型现在能不能用」。
 *
 * 刻意不用 dsh 的 25k token 探针：那个测的是长上下文承接能力，一次就顶掉
 * 可观的积分。面板要回答的是「能不能用、要不要换」，一句 ping 足够，且
 * 失败的返回体里已经带得上游的冷却提示。
 */
export async function probeModel(deps: BridgeDeps, modelId: string): Promise<ProbeResult> {
  const credential = await requireCredential(deps)
  const body = prepareChatBody(JSON.stringify({
    model: modelId,
    stream: true,
    max_tokens: 1,
    messages: [
      { role: 'system', content: 'You are a connectivity check. Reply with a single word.' },
      { role: 'user', content: 'ping' },
    ],
  }))
  const answer = await deps.client.probeChat(credential, body, AbortSignal.timeout(45_000))
  // 成功的流必须读掉：probeChat 只负责拿到响应，丢掉不读会让连接悬着。
  if (answer.ok && answer.response?.body !== undefined && answer.response.body !== null) {
    try {
      for await (const chunk of answer.response.body as unknown as AsyncIterable<Uint8Array>) {
        void chunk
      }
    } catch {
      // 读到一半断开不影响「可用」这个结论。
    }
  }
  return {
    ok: answer.ok,
    status: answer.status,
    retryAfter: answer.retryAfter,
    message: answer.ok ? '' : (answer.body ?? '').slice(0, 300),
  }
}

/** 丢掉目录缓存并重拉，返回最新模型数。 */
export async function refreshModels(deps: BridgeDeps): Promise<{ ok: boolean; count: number }> {
  invalidateModels()
  invalidateOverview()
  const models = await cachedModels(deps)
  return { ok: true, count: models.length }
}

export async function mediaModels(deps: BridgeDeps): Promise<Record<string, unknown>[]> {
  const credential = await requireCredential(deps)
  const models = await deps.client.fetchMediaModels(credential)
  // 面板只做展示，字段集合随上游变化，原样透传比在这里逐步映射更耐改。
  return models as unknown as Record<string, unknown>[]
}

export async function listBenefits(deps: BridgeDeps): Promise<Record<string, unknown>[]> {
  const credential = await requireCredential(deps)
  const benefits = await deps.client.fetchBenefits(credential)
  return benefits as unknown as Record<string, unknown>[]
}

export async function claimBenefit(deps: BridgeDeps, kind: WorkBuddyBenefit['kind']): Promise<{ ok: true }> {
  const credential = await requireCredential(deps)
  await deps.client.claimBenefit(credential, kind)
  invalidateOverview()
  return { ok: true }
}
