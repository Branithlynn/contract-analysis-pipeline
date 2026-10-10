import type { Logger } from "@nexus/shared/node";

export type ShutdownStep = [name: string, close: () => void | Promise<void>];

export interface ShutdownDeps {
  logger: Logger;
  // In order: stop taking work first, close the stores the work writes to last.
  steps: ShutdownStep[];
  exit: (code: number) => void;
  forceAfterMs?: number;
}

export function createShutdown({
  logger,
  steps,
  exit,
  forceAfterMs = 10_000,
}: ShutdownDeps): (signal: string) => Promise<void> {
  let started: Promise<void> | undefined;

  async function run(signal: string): Promise<void> {
    logger.info({ signal }, "shutting down");
    // A hung close (a stuck request, redis not answering) must not keep the container from stopping.
    const force = setTimeout(() => {
      logger.error({ forceAfterMs }, "shutdown timed out, forcing exit");
      exit(1);
    }, forceAfterMs);
    force.unref();

    // One failing close shouldn't leave the others open.
    for (const [name, close] of steps) {
      try {
        await close();
        logger.info(`${name} closed`);
      } catch (err) {
        logger.error({ err }, `${name} close failed`);
      }
    }

    clearTimeout(force);
    logger.info("shutdown complete");
    exit(0);
  }

  // A second signal (ctrl+c twice, or SIGTERM then SIGINT) joins the shutdown already running.
  return (signal) => (started ??= run(signal));
}
