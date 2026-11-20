/**
 * 账号池：列出、切换、删除，以及 OAuth 添加账号。
 *
 * 对应 dsh 的 `/pool` 与 `/oauth` 两条路由。这里的每一条都只是把内核已有的
 * 方法接上 HTTP——`store` 早就实现了 vault 的读写与选择语义，重复实现一遍
 * 只会让两处的账号判定逻辑漂移。
 */

import { workbuddyAccountId } from '../core/auth.ts'
import type { WorkBuddyCredential } from '../core/auth.ts'
import { oauthPoll, oauthStart } from '../core/oauth.ts'
import { regionOf } from '../core/upstream.ts'
import type { WorkBuddyRegion } from '../core/upstream.ts'
import { log } from './store.ts'
import type { BridgeDeps } from './store.ts'

export interface AccountView {
  id: string
  name: string
  domain: string
  region: WorkBuddyRegion
  source: 'desktop' | 'dsh'
  expiresAt: string
  expired: boolean
  selected: boolean
  enterprise: boolean
}

/**
 * 账号列表。
 *
 * `current` 用 `store.current()` 现算而不是读 `accounts[].selected`：后者是
 * 存储层的「保存的选择」，而真实生效的账号还要经过运行期轮换与回退，两者
 * 在换号失败的瞬间会不一致，面板必须显示真正在计费的那个。
 */
export async function listAccounts(deps: BridgeDeps): Promise<{
  accounts: AccountView[]
  current: string | null
}> {
  const choices = await deps.store.accounts()
  const live = await deps.store.current().catch(() => undefined)
  const currentId = live === undefined ? null : workbuddyAccountId(live)
  const accounts = choices.map((choice) => ({
    id: choice.id,
    name: choice.accountName,
    domain: choice.domain,
    region: regionOf(choice.domain),
    source: choice.source,
    expiresAt: new Date(choice.tokenExpiresAtMs).toISOString(),
    expired: choice.tokenExpiresAtMs <= Date.now(),
    selected: currentId === null ? choice.selected : currentId === choice.id,
    enterprise: choice.enterprise === true,
  }))
  return { accounts, current: currentId }
}

export function selectAccount(deps: BridgeDeps, accountId: string): void {
  // 空串表示恢复默认（不指定具体账号）。
  deps.store.selectAccount(accountId === '' ? undefined : accountId)
}

export async function removeAccount(deps: BridgeDeps, accountId: string): Promise<boolean> {
  return deps.store.removeAccount(accountId)
}

export interface LoginStart {
  loginId: string
  /** 让用户去打开的授权地址。 */
  url: string
  expiresIn: number
}

export async function startLogin(region: WorkBuddyRegion): Promise<LoginStart | { error: string }> {
  const started = await oauthStart(region)
  if ('error' in started) return started
  return { loginId: started.loginId, url: started.verificationUri, expiresIn: started.expiresIn }
}

export interface LoginPoll {
  done: boolean
  account?: { id: string; name: string }
  error?: string
}

/**
 * 轮询一次登录结果；成功时立即落盘并切换过去。
 *
 * 自动切换是刻意的：用户点「添加账号」的意图就是「现在要用它」。若只入库不选中，
 * 面板会新增一行却仍在用旧账号计费，这比不添加更难理解。
 */
export async function pollLogin(
  deps: BridgeDeps,
  loginId: string,
  region: WorkBuddyRegion,
): Promise<LoginPoll> {
  const answer = await oauthPoll(loginId, region)
  if (!answer.done) return { done: false }
  if ('error' in answer) return { done: true, error: answer.error }

  const success = answer.account
  const credential: Omit<WorkBuddyCredential, 'source' | 'filePath'> = {
    accessToken: success.accessToken,
    refreshToken: success.refreshToken,
    expiresAtMs: success.expiresAtMs,
    domain: success.domain,
    uid: success.uid,
    ...(success.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: success.refreshExpiresAtMs }),
    ...(success.nickname === undefined ? {} : { nickname: success.nickname }),
    ...(success.uin === undefined ? {} : { uin: success.uin }),
    ...(success.enterpriseId === undefined ? {} : { enterpriseId: success.enterpriseId }),
  }
  const id = await deps.store.addOAuthAccount(credential)
  deps.store.selectAccount(id)
  log(`已添加账号 ${success.uid}（${success.domain}）并切换过去`)
  return { done: true, account: { id, name: success.nickname ?? success.uid } }
}
