# wx-acpx Text-only MVP Implementation Plan

I'm using the writing-plans skill to create the implementation plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `wx-acpx` 将微信的纯文本消息按命令路由到最小 Agent 集合，并用 `typing` 生命周期 + `acpx ensureSession/sendSession` 会话契约实现 Text-only MVP。

**Architecture:** `weixin-bot` 继续只负责传输层（收消息/缓存 context token/typing/send）。新增 `src/messaging/handler.ts` 负责命令解析、权限默认策略、并发串行化、typing 时序与错误可见反馈。新增 `src/acpx-runtime/client.ts` 作为运行时适配层，按 `(userId, agentName)` 生成 `nonce/name`，并通过 `acpx` 的 `ensureSession/sendSession` 完成最终文本提取（使用 `createOutputFormatter('quiet')` + 自定义 stdout 缓冲）。

**Tech Stack:** Bun（`bun test`、`Bun.spawn`/`async` 生态）、TypeScript、`fs.promises.realpath` canonicalization、`crypto`（SHA256 + uuid instanceId）、acpx（导入其 `ensureSession/sendSession/createOutputFormatter`）。

---

## Task 1: Add minimal Bun test scaffold

**Files:**
- Modify: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/package.json`（添加 `scripts.test` 可选；不强制）
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/smoke.test.ts`
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/test-utils.ts`

**Spec coverage (pre-check):**
- 当前 `wx-acpx` 没有任何 `*.test.ts`，因此需要最小 `bun test` 可运行骨架。

- [ ] **Step 1: Write the failing test**
  - `tests/smoke.test.ts`：
    - `import { test, expect } from "bun:test";`
    - `test("bun smoke works", () => expect(1 + 1).toBe(2))`

- [ ] **Step 2: Run test to verify it fails**
  - Run: `cd /Users/mamba/workspace/bailian/openclaw-wx/wx-acpx && bun test tests/smoke.test.ts`
  - Expected: FAIL（若当前 bun/test 配置缺失；或在引入更多测试前先只看 smoke）

- [ ] **Step 3: Write minimal implementation**
  - 无需生产代码；仅确保测试文件可被 Bun 发现与运行。

- [ ] **Step 4: Run test to verify it passes**
  - Run: `cd /Users/mamba/workspace/bailian/openclaw-wx/wx-acpx && bun test tests/smoke.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**（可选）

## Task 2: Implement command parsing & routing skeleton (with minimal aliases)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/command-types.ts`
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/command-parser.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/text-only-mvp/command-parser.test.ts`

**Spec coverage (must be implemented + tested):**
- 命令以 `/` 开头；`/agentname message`：第一个空白 token 为 `agentName`，其余为 message（`trim` 后文本保留）。
- agentName 大小写不敏感；message 保留 `trim` 后文本。
- 最小 alias 集合（MVP 必须支持）：
  - `/cc` -> `claude`
  - `/cx` -> `codex`
  - `/cs` -> `cursor`
  - `/km` -> `kimi`
  - `/gm` -> `gemini`
  - `/oc` -> `openclaw`
  - `/ocd` -> `opencode`
- 未带 `/` 前缀：走默认 agent。
- 未知 agent：handler 返回“未知 agent”并拒绝调用 acpx（parser 需要能返回“未知 agent error 分支”）。

- [ ] **Step 1: Write the failing test**
  - 在 `tests/text-only-mvp/command-parser.test.ts`：
    - `/help` parses -> `{ kind: "help" }`
    - `/info` parses -> `{ kind: "info" }`
    - `/new`、`/clear` parses -> `{ kind: "reset" }`
    - `/cwd ./somewhere` parses -> `{ kind: "cwd", path: "./somewhere" }`（path 为剩余字符串 trim）
    - `/cx hello` parses -> `{ kind: "agent-prompt", agentName: "codex", prompt: "hello" }`
    - `/ocd  hi there` parses -> `{ kind: "agent-prompt", agentName: "opencode", prompt: "hi there" }`
    - `/CS hello`（alias 大小写不敏感）-> agentName `cursor`
    - `/codex`（无 message） -> `{ kind: "agent-set-default", agentName: "codex" }`
    - `hello without slash` -> `{ kind: "agent-prompt", agentName: <defaultAgent>, prompt: "hello without slash" }`
    - `unknown like /unknown hi` -> `{ kind: "error", errorText contains "未知 agent" }`

- [ ] **Step 2: Run test to verify it fails**
  - Run: `cd ... && bun test tests/text-only-mvp/command-parser.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Implement `command-parser.ts`：
    - alias map：`cc/cx/cs/km/gm/oc/ocd` -> canonical agentName
    - canonical agentName 允许集合：`claude|codex|cursor|kimi|gemini|openclaw|opencode`
    - parser precedence：`help/info/reset/cwd` 优先；其次 parser agent forms；否则 fallback default agent

