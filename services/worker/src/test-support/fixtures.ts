import {
  createDocument,
  createLogger,
  loadConfig,
  migrate,
  openMemoryDb,
  type CreateDocumentInput,
} from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import { MockProvider } from "../llm/mock.js";

// Shared by the worker tests. Excluded from the build in tsconfig.json, typechecked via tsconfig.test.json.

export const NOW = new Date("2026-06-01T12:00:00Z");

export function docId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function makeDeps(env: Record<string, string> = {}) {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  const db = openMemoryDb();
  migrate(db);
  const deps: WorkerDeps = {
    db,
    config: loadConfig(env),
    logger: createLogger("worker", "debug", stream),
    provider: new MockProvider(),
    clock: () => NOW,
  };
  return { deps, lines };
}

export function seedDocument(deps: WorkerDeps, overrides: Partial<CreateDocumentInput> = {}) {
  const input: CreateDocumentInput = {
    id: docId(1),
    original_name: "contract.pdf",
    mime: "application/pdf",
    size_bytes: 1234,
    sha256: "a".repeat(64),
    storage_path: `${docId(1)}.pdf`,
    status: "queued",
    ...overrides,
  };
  createDocument(deps.db, input);
  return input.id;
}
