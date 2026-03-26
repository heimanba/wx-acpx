import { realpath } from "node:fs/promises";
import path from "node:path";

export type ResolveSafeCwdParams = {
  inputPath: string;
  baseCwd: string;
  cwdRoot: string;
};

export type ResolveSafeCwdResult =
  | { ok: true; cwd: string }
  | { ok: false; error: string };

export async function resolveSafeCwd({
  inputPath,
  baseCwd,
  cwdRoot,
}: ResolveSafeCwdParams): Promise<ResolveSafeCwdResult> {
  const trimmedInput = inputPath.trim();
  if (!trimmedInput) {
    return { ok: false, error: "cwd 缺少 path" };
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(cwdRoot);
  } catch {
    return { ok: false, error: "cwdRoot 无法解析（路径不存在或不可访问）" };
  }

  const absoluteInput = path.isAbsolute(trimmedInput)
    ? trimmedInput
    : path.resolve(baseCwd, trimmedInput);

  let canonicalInput: string;
  try {
    canonicalInput = await realpath(absoluteInput);
  } catch {
    return { ok: false, error: "cwd 路径无法解析（路径不存在或不可访问）" };
  }

  // Cross-platform in-bounds check: use relative path semantics.
  // On Windows, normalize case to avoid drive-letter casing mismatches.
  const rootForCompare = process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
  const inputForCompare = process.platform === "win32" ? canonicalInput.toLowerCase() : canonicalInput;

  const rel = path.relative(rootForCompare, inputForCompare);
  const inBounds = rel === ""
    || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));

  if (!inBounds) {
    return { ok: false, error: "cwd 越界：不允许跳出 cwdRoot" };
  }

  return { ok: true, cwd: canonicalInput };
}