- [ ] **Step 4: Run test to verify it passes**
  - Run: `cd ... && bun test tests/text-only-mvp/command-parser.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**（可选）

## Task 3: Implement per-user state (nonce + session name template + cwd + default agent)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/user-state.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/text-only-mvp/user-state.test.ts`

**Spec coverage (must be implemented + tested):**
- `sessionKey = userId + '::' + agentName`
- 进程启动生成固定不变的 `instanceId`（测试可注入）。
- `nonce` 初始为 `0`；`/new|/clear`：对该 `sessionKey` 执行 `nonce += 1`
- `acpx ensureSession name` 模板（必须写死）：
  - `name = wx-acpx:${instanceId}:${agentName}:${hash(userId)}:nonce:${nonce}`

- [ ] **Step 1: Write the failing test**
  - In `tests/text-only-mvp/user-state.test.ts`：
    - `createUserState({ instanceId: "test-instance", initialCwdRoot: "/root" })`
    - default agent 初始为 `codex`
    - bumpNonceForDefaultAgent(userId)：
      - `nonce` 从 0 变 1
      - `buildSessionName`：
        - 包含 `wx-acpx:test-instance:${agentName}:`
        - 包含 `:nonce:0` 与 `:nonce:1`（并且两次 nonce 不同）
    - `hash(userId)` 在多次调用稳定

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test tests/text-only-mvp/user-state.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - `user-state.ts`：
    - SHA256 hash 截断（例如前 16 hex，测试断言不必覆盖完整 hash，只断言模板片段存在即可）
    - `getDefaultAgent(userId) / setDefaultAgent(userId, agentName)`
    - `getCwd(userId) / setCwdAndReset(userId, cwd)`：
      - MVP：cwd 切换后清空与该 user 相关的 `nonceBySessionKey`（或更保守清空全部映射；实现里需要与你 handler 的契约一致）

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test tests/text-only-mvp/user-state.test.ts`
  - Expected: PASS

## Task 4: Implement `/cwd` safe canonicalization (realpath + symlink escape prevention)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/cwd-safety.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/text-only-mvp/cwd-safety.test.ts`

**Spec coverage (must be implemented + tested):**
- 越界/符号链接逃逸：必须使用 `realpath` canonicalization。
- 越界时拒绝并返回错误文本；handler 需拒绝并且不调用 acpx。

- [ ] **Step 1: Write the failing test**
  - In `tests/text-only-mvp/cwd-safety.test.ts`：
    - create temp dirs：`rootDir`（allowed）、`outsideDir`（disallowed）
    - create `escapeSymlink = rootDir + "/escape"` -> symlink to `outsideDir`
    - `resolveSafeCwd({ inputPath: escapeSymlink, cwdRoot: rootDir })` -> reject（out of bounds）
    - `resolveSafeCwd` with non-existing path -> reject（realpath 失败）
    - `resolveSafeCwd` with `rootDir/subdir` -> returns canonical path（在 root 内）

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test tests/text-only-mvp/cwd-safety.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - `cwd-safety.ts`：
    - `canonicalRoot = await realpath(cwdRoot)`
    - `absoluteInput = isAbsolute(inputPath) ? inputPath : join(process.cwd(), inputPath)`（实现需在 plan 里固定一个策略）
    - `canonicalInput = await realpath(absoluteInput)`（dereference symlink）
    - allow：
      - `canonicalInput === canonicalRoot`
      - 或 `canonicalInput.startsWith(canonicalRoot + path.sep)`

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test tests/text-only-mvp/cwd-safety.test.ts`
  - Expected: PASS

## Task 5: Implement per-user serial queue (concurrency串行化 by userId)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/user-queue.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/text-only-mvp/user-queue.test.ts`

