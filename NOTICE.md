# NOTICE — 第三方来源与致谢

本项目是在以下三个开源项目的基础上、或参考它们完成的。这里逐项说明**取用了什么、没有取用什么**，以便使用者能自行核对。

---

## 1. dsh-connect-workbuddy — 内核来源（MIT）

- 仓库：<https://github.com/dingminhua/dsh-connect-workbuddy>
- 作者：LaoDing
- 许可证：MIT

**取用内容（重要）**：`src/core/` 下的文件是对该项目 `src/` 的移植，绝大多数逐字保留，仅把与 DSH 宿主绑定的一部分换成普通路径解析（如 `host-peers.ts` 的 home 目录解析）。`src/web/card-css.ts` 是其 `src/client/styles.ts` 中 `WORKBUDDY_CARD_CSS` 的逐字导出。没有这些代码，本项目不存在。

**未取用内容**：DSH 插件注册入口（`index.ts`）、React 卡片（`src/client/**`）、宿主工具注册（`image-tool` / `video-tool`）、以及 `src/` 中未被本代理引用的其余模块（账号池调度、shim、诊断等）。这些文件不随本仓库分发。

**为什么保留 MIT 而不是改协议**：MIT 允许再分发与再许可，但要求保留原版权声明与许可全文。因此 `LICENSE` 中同时列有原作者与本项目的版权行，`src/core/` 与 `card-css.ts` 的版权归原作者所有。

---

## 2. codex-workbuddy-connect — 协议与工程实践参考（MIT）

- 仓库：<https://github.com/DuuU525/codex-workbuddy-connect>
- 作者：Charlotte Lee
- 许可证：MIT

**取用内容**：没有复制源码。参考了它对 Codex 侧接入方式的判断——本地 HTTP 代理 + OpenAI 兼容接口 + 在 Codex 配置里挂 `model_providers`；以及凭据文件的多路径探测思路（兼容 WorkBuddyAI / CodeBuddy / 国际版与国内版两个 auth 文件）。

**未取用内容**：其 Python 实现与 `wbresponses.py` 里的 Responses↔Chat 转换。本项目走的是另一条路：只讲 chat completions，把 Responses 的转换交给 Codex++ 网关（README 中的「路径 A」）。

---

## 3. CodexPlusPlus（Codex++）— 目标宿主与设计参照（AGPL-3.0）

- 仓库：<https://github.com/BigPizzaV3/CodexPlusPlus>
- 作者：BigPizzaV3
- 许可证：AGPL-3.0-only

**没有复制其代码**。本项目不包含 CodexPlusPlus 的任何源代码，也不链接其库，因此本仓库以 MIT 发布，不受 AGPL 传染。

参考的部分属于事实性接口与行为：

- 供应商池 `gateway.json` 的字段形态（`protocol` / `relayMode` / `upstreamBaseUrl` / `modelList` / `modelWindows` / `apiKeys`），用于读取与比对，以及判断「已保存的地址是否还指向上一个端口」；
- 模型列表「模型名 + 窗口」的写法（`[1M]` / `[500K]`），用于生成可直接粘贴的清单；
- 请求日志的字段维度（`startedAtMs` / `durationMs` / `firstTokenMs` / `usage` / `cacheHitRatio` / `attempts` / `error`），本项目的 `src/bridge/requests.ts` 是照这套维度自行实现的。

若你认为上述参考越界，请开 issue，我会立即调整表述或实现。

---

## 4. 运行时依赖

| 依赖 | 许可证 | 用途 |
|---|---|---|
| Node.js | MIT | 运行时（单文件构建时内嵌） |
| esbuild | MIT | 打包（仅构建期） |
| TypeScript | Apache-2.0 | 类型检查（仅构建期） |
| tsx | MIT | 开发期直接运行 TS |
| postject | MIT | 把 SEA blob 注入 exe（仅构建期） |

无运行时第三方依赖：`dist/` 的产物只依赖 Node 内置模块。

---

## 5. 商标与归属

WorkBuddy、CodeBuddy、Codex、Codex++ 等名称归各自所有者。本项目是个人开发的第三方工具，**与 WorkBuddy / 腾讯、OpenAI、CodexPlusPlus 作者均无隶属关系，也未获其背书**。使用本项目访问任何服务时，请自行遵守该服务的使用条款。
