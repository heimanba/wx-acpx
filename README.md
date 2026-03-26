# wx-acpx

微信 AI Agent 桥接器（Weixin Bot x ACPX runtime）— 将微信文本消息路由到 ACP 模式的 Agent（Qwen、Claude、Codex、Gemini、Kimi、Cursor 等）。

## 快速开始

```bash
# 安装依赖
bun install

# 启动（首次运行会在终端输出二维码登录指引）
bun run index.ts
```

启动后，`wx-acpx` 会：

1. 登录微信 Bot（首次需要扫码确认；凭证默认保存到 `~/.wx-acpx/credentials.json`）
2. 等待微信消息
3. 解析聊天命令（如 `/help`、`/qwen 你好`、`/cwd /path/to/project`）
4. 为每个用户维护默认 Agent、工作目录、会话 nonce，并通过 ACPX runtime 转发到对应 Agent

## 测试

```bash
bun test
```

## 聊天命令

在微信中发送以下命令：

| 命令 | 说明 |
| --- | --- |
| `你好` | 发送给当前默认 Agent |
| `/<agent> <prompt>` | 发送给指定 Agent（例如：`/qwen 解释这段代码`） |
| `/<agent>` | 将默认 Agent 切换为该 Agent（例如：`/claude`） |
| `/cwd <path>` | 切换工作目录（支持相对路径；会进行安全路径解析） |
| `/new` | 开始新会话（nonce 递增） |
| `/clear` | 同 `/new` |
| `/info` | 查看当前 `defaultAgent` / `cwd` / `nonce` |
| `/help` | 查看帮助 |

### 快捷别名

以下别名在默认配置下可用：

| 别名 | Agent |
| --- | --- |
| `/cc` | `claude` |
| `/cx` | `codex` |
| `/cs` | `cursor` |
| `/km` | `kimi` |
| `/gm` | `gemini` |
| `/oc` | `openclaw` |
| `/ocd` | `opencode` |

## 配置

环境变量：

- `WX_ACP_CWD_ROOT`：允许切换工作目录的根路径（`/cwd` 会被限制在该根目录下）。默认：`process.cwd()`

示例：

```bash
WX_ACP_CWD_ROOT="$HOME/work" bun run index.ts
```

## 技术文档

- [微信 Bot（iLink）协议与本地封装](docs/weixin-bot-protocol.md)：HTTP 路径、登录、长轮询、`context_token`、发消息与 typing
- [ACPX Runtime 集成](docs/acpx-runtime.md)：依赖 `acpx` CLI、`ensureSession` / `sendSession`、Agent 注册表

## 目录结构（核心）

- `index.ts`：程序入口，初始化 Weixin Bot、命令解析、用户状态与 ACPX runtime 客户端
- `src/messaging/`：命令解析、消息处理、用户状态与串行队列（避免同一用户并发消息互相打断）
- `src/acpx-runtime/`：ACPX runtime 客户端与 agent registry（把 agentName 解析为实际可执行命令）
- `src/weixin-bot/`：微信 Bot 登录/收发消息（二维码登录、凭证持久化）

## 常见问题

### 收不到消息或程序卡住？

- 确认终端里显示了 `Bot is running. Press Ctrl+C to stop.`（入口在 `index.ts`）
- 首次启动需要完成二维码扫码确认；登录凭证默认保存在 `~/.wx-acpx/credentials.json`

### `未知 agent: xxx` 是什么原因？

- 你发送了未注册/未别名的 agent token。可以先用 `/help` 查看命令格式，或使用已内置的 agent（如 `/qwen`、`/claude`、`/codex`、`/gemini`、`/kimi`、`/cursor` 等）

---

本项目使用 [Bun](https://bun.com) 运行与测试。