**Spec coverage (must be implemented + tested):**
- 并发串行化：同一 `userId` 任意时刻只允许处理一个 agent 分支（串行进入 agent 调用）。

- [ ] **Step 1: Write the failing test**
  - In `tests/text-only-mvp/user-queue.test.ts`：
    - enqueue for same userId 两个任务（第二个任务必须在第一个完成后才开始）
    - 使用 deferred promise 控制任务完成时机
    - assert `t2-start` occurs after `t1-end`

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test tests/text-only-mvp/user-queue.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - `user-queue.ts`：
    - `Map<userId, Promise<void>>` 维护链式队列
    - `enqueue(userId, fn)`：将 fn 串到链尾，并在 finally 清理（可选）

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test tests/text-only-mvp/user-queue.test.ts`
  - Expected: PASS

## Task 6: Add acpx dependency (direct import) + implement `acpx-runtime/client` (ensureSession/sendSession + quiet final text extraction)

**Files:**
- Modify: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/package.json`
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/acpx-runtime/agents.ts`
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/acpx-runtime/client.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/text-only-mvp/acpx-runtime-client.test.ts`

**Choice (required by you; brief explanation):**
- 选择：增加 `wx-acpx/package.json` 依赖并**直接 import `acpx` 库**（而不是 CLI 子进程）。
- 理由：本仓库同级存在 `openclaw-wx/acpx`，且 `wx-acpx` 使用 Bun，可直接 import `acpx` 的 TypeScript 源文件，从而更容易精确覆盖契约里的 `ensureSession/sendSession` 参数字段与 `createOutputFormatter('quiet')` 最终文本提取逻辑。

**Spec coverage (must be implemented + tested):**
- 权限字段传参：
  - `acpx ensureSession` 与 `acpx sendSession` 调用参数都显式包含 `permissionMode` 与 `nonInteractivePermissions`
- 最终文本提取：
  - 使用 `createOutputFormatter('quiet')`
  - 返回 `quietBuffer.trim()`（若为空返回兜底文案，避免发送空消息）
- agentName -> agentCommand 映射应复用 `acpx` 的 registry（`resolveAgentCommand` / `AGENT_REGISTRY`）

- [ ] **Step 1: Write the failing test**
  - In `tests/text-only-mvp/acpx-runtime-client.test.ts`：
    - 通过依赖注入（推荐实现方式）把 `acpxEnsureSession/acpxSendSession/createOutputFormatter/resolveAgentCommand` 作为参数传入 client 工厂，避免 bun test 里复杂的 module mocking
    - test 1：权限字段传参
      - 调用 client.ensureSession/sendSession
      - assert ensureSession 被调用时参数包含：
        - `permissionMode === "approve-reads"`
        - `nonInteractivePermissions === "deny"`
      - assert sendSession 被调用时参数包含同样两字段
    - test 2：quiet 输出提取
      - stub `createOutputFormatter('quiet', { stdout })` 返回一个 formatter，其 `flush()` 会调用 `stdout.write("assistant text")`
      - stub `acpxSendSession` 在执行时调用 `outputFormatter.flush()`
      - assert client 返回 `"assistant text"`（trim 后）

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test tests/text-only-mvp/acpx-runtime-client.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - `agents.ts`：
    - 复用 `acpx/src/agent-registry.ts` 的 `resolveAgentCommand`（或维护等价映射，但计划要求复用 registry）
  - `client.ts`：
    - 导出一个 `createAcpxRuntimeClient({ cwdRoot?, acpx })` 或纯函数 `createClientWithDeps(...)`
    - `ensureSession({ agentName, agentCommand, cwd, name, permissionMode, nonInteractivePermissions })`：
      - 调用 `acpxEnsureSession({ agentCommand, cwd, name, permissionMode, nonInteractivePermissions })`
      - 返回 `sessionId/sessionRecord`（至少返回 `record` 里可用于 sendSession 的 `sessionId/record.acpxRecordId`，具体以 acpx 类型定义为准）
    - `sendSession({ sessionRecord, prompt, output })`：
      - 创建 quiet output formatter：
        - `const quietBuffer = ""`
        - `stdout = { write(chunk){ quietBuffer += chunk }, isTTY: false }`
        - `outputFormatter = createOutputFormatter("quiet", { stdout })`
      - 调用 `acpxSendSession({ sessionId, prompt, outputFormatter, waitForCompletion:true, permissionMode, nonInteractivePermissions })`
      - 最终 `replyText = quietBuffer.trim()`；为空返回兜底文案

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test tests/text-only-mvp/acpx-runtime-client.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**（可选）

