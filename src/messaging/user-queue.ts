export type UserQueue = {
  enqueue<T>(userId: string, fn: () => Promise<T>): Promise<T>;
};

export function createUserQueue(): UserQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    enqueue<T>(userId: string, fn: () => Promise<T>): Promise<T> {
      const prev = tails.get(userId) ?? Promise.resolve();

      const task = prev.then(fn);

      const nextTail: Promise<void> = task.then(
        () => undefined,
        () => undefined,
      );

      tails.set(userId, nextTail);

      nextTail.finally(() => {
        if (tails.get(userId) === nextTail) tails.delete(userId);
      });

      return task;
    },
  };
}

