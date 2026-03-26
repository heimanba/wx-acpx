import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";

import { createAcpxRuntimeClient, type AcpxRuntimeClient, AGENT_REGISTRY } from "../../src/acpx-runtime/client";
import { createCommandParser } from "../../src/messaging/command-parser";
import { createWxAcpHandler } from "../../src/messaging/handler";
import { createUserQueue } from "../../src/messaging/user-queue";
import { createUserState } from "../../src/messaging/user-state";
import type { IncomingMessage } from "../../src/weixin-bot/types";

function createStubAcpxClient(): AcpxRuntimeClient {
  return {
    async ensureSession() {
      // no-op
    },
    async sendSession({ prompt, agentName, cwd, sessionName }) {
      return [
        "[local stub]",
        `agent=${agentName}`,
        `cwd=${cwd}`,
        `session=${sessionName}`,
        "",
        prompt,
      ].join("\n");
    },
  };
}

async function main() {
  const instanceId = randomUUID();
  const cwdRoot = process.env.WX_ACP_CWD_ROOT ?? process.cwd();
  const userId = process.env.WX_ACP_LOCAL_USER_ID ?? "local-user";
  const useStubAcpx = process.env.WX_ACP_LOCAL_USE_STUB === "1";

  const userState = createUserState({
    instanceId,
    initialDefaultAgentName: "qwen",
    initialCwd: process.cwd(),
  });
  const userQueue = createUserQueue();

  const commandParser = createCommandParser({
    allowedAgentNames: Object.keys(AGENT_REGISTRY),
    aliasMap: {
      ...Object.fromEntries(Object.keys(AGENT_REGISTRY).map((k) => [k, k])),
      cc: "claude",
      cx: "codex",
      cs: "cursor",
      km: "kimi",
      gm: "gemini",
      oc: "openclaw",
      ocd: "opencode",
    },
  });

  const acpxClient = useStubAcpx ? createStubAcpxClient() : await createAcpxRuntimeClient();

  const handler = createWxAcpHandler({
    bot: {
      async sendTyping() {},
      async stopTyping() {},
      async send(_userId, text) {
        output.write(`BOT> ${text}\n`);
      },
    },
    userState,
    userQueue,
    commandParser,
    cwdRoot,
    acpxClient,
    permissionDefaults: {
      permissionMode: "approve-reads",
      nonInteractivePermissions: "deny",
    },
  });

  output.write(
    [
      "wx-acpx local dev (no weixin-bot).",
      "输入一行文本即可；以 /help 查看命令；输入 /exit 退出。",
      useStubAcpx ? "当前：使用 stub ACPX（完全离线）" : "当前：使用真实 ACPX（可能依赖外部 agent/CLI）",
      "",
    ].join("\n") + "\n",
  );

  const rl = createInterface({ input, output, terminal: true });
  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question("YOU> ");
      } catch (error) {
        // When stdin is piped, EOF can close readline between questions.
        // Treat it as a graceful exit.
        if (error instanceof Error && error.code === "ERR_USE_AFTER_CLOSE") {
          break;
        }
        throw error;
      }
      const text = line.trimEnd();
      if (!text) continue;
      if (text === "/exit" || text === "/quit") break;

      const incoming: IncomingMessage = {
        userId,
        text,
        type: "text",
        raw: {} as any,
        _contextToken: "local",
        timestamp: new Date(),
      };

      await handler.handle(incoming);
    }
  } finally {
    rl.close();
  }
}

await main();
