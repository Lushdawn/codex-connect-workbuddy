/**
 * 账号路由：按剩余积分决定用哪个账号，全部没额度就拒绝。
 *
 * 两条阈值，回答的是两个不同问题，所以不能合成一条：
 *
 * - `SWITCH_FLOOR = 20`：**当前**账号掉到这个数就换下一个。留这 20 分不是
 *   吝啬，是因为一次长上下文请求的扣费在响应结束前不可知，账户见底时上游
 *   会用 `hard_credit` 把请求打断——那比提前换号难看得多。
 * - `MIN_USABLE = 50`：**所有**账号都低于它就不再发请求，直接报无额度。
 *   它比 `SWITCH_FLOOR` 高，是刻意的：换号有成本（预填充重来、缓存全失效），
 *   而一个只剩 30 分的账号撑不完一次长会话，换过去等于把失败往后挪三十秒。
 *
 * 余额读不到（网络失败、凭据不可读）时**不参与判定**，既不当成有额度、也不
 * 当成没额度：按「未知」放行，让上游自己回答。把读失败当成 0 会让面板在断网
 * 时谎报「无额度」，那是更坏的错。
 */

import { workbuddyAccountId } from '../core/auth.ts'
import type { WorkBuddyCredential } from '../core/auth.ts'
import { listAccounts } from './accounts.ts'
import type { AccountView } from './accounts.ts'
import { log } from './store.ts'
import type { BridgeDeps } from './store.ts'

/** 当前账号剩余积分低于此值即换号。 */
export const SWITCH_FLOOR = 20
/** 所有账号都低于此值时判定无额度，拒绝发请求。 */
export const MIN_USABLE = 50
/** 余额缓存时长：面板每 5 秒轮询，不能每次都打上游 N 次。 */
const BALANCE_TTL_MS = 60_000

export interface AccountBalance extends AccountView {
  /** 剩余积分；读不到时为 `null`（未知，不是 0）。 */
  total: number | null
  balanceError?: string
  /** 是否达到可发起请求的门槛。未知余额按可用处理。 */
  usable: boolean
}

let cache: { at: number; value: AccountBalance[] } | undefined

export function invalidateBalances(): void {
  cache = undefined
}

/** 每个账号的余额（带缓存）。`force` 供面板上的刷新按钮用。 */
export async function accountBalances(deps: BridgeDeps, force = false): Promise<AccountBalance[]> {
  if (!force && cache !== undefined && Date.now() - cache.at < BALANCE_TTL_MS && cache.value.length > 0) {
    return cache.value
  }
  const { accounts } = await listAccounts(deps)
  const value = await Promise.all(accounts.map(async (account): Promise<AccountBalance> => {
    if (account.expired) {
      return { ...account, total: null, balanceError: '令牌已过期', usable: false }
    }
    try {
      const credential = await deps.store.credentialFor(account.id)
      if (credential === undefined) {
        return { ...account, total: null, balanceError: '凭据不可读', usable: false }
      }
      const credits = await deps.client.fetchCredits(credential)
      return {
        ...account,
        total: credits.total,
        usable: credits.total >= MIN_USABLE,
      }
    } catch (error) {
      const message = (error as Error).message.slice(0, 120)
      log(`读取账号 ${account.name} 余额失败:`, message)
      // 读不到 ≠ 没额度：放行，由上游回答。
      return { ...account, total: null, balanceError: message, usable: true }
    }
  }))
  cache = { at: Date.now(), value }
  return value
}

/** 所有账号都没额度。`code` 直接用 OpenAI 的 `insufficient_quota`。 */
export class NoQuotaError extends Error {
  readonly code = 'insufficient_quota'
  readonly balances: readonly AccountBalance[]