## Task 7: Implement messaging handler (`typing` 生命周期 + 路由 + nonce/name + 权限 + cwd 安全 + 并发串行化 + 错误处理)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/handler.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/tests/text-only-mvp/handler.test.ts`

**Spec coverage (must be implemented + tested):**
1) typing 时序：
  - 必须 `await bot.send(userId, ...)` 完成后才 `await bot.stopTyping(userId)`
  - 错误路径同样 `finally` 里 stopTyping（typing 不悬挂）
2) `/new|/clear`：
  - nonce/name 变化，并导致下一次 `acpx ensureSession` 的 `name` 不同（mock 断言）
3) 权限字段传参：
  - handler 调用的 `ensureSession/sendSession` 参数中显式包含 `permissionMode/nonInteractivePermissions`
4) `/cwd` 越界/符号链接逃逸拒绝：
  - 越界/realpath 失败时返回错误文本，并且**不调用** acpx（ensureSession/sendSession 不被调用）
5) 并发串行化：
  - 同一 `userId` 的并发消息不会同时进入 agent 调用分支（可用队列+mock 验证顺序）
6) 命令解析与路由：
  - alias 最小集合通过 parser + handler 路由生效
7) 文本-only：
  - `incoming.type !== "text"` 不崩溃并给出明确提示（MVP 建议：发送提示并 return；且不调用 acpx）

