/**
 * 桥接层装配：一份凭据存储 + 一个上游客户端。
 *
 * 为什么单独一层：`src/core/*` 是从 dsh-connect-workbuddy 原样搬过来的
 * 「纯传输 + 解析」内核，它刻意不认识宿主。这里只做接线，不改内核行为，
 * 于是上游变更时可以整目录覆盖，不用重做适配。
 */

import { WorkBuddyCredentialStore } from '../core/auth.ts'
import type { WorkBuddyCredential } from '../core/auth.ts'
import { WorkBuddyUpstreamClient } from '../core/upstream.ts'
import type { WorkBuddyRegion } from '../core/upstream.ts'

/** 诊断输出走 stderr，stdout 留给 CLI 的机器可读结果。 */
export function log(...parts: readonly unknown[]): void {
  process.stderr.write(`[wbb] ${parts.map(String).join(' ')}\n`)
}

export interface BridgeDeps {
  readonly region: WorkBuddyRegion | undefined
  readonly client: WorkBuddyUpstreamClient
  readonly store: WorkBuddyCredentialStore
}

/**
 * 不指定 region 时建立「跨区」存储：国内版与国际版是两个独立积分池，
 * 但第一期只要求「能连上并跑通」，选最近一次登录的那个即可。
 * 第二期换成账号池后这里会变成按 region 各建一份。
 */
export function createBridgeDeps(region?: WorkBuddyRegion): BridgeDeps {
  // 第一个参数是身份回退告警的回调，与 dsh 里注入 ctx.logger.warn 同一个位置。
  const client = new WorkBuddyUpstreamClient(
    message => log('identity fallback:', message),
    {},
    {},
  )
  const store = new WorkBuddyCredentialStore({
    ...(region === undefined ? {} : { region }),
    refresh: credential => client.refreshToken(credential),
  })
  return { region, client, store }
}

/**
 * 取当前可用凭据。`current()` 内部负责「读桌面端 auth → 解密 → 到期刷新」，
 * 失败时抛错，由调用方翻成 HTTP 错误。
 */
export async function requireCredential(deps: BridgeDeps): Promise<WorkBuddyCredential> {
  const credential = await deps.store.current()
  if (credential === undefined) {
    throw new NoCredentialError()
  }
  return credential
}

/** 本机没有可用的 WorkBuddy 登录态。 */
export class NoCredentialError extends Error {
  constructor() {
    super(
      '没有找到可用的 WorkBuddy 登录态：请先在 WorkBuddy 桌面端完成登录，'
      + '然后运行 `wbx doctor` 确认凭据能被读到。',
    )
    this.name = 'NoCredentialError'
  }
}
