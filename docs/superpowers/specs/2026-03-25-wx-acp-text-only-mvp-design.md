# wx-acpx Text-only MVP 设计文档

日期：2026-03-25

## 1. 背景与现状

`wx-acpx` 当前实现了一个 `WeixinBot`（`wx-acpx/src/weixin-bot/*`）：
- 通过长轮询接收微信侧消息（`getUpdates`）
- 缓存并复用每个用户的 `context_token`
- 支持发送纯文本消息（`buildTextMessage` + `sendMessage`），以及 typing 指示（`sendTyping/stopTyping`）

但目前入口 `wx-acpx/index.ts` 只是登录并对收到的消息回“你说了: xxx”，没有实现：
- 命令解析与路由（按 agent 名称选择不同 Coding Agent）
- 会话/上下文策略（保持同一用户与同一 agent 的对话连续性）
- 对接 `acpx`（`openclaw-wx/acpx`）作为数据/运行时后端

`weclaw` 的 Go 实现（`weclaw/messaging/handler.go`）集中实现了“消息编排 + 命令路由 + typing 生命周期 + agent dispatch + 额外内置命令”，本设计将其行为对齐到 `wx-acpx` 的 Text-only MVP。

## 2. 目标

### 2.1 必须完成（MVP）
- Text-only：只处理文本消息；非文本（图片/语音/文件）在 MVP 阶段要么忽略，要么用明确提示降级。
- 命令与路由：
  - `/help`：返回帮助
  - `/info`：返回当前默认 agent 信息（至少包含名称）与当前工作目录（cwd）
  - `/new`、`/clear`：重置该用户与“默认 agent”的会话（清空历史/开始新会话）
  - `/cwd <path>`：切换工作目录，并使后续新会话在该目录下创建（MVP 简化：切换后清空运行中状态）；且 `cwd` 需位于允许根目录（建议 `WX_ACP_CWD_ROOT`）之下
    - 规范化/安全契约：将输入路径解析为真实路径（`realpath`/等价 canonicalization），使用真实路径前缀检查阻止 `..` 与符号链接逃逸；若解析失败或越界则返回错误
  - `/agentname`：切换默认 agent（只改默认路由，不立即对话）
  - `/agentname message`：将 message 路由给指定 agent 并回复
  - 无命令前缀：走默认 agent
- typing 生命周期：
  - 在调用 agent 期间发送 typing
  - agent 完成后停止 typing
- 对接 `acpx`：
  - 对于给定 `(userId, agentName)`，通过 `acpx` 完成 `ensureSession`（会话确保）与 `sendSession`（提示发送）
  - 返回 agent 的“最终文本回复”并发送回微信
- 权限策略（默认安全）：
  - 使用 `permissionMode="approve-reads"` + `nonInteractivePermissions="deny"`
  - 语义约束：`wx-acpx` 在服务/容器运行时默认没有 TTY；因此 `acpx` 在解析权限时会走 non-interactive 分支，保证写入/执行类工具不会被自动放行（最多是被拒绝或取消）。

### 2.2 非目标（后续迭代）
- 图片/语音/文件的保存、转发与多媒体回复（weclaw 在 `handleImageSave` 等处实现，本 MVP 不做等价实现）
- 链接拦截（linkhoard）与 URL 保存（weclaw 对应 `IsURL`/`SaveLinkToLinkhoard`）
- streaming 分片到微信（目前 `WeixinBot` 发送文本是按块分割长文本，不做增量输出）

## 3. 关键设计决策

### 3.1 分层结构（对齐 weclaw，但适配 TS 架构）
- `weixin-bot`：仅做传输层
  - 负责收取消息、缓存 context token、typing、发送纯文本
- 新增 `messaging/handler`：负责消息编排
  - 负责命令解析、agent 路由、调用 acpx、组装回复
- 新增 `acpx-runtime/client`：负责 `agentName -> acpx agentCommand` 与会话交互
  - 负责 `ensureSession/sendSession` 的参数组装与“最终文本提取”

这样做到：
- 以后替换传输层（例如换成别的聊天入口）只改 handler 的输入/输出
- 以后替换 acpx 的调用方式只改运行时适配层

### 3.2 默认权限策略
MVP 默认采用最保守策略，避免在服务端环境触发写入或执行工具：
- `permissionMode="approve-reads"`
- `nonInteractivePermissions="deny"`

执行时序与生效前提（必须写死到实现里）：
- `wx-acpx` 调用 `acpx` 的 `ensureSession/sendSession` 时要显式传入 `permissionMode/nonInteractivePermissions`
- 当进程具备 TTY（本地开发手动运行）时，`acpx` 可能会进入交互式权限询问；这不改变安全边界（仍由 `approve-reads` 控制自动放行范围），但本 MVP 的“非交互自动拒绝”验收按服务场景执行。

后续可以通过配置开关或命令扩展为 `approve-all`，但不作为默认。

### 3.3 会话重置策略（MVP 简化）
MVP 必须“显式保证新会话”，避免 `acpx` 在相同 `(agentCommand, cwd, name)` 下复用旧会话。

