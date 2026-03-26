export type CliRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CliRunner = (params: {
  argv: string[];
  cwd: string;
}) => Promise<CliRunResult>;

export type CreateBunCliRunnerOptions = {
  onChunk?: (chunk: string) => void;
};

export function createBunCliRunner(options?: CreateBunCliRunnerOptions): CliRunner {
  return async ({ argv, cwd }) => {
    const proc = Bun.spawn({
      cmd: argv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: Bun.env,
    });

    const onChunk = options?.onChunk;
    let stdout = "";

    const stdoutPromise = onChunk
      ? (async () => {
          const reader = proc.stdout.getReader();
          const decoder = new TextDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              stdout += chunk;
              onChunk(chunk);
            }
          } finally {
            reader.releaseLock();
          }
          return stdout;
        })()
      : new Response(proc.stdout).text();

    const [stdoutResult, stderr, exitCode] = await Promise.all([
      stdoutPromise,
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      stdout: typeof stdoutResult === "string" ? stdoutResult : stdout,
      stderr,
      exitCode,
    };
  };
}

