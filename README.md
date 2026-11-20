# codex-connect-workbuddy

把你本机已登录的 **WorkBuddy** 模型，接进 **Codex** / **Codex++**。

本机起一个 OpenAI 兼容的 HTTP 代理（默认 `127.0.0.1:8787`），把 Codex 的对话请求转给 WorkBuddy 的上游接口；凭据直接复用 WorkBuddy 桌面端已经加密保存的那份，不需要另外填 token。

```
Codex ──▶ Codex++ 网关 ──▶ 本项目代理 ──▶ WorkBuddy 上游
          (Responses→Chat)   (127.0.0.1)      (SSE 逐字节透传)
```

---

## 它是什么 / 不是什么

**是**：一个本地转发进程 + 一个网页面板。转发用你本机的登录态，面板用来管账号、看余额、开关模型、查每次请求的耗时与 token。

**不是**：

- 不是逆向出来的免费额度工具。它用的是你自己账号的额度，扣的是你的积分。
- 不绕过 WorkBuddy 的任何鉴权。凭据解密调的是它自己的凭据文件与解密密钥。
- 不修改 Codex / Codex++。对它们来说，这只是一个普通的上游供应商。
- 与 WorkBuddy、腾讯、OpenAI、CodexPlusPlus 均无隶属关系。

---

## 功能

**转发**

- OpenAI 兼容的 `POST /v1/chat/completions`，支持流式与非流式；上游 SSE **逐字节透传**，不重编码（重编码会丢字段）。
- 工具调用（`tools` / `tool_choice`）以标准增量透传，Codex 的转换器可直接消费。
- `GET /v1/models` 按面板设置动态生成：被关掉的模型不出现，上下文窗口可覆盖，视觉能力可逐模型开关。
- 模型显示名带倍率（如 `DeepSeek-V4.1-Flash ×0.11`），选模型时就能看到价格差异。

**账号**

- 账号池列表带**剩余积分**与令牌到期时间，不用切过去才知道。
- 按余额自动换号：当前账号 ≤ 20 分时切到余额最高的账号并重发请求；所有账号都 < 50 分时不再发请求，返回 `402 insufficient_quota`。
- 只在「关于账号」的失败上换号（积分不足、账号级限流、凭据失效、账号被限制）；模型侧拥堵（`14003`）不换。
- OAuth 添加账号（国内版 / 国际版），登录后自动写入本地凭据库并切换。

**面板**（`http://127.0.0.1:8787/`）

| 标签页 | 内容 |
|---|---|
| 账号 | 账号切换 / 添加 / 移除、令牌到期、积分、签到、自动换号策略 |
| 模型 | 每个模型的倍率、上下文、工具与图片能力、窗口档位（200K/500K/1M）、推理强度、单个探测与测速 |
| 接入 | Codex++ 的填写参数逐项列出，可逐行复制；模型清单可直接粘贴；没有 Codex++ 时的原生 `config.toml` 片段 |
| 能力 | 图片 / 视频模型目录、福利领取 |
| 日志 | 逐条请求记录：模型、状态、耗时、首字耗时、输入输出 token、账号、错误原文；可筛选、搜索、只看失败、清空 |
| 诊断 | 设备身份档位（虚拟 / 真实）、桌面端 SDK 探测、最近请求 |

**进程**

- 单文件程序（Node SEA），自带运行时，不需要装 Node。
- 端口被占用自动顺延（最多试 20 个），顺延后弹窗告知，并把新端口记进配置。
- 「关闭」按钮一次结束代理与它派生的辅助进程；不影响 Codex / Codex++。

---

## 快速开始

### 前置

1. 本机安装并**登录** WorkBuddy 桌面端（凭据从它的数据目录读取）。
2. Node.js ≥ 22.19（只有从源码跑需要；用打包好的 exe 不需要）。

### 从源码跑

```bash
npm install
npm run check          # 类型检查
npm run dev            # 启动代理并打开面板（等价于 tsx src/cli.ts serve --open）
```

### 打成单文件程序

```bash
npm run build:exe      # 生成 dist/WorkBuddy 面板.exe（约 85 MB）
npm start              # 或直接双击 exe：不带参数 = serve --open
```

> 首次运行 Windows 可能弹 SmartScreen：注入 SEA blob 会破坏原 `node.exe` 的签名，程序**没有**数字签名，选「仍要运行」即可。

### 第一步先自检

```bash
npm run doctor
```

它会告诉你三件事：能不能读到登录态、桌面端主程序是否找到、模型目录有几个模型。**读不到登录态时先看这里，不要直接怀疑代理。**

---

## 接入 Codex++（推荐）

Codex++ 的本地网关已经接管了 `~/.codex/config.toml`，所以正确做法是**把本代理加成一个供应商**，而不是手改配置。

Codex++ 面板 → 供应商 → 添加 → 自定义（纯 API）：

