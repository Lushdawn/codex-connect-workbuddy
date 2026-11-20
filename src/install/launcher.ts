/**
 * 双击启动器：在项目根生成一个 `.cmd`，双击即拉起代理并打开面板。
 *
 * 不是开机自启——用户要的是「我想用时双击一下」。所以脚本在前台跑代理：
 * 关掉窗口就等于停掉代理，不留后台进程，也不需要另记停止方式。
 *
 * 由工具生成而不是手写死文件，是因为两处路径必须准确：项目目录（`%~dp0`
 * 已解决，移动文件夹仍有效）和 node 可执行文件。后者不能靠 PATH——本机
 * node 来自 WorkBuddy 自带运行时，命令行环境里未必在 PATH 上。
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LAUNCHER_NAME = '启动 WorkBuddy 代理.cmd'
/** 停止器：双击即调用 `stop`，不必再去翻任务管理器。 */
export const STOPPER_NAME = '停止 WorkBuddy 代理.cmd'

/** 从模块位置向上找含 `package.json` 的目录；开发与构建后层级不同。 */
export function findProjectRoot(): string {
  // SEA（单文件可执行）里没有模块路径，`import.meta.url` 取不到；退到可执行
  // 文件所在目录——打包后的 exe 就放在项目根，语义与开发态一致。
  let start: string
  try {
    start = dirname(fileURLToPath(import.meta.url))
  } catch {
    start = dirname(process.execPath)
  }
  let dir = start
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

/**
 * 生成启动器。
 *
 * 脚本正文全 ASCII：cmd.exe 按系统代码页解释文件内容，中文注释在部分机器上
 * 会被吞掉半行，进而把下一条命令拼坏。中文只出现在文件名里——文件名不参与
 * 脚本解析。
 */
export function writeLauncher(root = findProjectRoot()): string {
  const node = process.execPath
  // 有单文件程序就优先用它：它自带运行时，不依赖 node 在不在 PATH 上，也不会
  // 因为 node_modules 被清掉而失效。没有 exe 才退回「node + bundle」。
  const hasExe = distHasExe(root)
  const lines = hasExe
    ? [
        '@echo off',
        'title WorkBuddy Bridge Proxy',
        'cd /d "%~dp0"',
        '',
        'rem Wildcard keeps this ASCII-only: the exe name is Chinese.',
        'for %%f in ("dist\\*.exe") do start "" "%%~ff"',
        '',
      ]
    : [
        '@echo off',
        'title WorkBuddy Bridge Proxy',
        'cd /d "%~dp0"',
        '',
        'if not exist "dist\\wbx.mjs" goto nobuild',
        'goto run',
        '',
        ':nobuild',
        'echo Bundle not found: dist\\wbx.mjs',
        'echo Run "npm install" then "npm run build" once, and double-click again.',
        'pause',
        'exit /b 1',
        '',
        ':run',
        'echo Starting WorkBuddy proxy - close this window to stop it.',
        `"${node}" "dist\\wbx.mjs" serve --open`,
        'echo.',
        'echo Proxy stopped.',
        'pause',
        '',
      ]
  const path = join(root, LAUNCHER_NAME)
  writeFileSync(path, lines.join('\r\n'), 'utf8')

  // 停止器与启动器成对生成：只给启动不给停止，用户最后一定会去任务管理器
  // 里找进程，而那台机器上任务管理器未必好找。
  const stopper = hasExe
    ? [
        '@echo off',
        'title Stop WorkBuddy Bridge',
        'cd /d "%~dp0"',
        '',
        'rem Wildcard keeps this ASCII-only: the exe name is Chinese.',
        'for %%f in ("dist\\*.exe") do "%%~ff" stop',
        '',
        'rem Keep the window up for a moment so the result is readable.',
        'ping -n 3 127.0.0.1 >nul',
        '',
      ]
    : [
        '@echo off',
        'title Stop WorkBuddy Bridge',
        'cd /d "%~dp0"',
        '',
        `"${node}" "dist\\wbx.mjs" stop`,
        '',
        'rem Keep the window up for a moment so the result is readable.',
        'ping -n 3 127.0.0.1 >nul',
        '',
      ]
  writeFileSync(join(root, STOPPER_NAME), stopper.join('\r\n'), 'utf8')
  return path
}

/** `dist` 目录里是否已有单文件程序（exe）。 */
function distHasExe(root: string): boolean {
  const dir = join(root, 'dist')
  if (!existsSync(dir)) return false
  try {
    return readdirSync(dir).some(name => name.toLowerCase().endsWith('.exe'))
  } catch {
    return false
  }
}
