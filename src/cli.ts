#!/usr/bin/env node
/**
 * 命令行入口：`serve` / `doctor` / `models`。
 *
 * 刻意保持三个子命令的最小面——桥接层出问题时，人能靠 doctor 的输出去判断
 * 到底是「没登录」「凭据加密读不出来」还是「上游拒绝」，而不是靠翻日志。
 */

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WORKBUDDY_CONNECT_VERSION } from './core/version.ts'
import { fallbackModelsFor } from './core/catalog.ts'
import { regionOf } from './core/upstream.ts'
import type { WorkBuddyUpstreamModel } from './core/upstream.ts'
import { createBridgeDeps, log } from './bridge/store.ts'
import type { BridgeDeps } from './bridge/store.ts'
import { clearRuntime, DEFAULT_PORT, openPanel, readRuntime, startServer } from './bridge/server.ts'
import { killLiveWorkers } from './core/turing-sdk.ts'
import { applyAppPath, configPath, discoverAppPath, readConfig, writeConfig } from './bridge/config.ts'
import { renderInstallGuide } from './install/codexpp.ts'
import { writeLauncher } from './install/launcher.ts'

function usage(): void {
  process.stdout.write(
    [
      'wbx — WorkBuddy 的 Codex 桥（本地 OpenAI 兼容代理）',
      '',
      '用法：',
      '  wbx serve [--port 8787] [--open]   启动本地代理（--open 就绪后开浏览器）',
      '  wbx stop [--port 8787]         停止正在运行的代理',
      '  wbx doctor [--json]            诊断凭据、设备身份与模型目录',
      '  wbx models [--json]            列出可转发的模型',
      '  wbx install                    打印 Codex++ / Codex 的接入参数',
      '  wbx launcher                   生成双击启动器（项目根 .cmd）',
      '  wbx app-path                   查看探测到的桌面端路径',
      '  wbx app-path --set <路径>      固定桌面端路径（注册表探测不可用时用）',
      '',
      '环境变量：',
      '  WBX_HOME                       状态目录，默认 ~/.wb-codex-bridge',
      '  WORKBUDDY_APP_EXECUTABLE       直接指定桌面端主程序路径',
      '',
    ].join('\n'),
  )
}

function takeFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

