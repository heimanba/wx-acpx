import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSafeCwd } from "./cwd-safety";

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("cwd-safety.resolveSafeCwd", () => {
  test("in-bounds: inputPath='.' returns ok and cwd inside root", async () => {
    const root = await makeTempDir("wx-acpx-cwd-root-");
    try {
      const r = await resolveSafeCwd({ inputPath: ".", baseCwd: root, cwdRoot: root });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const canonicalRoot = await realpath(root);
        expect(r.cwd === canonicalRoot || r.cwd.startsWith(canonicalRoot + path.sep)).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("missing path -> ok=false", async () => {
    const root = await makeTempDir("wx-acpx-cwd-root-");
    try {
      const r = await resolveSafeCwd({
        inputPath: "does-not-exist",
        baseCwd: root,
        cwdRoot: root,
      });
      expect(r.ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("empty path -> ok=false", async () => {
    const root = await makeTempDir("wx-acpx-cwd-root-");
    try {
      const r = await resolveSafeCwd({ inputPath: "   ", baseCwd: root, cwdRoot: root });
      expect(r.ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("missing cwdRoot -> ok=false", async () => {
    const sandbox = await makeTempDir("wx-acpx-cwd-root-missing-");
    try {
      const missingRoot = path.join(sandbox, "nope");
      const r = await resolveSafeCwd({ inputPath: ".", baseCwd: sandbox, cwdRoot: missingRoot });
      expect(r.ok).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("symlink escape: rootDir/escape points outside root -> ok=false", async () => {
    const sandbox = await makeTempDir("wx-acpx-cwd-symlink-");
    const root = path.join(sandbox, "root");
    const outside = path.join(sandbox, "outside");
    try {
      await mkdir(root, { recursive: true });
      await mkdir(outside, { recursive: true });

      // Ensure outside has something (not strictly needed, but makes intent clear)
      await writeFile(path.join(outside, "x.txt"), "x");

      await symlink(outside, path.join(root, "escape"));

      const r = await resolveSafeCwd({
        inputPath: "escape",
        baseCwd: root,
        cwdRoot: root,
      });
      expect(r.ok).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