会话命名与 nonce 规则（强制写进实现）：
- 为每个键 `sessionKey = userId + '::' + agentName` 维护 `nonce`（初始为 0）
- 在进程启动时生成固定不变的 `instanceId`（例如 uuid），参与会话命名：保证进程重启后不会复用旧上下文
- 将 `acpx ensureSession` 的 `name` 设置为 `name = wx-acpx:${instanceId}:${agentName}:${hash(userId)}:nonce:${nonce}`
  - `hash(userId)` 用不可逆 hash（如 sha256 截断），避免在本地 session 文件里明文暴露 userId
- `/new|/clear` 时对该 `sessionKey` 的 `nonce += 1`
  - 下一次对话调用 `ensureSession` 时 `name` 改变，因此 `acpx` 的 session 查找（按 `agentCommand/cwd/name`）无法匹配旧 session，只能创建新 session。

在本 MVP 中：
- 不要求立即关闭/清理旧 session；验收关注的是用户侧“不会复用旧上下文”的行为契约
- 持久化（落盘）可在后续迭代

## 4. 组件设计

### 4.1 `WeixinBot`（现有）
关键现状点：
- 收到消息后会调用 `onMessage(handler)`
- `reply(message, text)` 会写入 context token 并自动停止 typing

MVP 选择：typing 生命周期由 handler 独占控制，避免与 `reply()` 的自动停止逻辑冲突。
- 处理完成回复时使用 `WeixinBot.send(userId, text)`（纯文本），不使用 `reply()`
- typing 开始：`bot.sendTyping(userId)`
- typing 结束：在 `bot.send(...)` 的 Promise **settle**（resolve/reject）之后调用 `await bot.stopTyping(userId)`（放在 `finally` 内保障，避免 typing 悬挂）

### 4.2 `messaging/handler.ts`（新增）

职责：
- 输入：`IncomingMessage`（由 `WeixinBot` 提供）
- 输出：通过 `WeixinBot.send`（纯文本）返回给用户（MVP 不使用 `reply()`）

主要流程：
1. 过滤：只处理 `message.type === 'text'`（或 `extractText` 后非空）
2. 解析：
   - 识别 `/help /info /new|/clear /cwd`
   - 识别 `/agentname` 与 `/agentname message`
3. 路由：
   - 如果指定 agent：用指定 agentName
   - 否则使用用户的默认 agentName
4. typing：
   - 调用 `bot.sendTyping(userId)`
   - 调用运行时适配层得到回复文本
5. 回复：`await bot.send(userId, replyText)`（必要时复用 chunkText 机制；必须等待分块发送完成）
6. `finally`：`await bot.stopTyping(userId)`（保证无论成功/失败都能停止）

并发约束（必须写死到实现里）：
- 同一 `userId` 在任意时刻只允许处理一个对话请求（串行化）
- 否则多个并发请求可能互相 stopTyping，导致 typing 状态机混乱

### 4.3 `acpx-runtime/client.ts`（新增）

职责：
- 根据 `agentName` 找到 acpx 的 agentCommand（复用 `acpx/src/agent-registry.ts` 的 registry）
- 为给定 `(userId, agentName)` 创建/加载会话：
  - `ensureSession({ agentCommand, cwd, name, permissionMode, nonInteractivePermissions, ... })`
  - `sendSession({ sessionId, prompt: textPrompt(message), outputFormatter, waitForCompletion:true, ... })`
- “最终文本提取”：
  - 使用 `acpx` 的 `createOutputFormatter('quiet')`
  - 输出契约：`quiet` 模式只接收 `sessionUpdate.agent_message_chunk` 且 `content.type === 'text'` 的 assistant 文本块，并在 prompt 完成后将这些块串接为最终文本
  - handler 使用 `quietBuffer.trim()` 作为最终回复；若为空则返回兜底文案（避免发送空消息）

## 5. 数据流（一次消息）

1. `WeixinBot` long-poll 得到 `incoming`
2. `handler.handle(incoming)`：
   - parse route 和命令
   - typing 开启
   - `acpxClient.ensureSession/sendSession`
   - `await bot.send(userId, replyText)`
   - typing 停止：在 `bot.send(...)` settle 之后调用 `await bot.stopTyping(userId)`（finally）

## 6. 命令约定（对齐 weclaw 的可读性）

- `/help`
- `/info`
- `/new` 或 `/clear`：重置默认 agent 的会话
- `/cwd <path>`：切换工作目录
- `/agentname`：设置默认 agent
- `/agentname message`：指定 agent 对话

agentName / alias：
- MVP 在命令解析上提供与 weclaw 一致的最小 alias 集合：
  - `/cc` -> `claude`
  - `/cx` -> `codex`
  - `/cs` -> `cursor`
  - `/km` -> `kimi`
  - `/gm` -> `gemini`
  - `/oc` -> `openclaw`
  - `/ocd` -> `opencode`
