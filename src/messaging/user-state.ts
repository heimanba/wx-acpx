import { createHash } from "node:crypto";

export type CreateUserStateParams = {
  instanceId: string;
  initialDefaultAgentName: string;
  initialCwd: string;
};

type BuildSessionNameParams = { userId: string; agentName: string; nonce: number };

export type UserState = {
  getDefaultAgent(userId: string): string;
  setDefaultAgent(userId: string, agentName: string): void;
  getCwd(userId: string): string;
  setCwdForUser(userId: string, cwd: string): void;
  getNonce(userId: string, agentName: string): number;
  bumpNonceForDefaultAgent(userId: string): void;
  buildSessionName(params: BuildSessionNameParams): string;
};

function hashUserId(userId: string): string {
  // 不可逆：sha256(hex) 截断，避免在 sessionName 中泄露 userId
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

export function createUserState({
  instanceId,
  initialDefaultAgentName,
  initialCwd,
}: CreateUserStateParams): UserState {
  const defaultAgentByUserId = new Map<string, string>();
  const cwdByUserId = new Map<string, string>();
  const nonceByUserId = new Map<string, Map<string, number>>();

  const getDefaultAgent = (userId: string): string => {
    return defaultAgentByUserId.get(userId) ?? initialDefaultAgentName;
  };

  const getCwd = (userId: string): string => {
    return cwdByUserId.get(userId) ?? initialCwd;
  };

  const getOrCreateNonceMap = (userId: string): Map<string, number> => {
    const existing = nonceByUserId.get(userId);
    if (existing) return existing;
    const created = new Map<string, number>();
    nonceByUserId.set(userId, created);
    return created;
  };

  return {
    getDefaultAgent,

    setDefaultAgent(userId: string, agentName: string): void {
      defaultAgentByUserId.set(userId, agentName);
    },

    getCwd,

    setCwdForUser(userId: string, cwd: string): void {
      cwdByUserId.set(userId, cwd);

      // MVP 简化：cwd 切换不复用旧 session，清空该 user 的所有 nonce 记录
      nonceByUserId.delete(userId);
    },

    getNonce(userId: string, agentName: string): number {
      return nonceByUserId.get(userId)?.get(agentName) ?? 0;
    },

    bumpNonceForDefaultAgent(userId: string): void {
      const agentName = getDefaultAgent(userId);
      const map = getOrCreateNonceMap(userId);
      map.set(agentName, (map.get(agentName) ?? 0) + 1);
    },

    buildSessionName({ userId, agentName, nonce }: BuildSessionNameParams): string {
      return `wx-acpx:${instanceId}:${agentName}:${hashUserId(userId)}:nonce:${nonce}`;
    },
  };
}

