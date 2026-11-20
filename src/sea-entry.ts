/**
 * 单文件可执行（Node SEA）的入口。
 *
 * 为什么单独一个文件而不是复用 `cli.ts` 的「被直接调用才运行」那段判断：
 * 那段判断靠 `import.meta.url` 与 `process.argv[1]` 比对，意在「被 import 时
 * 不产生副作用」。而 SEA 里没有模块文件路径，`import.meta.url` 不可用，比对
 * 必然失败——于是 exe 双击之后什么都不会发生。
 *
 * 所以打包成 exe 时入口换成这里：无条件调用 `main`。`cli.ts` 里那段判断在
 * SEA 下返回 false，正好让「被谁执行」这件事只剩一个答案。
 *
 * 另：SEA 的入口必须是 CommonJS（Node 22 的 SEA 只接受 CJS 主脚本），所以
 * 这个文件由 esbuild 打成 `dist/sea/wbx.cjs`，与给 Node 直接跑的 `dist/wbx.mjs`
 * 分开产出——后者保留 ESM，两者共用同一份源码。
 */

import { log } from './bridge/store.ts'
import { main } from './cli.ts'

void main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    log('致命错误:', (error as Error).stack ?? String(error))
    process.exitCode = 1
  },
)
