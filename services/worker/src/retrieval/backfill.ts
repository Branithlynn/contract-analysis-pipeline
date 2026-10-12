import { resolve } from "node:path";
import { listDocumentsToIndex, setIndexStatus } from "@nexus/shared/node";
import { parseDocument } from "../parse/index.js";
import { classifyError } from "../pipeline/errors.js";
import { eventMessage } from "../pipeline/stage.js";
import { indexDocument, type IndexDeps } from "./index-document.js";

export interface BackfillResult {
  indexed: { id: string; name: string; chunks: number; flagged: number }[];
  failed: { id: string; name: string; error: string }[];
}

// Builds the index for completed documents that have none for the current embedding model: the
// ones processed before the index existed, the ones whose indexing failed, and the ones indexed
// with another model. The parsed text is not stored anywhere, so each file is parsed again.
// No llm call and no change to the extraction. One document failing does not stop the rest.
export async function backfillIndex(deps: IndexDeps): Promise<BackfillResult> {
  const { db, config, logger, embedder } = deps;
  const result: BackfillResult = { indexed: [], failed: [] };

  for (const doc of listDocumentsToIndex(db, embedder.model)) {
    const log = logger.child({ documentId: doc.id });
    try {
      const path = resolve(config.UPLOAD_DIR, doc.storage_path);
      const parsed = await parseDocument(path, doc.mime, log);
      const summary = await indexDocument({ ...deps, logger: log }, doc.id, parsed.text);
      setIndexStatus(db, doc.id, "indexed");
      log.info({ ...summary }, "document indexed");
      result.indexed.push({
        id: doc.id,
        name: doc.original_name,
        chunks: summary.chunks,
        flagged: summary.flagged,
      });
    } catch (err) {
      const { code, message } = classifyError(err);
      const error = eventMessage(`${code}: ${message}`);
      setIndexStatus(db, doc.id, "failed", error);
      log.warn({ code, err }, "could not index the document");
      result.failed.push({ id: doc.id, name: doc.original_name, error });
    }
  }
  return result;
}
