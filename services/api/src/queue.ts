import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  ExtractJobPayload,
  QUEUE_NAMES,
  jobIdFor,
  queueKindFor,
  type Logger,
  type ModelSelection,
  type QueueKind,
} from "@nexus/shared/node";

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;
const PING_TIMEOUT_MS = 1000;
const COMMAND_TIMEOUT_MS = 2000;

export interface JobQueue {
  // The model decides which queue the job goes on, and travels in the payload.
  enqueue(documentId: string, run: number, model: ModelSelection): Promise<void>;
  // Rejects when redis does not answer within the timeout, so the caller can log why.
  ping(): Promise<void>;
  // Synchronous connection check, so a caller can skip work instead of failing every enqueue.
  isReady(): boolean;
  // Fires each time the connection becomes ready, reconnects included. Returns an unsubscribe.
  onReady(listener: () => void): () => void;
  close(): Promise<void>;
}

type ExtractQueue = Queue<ExtractJobPayload, void, "extract">;

export class BullMqJobQueue implements JobQueue {
  // We own the connection: bullmq leaves caller supplied clients open on close(), and ping needs a client anyway.
  private readonly redis: Redis;
  // Ollama jobs on one queue, everything else on the other, see QUEUE_NAMES.
  private readonly queues: Record<QueueKind, ExtractQueue>;

  constructor(
    redisUrl: string,
    private readonly attempts: number,
    logger: Logger,
    private readonly backoffDelayMs = 5000,
    // bullmq's key prefix. Only the e2e test sets it, so its jobs never mix with a dev queue on the same redis.
    prefix?: string,
  ) {
    // Fail fast: with redis down an upload gets an answer right away and the row stays queued for the
    // reconciler, instead of the request hanging in ioredis's offline queue.
    this.redis = new Redis(redisUrl, {
      enableOfflineQueue: false,
      commandTimeout: COMMAND_TIMEOUT_MS,
    });
    const open = (kind: QueueKind): ExtractQueue => {
      const queue: ExtractQueue = new Queue(QUEUE_NAMES[kind], {
        connection: this.redis,
        ...(prefix === undefined ? {} : { prefix }),
      });
      // bullmq re-emits the client's connection errors here and prints them to the console if nobody listens.
      queue.on("error", (err) => {
        logger.warn({ queue: kind, err }, "redis connection error");
      });
      return queue;
    };
    this.queues = { local: open("local"), hosted: open("hosted") };
  }

  async enqueue(documentId: string, run: number, model: ModelSelection): Promise<void> {
    const payload = ExtractJobPayload.parse({ documentId, run, ...model });
    // add() waits for the connection to be ready, which with redis down is forever, so offline queue and
    // commandTimeout never get a say. Checking first also covers redis dropping after it was up.
    if (!this.isReady()) {
      throw new Error(`redis is not ready (status ${this.redis.status})`);
    }
    await this.queues[queueKindFor(model.provider)].add("extract", payload, {
      jobId: jobIdFor(payload.documentId, payload.run),
      attempts: this.attempts,
      backoff: { type: "exponential", delay: this.backoffDelayMs },
      removeOnComplete: { age: SEVEN_DAYS_S },
      removeOnFail: { age: SEVEN_DAYS_S },
    });
  }

  isReady(): boolean {
    return this.redis.status === "ready";
  }

  onReady(listener: () => void): () => void {
    this.redis.on("ready", listener);
    return () => {
      this.redis.off("ready", listener);
    };
  }

  async ping(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`redis ping timed out after ${PING_TIMEOUT_MS}ms`));
      }, PING_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.redis.ping(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.queues.local.close(), this.queues.hosted.close()]);
    await this.redis.quit();
  }
}
