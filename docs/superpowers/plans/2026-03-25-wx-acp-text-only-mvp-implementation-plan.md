# wx-acpx Text-only MVP Implementation Plan

I'm using the writing-plans skill to create the implementation plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `wx-acpx` 通过命令路由与 typing 生命周期，把纯文本消息对接 `acpx` 实现 Text-only MVP。

**Architecture:** `weixin-bot` 只做传输层（长轮询接收/typing/send/纯文本发送）；新增 `messaging/handler` 做命令解析、并发串行化、typing 生命周期与回复编排；新增 `acpx-runtime/client` 做 `ensureSession/sendSession` 的运行时适配层（默认通过 `acpx` CLI 子进程 + `--format quiet` 做最终文本提取）。

**Tech Stack:** Bun（`bun test`、`Bun.spawn`）、TypeScript、`fs.realpath` canonicalization、`crypto`（SHA256 + instanceId）、`acpx` CLI（权限 flags + quiet 输出）。

---

## Repo/Testing Pre-check (quick)

- `wx-acpx` 目前仅有 `index.ts` 与 `src/weixin-bot/*`；`src/**` 下目前没有任何 `*.test.ts`。
- 因此需要先加最小 `bun test` 验证用例与测试目录结构。

### Task 1: Add minimal Bun test scaffold

**Files:**
- Modify: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/package.json`
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/test/smoke.test.ts`

- [ ] **Step 1: Write the failing test**
  - Create `src/test/smoke.test.ts`:
    - `import { test, expect } from "bun:test";`
    - `test("bun test works", () => expect(1 + 1).toBe(2))`

- [ ] **Step 2: Run test to verify it passes**
  - Run: `bun test src/test/smoke.test.ts`
  - Expected: PASS

- [ ] **Step 3: Write minimal implementation**
  - 只添加该测试文件与必要的 package.json test script（见 Step 3 实现条目）

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test src/test/smoke.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 不写死 git commit：当前目录并非 git repo（如实现阶段需要版本化，再按实际仓库情况决定）。

> package.json 建议（实现任务时确认即可）：添加
> `scripts: { "test": "bun test" }`（只为方便，不强制）

### Task 2: Implement command parsing & routing (including minimal aliases)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/command-types.ts`
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/command-parser.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/command-parser.test.ts`

**Spec coverage (must be implemented + tested):**
- 命令以 `/` 开头；`/agentname message`：第一个空白 token 为 `agentName`，剩余为 message（`trim` 后）。
- `agentName` 大小写不敏感；message 保留 `trim` 后文本。
- 最小 alias 集合（只覆盖设计文档列出的最小集合）：
  - `/cc` -> `claude`
  - `/cx` -> `codex`
  - `/cs` -> `cursor`
  - `/km` -> `kimi`
  - `/gm` -> `gemini`
  - `/oc` -> `openclaw`
  - `/ocd` -> `opencode`

**明确 API（为避免 defaultAgent/allowedAgents 对齐风险）：**
- `command-parser.ts` 导出工厂：
  - `createCommandParser({ allowedAgentNames, aliasMap })`
  - 返回 `{ parse(text: string, defaultAgentName: string): ParsedCommand }`
  - `defaultAgentName` 由 handler 每次从 `userState.getDefaultAgent(userId)` 获取传入（修复 `/agentname` 后“无前缀路由”契约）。

- [ ] **Step 1: Write the failing test**
  - In `command-parser.test.ts`:
    - `const parser = createCommandParser({ allowedAgentNames:["claude","codex","cursor","kimi","gemini","openclaw","opencode"], aliasMap:{cc:"claude",cx:"codex",cs:"cursor",km:"kimi",gm:"gemini",oc:"openclaw",ocd:"opencode"} })`
    - `const defaultAgentName = "codex"`
    - 调用方式统一为：`parser.parse(text, defaultAgentName)`
    - `/help` => `{ kind:"help" }`
    - `/info` => `{ kind:"info" }`
    - `/new` 与 `/clear` => `{ kind:"reset", scope:"default-agent" }`
    - `/cwd ./somewhere` => `{ kind:"cwd", path:"./somewhere" }`
    - `/cx hello` => `{ kind:"agent-prompt", agentName:"codex", prompt:"hello" }`
    - `/cx   hello  ` => `{ kind:"agent-prompt", agentName:"codex", prompt:"hello" }`（验证 message trim 规则）
    - `/ocd  hi there` => `{ kind:"agent-prompt", agentName:"opencode", prompt:"hi there" }`
    - `/CS hello` => `cursor`
    - `/codex`（无 message）=> `{ kind:"agent-set-default", agentName:"codex" }`
    - `hello without slash` => `{ kind:"agent-prompt", agentName:"codex", prompt:"hello without slash" }`
    - `/unknown hi` => `{ kind:"error", errorText: <包含"未知 agent"> }`

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test src/messaging/command-parser.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Implement alias/agent resolution：
    - `token = first non-space token after leading "/" up to whitespace`
    - normalize token with `toLowerCase()`
    - resolve canonical:
      - `aliasMap[token]` if exists
      - else if `allowedAgentNames` contains token => token
      - else error
  - Parsing precedence：
    - handle `/help|/info|/new|/clear|/cwd` first
    - else if token resolved to agent：
      - if remainder non-empty => `agent-prompt`
      - else => `agent-set-default`
    - else error
  - For message remainder: split on first whitespace only (respect `/agentname message` contract).

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test src/messaging/command-parser.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 同 Task 1：根据是否为 git repo 决定。

### Task 3: Implement per-user state (default agent, cwd, nonce, session name template)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/user-state.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/user-state.test.ts`

