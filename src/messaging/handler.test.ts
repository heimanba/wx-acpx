import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { IncomingMessage } from "../weixin-bot/types";
import { createCommandParser } from "./command-parser";
import { createUserState } from "./user-state";
import { createUserQueue } from "./user-queue";
import { createWxAcpHandler, type WxAcpBot } from "./handler";
import type { AcpxRuntimeClient, EnsureSessionParams, SendSessionParams } from "../acpx-runtime/client";

function msg(params: Partial<IncomingMessage> & { userId: string }): IncomingMessage {
  return {
    userId: params.userId,
    text: params.text ?? "",
    type: params.type ?? "text",
    raw: (params.raw ?? ({} as any)) as any,
    _contextToken: params._contextToken ?? "ctx",
    timestamp: params.timestamp ?? new Date(),
  };
}

function createRecordingBot(events: string[]): WxAcpBot {
  return {
    async sendTyping(userId: string) {
      events.push(`typing:${userId}`);
    },
    async send(userId: string, text: string) {
      events.push(`send:${userId}:${text}`);
    },
    async stopTyping(userId: string) {
      events.push(`stop:${userId}`);
    },
  };
}

function createStubAcpxClient(options?: {
  sendResult?: string;
  sendError?: Error;
  ensureDelay?: Promise<void>;
  sendDelay?: Promise<void>;
  onEnsure?: (p: EnsureSessionParams) => void;
  onSend?: (p: SendSessionParams) => void;
}): AcpxRuntimeClient & { calls: { ensure: EnsureSessionParams[]; send: SendSessionParams[] } } {
  const calls = { ensure: [] as EnsureSessionParams[], send: [] as SendSessionParams[] };
  return {
    calls,
    async ensureSession(params: EnsureSessionParams) {
      calls.ensure.push(params);
      options?.onEnsure?.(params);
      await options?.ensureDelay;
    },
    async sendSession(params: SendSessionParams) {
      calls.send.push(params);
      options?.onSend?.(params);
      await options?.sendDelay;
      if (options?.sendError) throw options.sendError;
      return options?.sendResult ?? "ok";
    },
  };
}

