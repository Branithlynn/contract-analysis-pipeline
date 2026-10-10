import { findStaleQueued, type Db, type Logger } from "@nexus/shared/node";
import type { JobQueue } from "./queue.js";

// Inserting the row and enqueueing are two systems with no shared transaction, so a crash in between
// leaves a document queued with no job. An outbox would close that gap properly; for this a periodic
// sweep is enough. Re-enqueueing is safe because jobIdFor(id, run) makes it a no-op when the job exists.

export interface ReconcilerDeps {
  db: Db;
  queue: JobQueue;
  logger: Logger;
  clock: () => Date;
  intervalMs?: number;
  staleAfterMs?: number;
}

export interface ReconcileResult {
  stale: number;
  enqueued: number;
  failed: number;
}

export interface Reconciler {
  // Resolves to undefined when the pass itself failed; it never rejects.
  runOnce(): Promise<ReconcileResult | undefined>;
  stop(): void;
}

export function startReconciler({
  db,
  queue,
  logger,
  clock,
  intervalMs = 60_000,
  staleAfterMs = 60_000,
}: ReconcilerDeps): Reconciler {
  let inFlight: Promise<ReconcileResult | undefined> | undefined;

  async function pass(): Promise<ReconcileResult | undefined> {
    try {
      const cutoff = new Date(clock().getTime() - staleAfterMs).toISOString();
      const rows = findStaleQueued(db, cutoff);
      const result: ReconcileResult = { stale: rows.length, enqueued: 0, failed: 0 };
      for (const row of rows) {
        try {
          await queue.enqueue(row.id, row.run);
          result.enqueued++;
        } catch (err) {
          result.failed++;
          logger.warn({ documentId: row.id, run: row.run, err }, "reconciler enqueue failed");
        }
      }
      logger[rows.length > 0 ? "info" : "debug"](result, "reconciler pass");
      return result;
    } catch (err) {
      logger.error({ err }, "reconciler pass failed");
      return undefined;
    }
  }

  // With redis slow every enqueue can take up to the command timeout, so a pass may outlast the interval.
  // Callers that land during a pass share it instead of starting a second one.
  function runOnce(): Promise<ReconcileResult | undefined> {
    inFlight ??= pass().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  void runOnce();
  const timer = setInterval(() => void runOnce(), intervalMs);
  // The sweep alone should never keep the process alive.
  timer.unref();

  return {
    runOnce,
    stop: () => {
      clearInterval(timer);
    },
  };
}