- 解析规则（必须写清楚到实现里）：
  - 命令以 `/` 开头，`/agentname message` 采用“第一个空白 token 为 agentName，剩余为 message”的切分
  - agentName 大小写不敏感；message 保留 trim 后的文本

## 7. 错误处理与用户可见反馈

MVP 建议：
- 运行时异常（acpx 失败/超时/无会话/权限拒绝）要转成可读文本，发回微信（例如 `Error: ...`）
- typing 与发送逻辑一定用 `try/finally` 防止 typing 悬挂
- 对“agent 返回空文本”的情况返回兜底提示（避免微信空消息）

## 8. 测试计划（建议）

单元测试目标：
- 命令解析：
  - `/help /info /cwd /new /agentname` 等解析与路由键正确
- 路由策略：
  - 指定 agent vs 默认 agent 的行为正确
  - `/new` 对应到“重置 session 映射”，下一轮确实走新会话路径
- typing 与错误：
  - agent 抛错时 `stopTyping` 仍被调用
- 会话契约：
  - `/new` 后下一次调用 `acpx ensureSession` 的 `name` 中 nonce 递增（且包含 instanceId，避免重启后复用旧上下文）
- 权限契约：
  - `acpx ensureSession/sendSession` 的调用参数中显式包含 `permissionMode="approve-reads"` 与 `nonInteractivePermissions="deny"`
- cwd 安全契约：
  - 当 `/cwd` 输入越界或存在符号链接逃逸风险时，handler 返回错误并拒绝切换（不进行会话调用）

实现上可以通过 mock：
- mock `WeixinBot`（只验证 sendTyping/stopTyping/send 的调用）
- mock `acpx-runtime/client`（返回固定文本或抛出错误）

必测断言清单（用于验收，必须写成测试断言）：
- `/new|/clear` 语义
  - 断言：handler 内部维护的 `nonce` 在收到 `/new` 或 `/clear` 后递增
  - 断言：下一次调用 `acpx ensureSession` 时，传入的 `name` 匹配模板
    - 包含固定片段 `wx-acpx:${instanceId}:${agentName}:`
    - 包含 `:nonce:${nonce}` 且与上一轮 nonce 不同
  - 断言：`/new|/clear` 本身不会直接调用 `ensureSession/sendSession`（除非设计选择立即重启会话）
- 权限字段传参
  - 断言：分别对 `ensureSession` 与 `sendSession` 的调用参数都显式包含 `permissionMode="approve-reads"` 与 `nonInteractivePermissions="deny"`
- `/cwd` 越界/符号链接逃逸拒绝
  - 断言：当输入路径规范化后（realpath/canonicalization）落在允许根目录之外时，handler 返回错误文本，并且**不调用** `acpx ensureSession/sendSession`
  - 断言：解析失败（realpath 失败）时同样拒绝并不调用 acpx
- 权限/路由组合的拒绝策略
  - 断言：若 `agentName` 不是允许列表（MVP 的最小集合/alias 解析失败），handler 返回“未知 agent”错误文本，并且不调用 acpx
- unknown agent 的 typing 行为
  - 断言：当命令解析为 unknown agent（或解析错误）时，handler 不调用 `bot.sendTyping/bot.stopTyping`，不调用 `acpx ensureSession/sendSession`，仅 `bot.send(userId, <errorText>)`
- typing 时序
  - 断言：每次 agent 调用前调用 `bot.sendTyping(userId)`
  - 断言：handler 必须 `await bot.send(userId, ...)`，且仅在该 Promise settle（resolve/reject）后才调用 `await bot.stopTyping(userId)`
- agent 错误路径
  - 断言：当运行时（acpx）抛错时，handler 仍会 `await bot.stopTyping(userId)`（finally）
  - 断言：handler 会 `await bot.send(userId, <errorText>)`（包含 `Error:` 前缀或等价用户可读错误文案），并且该发送发生在 stopTyping 之前
- 并发串行化
  - 断言：同一 `userId` 的并发消息不会同时进入 agent 调用分支（可用队列/锁 mock 验证调用次数与顺序）

## 9. 验收标准

1. 发送一条纯文本消息后：
   - typing 出现
   - 得到 acpx agent 的响应文本并回复
2. `/help` 能返回支持命令
3. `/agentname message` 路由到指定 agent，`/agentname` 只切默认
4. `/new` 后下一次对话表现为“新会话”：`acpx ensureSession` 使用的 `name` 因 nonce 改变，因此不会复用旧会话上下文
5. `/cwd` 切换后至少保证后续会话在新目录创建：切换后清空当前运行时的会话 nonce/默认路由映射（MVP 简化），保证不会错误地复用旧 cwd 下的 session
6. 非文本消息在 MVP 阶段不崩溃，并给出明确提示（或安全忽略）

## 10. 待确认问题（后续实现可调整）

- 是否需要把 `/cwd` 的允许目录做成可配置（建议引入 `WX_ACP_CWD_ROOT`，默认取进程启动目录/工作区根，拒绝越界路径）
- `/cwd` 切换是否需要像 `/new` 一样也显式 bump nonce（当前设计选择“清空映射”，等价于 bump 行为）

