import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { ExtractJobPayload, QUEUE_NAME, jobIdFor, type Logger } from "@nexus/shared/node";

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;
const PING_TIMEOUT_MS = 1000;
const COMMAND_TIMEOUT_MS = 2000;

export interface JobQueue {
  enqueue(documentId: string, run: number): Promise<void>;
  // Rejects when redis does not answer within the timeout, so the caller can log why.
  ping(): Promise<void>;
  // Synchronous connection check, so a caller can skip work instead of failing every enqueue.
  isReady(): boolean;
  // Fires each time the connection becomes ready, reconnects included. Returns an unsubscribe.
  onReady(listener: () => void): () => void;
  close(): Promise<void>;
}

export class BullMqJobQueue implements JobQueue {
  // We own the connection: bullmq leaves caller supplied clients open on close(), and ping needs a client anyway.
  private readonly redis: Redis;
  private readonly queue: Queue<ExtractJobPayload, void, "extract">;

  constructor(
    redisUrl: string,
    private readonly attempts: number,
    logger: Logger,
    private readonly backoffDelayMs = 5000,
  ) {
    // Fail fast: with redis down an upload gets an answer right away and the row stays queued for the
    // reconciler, instead of the request hanging in ioredis's offline queue.
    this.redis = new Redis(redisUrl, {
      enableOfflineQueue: false,
      commandTimeout: COMMAND_TIMEOUT_MS,
    });
    this.queue = new Queue(QUEUE_NAME, { connection: this.redis });
    // bullmq re-emits the client's connection errors here and prints them to the console if nobody listens.
    this.queue.on("error", (err) => {
      logger.warn({ err }, "redis connection error");
    });
  }

  async enqueue(documentId: string, run: number): Promise<void> {
    const payload = ExtractJobPayload.parse({ documentId, run });
    // add() waits for the connection to be ready, which with redis down is forever, so offline queue and
    // commandTimeout never get a say. Checking first also covers redis dropping after it was up.
    if (!this.isReady()) {
      throw new Error(`redis is not ready (status ${this.redis.status})`);
    }
    await this.queue.add("extract", payload, {
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
    await this.queue.close();
    await this.redis.quit();
  }
}