  /**
   * `reason` 决定这句话怎么说，因为两种情况的处置完全不同：
   * - `low`：所有账号余额都低于门槛——用户该去充值或加号；
   * - `excluded`：账号还有余额，但本轮都已经失败过——等一会儿会自己恢复。
   * 把后者说成「无额度」会让用户去充值一个其实有钱的账号。
   */
  constructor(balances: readonly AccountBalance[], reason: 'low' | 'excluded' = 'low') {
    const detail = balances
      .map(item => `${item.name || item.id}: ${item.total === null ? (item.balanceError ?? '未知') : item.total.toFixed(2)}`)
      .join('；')
    super(reason === 'low'
      ? `无额度：所有账号剩余积分均低于 ${MIN_USABLE}，已停止发送请求（${detail || '没有可用账号'}）`
      : `无可用账号：本轮已尝试的账号均失败，其余账号也已被排除（${detail || '没有账号'}）`)
    this.name = 'NoQuotaError'
    this.balances = balances
  }
}

export interface RoutedAccount {
  credential: WorkBuddyCredential
  accountId: string
  name: string
  total: number | null
  /** 这一次是否发生了换号。 */
  switched: boolean
}

function idOf(credential: WorkBuddyCredential): string {
  return workbuddyAccountId(credential)
}

/**
 * 选一个账号发起请求。
 *
 * 顺序是「粘性优先 → 余额最高」：当前账号还能用就不换（哪怕别的号更多），
 * 因为换号会让上游前缀缓存全废、首字延迟翻倍。只有它掉到 `SWITCH_FLOOR` 以下、
 * 被 `exclude` 排除（刚失败）、或根本没得用时才换。
 */
export async function routeAccount(
  deps: BridgeDeps,
  options: { readonly exclude?: readonly string[] } = {},
): Promise<RoutedAccount> {
  const list = await accountBalances(deps)
  const excluded = new Set(options.exclude ?? [])
  const usable = list.filter(item => item.usable && !excluded.has(item.id))

  const current = await deps.store.current().catch(() => undefined)
  const currentId = current === undefined ? undefined : idOf(current)
  const currentRow = list.find(item => item.id === currentId)

  if (
    current !== undefined
    && currentRow !== undefined
    && !excluded.has(currentRow.id)
    && currentRow.usable
    && (currentRow.total === null || currentRow.total > SWITCH_FLOOR)
  ) {
    return {
      credential: current,
      accountId: currentRow.id,
      name: currentRow.name,
      total: currentRow.total,
      switched: false,
    }
  }

  if (usable.length === 0) {
    const allLow = list.length > 0 && list.every(item => item.total !== null && item.total < MIN_USABLE)
    throw new NoQuotaError(list, allLow ? 'low' : 'excluded')
  }

  const best = [...usable].sort((a, b) => (b.total ?? Number.POSITIVE_INFINITY) - (a.total ?? Number.POSITIVE_INFINITY))[0]
  if (best === undefined) throw new NoQuotaError(list)

  const fresh = await deps.store.credentialFor(best.id)
  if (fresh === undefined) throw new NoQuotaError(list)

  deps.store.selectAccount(best.id)
  invalidateBalances()
  if (best.id !== currentId) {
    log(`自动换号：${currentRow?.name ?? '未知'}（${currentRow?.total ?? '?'}）→ ${best.name}（${best.total ?? '?'}）`)
  }
  return {
    credential: fresh,
    accountId: best.id,
    name: best.name,
    total: best.total,
    switched: true,
  }
}

/**
 * 这次上游失败值得换号吗。
 *
 * 只有「关于账号」的失败才换：积分不足、账号级限流、凭据失效、账号被限制。
 * `model_busy`（14003，模型侧负载）**不换**——内核的注释记着实测：同一秒里
 * 该账号服务别的模型完全正常，换号只会把每个账号轮流撞同一堵墙。
 * `policy_reject` 也不换：那是内容判定，换谁都是同一个答案。
 */
export function shouldFailover(kind: string): boolean {
  return kind === 'hard_credit'
    || kind === 'soft_rate'
    || kind === 'session_dead'
    || kind === 'account_restricted'
}