| 字段 | 值 |
|---|---|
| 名称 | `WorkBuddy` |
| 供应商 ID | `wb-cn`（不要与池内已有 id 重复） |
| Base URL | `http://127.0.0.1:8787/v1` |
| 上游协议 | `Chat Completions` |
| 模式 | `纯 API` |
| API Key | `wbx-local`（**必填**，但本代理不校验；只要求非空） |
| 配置模型 | `deepseek-v4.1-flash`（默认启动模型，**不要带 `[500K]` 后缀**） |
| 模型列表 | 点「从上游获取」自动拉全；或手填 `模型名[窗口]`，每行一个 |

这些值在面板「接入」页会按当前端口与区域自动生成，每行都能单独复制，避免手抄出错。

要点：

- **协议必须选 Chat Completions**。本代理只讲 chat completions，`/v1/responses` 会明确返回 501 并提示改协议。
- **窗口不要填 1M**。上游报的是原生窗口，但 Codex 会按这个值推迟自动压缩，真跑到那个长度会先撞上游限流。填原生窗口的一半（500K 左右）更稳。
- 供应商与模型是**逐会话绑定**的，改完要新建会话才生效。

### 没有 Codex++ 时

Codex 原生 provider 也能用，在 `~/.codex/config.toml` 追加：

```toml
model_provider = "workbuddy"
model = "deepseek-v4.1-flash"

[model_providers.workbuddy]
name = "WorkBuddy"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "chat"
requires_openai_auth = false
experimental_bearer_token = "wbx-local"
```

注意：**装了 Codex++ 的话，手写的这段会被它覆盖**，那种情况下请走上面的供应商面板。

---

## 命令行

| 命令 | 作用 |
|---|---|
| `wbx serve [--port N] [--open]` | 启动代理；`--open` 就绪后打开面板 |
| `wbx stop [--port N]` | 停止代理（先请求优雅退出，失败再按端口结束进程） |
| `wbx doctor [--json]` | 诊断登录态、桌面端路径、模型目录 |
| `wbx models [--json]` | 列出可转发模型与窗口 |
| `wbx install` | 打印 Codex++ / Codex 的接入参数 |
| `wbx launcher` | 生成成对的双击脚本（启动 / 停止） |
| `wbx app-path [--set <路径>]` | 查看或固定桌面端主程序路径 |

`wbx` 指 `tsx src/cli.ts` 或构建后的 `node dist/wbx.mjs`。

### 端口

默认 8787。被占用时自动往后找空闲端口（最多 20 个），把实际端口写进 `runtime.json` 与 `bridge.json`（后者保证下次启动沿用同一端口，否则地址会来回跳）。面板会弹窗说明，并在「接入」页比对 Codex++ 里已保存的地址，若某条仍指向旧端口会直接点名。

### 关闭

| 方式 | 结果 |
|---|---|
| 面板右上角「关闭」 | 结束代理与它派生的辅助进程（设备 SDK worker 等），清理运行状态 |
| 关掉标题为 `WorkBuddy Proxy` 的控制台窗口 | 同上（那个窗口就是进程本体） |
| `wbx stop` / 双击生成的「停止」脚本 | 先优雅退出，退不掉再按端口强杀 |

停止通道只接受本机来源：带非本机 `Origin` 的请求一律 403，避免任意网页把你的代理关掉。

---

## 账号路由

| 规则 | 阈值 | 行为 |
|---|---|---|
| 换号 | 当前账号 ≤ **20** | 切到余额最高的账号，本次请求重发 |
| 停用 | 所有账号都 < **50** | 不发请求，返回 `402` + `insufficient_quota` |

阈值在 `src/bridge/router.ts` 的 `SWITCH_FLOOR` / `MIN_USABLE`，可以直接改。

两个数不同是刻意的：20 是「这个号撑不完一次长会话」的保险线，50 是「换过去也没意义」的门槛——换号会让上游前缀缓存全废，首字延迟翻倍。

- **粘性优先**：当前账号高于 20 就不换，哪怕别的号分更多。
- **余额读不到时放行**，既不当作有钱也不当作没钱，由上游回答。断网时报「无额度」会让人去充值一个其实有钱的账号。
- 换号只发生在响应头发出之前，客户端看不到半截内容。

---

## 请求日志

字段维度对齐 Codex++ 的请求日志：

```
startedAtMs / durationMs / path / statusCode / stream / model / upstreamModel
wireApi / attempts / autoRetries / firstTokenMs / usage{input,output,cached,reasoning}
cacheHitRatio / account / error
```

- 落盘 `~/.wb-codex-bridge/requests.jsonl`，**8 MB 滚动、只保留尾部 2 MB**，从换行处切，不留半截 JSON。
- 流式响应的 `usage` 从**尾部 8 KB** 做括号配平刮出来，不缓存整段响应（长回答几百 KB，整段缓存等于给每次请求做一次全量复制）。
- `attempts` 是真实发出去的上游请求数，`autoRetries` 是因账号原因重来的次数。

---

## 状态与配置文件

全部在 `~/.wb-codex-bridge/`：

