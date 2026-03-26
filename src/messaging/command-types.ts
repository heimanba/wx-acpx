export type BuiltinCommandResult =
  | { type: "help" }
  | { type: "info" }
  | { type: "new" }
  | { type: "clear" }
  | { type: "cwd"; path: string };

export type SetDefaultResult = {
  type: "set-default";
  agentName: string;
};

export type AgentPromptResult = {
  type: "agent-prompt";
  agentName: string;
  prompt: string;
};

export type CommandErrorResult = {
  type: "error";
  error: string;
};

export type CommandParseResult =
  | BuiltinCommandResult
  | SetDefaultResult
  | AgentPromptResult
  | CommandErrorResult;

export type CommandParser = {
  parse: (text: string, defaultAgentName: string) => CommandParseResult;
};

export type CreateCommandParserParams = {
  /**
   * Optional strict allowlist for agent names.
   *
   * - When provided, only agents in this list (after alias resolution) are accepted.
   * - When omitted, the parser accepts any agent token to match acpx behavior
   *   (unknown agents are treated as raw commands by acpx via --agent).
   */
  allowedAgentNames?: string[];
  aliasMap?: Record<string, string>;
};

