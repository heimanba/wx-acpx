import { describe, expect, test } from "bun:test";
import { createUserQueue } from "./user-queue";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("user-queue", () => {
  test("同一 userId：严格串行（t2-start 必须在 t1-end 之后）", async () => {
    const q = createUserQueue();
    const events: Array<"t1-start" | "t1-end" | "t2-start" | "t2-end"> = [];

    const gate = deferred<void>();

    const t1 = q.enqueue("u1", async () => {
      events.push("t1-start");
      await gate.promise;
      events.push("t1-end");
    });

    const t2 = q.enqueue("u1", async () => {
      events.push("t2-start");
      events.push("t2-end");
    });

    await tick();
    expect(events).toEqual(["t1-start"]);

    gate.resolve();
    await Promise.all([t1, t2]);

    expect(events.indexOf("t2-start")).toBeGreaterThan(events.indexOf("t1-end"));
  });

  test("不同 userId：互不阻塞（可并行 start）", async () => {
    const q = createUserQueue();
    const events: string[] = [];

    const gate1 = deferred<void>();
    const gate2 = deferred<void>();

    const t1 = q.enqueue("u1", async () => {
      events.push("u1-start");
      await gate1.promise;
      events.push("u1-end");
    });

    const t2 = q.enqueue("u2", async () => {
      events.push("u2-start");
      await gate2.promise;
      events.push("u2-end");
    });

    await tick();
    expect(new Set(events)).toEqual(new Set(["u1-start", "u2-start"]));

    gate1.resolve();
    gate2.resolve();
    await Promise.all([t1, t2]);
  });

  test("若 fn 抛错：后续同一 userId 的队列仍能继续", async () => {
    const q = createUserQueue();
    const events: string[] = [];

    const t1 = q.enqueue("u1", async () => {
      events.push("t1-start");
      throw new Error("boom");
    });

    const t2 = q.enqueue("u1", async () => {
      events.push("t2-start");
      return 42;
    });

    await expect(t1).rejects.toThrow("boom");
    await expect(t2).resolves.toBe(42);
    expect(events).toEqual(["t1-start", "t2-start"]);
  });
});

