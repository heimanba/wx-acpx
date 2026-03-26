import { describe, expect, test } from "bun:test";
import { createAcpxRuntimeClient, resolveAgentCommand } from "./client";
import type { CliRunner } from "./cli-runner";

function makeCapturingRunner(opts?: { stdout?: string; exitCode?: number }): {
  runner: CliRunner;
  calls: Array<{ argv: string[]; cwd: string }>;
} {
  const calls: Array<{ argv: string[]; cwd: string }> = [];
  const runner: CliRunner = async ({ argv, cwd }) => {
    calls.push({ argv, cwd });
    return {
      stdout: opts?.stdout ?? "",
      stderr: "",
      exitCode: opts?.exitCode ?? 0,
    };
  };
  return { runner, calls };
}

function expectArgvContainsSubsequence(argv: string[], subseq: string[]) {
  const start = argv.findIndex((v, i) => subseq.every((s, j) => argv[i + j] === s));
  expect(start).toBeGreaterThanOrEqual(0);
}

describe("acpx-runtime client", () => {
  test("resolveAgentCommand(cursor) === cursor-agent acp", () => {
    expect(resolveAgentCommand("cursor")).toBe("cursor-agent acp");
  });

  test("ensureSession argv 包含 quiet + permissions + cwd + sessions ensure --name", async () => {
    const { runner, calls } = makeCapturingRunner();
    const cwd = "/tmp/wx-acpx";
    const cliJsPath = "/tmp/acpx/dist/cli.js";

    const client = await createAcpxRuntimeClient({
      runner,
      cliJsPath,
      fileExists: async () => true,
    });

    await client.ensureSession({
      agentName: "cursor",
      cwd,
      name: "s1",
      permissionMode: "approve-reads",
      nonInteractivePermissions: "deny",
    });

    expect(calls).toHaveLength(1);
    const argv = calls[0]!.argv;

    expect(argv[0]).toBe("bun");
    expect(argv[1]).toBe(cliJsPath);

    expectArgvContainsSubsequence(argv, ["--format", "quiet"]);
    expect(argv).toContain("--approve-reads");
    expectArgvContainsSubsequence(argv, ["--non-interactive-permissions", "deny"]);
    expectArgvContainsSubsequence(argv, ["--cwd", cwd]);
    expectArgvContainsSubsequence(argv, ["sessions", "ensure", "--name", "s1"]);
  });

  test("sendSession argv 包含 --session + -- + prompt，并对 stdout trim()", async () => {
    const { runner, calls } = makeCapturingRunner({ stdout: "  hello \n" });
    const cwd = "/tmp/wx-acpx";
    const cliJsPath = "/tmp/acpx/dist/cli.js";

    const client = await createAcpxRuntimeClient({
      runner,
      cliJsPath,
      fileExists: async () => true,
    });

    const out = await client.sendSession({
      agentName: "cursor",
      cwd,
      sessionName: "s2",
      prompt: "hi",
      permissionMode: "approve-reads",
      nonInteractivePermissions: "deny",
    });

    expect(out).toBe("hello");

    expect(calls).toHaveLength(1);
    const argv = calls[0]!.argv;

    expectArgvContainsSubsequence(argv, ["--format", "quiet"]);
    expect(argv).toContain("--approve-reads");
    expectArgvContainsSubsequence(argv, ["--non-interactive-permissions", "deny"]);
    expectArgvContainsSubsequence(argv, ["--cwd", cwd]);
    expectArgvContainsSubsequence(argv, ["prompt", "--session", "s2"]);

    const dashDashIdx = argv.indexOf("--");
    expect(dashDashIdx).toBeGreaterThanOrEqual(0);
    expect(argv[dashDashIdx + 1]).toBe("hi");
  });

  test('prompt="--help" 时必须包含 -- 终止符且 prompt 作为单个 argv 元素', async () => {
    const { runner, calls } = makeCapturingRunner({ stdout: "ok\n" });
    const cwd = "/tmp/wx-acpx";
    const cliJsPath = "/tmp/acpx/dist/cli.js";

    const client = await createAcpxRuntimeClient({
      runner,
      cliJsPath,
      fileExists: async () => true,
    });

    await client.sendSession({
      agentName: "cursor",
      cwd,
      sessionName: "s3",
      prompt: "--help",
      permissionMode: "approve-reads",
      nonInteractivePermissions: "deny",
    });

    expect(calls).toHaveLength(1);
    const argv = calls[0]!.argv;
    const dashDashIdx = argv.indexOf("--");
    expect(dashDashIdx).toBeGreaterThanOrEqual(0);
    expect(argv[dashDashIdx + 1]).toBe("--help");
    expect(argv.filter((v) => v === "--help")).toHaveLength(1);
  });

  test("dist missing：create client 时应抛错且 message 包含 dist/cli.js", async () => {
    await expect(async () => {
      await createAcpxRuntimeClient({
        resolvePackageJsonUrl: () => "file:///tmp/fake-acpx/package.json",
        fileExists: async () => false,
        runner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      });
    }).toThrow(/dist\/cli\.js/);
  });
});