| 文件 | 内容 |
|---|---|
| `bridge.json` | 桌面端主程序路径、端口 |
| `panel.json` | 面板设置：区域开关、逐模型开关 / 窗口 / 推理强度 / 图片 |
| `runtime.json` | 当前实例的端口与 pid（`stop` 靠它定位） |
| `requests.jsonl` | 请求日志 |

目录权限 `0700`、文件 `0600`（Windows 上通过 ACL 收紧）。

---

## 安全与隐私

- **凭据只读**：从 WorkBuddy 桌面端的加密凭据文件读取，解密密钥来自它自己的安装目录；本代理不修改、不上传。
- **不出本机**：所有请求发往 WorkBuddy 官方域名，没有任何第三方中转、遥测或统计上报。
- **面板只监听 127.0.0.1**，不对外网开放；面板不校验 API Key，但也不会因此暴露——它没有公网入口。
- **日志只在你本机**，可在面板「日志」页清空。
- **令牌不落日志**：日志里只有账号名，没有 token；设备 SDK 的 token 只以掩码与长度出现。

---

## 已知限制

- **依赖上游未公开接口**。WorkBuddy 的内部接口随时可能变；变了就得改 `src/core/upstream.ts`。不保证长期可用。
- **只提供 chat completions**。`/v1/responses` 返回 501（路径 A 的设计选择）。
- **不提供图片 / 视频生成端点**。面板能列出媒体模型，但只提供目录信息；生成能力没有暴露成 HTTP 接口。
- **`attempts` 只在账号类失败时 > 1**。请求级的网络重试没有做。
- **真实设备档需要外部 SDK**。单文件构建里没有模块路径，自动发现失效，需要设 `WORKBUDDY_SDK_DIR`；默认的虚拟设备档不受影响。
- **切换设备档要重启代理**才生效（身份在构造上游客户端时解析并缓存）。
- **Windows 优先**。代码里 Windows 相关处理（ACL、注册表回退、控制台标题）占比不低，macOS / Linux 未实测。

---

## 目录结构

```
src/
  core/            上游能力内核：凭据解密、设备身份、上游客户端、目录、积分、签到
  bridge/          适配层：HTTP 服务、账号路由、面板数据、设置持久化、请求日志
  web/             面板（HTML + 内联 JS，样式沿用 dsh-connect-workbuddy 的卡片样式系统）
  install/         Codex++ 接入参数推算、双击启动器生成
  cli.ts           命令行入口
  sea-entry.ts     单文件可执行入口（Node SEA 只接受 CJS 主脚本）
native/turing-sdk/ 设备身份 SDK 的 worker（可选，真实设备档用）
scripts/           构建辅助（SEA 注入）
```

### 构建产物

```bash
npm run build       # dist/wbx.mjs        ESM bundle，node 直接跑
npm run build:exe   # dist/WorkBuddy 面板.exe  单文件程序（自带运行时）
```

---

## 常见问题

**「未读到登录态」** —— 先 `npm run doctor`。多数是桌面端没登录，或桌面端装在了非常规路径导致找不到主程序：用 `wbx app-path --set <路径>` 固定一次。

**Codex 报连接失败** —— 先看面板「日志」页有没有记录：
- 没有记录 → 请求没打到代理，是 Codex++ 那边的供应商绑定或端口对不上；
- 有记录但状态 4xx → 看错误原文（多半是上游判定，如 `11128` 渠道校验、`14003` 模型拥堵）；
- 有记录、200、但 Codex 报错 → 网关回程转换的问题，把日志导出来开 issue。

**切了账号但积分没变** —— 旧版本的问题（概览缓存没按账号区分），已修复；如果你用的是旧版本，切完请手动刷新一次。

**积分显示 `×0`** —— 上游目录里的免费模型，仍会消耗请求次数但倍率为 0。

**面板打不开** —— 代理没在跑。双击程序或 `npm start`；端口被占会自动顺延，看控制台输出或弹窗里的端口。

---

## 致谢

这个项目的**内核不是从零写的**，它站在三个开源项目上：

1. **[dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)**（LaoDing，MIT）—— `src/core/` 与面板样式的来源。凭据解密、设备身份派生、上游客户端、目录与积分，基本是它的实现；本项目主要做了「脱离 DSH 宿主 + 换成 Codex 的协议面」这层改造。
2. **[codex-workbuddy-connect](https://github.com/DuuU525/codex-workbuddy-connect)**（Charlotte Lee，MIT）—— 教会了我怎么把这类东西挂到 Codex 侧：本地代理 + OpenAI 兼容接口 + `model_providers`，以及凭据文件的多路径探测思路。
3. **[CodexPlusPlus](https://github.com/BigPizzaV3/CodexPlusPlus)**（BigPizzaV3，AGPL-3.0）—— 目标宿主。供应商池格式、模型列表写法、请求日志的字段维度都参考了它。**本项目未复制其任何源代码。**

逐项说明了「取用什么、没取用什么」的清单见 [NOTICE.md](NOTICE.md)。

---

## 许可证

[MIT](LICENSE)。`src/core/` 与 `src/web/card-css.ts` 的版权归原作者（LaoDing），其余部分归本项目作者。
