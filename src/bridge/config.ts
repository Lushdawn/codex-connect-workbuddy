/**
 * 本地配置：`~/.wb-codex-bridge/bridge.json`。
 *
 * 存在的唯一理由是「桌面端路径」这一项：读取加密凭据要先找到 WorkBuddy 主程序，
 * 内核默认靠注册表探测，而注册表在某些受限环境（安全软件、精简系统、被策略
 * 拦过 reg.exe 的机器）拿不到结果——那时用户明明登录着，却只会看到「未读到
 * 登录态」。所以把它变成一次写盘、之后直读的配置项。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic, resolveDshHome } from '../core/host-peers.ts'
import { WORKBUDDY_APP_EXECUTABLE_ENV } from '../core/at-rest.ts'

export interface BridgeConfig {
  /** WorkBuddy 桌面端主程序绝对路径。 */
  appPath?: string
  /** 代理端口。 */
  port?: number
}

export function configPath(): string {
  return join(resolveDshHome(), 'bridge.json')
}

export function readConfig(): BridgeConfig {
  const path = configPath()
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const record = value as Record<string, unknown>
    const config: BridgeConfig = {}
    if (typeof record['appPath'] === 'string' && record['appPath'].trim() !== '') {
      config.appPath = record['appPath'].trim()
    }
    if (typeof record['port'] === 'number' && Number.isInteger(record['port'])) {
      config.port = record['port']
    }
    return config
  } catch {
    // 配置坏了不该让整个进程起不来：忽略即可，doctor 会重新写出正确的一份。
    return {}
  }
}

export async function writeConfig(config: BridgeConfig): Promise<void> {
  await writeFileAtomic(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

const APP_EXE_NAMES = ['WorkBuddy.exe', 'WorkBuddyAI.exe', 'CodeBuddy.exe'] as const
const APP_DIR_NAMES = ['workbuddy', 'WorkBuddy', 'WorkBuddyAI', 'CodeBuddy'] as const
const DRIVES = ['C', 'D', 'E', 'F', 'G', 'H'] as const

/**
 * 无注册表的候选路径扫描。
 *
 * 顺序刻意是「显式配置 → 环境变量 → 常见安装位置」：前两者是用户意图，
 * 最后一列只是让零配置的机器也能自己跑起来。
 */
export function discoverAppPath(configured?: string): string | undefined {
  const explicit = configured?.trim()
  if (explicit !== undefined && explicit !== '') return explicit

  const fromEnv = process.env[WORKBUDDY_APP_EXECUTABLE_ENV]?.trim()
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv

  const roots: string[] = []
  for (const drive of DRIVES) {
    for (const dir of APP_DIR_NAMES) {
      roots.push(`${drive}:/${dir}`)
      roots.push(`${drive}:/Program Files/${dir}`)
      roots.push(`${drive}:/Programs/${dir}`)
    }
  }
  const local = process.env['LOCALAPPDATA']
  if (local !== undefined) {
    for (const dir of APP_DIR_NAMES) roots.push(join(local, 'Programs', dir))
  }
  for (const root of roots) {
    for (const exe of APP_EXE_NAMES) {
      const candidate = `${root}/${exe}`
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        continue
      }
    }
  }
  return undefined
}

/**
 * 把发现的路径写进进程环境，供内核的 at-rest 解密使用。
 *
 * 必须在任何一次凭据读取之前调用：`readAtRestKey` 是懒加载的，一旦它以
 * 「找不到主程序」失败，同一进程内的后续读取不会重新探测。
 */
export function applyAppPath(config: BridgeConfig): string | undefined {
  const path = discoverAppPath(config.appPath)
  if (path !== undefined) process.env[WORKBUDDY_APP_EXECUTABLE_ENV] = path
  return path
}