async function commandDoctor(args: readonly string[]): Promise<number> {
  const deps = createBridgeDeps()
  const appPath = discoverAppPath(readConfig().appPath)
  const report: Record<string, unknown> = {
    version: WORKBUDDY_CONNECT_VERSION,
    home: process.env['WBX_HOME'] ?? '~/.wb-codex-bridge',
    appPath: appPath ?? null,
    credential: { readable: false },
  }

  let credential
  try {
    credential = await deps.store.current()
  } catch (error) {
    // 加密凭据读不出来是 WorkBuddy 特有的失败：用户明明登录了，但构建版本把
    // token 字段加密了，只有桌面端在场才能交出 at-rest 密钥。
    report['credential'] = { readable: false, reason: (error as Error).message }
    credential = undefined
  }

  if (credential !== undefined) {
    const region = regionOf(credential.domain)
    report['credential'] = {
      readable: true,
      uid: credential.uid,
      domain: credential.domain,
      region,
      name: credential.displayName ?? credential.nickname ?? credential.enterpriseUserName ?? '',
      expiresAt: new Date(credential.expiresAtMs).toISOString(),
      expired: credential.expiresAtMs <= Date.now(),
      file: credential.filePath,
    }
    report['models'] = fallbackModelsFor(region).map(model => model.id)
  }

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return credential === undefined ? 1 : 0
  }

  const lines: string[] = [`wbx ${WORKBUDDY_CONNECT_VERSION}`, '']
  const cred = report['credential'] as Record<string, unknown>
  if (cred['readable'] === true) {
    lines.push(
      `登录态      : 已读到（${String(cred['region'])} · ${String(cred['domain'])}）`,
      `账号        : ${String(cred['uid'])}${cred['name'] === '' ? '' : ` (${String(cred['name'])})`}`,
      `访问令牌到期: ${String(cred['expiresAt'])}${cred['expired'] === true ? '  ← 已过期，下次请求会尝试刷新' : ''}`,
      `凭据文件    : ${String(cred['file'])}`,
      `可转发模型  : ${(report['models'] as string[]).length} 个`,
    )
  } else {
    lines.push(
      '登录态      : 未读到',
      `原因        : ${String(cred['reason'] ?? '未知')}`,
      `桌面端路径  : ${appPath ?? '未探测到 —— 注册表探测可能被拦截'}`,
      '',
      '下一步      : 在 WorkBuddy 桌面端登录；若已登录，用 `wbx app-path --set <WorkBuddy.exe>`,',
      '              把主程序路径固定下来后重试（加密凭据必须靠桌面端交出 at-rest 密钥）。',
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  return credential === undefined ? 1 : 0
}

/**
 * 优先用上游真实目录，失败才回落内置目录。
 *
 * 内置目录是随包发布的快照，会漏掉账号上新增的模型（例如免费档的
 * `hy4flash-free`）——而「有哪些模型能用」正是安装步骤里最需要准确的一栏。
 */
async function resolveModels(
  deps: ReturnType<typeof createBridgeDeps>,
  credential: Awaited<ReturnType<BridgeDeps['store']['current']>>,
): Promise<readonly WorkBuddyUpstreamModel[]> {
  if (credential !== undefined) {
    try {
      return await deps.client.fetchModels(credential)
    } catch (error) {
      log('拉取上游目录失败，回落内置目录:', (error as Error).message)
    }
  }
  return fallbackModelsFor(credential === undefined ? 'cn' : regionOf(credential.domain))
}

async function commandModels(args: readonly string[]): Promise<number> {
  const deps = createBridgeDeps()
  const credential = await deps.store.current().catch(() => undefined)
  const models = await resolveModels(deps, credential)
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(models, null, 2)}\n`)
    return 0
  }
  for (const model of models) {
    const ctx = Math.round(model.contextWindow / 1000)
    const rate = model.creditMultiplier === undefined ? '' : `×${model.creditMultiplier}`
    process.stdout.write(`${model.id.padEnd(24)} ${String(ctx).padStart(5)}K ${rate.padStart(7)}  ${model.name}\n`)
  }
  return 0
}

/**
 * 端口对应的监听进程 pid。
 *
 * Windows 上没有 `lsof`，`netstat -ano` 是唯一稳定可用的来源：第二列是本端
 * 地址（`127.0.0.1:8787`），第四列状态，第五列 pid。只认 LISTENING，避免把
 * 一条 TIME_WAIT 的连接当成进程。
 */
function pidListeningOn(port: number): number | undefined {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/)
      if (cols.length < 5) continue
      if (cols[1]?.endsWith(`:${port}`) !== true) continue
      if (cols[3] !== 'LISTENING') continue
      const pid = Number.parseInt(cols[4] ?? '', 10)
      if (Number.isInteger(pid) && pid > 0) return pid
    }
  } catch {
    // netstat 不可用时退化为「找不到进程」，让上层按失败处理。
  }
  return undefined
}

/**
 * 停止代理：先请求它自己退出，退不掉再按端口结束进程。
 *
 * 两级是必要的。优雅退出会走 `server.close()`，在途的流式请求能收尾；而代理
 * 卡在某个上游长连接上时，`/wb/shutdown` 可能根本没人应答（旧版本没有这条
 * 路由，或进程已半死），那时只剩强杀这一条路。
 */
async function commandStop(args: readonly string[]): Promise<number> {
  const config = readConfig()
  const state = readRuntime()
  const portText = takeFlag(args, '--port')
  const port = portText === undefined
    ? state?.port ?? config.port ?? DEFAULT_PORT
    : Number.parseInt(portText, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write(`端口不合法：${String(portText)}\n`)
    return 2
  }

  let graceful = false
  try {
    const response = await fetch(`http://127.0.0.1:${port}/wb/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    })
    graceful = response.ok
  } catch {
    // 连不上就是没在跑，或旧版本没有这条路由；下面用端口查一遍再下结论。
  }

  if (graceful) {
    // 等端口真正释放再回报，否则用户紧接着双击启动会撞上「已在运行」。
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      if (pidListeningOn(port) === undefined) {
        process.stdout.write(`已停止：端口 ${port} 已释放，可以再次启动。\n`)
        return 0
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    process.stdout.write('已发出停止指令，但端口仍被占用，改为强制结束进程。\n')
  }

  const pid = pidListeningOn(port)
  if (pid === undefined) {
    process.stdout.write(`代理没有在运行（端口 ${port} 无监听）。\n`)
    return graceful ? 0 : 1
  }
  if (pid === process.pid) {
    process.stdout.write('端口属于当前进程，不再结束自己。\n')
    return 1
  }

  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      process.kill(pid, 'SIGTERM')
    }
    process.stdout.write(`已结束进程 ${pid}（端口 ${port}）。\n`)
    return 0
  } catch (error) {
    process.stderr.write(`结束进程 ${pid} 失败：${(error as Error).message}\n`)
    return 1
  }
}

