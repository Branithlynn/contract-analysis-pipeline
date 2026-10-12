import { z } from "zod";
import { LlmProviderName } from "./providers.js";

// Two queues, so the rule "one ollama job at a time" is a property of the setup and not of code
// that runs inside a job: the local queue's worker has concurrency 1, the hosted one runs jobs in
// parallel. A lock around ollama calls in one shared queue would also work, but a waiting job
// would hold a worker slot, and two local jobs could block every hosted job behind them.
// New names: jobs left in the old "document-extraction" queue are not consumed any more, their
// documents are still queued in the db and the reconciler puts them on the right queue.
export const QUEUE_NAMES = {
  local: "extract-local",
  hosted: "extract-hosted",
} as const;
export type QueueKind = keyof typeof QUEUE_NAMES;

// Only ollama shares one machine's gpu. The mock goes with the hosted ones, it has nothing to protect.
export function queueKindFor(provider: LlmProviderName): QueueKind {
  return provider === "ollama" ? "local" : "hosted";
}

export const ExtractJobPayload = z.object({
  documentId: z.uuid(),
  run: z.int().positive(),
  // Optional: a job enqueued before model selection existed has neither, and runs with the default.
  provider: LlmProviderName.optional(),
  model: z.string().min(1).optional(),
});
export type ExtractJobPayload = z.infer<typeof ExtractJobPayload>;

// bullmq ignores add() when a job with the same id exists, finished ones included, which makes enqueue
// idempotent. A retry bumps run to get a fresh id, and the worker drops jobs whose run no longer matches
// the document. "_" instead of ":" because bullmq rejects custom ids containing ":".
export function jobIdFor(documentId: string, run: number): string {
  return `${documentId}_${run}`;
}