describe("messaging/handler Task 7", () => {
  test("typing 顺序：sendTyping -> send -> stopTyping（成功路径）", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({
      allowedAgentNames: ["claude", "cursor"],
      aliasMap: { cs: "cursor" },
    });
    const acpx = createStubAcpxClient({ sendResult: "hello back" });

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "/cs hi" }));

    expect(events[0]).toBe("typing:u1");
    expect(events[1]).toContain("send:u1:");
    expect(events[2]).toBe("stop:u1");
  });

  test("typing 顺序：错误路径也必须 stopTyping（finally），且错误 send 在 stopTyping 前", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient({ sendError: new Error("boom") });

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "hi" }));

    expect(events[0]).toBe("typing:u1");
    expect(events[1]).toMatch(/^send:u1:/);
    expect(events[2]).toBe("stop:u1");
  });

  test("/new|/clear：只 bump nonce 不调用 acpx；下一次 prompt ensureSession.name 中 nonce 递增", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient();

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "/new" }));
    expect(acpx.calls.ensure.length).toBe(0);
    expect(acpx.calls.send.length).toBe(0);

    await handler.handle(msg({ userId: "u1", text: "hi" }));
    expect(acpx.calls.ensure.length).toBe(1);
    expect(acpx.calls.ensure[0].name).toContain("nonce:1");
  });

  test("权限字段：ensureSession 与 sendSession 参数显式包含 permissionMode 与 nonInteractivePermissions", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient({ sendResult: "ok" });

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "hi" }));

    expect(acpx.calls.ensure[0].permissionMode).toBe("approve-reads");
    expect(acpx.calls.ensure[0].nonInteractivePermissions).toBe("deny");
    expect(acpx.calls.send[0].permissionMode).toBe("approve-reads");
    expect(acpx.calls.send[0].nonInteractivePermissions).toBe("deny");
  });

  test("非文本消息：降级提示且不调用 acpx", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient();

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", type: "image", text: "[image]" }));

    expect(acpx.calls.ensure.length).toBe(0);
    expect(acpx.calls.send.length).toBe(0);
    expect(events.join("\n")).toContain("send:u1:");
  });

  test("/cwd 越界/realpath 失败：返回错误且不调用 acpx", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wx-acpx-root-"));
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: root,
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient();

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: root,
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "/cwd ../" }));
    expect(acpx.calls.ensure.length).toBe(0);
    expect(acpx.calls.send.length).toBe(0);
    expect(events.join("\n")).toContain("cwd 越界");

    await handler.handle(msg({ userId: "u1", text: "/cwd ./definitely-not-exist" }));
    expect(acpx.calls.ensure.length).toBe(0);
    expect(acpx.calls.send.length).toBe(0);
    expect(events.join("\n")).toContain("无法解析");
  });

  test("/cwd in-bounds：更新 cwd，后续 ensureSession 使用新 cwd；并清空该 user nonce（nonce 回到 0）", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wx-acpx-root-"));
    const child = path.join(root, "child");
    await mkdir(child);
    const canonicalChild = await realpath(child);

    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: root,
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient();

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: root,
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "/new" }));
    await handler.handle(msg({ userId: "u1", text: "/cwd child" }));
    await handler.handle(msg({ userId: "u1", text: "hi" }));

    expect(acpx.calls.ensure[0].cwd).toBe(canonicalChild);
    expect(acpx.calls.ensure[0].name).toContain("nonce:0");
  });

  test("unknown agent：错误且不调用 acpx", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient();

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "/unknown hi" }));
    expect(acpx.calls.ensure.length).toBe(0);
    expect(acpx.calls.send.length).toBe(0);
    expect(events.join("\n")).toContain("未知 agent");
  });

  test("alias 路由：/cs hello 路由到 cursor", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({
      allowedAgentNames: ["claude", "cursor"],
      aliasMap: { cs: "cursor" },
    });
    const acpx = createStubAcpxClient({ sendResult: "ok" });

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "/cs hello" }));
    expect(acpx.calls.ensure[0].agentName).toBe("cursor");
    expect(acpx.calls.send[0].agentName).toBe("cursor");
  });

  test("/help /info：返回基本字段，且不调用 acpx", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient();

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "/help" }));
    await handler.handle(msg({ userId: "u1", text: "/info" }));
    expect(acpx.calls.ensure.length).toBe(0);
    expect(acpx.calls.send.length).toBe(0);
    expect(events.join("\n")).toContain("help");
    expect(events.join("\n")).toContain("info");
  });

  test("空回复兜底：acpx 返回空串时仍发送非空兜底文案", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });
    const acpx = createStubAcpxClient({ sendResult: "   " });

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    await handler.handle(msg({ userId: "u1", text: "hi" }));
    const sent = events.find((e) => e.startsWith("send:u1:")) ?? "";
    expect(sent).not.toBe("send:u1:");
  });

  test("并发串行化：同一 userId 两条并发 handle 时第二条不会在第一条完成前进入 acpx", async () => {
    const events: string[] = [];
    const bot = createRecordingBot(events);
    const userState = createUserState({
      instanceId: "inst",
      initialDefaultAgentName: "claude",
      initialCwd: "/tmp",
    });
    const userQueue = createUserQueue();
    const commandParser = createCommandParser({ allowedAgentNames: ["claude"] });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => (releaseFirst = r));

    const acpx: AcpxRuntimeClient & {
      calls: { ensure: EnsureSessionParams[]; send: SendSessionParams[] };
    } = {
      calls: { ensure: [], send: [] },
      async ensureSession(p: EnsureSessionParams) {
        this.calls.ensure.push(p);
      },
      async sendSession(p: SendSessionParams) {
        this.calls.send.push(p);
        events.push(`acpx:send:${this.calls.send.length}`);
        if (this.calls.send.length === 1) {
          await firstGate;
        }
        return "ok";
      },
    };

    const handler = createWxAcpHandler({
      bot,
      userState,
      userQueue,
      commandParser,
      cwdRoot: "/tmp",
      acpxClient: acpx,
      permissionDefaults: { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    });

    const p1 = handler.handle(msg({ userId: "u1", text: "first" }));
    const p2 = handler.handle(msg({ userId: "u1", text: "second" }));

    for (let i = 0; i < 50; i++) {
      if (events.some((e) => e === "acpx:send:1")) break;
      await delay(1);
    }
    expect(events.filter((e) => e.startsWith("acpx:send:")).length).toBe(1);

    releaseFirst();
    await Promise.all([p1, p2]);

    expect(events.filter((e) => e.startsWith("acpx:send:")).length).toBe(2);
  });
});

