import { z } from "zod";

export const QUEUE_NAME = "document-extraction";

export const ExtractJobPayload = z.object({
  documentId: z.uuid(),
  run: z.int().positive(),
});
export type ExtractJobPayload = z.infer<typeof ExtractJobPayload>;

// bullmq ignores add() when a job with the same id exists, finished ones included, which makes enqueue
// idempotent. A retry bumps run to get a fresh id, and the worker drops jobs whose run no longer matches
// the document. "_" instead of ":" because bullmq rejects custom ids containing ":".
export function jobIdFor(documentId: string, run: number): string {
  return `${documentId}_${run}`;
}
