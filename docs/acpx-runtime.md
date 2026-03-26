# ACPX Runtime 集成

本仓库通过 **`acpx` npm 包**提供的 CLI（`dist/cli.js`）在子进程里驱动各 Agent 的 ACP 会话，而不是在进程内嵌入协议实现。本文说明：**如何解析 CLI**、**传给 acpx 的参数**、**Agent 注册表** 及 **与本项目 `AcpxRuntimeClient` 的对应关系**。

## 依赖与 CLI 路径

- **包名**：`acpx`（见 `package.json`）
- **仓库地址**：`https://github.com/openclaw/acpx`
- **可执行入口**：安装包内 `dist/cli.js`（由 `createAcpxRuntimeClient` 解析 `acpx/package.json` 后拼接路径）
- **启动方式**：`bun <cliJsPath> ...`（见 `client.ts` 中 `runAcpx`）

若解析失败，错误信息会提示：执行 `bun install` 或通过 `CreateAcpxRuntimeClientOptions.cliJsPath` 显式指定 `dist/cli.js`。

## 子进程与 CLI Runner

- 默认使用 `createBunCliRunner()`（`cli-runner.ts`）：`Bun.spawn`，捕获 stdout/stderr，非 0 退出码会包装为错误信息。
- 可注入自定义 `runner` 或 `runnerFactory`，用于测试或观测。

## 权限与格式（当前固定组合）

与 `index.ts` 中传入的 `permissionDefaults` 一致：

| 概念 | 类型 | 当前值 | CLI 映射 |
|------|------|--------|----------|
| `permissionMode` | `PermissionMode` | 仅支持 `"approve-reads"` | 追加 `--approve-reads` |
| `nonInteractivePermissions` | `NonInteractivePermissions` | 仅支持 `"deny"` | `--non-interactive-permissions deny` |

所有调用均带 `--format quiet`，以稳定解析 stdout。

## 会话：ensure

对应 `AcpxRuntimeClient.ensureSession`：

- 将逻辑上的 `agentName` 解析为 **一条可执行的 agent 命令字符串**（见下文「Agent 注册表」）
- 等价 CLI 形态（概念上）：

```text
bun <acpx-cli.js> --format quiet [--approve-reads] --non-interactive-permissions deny \
  --cwd <cwd> --agent <agentCommand> sessions ensure --name <name>
```

- `name`：业务层生成的会话名（如与微信用户、nonce 组合，见 `userState.buildSessionName`）

## 对话：prompt

对应 `AcpxRuntimeClient.sendSession`：

```text
bun <acpx-cli.js> --format quiet [--approve-reads] --non-interactive-permissions deny \
  --cwd <cwd> --agent <agentCommand> prompt --session <sessionName> -- <prompt>
```

- 返回值为 **stdout 去首尾空白** 后的字符串，作为回复发给用户；空回复时上层有兜底文案（见 `handler.ts`）。

## Agent 注册表与解析规则

- **`AGENT_REGISTRY`**：`agentName`（小写键）→ 传给 `--agent` 的**整条命令**（可为 `bunx ...`、`qwen --acp` 等），由本机 PATH / bunx 实际解析。
- **`AGENT_ALIASES`**：额外别名（如 `factory-droid` → `droid`）。
- **`resolveAgentName`**：trim + lower case；先查 registry 与 aliases，**若无匹配则把原始字符串当作 agent 命令透传**（便于自定义未内置的 token）。

内置条目会随版本调整，以 `src/acpx-runtime/client.ts` 中 `AGENT_REGISTRY` 为准。部分条目使用固定版本范围的 `bunx` 包（`ACP_ADAPTER_PACKAGE_RANGES`）。

微信侧「快捷别名」（如 `/cc` → claude）在 **`index.ts` 的 `commandParser.aliasMap`** 中配置，与 `AGENT_REGISTRY` 互补：前者是聊天命令层，后者是 **acpx 实际执行的命令**。

## 类型 `AcpxRuntimeClient` 说明

- **`ensureSession` / `sendSession`**：已实现，并由消息处理流程调用。
- **`sendSessionStreaming`**：类型中声明，用于带 `onChunk` 的流式场景；实现以仓库中 `client.ts` 为准（若需流式回复，需在实现中接好 `cli-runner` 的 `onChunk` 与 acpx 子命令）。

## 测试

- `src/acpx-runtime/client.test.ts`：覆盖 agent 解析、路径解析等逻辑；运行：`bun test`。

## 相关源码

| 文件 | 职责 |
|------|------|
| `client.ts` | `createAcpxRuntimeClient`、`AGENT_REGISTRY`、`resolveAgentCommand`、acpx argv 拼装 |
| `cli-runner.ts` | `Bun.spawn` 封装与可选 stdout 分块回调 |

更底层的 ACP 协议与 `acpx` CLI 子命令细节，请参阅 **`acpx` 包官方文档或源码**（`https://github.com/openclaw/acpx`）；本文仅描述 **wx-acpx 如何调用它**。
