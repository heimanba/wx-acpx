import type { IncomingMessage } from "../weixin-bot/types";

import type { CommandParser } from "./command-types";
import type { UserState } from "./user-state";
import type { UserQueue } from "./user-queue";
import { resolveSafeCwd } from "./cwd-safety";

import type {
  AcpxRuntimeClient,
  NonInteractivePermissions,
  PermissionMode,
} from "../acpx-runtime/client";

export type WxAcpPermissionDefaults = {
  permissionMode: PermissionMode;
  nonInteractivePermissions: NonInteractivePermissions;
};

export type WxAcpBot = {
  sendTyping(userId: string): Promise<void>;
  stopTyping(userId: string): Promise<void>;
  send(userId: string, text: string): Promise<void>;
};

export type CreateWxAcpHandlerParams = {
  bot: WxAcpBot;
  userState: UserState;
  userQueue: UserQueue;
  commandParser: CommandParser;
  cwdRoot: string;
  acpxClient: AcpxRuntimeClient;
  permissionDefaults: WxAcpPermissionDefaults;
};

const EMPTY_REPLY_FALLBACK = "（空回复）我这次没有拿到有效输出，你可以换个说法再试一次。";

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "未知错误";
  const text = String(error);
  return text && text !== "[object Object]" ? text : "未知错误";
}

export function createWxAcpHandler(params: CreateWxAcpHandlerParams): {
  handle: (incoming: IncomingMessage) => Promise<void>;
} {
  const {
    bot,
    userState,
    userQueue,
    commandParser,
    cwdRoot,
    acpxClient,
    permissionDefaults,
  } = params;

  async function handleOne(incoming: IncomingMessage): Promise<void> {
    const userId = incoming.userId;

    if (incoming.type !== "text") {
      await bot.send(userId, "暂不支持非文本消息，请发送文本指令或问题。");
      return;
    }

    const defaultAgentName = userState.getDefaultAgent(userId);
    const parsed = commandParser.parse(incoming.text, defaultAgentName);

    if (parsed.type === "error") {
      await bot.send(userId, parsed.error);
      return;
    }

    if (parsed.type === "help") {
      await bot.send(
        userId,
        [
          "help",
          "可用命令：/help /info /new /clear /cwd <path> /<agent> <prompt> /<agent>",
          "别名示例：/cs hello",
        ].join("\n"),
      );
      return;
    }

    if (parsed.type === "info") {
      const cwd = userState.getCwd(userId);
      const agentName = userState.getDefaultAgent(userId);
      const nonce = userState.getNonce(userId, agentName);
      await bot.send(
        userId,
        ["info", `defaultAgent=${agentName}`, `cwd=${cwd}`, `nonce=${nonce}`].join("\n"),
      );
      return;
    }

    if (parsed.type === "new" || parsed.type === "clear") {
      userState.bumpNonceForDefaultAgent(userId);
      await bot.send(userId, "已创建新会话（nonce 已递增）。");
      return;
    }

    if (parsed.type === "cwd") {
      const baseCwd = userState.getCwd(userId);
      const safe = await resolveSafeCwd({ inputPath: parsed.path, baseCwd, cwdRoot });
      if (!safe.ok) {
        await bot.send(userId, safe.error);
        return;
      }

      userState.setCwdForUser(userId, safe.cwd);
      await bot.send(userId, `cwd 已更新：${safe.cwd}`);
      return;
    }

    if (parsed.type === "set-default") {
      userState.setDefaultAgent(userId, parsed.agentName);
      await bot.send(userId, `默认 agent 已设置为：${parsed.agentName}`);
      return;
    }

    // agent-prompt
    let startedTyping = false;
    try {
      await bot.sendTyping(userId);
      startedTyping = true;
    } catch {
      // best effort: typing is optional UX signal
      startedTyping = false;
    }

    const agentName = parsed.agentName;
    const cwd = userState.getCwd(userId);
    const nonce = userState.getNonce(userId, agentName);
    const sessionName = userState.buildSessionName({ userId, agentName, nonce });

    try {
      await acpxClient.ensureSession({
        agentName,
        cwd,
        name: sessionName,
        permissionMode: permissionDefaults.permissionMode,
        nonInteractivePermissions: permissionDefaults.nonInteractivePermissions,
      });

      const output = await acpxClient.sendSession({
        agentName,
        cwd,
        sessionName,
        prompt: parsed.prompt,
        permissionMode: permissionDefaults.permissionMode,
        nonInteractivePermissions: permissionDefaults.nonInteractivePermissions,
      });

      const trimmed = output.trim();
      await bot.send(userId, trimmed || EMPTY_REPLY_FALLBACK);
    } catch (error) {
      await bot.send(userId, `错误：${asErrorMessage(error)}`);
    } finally {
      if (startedTyping) {
        try {
          await bot.stopTyping(userId);
        } catch {
          // best effort: do not fail the whole turn if stopTyping fails
        }
      }
    }
  }

  return {
    async handle(incoming) {
      await userQueue.enqueue(incoming.userId, async () => {
        await handleOne(incoming);
      });
    },
  };
}