**Spec coverage (must be implemented + tested):**
- `sessionKey = userId + '::' + agentName`
- `instanceId`：进程启动生成固定不变值（测试时可注入固定值）
- `nonce` 初始为 0；`/new|/clear` 对默认 agent 的 `sessionKey` 执行 `nonce += 1`
- `acpx ensureSession name` 模板（必须写死实现）：
  - `wx-acpx:${instanceId}:${agentName}:${hash(userId)}:nonce:${nonce}`

- [ ] **Step 1: Write the failing test**
  - In `user-state.test.ts`:
    - `state = createUserState({ instanceId:"test-instance", initialDefaultAgentName:"codex", initialCwd:"/cwd0" })`
    - `nonce` 初始为 0：
      - `state.getNonce("u1","codex") === 0`
    - `state.bumpNonceForDefaultAgent("u1")`：
      - nonce 变为 1
    - `state.buildSessionName({ userId:"u1", agentName:"codex", nonce:0 })`：
      - 包含 `wx-acpx:test-instance:codex:`
      - 包含 `:nonce:0`
      - 不包含原始 userId 字符串（避免明文暴露）
    - nonce=1 时 `:nonce:1` 且 name != nonce=0 的 name

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test src/messaging/user-state.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Implement:
    - maps：
      - `defaultAgentByUserId`
      - `cwdByUserId`
      - `nonceBySessionKey`
    - `hashUserId`：SHA256 hex 截断（例如前 16 hex），仅用于拼 sessionName
    - exact 模板拼接（按 contract 字符串）
    - `setCwdForUser(userId, cwd)`：MVP 简化 => 清空该 user 的 `nonceBySessionKey`（满足“切换后清空运行中状态”）

  - 定死对外方法（handler/client/test 直接依赖这些签名，不要猜）：
    - `getDefaultAgent(userId): string`
    - `setDefaultAgent(userId, agentName: string): void`
    - `getCwd(userId): string`
    - `setCwdForUser(userId: string, cwd: string): void`
    - `getNonce(userId: string, agentName: string): number`
    - `bumpNonceForDefaultAgent(userId: string): void`
    - `buildSessionName(params: { userId: string; agentName: string; nonce: number }): string`

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test src/messaging/user-state.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 同 Task 1。

