# 微信 Bot（iLink）协议与本地封装

本文说明 `src/weixin-bot/` 对接的**服务端 HTTP 协议**与本仓库中的**客户端行为**，便于排查登录、收消息、发消息与「正在输入」等问题。

## 参考来源（上游）

- **协议分析**：`https://www.wechatbot.dev/zh/protocol`
- **参考 SDK 实现**（本文对照对象）：`https://github.com/epiral/weixin-bot`

说明：

- 本仓库的实现以“能稳定跑通”为主，字段/接口命名尽量沿用 iLink 返回；当本文与上游文档不一致时，以 `src/weixin-bot/` 代码为准。
- 上游文档中常见 `base_info.channel_version: "2.0.0"`；但本仓库当前常量为 `CHANNEL_VERSION = "1.0.0"`（见 `api.ts`）。若后续遇到服务端兼容性变化，可优先尝试对齐上游的 `2.0.0`。

## 服务端与通道

- **默认 Base URL**：`https://ilinkai.weixin.qq.com`（见 `api.ts` 中 `DEFAULT_BASE_URL`）
- **通道版本**：`channel_version: "1.0.0"`，随各请求在 `base_info` 中携带

所有业务请求均为 **POST JSON**（除二维码相关 GET 外），成功响应体通常含 `ret === 0`。

## 认证

### 二维码登录（无 token 时）

| 操作 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 取二维码 | GET | `/ilink/bot/get_bot_qrcode?bot_type=3` | 返回 `qrcode`、`qrcode_img_content`（可展示为链接/二维码） |
| 轮询状态 | GET | `/ilink/bot/get_qrcode_status?qrcode=...` | `status`: `wait` \| `scaned` \| `confirmed` \| `expired` |

确认后响应中应包含 `bot_token`、`ilink_bot_id`、`ilink_user_id`；可选 `baseurl` 覆盖默认 API 根地址。

### 已登录请求头（有 token 时）

由 `buildHeaders(token)` 生成，主要包括：

- `Content-Type: application/json`
- `AuthorizationType: ilink_bot_token`
- `Authorization: Bearer <token>`
- `X-WECHAT-UIN`: 随机生成的 UIN（见 `randomWechatUin()`）

### 凭证持久化

- 默认路径：`~/.wx-acpx/credentials.json`（目录 `~/.wx-acpx`，文件权限 `0600`）
- 结构（`Credentials`）：`token`、`baseUrl`、`accountId`、`userId`
- 可通过 `LoginOptions.tokenPath` 自定义路径

## 消息拉取（长轮询）

| 操作 | 路径 | 请求体要点 |
|------|------|------------|
| 拉取更新 | `POST /ilink/bot/getupdates` | `get_updates_buf`：游标；`base_info` |

- 客户端用返回的 `get_updates_buf` 作为下一轮游标（见 `WeixinBot` 中 `cursor`）
- 超时由服务端通过 `longpolling_timeout_ms` 等字段描述；本地 `fetch` 使用 `AbortSignal.timeout(40_000)` 等控制

## 下行消息结构（节选）

核心类型见 `types.ts`：

- `WeixinMessage`：`message_id`、`from_user_id`、`to_user_id`、`message_type`、`message_state`、`context_token`、`item_list` 等
- `message_type`：`USER(1)` / `BOT(2)` — 仅 **USER** 消息会转为 `IncomingMessage` 交给业务
- `item_list` 中 `MessageItemType`：`TEXT`、`IMAGE`、`VOICE`、`FILE`、`VIDEO`

`WeixinBot.toIncomingMessage` 只处理用户消息；文本从 `text_item` 拼接，其它类型会映射为占位或 URL 片段（见 `extractText`）。

## 上行：发文本

| 操作 | 路径 | 说明 |
|------|------|------|
| 发消息 | `POST /ilink/bot/sendmessage` | `msg` 内含 `to_user_id`、`context_token`、`item_list`（文本为 `TEXT` + `text_item`） |

- 单条文本非空；超长内容在客户端按 **2000 字符**（Unicode 码点）分片多次发送（`chunkText`）
- `buildTextMessage` 使用 `MessageType.BOT`、`MessageState.FINISH`，并为每条生成新的 `client_id`

## 「正在输入」

1. `POST /ilink/bot/getconfig`：传入 `ilink_user_id`、`context_token`，响应中可能含 `typing_ticket`
2. `POST /ilink/bot/sendtyping`：`status` 为 `1`（开始）或 `2`（结束），并带上一步的 `typing_ticket`

业务侧须先有该用户的 `context_token`（来自最近一条消息）；`send` / `sendTyping` 依赖内部缓存的 `contextTokens`。

## `WeixinBot` 运行时行为（摘要）

- **`login()`**：读盘凭证或走二维码；登录后更新内存中的 `baseUrl` / `credentials`
- **`run()`**：循环调用 `getupdates`；对每条用户消息调用已注册的 `onMessage` 处理器
- **会话失效**：若错误为 `ApiError` 且 `code === -14`，视为会话过期：清凭证、清游标与 context，必要时强制重新扫码（见 `isSessionExpired`）

## 与上层（wx-acp）的边界

- 本模块只负责：**登录、长轮询收消息、按用户维护 context、发文本、可选 typing**
- 命令解析、Agent、工作目录等均在 `src/messaging/` 与 `src/acpx-runtime/`，不在本文范围

## 相关源码

| 文件 | 职责 |
|------|------|
| `api.ts` | HTTP 路径、请求体、Header、`ApiError` |
| `auth.ts` | 二维码流程、读写 `credentials.json` |
| `client.ts` | `WeixinBot` 类：游标、分发、分片发送 |
| `types.ts` | 请求/响应与消息结构类型 |