- [ ] **Step 1: Write the failing test**
  - `tests/text-only-mvp/handler.test.ts`：
    - botMock：
      - `sendTyping(userId)` -> 记录 `"typing-start"`
      - `send(userId, text)` -> 记录 `"send"` 并保存 text
      - `stopTyping(userId)` -> 记录 `"typing-stop"`
    - acpxMock（注入到 handler）：
      - `ensureSession(params)`：记录 params（包含 name 与权限字段）
      - `sendSession(params)`：记录 params，返回固定 `"assistant reply"`
    - userState 使用真实实现（或注入可控 instanceId）
    - userQueue 使用真实实现（或注入空锁以便专门测试）
    - 添加测试用例：
      - typing 时序（成功）：
        - 调用 handler 处理一条默认 agent 的纯文本消息
        - assert call order：`typing-start` -> `send` -> `typing-stop`
        - assert `stopTyping` 发生在 `send` await 完成之后（通过自定义 send 返回一个可控 promise 并检查 stopTyping 是否在其 resolve 后执行）
      - typing 时序（错误 + finally）：
        - `acpxMock.sendSession` throw `new Error("boom")`
        - assert：
          - `bot.send` 被调用且 text 含 `Error:`（或等价用户可读前缀）
          - call order 仍为：`typing-start` -> `send` -> `typing-stop`
      - /new|/clear nonce/name 契约（mock 断言）：
        - 先处理 prompt1（触发 ensureSession name 包含 `nonce:0`）
        - 再处理 `/new`（assert 不触发 ensureSession/sendSession）
        - 再处理 prompt2（assert ensureSession name 包含 `nonce:1` 且与 prompt1 的 name 不同；并包含 `wx-acpx:${instanceId}:${agentName}:` 片段）
      - 权限字段传参契约：
        - assert ensureSession/sendSession 调用参数中：
          - `permissionMode === "approve-reads"`
          - `nonInteractivePermissions === "deny"`
      - /cwd 越界/逃逸拒绝：
        - 构造允许 root 与逃逸 symlink（可复用 Task4 的测试数据生成方式，或仅 stub `resolveSafeCwd` 返回 error）
        - 处理 `/cwd <escapePath>`：
          - assert bot.send 返回错误文本
          - assert acpxMock.ensureSession/sendSession 未被调用
      - 并发串行化（同一 userId）：
        - 同一 userId 并发调用 handler.handle 两条 prompt
        - 让第一次 acpxMock.sendSession 在 deferred 上阻塞
        - assert 第二次 ensureSession/sendSession 不会在第一次完成前开始（检查调用次数与顺序）
      - 命令路由别名最小集合：
        - 输入 `/cs hello`
        - assert handler 将它路由到 `cursor` agent（通过 acpxMock 记录 agentName 或 agentCommand）

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test tests/text-only-mvp/handler.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - `handler.ts`：
    - 暴露类 `WxAcpHandler` 或函数 `createWxAcpHandler({ bot, userState, acpxClient, userQueue, parser, cwdRoot })`
    - `handle(incoming)`：
      - `return userQueue.enqueue(incoming.userId, () => this.processOne(incoming))`
    - `processOne(incoming)`：
      - 若 `incoming.type !== "text"`：
        - `await bot.send(userId, "MVP 暂不支持非文本消息")` 并 return（不调用 acpx）
      - 用 `command-parser` 根据文本得到命令结构
      - switch：
        - `help/info/reset/cwd/agent-set-default`：
          - 只更新 userState，并 `await bot.send` 确认；不调用 acpx
        - `agent-prompt`：
          - `await bot.sendTyping(userId)`
          - `try { ... await acpx ensureSession ... await acpx sendSession ... await bot.send(replyText) } catch(e) { await bot.send(userId, "Error: ...") } finally { await bot.stopTyping(userId) }`
          - 保证 `await bot.send` 在 finally 之前完成（通过把 bot.send 放在 try/catch 中、并且 finally 只做 stopTyping）
      - `/cwd` 流程：
        - 调用 `resolveSafeCwd` 做 canonicalization
        - 若 reject：`await bot.send(userId, errorText)` 并 return（且不调用 acpx）
        - 若 success：更新 userState 的 cwd，并执行 MVP 简化的状态清空（例如清空 nonceBySessionKey；实现与设计文档一致）

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test tests/text-only-mvp/handler.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**（可选）

## Task 8: Wire entrypoint `wx-acpx/index.ts` to new handler (remove echo reply)

**Files:**
- Modify: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/index.ts`

**Spec coverage:**
- 不使用 `bot.reply()`（因为它会自动 stopTyping，和 handler 的 try/finally typing 契约冲突）。
- 使用 handler 统一控制 `sendTyping/stopTyping/send`。

- [ ] **Step 1: Write the failing test**
  - No direct unit test required；以 handler tests 覆盖契约为主。

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test`
  - Expected: FAIL（若 wiring 引入类型错误；实现前不考虑）

- [ ] **Step 3: Write minimal implementation**
  - 修改 `index.ts`：
    - `const bot = new WeixinBot(); await bot.login();`
    - 初始化：
      - `const userState = createUserState({ instanceId: uuidv4, initialCwdRoot: process.env.WX_ACP_CWD_ROOT ?? process.cwd() })`
      - `const userQueue = createUserQueue()`
      - `const acpxClient = createAcpxRuntimeClient({ ...depsFromAcpx } )`
      - `const handler = new WxAcpHandler({ bot, userState, acpxClient, userQueue, parser })`
    - `bot.onMessage((msg) => handler.handle(msg))`
    - `await bot.run()`

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test`
  - Expected: PASS

- [ ] **Step 5: Commit**（可选）

---

## Execution Options

Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Two execution options:

1. Subagent-Driven (recommended)
   - 我将按 task 逐个派发并在 task 间做 review。
2. Inline Execution
   - 我在当前会话用 executing-plans 风格完成并在关键点 checkpoint。

Which approach do you want?