### Task 4: Implement /cwd safe canonicalization (realpath + symlink escape prevention)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/cwd-safety.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/cwd-safety.test.ts`

**Spec coverage (must be implemented + tested):**
- 越界/符号链接逃逸：必须使用 `realpath` canonicalization
- 越界时拒绝（handler 层进一步断言“不调用 acpx”）

**明确相对路径基准（修复 reviewer 风险点）：**
- `resolveSafeCwd` 签名必须显式接收 `baseCwd`（当前用户的 cwd），相对路径相对于 `baseCwd` 解析。

API（实现/测试都照此对齐）：
- `resolveSafeCwd({ inputPath, baseCwd, cwdRoot }) => Promise<Result<{ cwd: string }>>`

- [ ] **Step 1: Write the failing test**
  - In `cwd-safety.test.ts`:
    - build temp dirs：`rootDir`、`outsideDir`
    - `rootSymlink = rootDir + "/escape"`
    - `symlink(outsideDir, rootSymlink)`
    - `resolveSafeCwd({ inputPath: rootSymlink, baseCwd: rootDir, cwdRoot: rootDir })`
      - Expected: reject/out-of-bounds
    - `resolveSafeCwd({ inputPath: "./missing", baseCwd: rootDir, cwdRoot: rootDir })`
      - Expected: reject（realpath failure）
    - `resolveSafeCwd({ inputPath: ".", baseCwd: rootDir, cwdRoot: rootDir })`
      - Expected: ok and returns canonical path inside root

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test src/messaging/cwd-safety.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Implement boundary check：
    - `canonicalRoot = await realpath(cwdRoot)`
    - `absoluteInput = path.isAbsolute(inputPath) ? inputPath : path.resolve(baseCwd, inputPath)`
    - `canonicalInput = await realpath(absoluteInput)`
    - accept if `canonicalInput === canonicalRoot` OR `canonicalInput` startsWith `canonicalRoot + path.sep`
    - else return errorText (handler 使用该 errorText 回给微信)

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test src/messaging/cwd-safety.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 同 Task 1。

### Task 5: Implement per-user serial queue (concurrency serialization by userId)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/user-queue.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/user-queue.test.ts`

**Spec coverage (must be implemented + tested):**
- 并发串行化：同一 `userId` 串行进入 agent 分支

- [ ] **Step 1: Write the failing test**
  - In `user-queue.test.ts`（同 Task 5 reviewer 建议，但更简洁）：
    - enqueue 两个任务到同一 userId
    - `t2-start` 必须在 `t1-end` 之后

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test src/messaging/user-queue.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - 实现 `createUserQueue()`：基于 per-user Promise chain 的串行化队列。

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test src/messaging/user-queue.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 同 Task 1。

### Task 6: Implement acpx-runtime/client via CLI subprocess (permission flags + quiet text extraction)