/** 这个端口上是不是「我们自己的代理」：能应答 /wb/health 就算。 */
async function isOurProxy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/wb/health`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

/** 顺延端口时最多试几个：20 个足够覆盖「一堆开发服务占着低段端口」的机器。 */
const PORT_SCAN_LIMIT = 20

async function commandServe(args: readonly string[]): Promise<number> {
  const config = readConfig()
  const portText = takeFlag(args, '--port')
  const port = portText === undefined ? config.port ?? DEFAULT_PORT : Number.parseInt(portText, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write(`端口不合法：${String(portText)}\n`)
    return 2
  }

  // 先认「已经有一个跑着的自己」。判据优先用 runtime.json 里记的实际端口，因为
  // 端口可能已经顺延过：只在原定端口上探测会漏掉它，于是又起第二个实例。
  const state = readRuntime()
  // 显式给了 --port 就只认它：用户要的是「在这个端口上再起一个」，不能被
  // 「别的端口上已经跑着一个」劝退。不给参数（双击启动）时才沿用上次的端口。
  const candidates = portText !== undefined || state === undefined ? [port] : [state.port, port]
  for (const candidate of candidates) {
    if (await isOurProxy(candidate)) {
      process.stdout.write(`代理已在运行：http://127.0.0.1:${candidate}/v1（要重启请先结束旧进程）\n`)
      // 已运行又要求打开面板：直接把面板叫出来，这比让用户自己找窗口有用。
      if (args.includes('--open')) openPanel(candidate)
      return 0
    }
  }

  // 双击 exe 时会弹出一个控制台窗口，而它就是这个进程本体——标题得说清楚
  // 「关掉即停止」。标题刻意用 ASCII：控制台标题按系统代码页解析，中文在部分
  // 机器上会显示成乱码，反而更让人困惑。开发态（node 直接跑）不改终端标题。
  const exeName = process.execPath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (exeName !== 'node.exe') {
    process.title = 'WorkBuddy Proxy (close this window to stop)'
  }

  // 端口被别的程序占着就往后顺延，而不是抛一句 EADDRINUSE 让人自己猜。
  // 只有 EADDRINUSE 才顺延：其他错误（权限、端口越界）顺延也没用，直接报。
  let server: Awaited<ReturnType<typeof startServer>> | undefined
  let chosen = port
  let lastError: unknown
  for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
    chosen = port + offset
    if (chosen > 65535) break
    try {
      server = await startServer({ port: chosen, preferredPort: port, open: args.includes('--open') })
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE') throw error
      lastError = error
    }
  }
  if (server === undefined) {
    process.stderr.write(
      `端口 ${port} 起连续 ${PORT_SCAN_LIMIT} 个都被占用，无法启动（${(lastError as Error | undefined)?.message ?? '未知原因'}）。\n`
      + `用 --port 指定一个空闲端口，例如：wbx serve --port ${port + PORT_SCAN_LIMIT}\n`,
    )
    return 1
  }

  if (chosen !== port) {
    // 顺延之后要记住这个端口：否则下次 8787 空出来了又跳回去，而 Codex++ 里
    // 保存的是上一次的地址——那种「昨天还能用，今天连不上」最难排查。
    const next = { ...config, port: chosen }
    await writeConfig(next).catch(() => undefined)
    process.stdout.write(
      `端口 ${port} 被占用，已改用 ${chosen}，并记入配置（下次启动仍用 ${chosen}）。\n`
      + `注意：Codex++ 里若已保存指向 ${port} 的供应商，需要把上游地址改成 http://127.0.0.1:${chosen}/v1。\n`,
    )
  }
  process.stdout.write(`wbx 代理已启动：http://127.0.0.1:${server.port}/v1\n`)

  await new Promise<void>((resolve) => {
    // Ctrl+C / 关窗口也走同一条清理路径：先收子进程，再清运行状态，最后关
    // 监听。否则控制台被关掉时 worker 会被留下继续跑。
    const stop = (): void => {
      killLiveWorkers()
      clearRuntime()
      void server.close().then(() => resolve())
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return 0
}

async function commandInstall(args: readonly string[]): Promise<number> {
  const config = readConfig()
  const deps = createBridgeDeps()
  const credential = await deps.store.current().catch(() => undefined)
  const region = credential === undefined ? 'cn' : regionOf(credential.domain)
  const models = await resolveModels(deps, credential)
  const portText = takeFlag(args, '--port')
  const proxyPort = portText === undefined ? config.port ?? DEFAULT_PORT : Number.parseInt(portText, 10)
  process.stdout.write(`${renderInstallGuide({ proxyPort, region, models })}\n`)
  if (credential === undefined) {
    process.stdout.write('\n（提示：现在还没读到 WorkBuddy 登录态，先跑 `wbx doctor`。）\n')
  }
  return 0
}

export async function main(argv: readonly string[]): Promise<number> {
  const config = readConfig()
  // 必须在任何一次凭据读取之前应用：内核的 at-rest 密钥是懒加载的，
  // 一旦以「找不到桌面端」失败，同一进程内不会重新探测。
  const appPath = applyAppPath(config)

  const [command, ...rest] = argv
  switch (command) {
    case 'serve': return commandServe(rest)
    case 'stop': return commandStop(rest)
    case 'doctor': return commandDoctor(rest)
    case 'models': return commandModels(rest)
    case 'install': return commandInstall(rest)
    case 'launcher': {
      const path = writeLauncher()
      process.stdout.write(`已生成双击启动器：\n  ${path}\n双击它即可拉起代理并打开面板（关闭窗口即停止代理）。\n`)
      return 0
    }
    case 'app-path': {
      const value = takeFlag(rest, '--set') ?? rest[0]
      if (value === undefined) {
        process.stdout.write(`${appPath ?? '(未探测到)'}\n${configPath()}\n`)
        return appPath === undefined ? 1 : 0
      }
      // 只校验文件存在，不校验它是不是 WorkBuddy：把「写错路径」的判定留给
      // 桌面端自己，doctor 会紧接着报出「解密失败」这个更准确的原因。
      await writeConfig({ ...config, appPath: value })
      process.stdout.write(`已写入 ${configPath()}\nappPath = ${value}\n`)
      return 0
    }
    case '--version': case '-v':
      process.stdout.write(`${WORKBUDDY_CONNECT_VERSION}\n`)
      return 0
    default:
      // 不带参数（双击 exe、双击启动器）就等于「拉起面板」：这是它作为一个
      // 程序的主用途，让人先看一段 usage 再自己想参数是多余的。
      if (command === undefined) return commandServe(['--open'])
      usage()
      return 2
  }
}

/** 只有被当成可执行文件时才跑：被 import 时（测试）不应产生副作用。 */
function invokedDirectly(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      log('致命错误:', (error as Error).stack ?? String(error))
      process.exitCode = 1
    },
  )
}
