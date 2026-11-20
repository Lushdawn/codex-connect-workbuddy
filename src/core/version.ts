/**
 * 版本号。
 *
 * 这里刻意用字面量而不是运行时读 `package.json`：单文件程序（Node SEA）里没有
 * 可解析的包路径，构建产物也不含 `package.json`，运行时读文件必然失败。
 * 发布时与 `package.json` 的 `version` 一起改。
 *
 * @module codex-connect-workbuddy/version
 */

export const WORKBUDDY_CONNECT_VERSION = '0.1.0'