**Files:**
- Modify: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/package.json`（引入 `acpx` 以获取 CLI）
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/acpx-runtime/cli-runner.ts`
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/acpx-runtime/client.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/acpx-runtime/client.test.ts`

**Choice (required by your requirement #6):**
- 选择：使用 `acpx` CLI 作为子进程实现 `ensureSession/sendSession`。
- 需要显式把 `acpx` 加入 `wx-acpx/package.json`（否则无法在实现/运行中稳定定位 CLI）。

**Spec coverage (must be implemented + tested):**
- 权限字段传参：ensureSession 与 sendSession 需要显式接收 `permissionMode/nonInteractivePermissions`（handler 传入；client forward to CLI flags）
- typing/text 提取语义：使用 quiet（通过 `--format quiet` + `stdout.trim()`）

**关键落地点（fix reviewer issue #2/#3）：CLI bin 如何定位（实现时写死）**
- 在 `client.ts` 里提供 `createAcpxClient({ acpxCliEntry })`：
  - 默认 `acpxCliEntry = resolveAcpxCliEntry()`，使用 `import.meta.resolve("acpx/package.json")` 定位到 `node_modules/acpx/dist/cli.js`：
    - `const pkgPath = import.meta.resolve("acpx/package.json")`
    - `const pkgDir = path.dirname(pkgPath)`
    - `cliJsPath = path.join(pkgDir, "dist", "cli.js")`
  - cli-runner 通过 `Bun.spawn(["bun", cliJsPath, ...args])` 执行（避免依赖 `.bin` PATH，且符合 Bun 环境）
  - 实现前置条件：解析出 `cliJsPath` 后，检查文件是否存在；若缺失则抛出可读错误（提示先 `bun install` 或按实际 monorepo 工作流构建 `acpx/dist/cli.js`）

**另外：agentName -> acpx agentCommand（复用 registry，用于 mapping sanity check）**
- 以“构建可用”为最高优先级：在 `wx-acpx` 内维护 `AGENT_REGISTRY` 常量（从 `acpx/src/agent-registry.ts` 复制）。
- `resolveAgentCommand(agentName)` 用于：
  - client 层 mapping sanity check（Task 6 的必测断言）
  - 后续若从 CLI 切换到更直接的 ACP 接入时，复用同一套映射逻辑

- [ ] **Step 1: Write the failing test**
  - In `client.test.ts`:
    - stub `cliRunner` records `spawnArgv` (the args passed to `bun cliJsPath`) and returns:
      - ensure => exitCode 0
      - send => stdout "  assistant text\n"
    - create client with injected:
      - `acpxCliEntry = "/fake/acpx/cli.js"`
      - `cliRunner = stub`（避免真实 spawn）
    - call:
      - `ensureSession({ agentName:"cursor", cwd:"/allowed", name:"s1", permissionMode:"approve-reads", nonInteractivePermissions:"deny" })`
      - assert spawn args include:
        - `--approve-reads`
        - `--non-interactive-permissions deny`
        - `--cwd /allowed`
        - `--format quiet`
        - `cursor`（作为 acpx CLI 的 `<agent>` positional token）
        - `sessions ensure --name s1`
      - call:
      - `sendSession({ agentName:"cursor", cwd:"/allowed", sessionName:"s1", prompt:"hi there", permissionMode:"approve-reads", nonInteractivePermissions:"deny" })`
      - assert spawn args include:
        - `--format quiet`
        - `--session s1`
        - `--` terminator is present
        - and prompt element equals `"hi there"` is passed as a single argv element
      - assert return value `"assistant text"`（trim 后）
      - second call variant to lock down prompt starting with `--`:
        - call:
          - `sendSession({ agentName:"cursor", cwd:"/allowed", sessionName:"s1", prompt:"--help", permissionMode:"approve-reads", nonInteractivePermissions:"deny" })`
        - assert spawn args include:
          - `--` terminator is present
          - and prompt element equals `"--help"` is passed as a single argv element (i.e. not swallowed as a flag)
    - mapping sanity check（强制确保“复用 acpx registry”的责任在 client 层成立）：
      - 需要 `client.ts` 导出纯函数 `resolveAgentCommand`
      - `resolveAgentCommand("cursor") === "cursor-agent acp"`
    - dist missing error:
      - `createAcpxClient({ acpxCliEntry:"/missing/dist/cli.js", cliRunner:stub })` should throw
      - error message must include `"dist/cli.js"` and next-step hint (`bun install` / build)

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test src/acpx-runtime/client.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Implement `cli-runner.ts`:
    - `runCli({ cliJsPath, args, cwd, timeoutSec })` returns `{ exitCode, stdout, stderr, timedOut }`
    - internal execution uses `Bun.spawn(["bun", cliJsPath, ...args], { cwd, stdout: "pipe", stderr: "pipe" })`
  - Implement `client.ts`:
    - create `createAcpxClient({ cliJsPath, cliRunner })`
    - client 接口契约（fix reviewer issue #1）：
      - `ensureSession(params: { agentName: string; cwd: string; name: string; permissionMode: "approve-reads"; nonInteractivePermissions: "deny" }): Promise<void>`
      - `sendSession(params: { agentName: string; cwd: string; sessionName: string; prompt: string; permissionMode: "approve-reads"; nonInteractivePermissions: "deny" }): Promise<string>`
    - build `globalArgs(permissionMode, nonInteractivePermissions, cwd)`:
      - always `--format quiet`
      - `--approve-reads` for MVP
      - `--non-interactive-permissions deny` for MVP
      - `--cwd <cwd>`
    - resolve agent command:
      - implement local `AGENT_REGISTRY` constant copied from `acpx/src/agent-registry.ts`
      - export `resolveAgentCommand(agentName)`
      - implement `resolveAgentCommand(agentName)` => registry[normalized] ?? agentName
    - ensureSession => run `acpx <agentName> sessions ensure --name <name>`（由 acpx CLI 内部基于 registry 解析 tokenization）
    - sendSession => run `acpx <agentName> --session <sessionName> -- <promptText>`（explicit `--` to stop option parsing），并依赖 `--format quiet` 获取 stdout
    - if exitCode !=0 throw error including stderr/stdout

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test src/acpx-runtime/client.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 同 Task 1。

### Task 7: Implement messaging handler (typing lifecycle, /new nonce, /cwd safety, routing, error handling, concurrency)

**Files:**
- Create: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/handler.ts`
- Test: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/src/messaging/handler.test.ts`

**Handler contract (must be implemented + tested):**
1) typing 时序：
   - 对 agent 调用：必须 `await bot.send(...)` 完成后才 `await bot.stopTyping(...)`
   - 错误路径：错误时也同样 `finally` 里 stopTyping，且错误文本 send 必须发生在 stopTyping 之前
2) `/new|/clear`：
   - nonce/name 变化，下一次 agent prompt 必须导致 `acpx ensureSession` 的 `name` 参数变化（mock 断言）
   - `/new|/clear` 本身不应直接调用 `ensureSession/sendSession`
3) 权限字段传参：
   - handler 调用 client 时，ensureSession 与 sendSession 参数都显式包含 `permissionMode/nonInteractivePermissions`
4) `/cwd` 越界/符号链接逃逸：
   - 越界：handler 返回错误文本，并且不调用 acpx ensureSession/sendSession
5) 并发串行化：
   - 同一 `userId` 的两条消息不可同时进入 agent 分支（队列/锁可 mock 验证顺序）
6) 命令解析与路由（最小 alias）：
   - 至少在 handler 测试覆盖 1 条：`/cs hello` 路由到 cursor agent
7) `/help` 与 `/info` 输出至少包含最基本字段：
   - `/info` 至少包含默认 agent 名称 + 当前 cwd
   - `/help` 至少包含 `/help`、`/info`、`/cwd`、`/new|/clear`（文本可额外包含 alias）

- [ ] **Step 1: Write the failing test**
  - In `handler.test.ts`:
    - build shared config:
      - `defaultAgentName:"codex"`
      - allowed agent names: same as design minimal set canonical names
      - aliasMap: from design
      - permission defaults：`approve-reads` + `deny`
    - stub bot:
      - `sendTyping(userId)` => push `"typing-start"`
      - `send(userId, text)` => push `"send"` and record `text`
      - `stopTyping(userId)` => push `"typing-stop"`
    - stub acpx client:
      - `ensureSession(params)` => record params into arrays
      - `sendSession(params)` => record params and return "reply"
    - create handler with real:
      - `createUserQueue()`（Task 5 真实队列）以验证并发串行化
      - `createUserState({ instanceId:"test-instance", initialDefaultAgentName:"codex", initialCwd: rootDirCanonical })`
      - `createCommandParser(...)`（Task 2 真实 parser）
      - `resolveSafeCwd`（Task 4 真实 canonicalization）
  - Test cases（必须逐条断言）：
    - typing order success:
      - handle message `"hi"`（no slash）
      - assert order: `"typing-start"` -> `"send"` -> `"typing-stop"`
    - typing order error:
      - `acpxClient.sendSession` throw `new Error("boom")`
      - handle message `"hi"`
      - assert:
        - send text contains `"Error:"` (or the chosen prefix) and stopTyping happens after send (check call order)
        - stopTyping executed even when error thrown (finally)
    - /new|/clear nonce/name:
      - message1 `"hi"`（默认 agent=codex）=> capture first ensureSession `params.name`
        - must satisfy `name.startsWith("wx-acpx:test-instance:codex:")`
        - must include `:nonce:0`
      - message2 `"/clear"` => assert acpxMock ensure/send not called for this message
      - message3 `"hi2"` => capture second ensureSession `params.name`
        - must satisfy `name.startsWith("wx-acpx:test-instance:codex:")`
        - must include `:nonce:1` and not equal first
    - permission pass-through (explicit fields):
      - assert ensureSession params include `permissionMode:"approve-reads"` and `nonInteractivePermissions:"deny"`
      - assert sendSession params include same fields
    - non-text downgrade:
      - handle incoming message with `type:"image"`（文字内容可任意）
      - assert bot.send called with your chosen non-text MVP message
      - assert acpxMock ensure/send NOT called
    - unknown agent rejection (must not call acpx):
      - handle message `"/unknown hi"`
      - assert bot.send text includes `"未知 agent"`
      - assert acpxMock ensure/send NOT called
    - /cwd out-of-bounds + symlink escape:
      - create temp rootDir (allowed) and outsideDir
      - symlink escape inside root points to outside
      - handle `/cwd <escapeSymlinkPath>`
      - assert bot sends error text (contains "越界" 或你设计的 errorText 前缀)
      - assert acpx ensure/send NOT called
    - /cwd realpath failure:
      - handle `/cwd ./missing`（missing under allowed root）
      - assert bot sends error text
      - assert acpx ensure/send NOT called
    - /cwd in-bounds updates cwd passed to acpx:
      - handle `/cwd <rootDir/inner>`
      - then handle prompt `"hi"`
      - assert last ensureSession params.cwd equals canonical inner path
    - /agentname persistence + /new bump after switch:
      - handle `/cs`（agent-set-default：只改默认、不调用 acpx）
      - handle prompt `"hello"`（无前缀）并断言 ensureSession.agentName === "cursor"
      - handle `/new`（此时应 bump cursor 的 nonce）
      - handle prompt `"hello2"`并断言 ensureSession.name
        - must satisfy `name.startsWith("wx-acpx:test-instance:cursor:")`
        - contains `:nonce:1` 且且与上一次不同
    - /cwd clears running nonce state（MVP 简化契约）：
      - handle prompt `"hi"`（nonce:0）
      - handle `/new`（nonce:1）
      - handle `/cwd <rootDir/inner>`（清空该 user nonce）
      - handle prompt `"hi2"`并断言 ensureSession.name 里回到 `:nonce:0`
    - concurrency serialization for same userId:
      - acpxMock.sendSession returns deferred promise; start two `handler.handle()` calls concurrently with same userId:
        - second call must not call ensureSession/sendSession until first resolved
      - assert using call timestamps or call index ordering
    - routing alias minimal:
      - handle message `"/cs hello"`
      - assert ensureSession params.agentName === "cursor"
    - /help and /info basic:
      - handle `/help` => bot.send text includes `/help` and `/cwd`
      - handle `/info` => bot.send text includes default agent name and current cwd
    - empty agent reply fallback:
      - set `acpxMock.sendSession` to return `""` (or `"   "`)
      - handle prompt `"hi"`
      - assert bot.send text is non-empty and matches your chosen fallback string (e.g. `（空回复兜底）`)

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test src/messaging/handler.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Implement `handler.ts`:
    - class `WxAcpHandler`:
      - constructor accepts `{ bot, userState, acpxClient, userQueue, commandParser, config }`
      - method `handle(incoming)` => `await userQueue.enqueue(incoming.userId, () => processOne(incoming))`
    - `processOne`:
      - if `incoming.type !== "text"`:
        - `await bot.send(userId, "MVP 暂不支持非文本消息")`
        - return
      - `const parsedCommand = commandParser.parse(incoming.text, userState.getDefaultAgent(userId))`
      - if parsedCommand.kind === `"error"`:
        - `await bot.send(userId, parsedCommand.errorText)`（不调用 acpx）
        - if kind help/info:
          - build strings using userState default agent + cwd; `await bot.send`
          - no typing / no acpx
        - if kind reset:
          - `userState.bumpNonceForDefaultAgent(userId)`
          - `await bot.send(userId, "已重置会话")`
        - if kind cwd:
          - `const baseCwd = userState.getCwd(userId)`
          - `const resolved = await resolveSafeCwd({ inputPath: parsedCommand.path, baseCwd, cwdRoot })`
          - if reject: send errorText and return（no acpx）
          - else: `userState.setCwdForUser(userId, resolved.cwd)`（清空该 user nonce map）
          - send confirmation（no typing / no acpx）
        - if kind agent-set-default:
          - set default agent only; send confirmation; no acpx
        - if kind agent-prompt:
          - `await bot.sendTyping(userId)`
          - `try`:
            - `const agentName = parsedCommand.agentName`
            - `const cwd = userState.getCwd(userId)`
            - `const nonce = userState.getNonce(userId, agentName)`
            - `const name = userState.buildSessionName({ userId, agentName, nonce })`
            - `await acpxClient.ensureSession({ agentName, cwd, name, permissionMode, nonInteractivePermissions })`
            - `const replyText = await acpxClient.sendSession({ agentName, cwd, sessionName:name, prompt: incoming.text, permissionMode, nonInteractivePermissions })`
            - `const trimmed = replyText.trim()`
            - `const finalText = trimmed.length > 0 ? trimmed : "（空回复兜底）"`
            - `await bot.send(userId, finalText)`
          - `catch (e)`:
            - `await bot.send(userId, "Error: " + normalizeError(e))`
          - `finally`:
            - `await bot.stopTyping(userId)`（确保 stopTyping 在 send 之后：通过在 catch 里先 send；成功路径在 try 里先 await bot.send）
    - note：禁止使用 `bot.reply()`（它会自动 cancel typing，破坏契约时序）

    - helper：在 handler 内明确实现 `normalizeError(e: unknown): string`：
      - if `e instanceof Error` return `e.message`
      - else return `String(e)`

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test src/messaging/handler.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 同 Task 1。

### Task 8: Wire entrypoint `index.ts` to handler

**Files:**
- Modify: `/Users/mamba/workspace/bailian/openclaw-wx/wx-acpx/index.ts`

- [ ] **Step 1: Write the failing test**
  - 不建议为 index.ts 单独加测试（handler 与 acpx client 均已单测覆盖）。

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test`
  - Expected: FAIL（在实现 handler 接入完成前）

- [ ] **Step 3: Write minimal implementation**
  - Modify `index.ts`:
    - remove `bot.reply()` echo behavior
    - create:
      - `bot = new WeixinBot()`
      - `await bot.login()`
      - `userState = createUserState({ instanceId: randomUUID(), initialDefaultAgentName:"codex", initialCwd: process.cwd() })`
      - `cwdRoot = process.env.WX_ACP_CWD_ROOT ?? process.cwd()`
      - `commandParser = createCommandParser({ allowedAgentNames, aliasMap })`
      - `userQueue = createUserQueue()`
      - `acpxClient = createAcpxClient({ cli entry resolution + permission defaults })`
      - `handler = new WxAcpHandler({ bot, userState, acpxClient, userQueue, commandParser, config:{ cwdRoot } })`
    - `bot.onMessage((msg) => handler.handle(msg))`
    - `await bot.run()`

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - 同 Task 1。

---

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-03-25-wx-acpx-text-only-mvp-implementation-plan.md`. Two execution options:

1. Subagent-Driven (recommended)
2. Inline Execution

Which approach do you want?

