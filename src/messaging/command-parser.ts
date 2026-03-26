import type {
  CommandParser,
  CommandParseResult,
  CreateCommandParserParams,
} from "./command-types";

function normalizeMap(map: Record<string, string> | undefined): Record<string, string> {
  if (!map) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) out[k.toLowerCase()] = v.toLowerCase();
  return out;
}

export function createCommandParser({
  allowedAgentNames,
  aliasMap,
}: CreateCommandParserParams): CommandParser {
  const allowed = allowedAgentNames
    ? new Set(allowedAgentNames.map((n) => n.toLowerCase()))
    : null;
  const aliases = normalizeMap(aliasMap);

  function errorResult(error: string): CommandParseResult {
    return { type: "error", error };
  }

  function resolveAgentToken(token: string): string | null {
    const normalized = token.toLowerCase();
    const resolvedAgent = (aliases[normalized] ?? normalized).toLowerCase();
    if (allowed && !allowed.has(resolvedAgent)) {
      return null;
    }
    return resolvedAgent;
  }

  return {
    parse(text: string, defaultAgentName: string): CommandParseResult {
      if (!text.startsWith("/")) {
        const resolvedDefault = resolveAgentToken(defaultAgentName);
        if (!resolvedDefault) {
          return errorResult(`未知 agent: ${defaultAgentName}`);
        }
        return {
          type: "agent-prompt",
          agentName: resolvedDefault,
          prompt: text,
        };
      }

      const raw = text.slice(1);
      const s = raw.trimStart();
      if (!s) return errorResult("未知 agent：空命令");

      const firstSpaceIdx = s.search(/\s/);
      const rawToken = firstSpaceIdx === -1 ? s : s.slice(0, firstSpaceIdx);
      const rest = firstSpaceIdx === -1 ? "" : s.slice(firstSpaceIdx);

      const token = rawToken.toLowerCase();

      // builtins have highest priority
      if (token === "help") return { type: "help" };
      if (token === "info") return { type: "info" };
      if (token === "new") return { type: "new" };
      if (token === "clear") return { type: "clear" };
      if (token === "cwd") {
        const path = rest.trim();
        if (!path) return errorResult("cwd 缺少 path");
        return { type: "cwd", path };
      }

      const resolvedAgent = resolveAgentToken(rawToken);
      if (!resolvedAgent) {
        return errorResult(`未知 agent: ${rawToken}`);
      }

      const message = rest.trim();
      if (!message) {
        return { type: "set-default", agentName: resolvedAgent };
      }

      return { type: "agent-prompt", agentName: resolvedAgent, prompt: message };
    },
  };
}

