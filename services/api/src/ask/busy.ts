import type { Logger } from "@nexus/shared/node";
import { HttpError } from "../errors.js";

// Ollama runs one request at a time here (one small gpu). The worker's local queue has
// concurrency 1 for that reason, and a question to an ollama model has to fit in with it: sent
// while a document is being extracted it would sit in ollama's own queue for minutes, with the
// user looking at a spinner. So a question first waits a short while for the gpu to be free, and
// if it is not, the answer is MODEL_BUSY and the user can ask again or pick a hosted model.

export interface OllamaGate {
  // Resolves with a release function once ollama is free, rejects with 503 MODEL_BUSY when it is
  // still busy after the wait.
  acquire(): Promise<() => void>;
}

export interface OllamaGateOptions {
  // How many jobs the worker is running on the local queue right now.
  activeLocalJobs: () => Promise<number>;
  waitMs: number;
  logger: Pick<Logger, "warn">;
  pollMs?: number;
}

const DEFAULT_POLL_MS = 250;

export function createOllamaGate(opts: OllamaGateOptions): OllamaGate {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  // A second question would queue behind the first one in ollama just the same.
  let asking = false;

  async function workerBusy(): Promise<boolean> {
    try {
      return (await opts.activeLocalJobs()) > 0;
    } catch (err) {
      // Redis is down, so the worker gets no jobs either. Not a reason to refuse a question.
      opts.logger.warn({ err }, "could not ask the queue whether the local model is busy");
      return false;
    }
  }

  return {
    async acquire() {
      const deadline = Date.now() + opts.waitMs;
      for (;;) {
        const extracting = !asking && (await workerBusy());
        // Checked again after the await: another question may have got in during it.
        if (!asking && !extracting) {
          asking = true;
          return () => {
            asking = false;
          };
        }
        if (Date.now() + pollMs > deadline) {
          throw new HttpError(
            503,
            "MODEL_BUSY",
            asking
              ? "The local model is answering another question. Try again in a moment."
              : "The local model is busy with an extraction. Try again in a moment, or pick a hosted model.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
  };
}
