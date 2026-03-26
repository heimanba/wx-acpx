import { randomUUID } from "node:crypto";

import { AGENT_REGISTRY, createAcpxRuntimeClient } from "./src/acpx-runtime/client";
import { createCommandParser } from "./src/messaging/command-parser";
import { createWxAcpHandler } from "./src/messaging/handler";
import { createUserState } from "./src/messaging/user-state";
import { createUserQueue } from "./src/messaging/user-queue";
import { WeixinBot } from "./src/weixin-bot/index";

const bot = new WeixinBot();

await bot.login();

const instanceId = randomUUID();
const cwdRoot = process.env.WX_ACP_CWD_ROOT ?? process.cwd();

const userState = createUserState({
  instanceId,
  initialDefaultAgentName: "qwen",
  initialCwd: process.cwd(),
});

const userQueue = createUserQueue();

const commandParser = createCommandParser({
  // Explicitly enumerate built-in agent tokens for clarity and discoverability,
  // while still allowing unknown agents (no allowlist).
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

const acpxClient = await createAcpxRuntimeClient();

const handler = createWxAcpHandler({
  bot: {
    sendTyping: async (userId) => await bot.sendTyping(userId),
    stopTyping: async (userId) => await bot.stopTyping(userId),
    send: async (userId, text) => await bot.send(userId, text),
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

bot.onMessage(async (msg) => {
  console.log(`[${msg.timestamp.toLocaleTimeString()}] ${msg.userId}: ${msg.text}`);
  await handler.handle(msg);
});

console.log("Bot is running. Press Ctrl+C to stop.");
await bot.run();
