import { describe, expect, test } from "bun:test";
import { createUserState } from "./user-state";

describe("user-state", () => {
  test("defaultAgentByUserId / cwdByUserId: 未设置时返回 initial 值", () => {
    const s = createUserState({
      instanceId: "INSTANCE_TEST",
      initialDefaultAgentName: "claude",
      initialCwd: "/repo",
    });

    expect(s.getDefaultAgent("u1")).toBe("claude");
    expect(s.getCwd("u1")).toBe("/repo");

    s.setDefaultAgent("u1", "codex");
    s.setCwdForUser("u1", "/tmp");

    expect(s.getDefaultAgent("u1")).toBe("codex");
    expect(s.getCwd("u1")).toBe("/tmp");
  });

  test("nonceBySessionKey: 默认 0，bumpNonceForDefaultAgent 递增当前 default agent 的 nonce", () => {
    const s = createUserState({
      instanceId: "INSTANCE_TEST",
      initialDefaultAgentName: "claude",
      initialCwd: "/repo",
    });

    expect(s.getNonce("u1", "claude")).toBe(0);
    s.bumpNonceForDefaultAgent("u1");
    expect(s.getNonce("u1", "claude")).toBe(1);

    s.setDefaultAgent("u1", "codex");
    expect(s.getNonce("u1", "codex")).toBe(0);
    s.bumpNonceForDefaultAgent("u1");
    expect(s.getNonce("u1", "codex")).toBe(1);

    // bump 不应影响其它 agent 的 nonce
    expect(s.getNonce("u1", "claude")).toBe(1);
  });

  test("buildSessionName: 必须包含 instanceId/agentName/nonce，且不能包含原始 userId 字符串", () => {
    const s = createUserState({
      instanceId: "INSTANCE_TEST",
      initialDefaultAgentName: "claude",
      initialCwd: "/repo",
    });

    const userId = "user-abc-123";
    const name = s.buildSessionName({ userId, agentName: "claude", nonce: 7 });

    expect(name).toContain("wx-acpx:INSTANCE_TEST:claude:");
    expect(name).toContain(":nonce:7");
    expect(name).not.toContain(userId);
  });

  test("setCwdForUser: 清空该 user 的所有 nonce，保证 cwd 切换不复用旧 session", () => {
    const s = createUserState({
      instanceId: "INSTANCE_TEST",
      initialDefaultAgentName: "claude",
      initialCwd: "/repo",
    });

    const userId = "u1";

    // 产生 claude session 的 nonce
    s.bumpNonceForDefaultAgent(userId);
    expect(s.getNonce(userId, "claude")).toBe(1);

    // 切换 default agent 并产生 codex session 的 nonce
    s.setDefaultAgent(userId, "codex");
    s.bumpNonceForDefaultAgent(userId);
    expect(s.getNonce(userId, "codex")).toBe(1);

    // 切换 cwd 必须清空该用户所有 agent 的 nonce
    s.setCwdForUser(userId, "/new");
    expect(s.getNonce(userId, "claude")).toBe(0);
    expect(s.getNonce(userId, "codex")).toBe(0);
  });

  test('userId 含 "::" 时不应误清空其它用户 nonce', () => {
    const s = createUserState({
      instanceId: "INSTANCE_TEST",
      initialDefaultAgentName: "claude",
      initialCwd: "/repo",
    });

    // u1 与 u1::x 必须相互独立
    s.bumpNonceForDefaultAgent("u1"); // claude -> 1
    s.bumpNonceForDefaultAgent("u1::x"); // claude -> 1

    expect(s.getNonce("u1", "claude")).toBe(1);
    expect(s.getNonce("u1::x", "claude")).toBe(1);

    // 切换 u1 的 cwd 只能清空 u1，不影响 u1::x
    s.setCwdForUser("u1", "/new");
    expect(s.getNonce("u1", "claude")).toBe(0);
    expect(s.getNonce("u1::x", "claude")).toBe(1);
  });
});

