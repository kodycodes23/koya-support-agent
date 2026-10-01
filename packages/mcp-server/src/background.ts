import type { Logger } from "@koya/shared";

/**
 * Fire-and-forget writes (audit logs) that must not add database round trips to a
 * tool call's latency. Tracked so shutdown can wait for them to land.
 */
const pending = new Set<Promise<unknown>>();

export function inBackground(log: Logger, label: string, work: PromiseLike<{ error: { message: string } | null }>): void {
  const p = Promise.resolve(work)
    .then(({ error }) => {
      if (error) log.warn({ error: error.message }, `background write failed: ${label}`);
    })
    .catch((err: unknown) => log.warn({ err }, `background write threw: ${label}`))
    .finally(() => pending.delete(p));
  pending.add(p);
}

export async function flushBackgroundWrites(): Promise<void> {
  await Promise.allSettled([...pending]);
}
