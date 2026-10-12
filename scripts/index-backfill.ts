// Builds the search index for documents that have none for the current embedding model: processed
// before the index existed, failed to index, or indexed with another EMBED_MODEL.
// Usage: npm run index:backfill -- [--provider ollama|openai|mock] [--model <name>] [--all]
// --all indexes every completed document again, also the ones that have an index. For after a
// change to the chunking, e.g. to get exact page ranges on chunks written before they existed.
// The flags override EMBED_PROVIDER and EMBED_MODEL from .env. The api and the worker have to run
// with the same two values, otherwise search skips what this wrote.
import { parseArgs } from "node:util";
import {
  EmbedProviderName,
  assertMigrated,
  createEmbedder,
  createLogger,
  loadConfig,
  openDb,
} from "@nexus/shared/node";
import { backfillIndex } from "../services/worker/src/retrieval/backfill.js";
import { embedEnvFromArgs } from "./lib/embed-env.js";

const USAGE = `usage: npm run index:backfill -- [--provider ${EmbedProviderName.options.join("|")}] [--model <name>] [--all]`;

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

async function main(): Promise<void> {
  let values: {
    provider?: string | undefined;
    model?: string | undefined;
    all?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        provider: { type: "string" },
        model: { type: "string" },
        all: { type: "boolean" },
      },
    }));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  let env: Record<string, string | undefined>;
  try {
    env = embedEnvFromArgs(values);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  // loadConfig's error lists field paths and problems, never the values, so keys can't leak here.
  const config = loadConfig(env);
  const logger = createLogger("index-backfill", "warn");
  const db = openDb(config.DATABASE_PATH);
  const embedder = createEmbedder(config);
  try {
    // The api migrates. Without it this would fail on the first query with a less clear message.
    assertMigrated(db);
    console.log(`embeddings: ${embedder.name} ${embedder.model}`);
    console.log(`database:   ${config.DATABASE_PATH}`);

    const result = await backfillIndex(
      { db, config, logger, embedder },
      { all: values.all === true },
    );

    for (const doc of result.indexed) {
      const flagged = doc.flagged > 0 ? `, ${doc.flagged} flagged and kept out of search` : "";
      console.log(`indexed  ${doc.id}  ${doc.name}  (${doc.chunks} chunks${flagged})`);
    }
    for (const doc of result.failed) {
      console.error(`failed   ${doc.id}  ${doc.name}  ${doc.error}`);
    }
    console.log(`\n${result.indexed.length} indexed, ${result.failed.length} failed`);
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    await embedder.close?.();
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
