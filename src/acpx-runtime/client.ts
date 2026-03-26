import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBunCliRunner, type CliRunner, type CreateBunCliRunnerOptions } from "./cli-runner";

export type PermissionMode = "approve-reads";
export type NonInteractivePermissions = "deny";

export type EnsureSessionParams = {
  agentName: string;
  cwd: string;
  name: string;
  permissionMode: PermissionMode;
  nonInteractivePermissions: NonInteractivePermissions;
};

export type SendSessionParams = {
  agentName: string;
  cwd: string;
  sessionName: string;
  prompt: string;
  permissionMode: PermissionMode;
  nonInteractivePermissions: NonInteractivePermissions;
};

export type SendSessionStreamingParams = SendSessionParams & {
  onChunk: (chunk: string) => void;
};

export type AcpxRuntimeClient = {
  ensureSession(params: EnsureSessionParams): Promise<void>;
  sendSession(params: SendSessionParams): Promise<string>;
  sendSessionStreaming(params: SendSessionStreamingParams): Promise<string>;
};

const ACP_ADAPTER_PACKAGE_RANGES = {
  pi: "^0.0.22",
  codex: "^0.9.5",
  claude: "^0.21.0",
} as const;

export const AGENT_REGISTRY: Record<string, string> = {
  pi: `bunx pi-acp@${ACP_ADAPTER_PACKAGE_RANGES.pi}`,
  openclaw: "openclaw acp",
  codex: `bunx @zed-industries/codex-acp@${ACP_ADAPTER_PACKAGE_RANGES.codex}`,
  claude: `bunx -y @zed-industries/claude-agent-acp@${ACP_ADAPTER_PACKAGE_RANGES.claude}`,
  gemini: "gemini --acp",
  cursor: "cursor-agent acp",
  copilot: "copilot --acp --stdio",
  droid: "droid exec --output-format acp",
  iflow: "iflow --experimental-acp",
  kilocode: "bunx -y @kilocode/cli acp",
  kimi: "kimi acp",
  kiro: "kiro-cli acp",
  opencode: "bunx -y opencode-ai acp",
  qwen: "qwen --acp",
};

const AGENT_ALIASES: Record<string, string> = {
  "factory-droid": "droid",
  factorydroid: "droid",
};

function normalizeAgentName(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveAgentCommand(agentName: string): string {
  const normalized = normalizeAgentName(agentName);
  return (
    AGENT_REGISTRY[normalized] ??
    AGENT_REGISTRY[AGENT_ALIASES[normalized] ?? normalized] ??
    agentName
  );
}

export type CreateAcpxRuntimeClientOptions = {
  runner?: CliRunner;
  runnerFactory?: (options: CreateBunCliRunnerOptions) => CliRunner;
  cliJsPath?: string;
  resolvePackageJsonUrl?: (specifier: string) => string;
  fileExists?: (filePath: string) => Promise<boolean>;
};

async function defaultFileExists(filePath: string): Promise<boolean> {
  return await Bun.file(filePath).exists();
}

function resolveDefaultPackageJsonUrl(specifier: string): string {
  return import.meta.resolve(specifier);
}

async function resolveAcpxCliJsPath(params: {
  resolvePackageJsonUrl: (specifier: string) => string;
  fileExists: (filePath: string) => Promise<boolean>;
}): Promise<string> {
  const pkgJsonUrl = params.resolvePackageJsonUrl("acpx/package.json");
  let pkgJsonPath: string;
  try {
    const url = new URL(pkgJsonUrl);
    if (url.protocol !== "file:") {
      throw new Error(`Unsupported URL protocol: ${url.protocol}`);
    }
    pkgJsonPath = fileURLToPath(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "无法解析 acpx/package.json 的本地路径。",
        `resolve 返回值: ${pkgJsonUrl}`,
        `原因: ${detail}`,
        "建议: 传入 CreateAcpxRuntimeClientOptions.cliJsPath 显式指定 dist/cli.js 路径。",
      ].join("\n"),
    );
  }
  const pkgDir = path.dirname(pkgJsonPath);
  const cliJsPath = path.join(pkgDir, "dist", "cli.js");

  if (!(await params.fileExists(cliJsPath))) {
    throw new Error(
      [
        `未找到 acpx CLI：${cliJsPath}`,
        `期望存在: dist/cli.js`,
        `建议: 先运行 bun install（确保已安装 acpx），或在 acpx 包内执行 build 生成 dist。`,
      ].join("\n"),
    );
  }

  return cliJsPath;
}

function permissionModeToFlags(mode: PermissionMode): string[] {
  if (mode === "approve-reads") {
    return ["--approve-reads"];
  }
  return [];
}

export async function createAcpxRuntimeClient(
  options: CreateAcpxRuntimeClientOptions = {},
): Promise<AcpxRuntimeClient> {
  const runner = options.runner ?? createBunCliRunner();
  const resolvePackageJsonUrl = options.resolvePackageJsonUrl ?? resolveDefaultPackageJsonUrl;
  const fileExists = options.fileExists ?? defaultFileExists;

  const cliJsPath =
    options.cliJsPath ??
    (await resolveAcpxCliJsPath({
      resolvePackageJsonUrl,
      fileExists,
    }));

  if (!(await fileExists(cliJsPath))) {
    throw new Error(
      [
        `未找到 acpx CLI：${cliJsPath}`,
        `期望存在: dist/cli.js`,
        `建议: 先运行 bun install（确保已安装 acpx），或在 acpx 包内执行 build 生成 dist。`,
      ].join("\n"),
    );
  }

  async function runAcpx(cwd: string, args: string[]): Promise<{ stdout: string }> {
    const argv = ["bun", cliJsPath, ...args];
    let result: Awaited<ReturnType<CliRunner>>;
    try {
      result = await runner({ argv, cwd });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        [
          "acpx 执行失败（spawn 异常）",
          `cwd: ${cwd}`,
          `argv: ${argv.slice(0, 8).join(" ")}${argv.length > 8 ? " ..." : ""}`,
          `error: ${message}`,
        ].join("\n"),
      );
    }
    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      throw new Error(
        [
          "acpx 执行失败（exitCode 非 0）",
          `exitCode: ${result.exitCode}`,
          `cwd: ${cwd}`,
          `argv: ${argv.slice(0, 8).join(" ")}${argv.length > 8 ? " ..." : ""}`,
          stderr ? `stderr: ${stderr}` : "",
          !stderr && stdout ? `stdout: ${stdout}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return { stdout: result.stdout };
  }

  return {
    async ensureSession({ agentName, cwd, name, permissionMode, nonInteractivePermissions }) {
      const agentCommand = resolveAgentCommand(agentName);
      await runAcpx(cwd, [
        "--format",
        "quiet",
        ...permissionModeToFlags(permissionMode),
        "--non-interactive-permissions",
        nonInteractivePermissions,
        "--cwd",
        cwd,
        "--agent",
        agentCommand,
        "sessions",
        "ensure",
        "--name",
        name,
      ]);
    },

    async sendSession({
      agentName,
      cwd,
      sessionName,
      prompt,
      permissionMode,
      nonInteractivePermissions,
    }) {
      const agentCommand = resolveAgentCommand(agentName);
      const { stdout } = await runAcpx(cwd, [
        "--format",
        "quiet",
        ...permissionModeToFlags(permissionMode),
        "--non-interactive-permissions",
        nonInteractivePermissions,
        "--cwd",
        cwd,
        "--agent",
        agentCommand,
        "prompt",
        "--session",
        sessionName,
        "--",
        prompt,
      ]);
      return stdout.trim();
    },
  };
}

