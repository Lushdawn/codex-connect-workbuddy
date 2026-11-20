/**
 * 设备档位、桌面端 SDK 探测、吞吐测量。
 *
 * 对应 dsh 的 `/device-profile`、`/device-sdk`、`/tps` 三条路由。
 *
 * 一个必须说清的限制：设备档位与 SDK 目录只在**构造上游客户端时**读取一次
 * （身份在构造期解析并缓存）。所以切档后不会在本次进程内生效，接口如实返回
 * `restartRequired`，而不是让用户以为点了没反应。
 */

import { readDeviceSettings, saveDeviceSdkSettings, setDeviceMode } from '../core/device-profile.ts'
import type { WorkBuddyDeviceMode, WorkBuddyDeviceSettings } from '../core/device-profile.ts'
import { createTuringSdk } from '../core/turing-sdk.ts'
import { resolveDshHome } from '../core/host-peers.ts'
import { measureTps } from '../core/tps.ts'
import { requireCredential } from './store.ts'
import type { BridgeDeps } from './store.ts'

/** 设备设置文档所在的目录：与凭据 vault 同一个 home。 */
function profileDir(): string {
  return resolveDshHome()
}

export interface DeviceStatus {
  mode: WorkBuddyDeviceMode
  sdkDir: string
  realTier: WorkBuddyDeviceSettings['realTier'] | null
  accounts: number
  sdk: Record<string, unknown>
}

export async function deviceStatus(): Promise<DeviceStatus> {
  const settings = await readDeviceSettings({ dir: profileDir() })
  // SDK 探测会起子进程，失败是常态（未安装/平台不支持），所以一律降级成
  // 一个可展示的状态，不让它把整块面板打成错误。
  let sdk: Record<string, unknown>
  try {
    const info = await createTuringSdk({}).info()
    sdk = info as unknown as Record<string, unknown>
  } catch (error) {
    sdk = { state: 'error', message: (error as Error).message }
  }
  return {
    mode: settings.mode,
    sdkDir: settings.sdkDir ?? '',
    realTier: settings.realTier ?? null,
    accounts: Object.keys(settings.accounts).length,
    sdk,
  }
}

export async function switchDeviceMode(mode: WorkBuddyDeviceMode): Promise<{ mode: WorkBuddyDeviceMode }> {
  const settings = await setDeviceMode(mode, { dir: profileDir() })
  return { mode: settings.mode }
}

export async function saveSdkDir(values: { sdkDir?: string; sdkFallbackToVirtual?: boolean }): Promise<{ sdkDir: string }> {
  const settings = await saveDeviceSdkSettings(values, { dir: profileDir() })
  return { sdkDir: settings.sdkDir ?? '' }
}

export async function measureSpeed(deps: BridgeDeps, modelId: string): Promise<Record<string, unknown>> {
  const credential = await requireCredential(deps)
  // 默认 3 轮 × 256 tokens：面板上是一次明确点击，不是后台采样。
  const sample = await measureTps({ client: deps.client, credential, modelId })
  return sample as unknown as Record<string, unknown>
}
