import { describe, expect, test } from "bun:test";
import { createCommandParser } from "./command-parser.ts";

describe("command-parser", () => {
  const strictParser = createCommandParser({
    allowedAgentNames: [
      "claude",
      "codex",
      "cursor",
      "kimi",
      "gemini",
      "openclaw",
      "opencode",
    ],
    aliasMap: {
      cc: "claude",
      cx: "codex",
      cs: "cursor",
      km: "kimi",
      gm: "gemini",
      oc: "openclaw",
      ocd: "opencode",
    },
  });

  const permissiveParser = createCommandParser({
    // no allowlist -> accept any agent token (acpx-compatible)
    aliasMap: {
      cc: "claude",
      cx: "codex",
      cs: "cursor",
      km: "kimi",
      gm: "gemini",
      oc: "openclaw",
      ocd: "opencode",
    },
  });

  test("/help /info /new /clear 优先级最高", () => {
    expect(strictParser.parse("/help", "claude")).toEqual({ type: "help" });
    expect(strictParser.parse("/info", "claude")).toEqual({ type: "info" });
    expect(strictParser.parse("/new", "claude")).toEqual({ type: "new" });
    expect(strictParser.parse("/clear", "claude")).toEqual({ type: "clear" });
  });

  test("/cwd <path>", () => {
    expect(strictParser.parse("/cwd  /tmp/foo  ", "claude")).toEqual({
      type: "cwd",
      path: "/tmp/foo",
    });
  });

  test("/cx hello (trim message)", () => {
    expect(strictParser.parse("/cx   hello   ", "claude")).toEqual({
      type: "agent-prompt",
      agentName: "codex",
      prompt: "hello",
    });
  });

  test("/ocd hi there", () => {
    expect(strictParser.parse("/ocd hi there", "claude")).toEqual({
      type: "agent-prompt",
      agentName: "opencode",
      prompt: "hi there",
    });
  });

  test("/CS hello (agent token case-insensitive)", () => {
    expect(strictParser.parse("/CS hello", "claude")).toEqual({
      type: "agent-prompt",
      agentName: "cursor",
      prompt: "hello",
    });
  });

  test("/codex (no message) => set-default", () => {
    expect(strictParser.parse("/codex", "claude")).toEqual({
      type: "set-default",
      agentName: "codex",
    });
  });

  test("no slash => agent-prompt default (prompt keep original)", () => {
    expect(strictParser.parse("hello without slash", "claude")).toEqual({
      type: "agent-prompt",
      agentName: "claude",
      prompt: "hello without slash",
    });
  });

  test("no slash => default agent name is normalized and validated", () => {
    expect(strictParser.parse("hi", "Claude")).toEqual({
      type: "agent-prompt",
      agentName: "claude",
      prompt: "hi",
    });

    const r = strictParser.parse("hi", "NOT_ALLOWED");
    expect(r.type).toBe("error");
    if (r.type !== "error") throw new Error("expected error result");
    expect(r.error).toContain("未知 agent");
  });

  test("/unknown hi => error", () => {
    const r = strictParser.parse("/unknown hi", "claude");
    expect(r.type).toBe("error");
    if (r.type !== "error") throw new Error("expected error result");
    expect(r.error).toContain("未知 agent");
  });

  test("permissive: /unknown hi => agent-prompt", () => {
    expect(permissiveParser.parse("/unknown hi", "claude")).toEqual({
      type: "agent-prompt",
      agentName: "unknown",
      prompt: "hi",
    });
  });

  test("permissive: no slash => default agent is not validated", () => {
    expect(permissiveParser.parse("hi", "NOT_ALLOWED")).toEqual({
      type: "agent-prompt",
      agentName: "not_allowed",
      prompt: "hi",
    });
  });
});

