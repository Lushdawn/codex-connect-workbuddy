/**
 * 把当前 Node 运行时与 `dist/sea/wbx.blob` 合成一个单文件 exe。
 *
 * 为什么不写在 npm script 里：Windows 上这一步要「复制运行时 → 调 postject 注入
 * → 改名」，跨 shell 拼这条链（cp + npx + mv，且路径含中文）在 cmd 与 bash 里
 * 转义规则不同，容易在某台机器上静默失败。写成一个脚本，用的是同一套 Node API，
 * 换机器只要 `npm run build:exe`。
 *
 * 产物放在 `dist/` 而不是根目录：它 80+ MB，混在源码里既碍眼又容易被 git 收进去。
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const blob = join(root, 'dist', 'sea', 'wbx.blob')
const target = join(root, 'dist', 'WorkBuddy 面板.exe')

if (!existsSync(blob)) {
  process.stderr.write('缺少 dist/sea/wbx.blob：先运行 npm run build:sea\n')
  process.exit(1)
}

mkdirSync(dirname(target), { recursive: true })
copyFileSync(process.execPath, target)
process.stdout.write(`已复制运行时：${process.execPath}\n`)

const injected = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
    target,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit', cwd: root },
)

if (injected.status !== 0) {
  process.stderr.write('注入失败：检查 postject 是否安装（npm i -D postject）\n')
  process.exit(injected.status ?? 1)
}

process.stdout.write(`\n完成：${target}\n双击它即可启动代理并打开面板。\n`)
