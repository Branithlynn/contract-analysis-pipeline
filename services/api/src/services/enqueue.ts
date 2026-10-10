import { insertEvent, type Db } from "@nexus/shared/node";
import type { JobQueue } from "../queue.js";

export const QUEUE_DEFERRED_MESSAGE = "queue unavailable, will retry automatically";

export type EnqueueOutcome = { enqueued: true } | { enqueued: false; err: unknown };

// queued in the db means "should be in the queue"; the reconciler makes that true. So a failed enqueue
// leaves the row queued and only records why it is waiting, for the ui to show.
export async function enqueueOrDefer(
  { db, queue }: { db: Db; queue: JobQueue },
  documentId: string,
  run: number,
): Promise<EnqueueOutcome> {
  try {
    await queue.enqueue(documentId, run);
    return { enqueued: true };
  } catch (err) {
    insertEvent(db, {
      document_id: documentId,
      run,
      stage: "queue",
      outcome: "retry",
      message: QUEUE_DEFERRED_MESSAGE,
    });
    return { enqueued: false, err };
  }
}
