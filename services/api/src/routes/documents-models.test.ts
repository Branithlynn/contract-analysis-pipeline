import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DocumentDetailSchema,
  DocumentSummarySchema,
  ErrorBodySchema,
  ModelsResponseSchema,
  type ExtractionResult,
  type UploadResponse,
} from "@nexus/shared";
import {
  createDocument,
  createLogger,
  failRun,
  getDocument,
  insertExtraction,
  listEvents,
  loadConfig,
  migrate,
  MockEmbedder,
  openMemoryDb,
  transitionStatus,
  type Db,
  type ModelSelection,
} from "@nexus/shared/node";
import type { JobQueue } from "../queue.js";
import { buildServer } from "../server.js";
import { docId, extractionResult, offlineModels } from "../test-support/fixtures.js";
import { multipart, pdf } from "../test-support/upload.js";

// Model selection on upload, retry and reanalysis, and what the detail says about runs.

const OLLAMA: ModelSelection = { provider: "ollama", model: "qwen2.5:7b-instruct" };
const MOCK: ModelSelection = { provider: "mock", model: "mock" };
const MOCK_ALT: ModelSelection = { provider: "mock", model: "mock-alt" };
const GPT: ModelSelection = { provider: "openai", model: "gpt-5-mini" };
const PROMPT = "extract.v3";

// The mock is allowed and openai has a key. Anthropic has none, and ollama does not answer.
const ENV = {
  ALLOW_MOCK: "true",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODELS: "gpt-5-mini,gpt-5",
};

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

let uploadDir: string;
let db: Db;

beforeEach(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), "nexus-models-"));
  db = openMemoryDb();
  migrate(db);
});

afterEach(async () => {
  db.close();
  await rm(uploadDir, { recursive: true, force: true });
});

async function setup(env: Record<string, string> = ENV) {
  const enqueued: { id: string; run: number; model: ModelSelection }[] = [];
  const queue: JobQueue = {
    enqueue: (id, run, model) => {
      enqueued.push({ id, run, model });
      return Promise.resolve();
    },
    ping: () => Promise.resolve(),
    isReady: () => true,
    activeLocalJobs: () => Promise.resolve(0),
    onReady: () => () => undefined,
    close: () => Promise.resolve(),
  };
  const app = await buildServer({
    db,
    queue,
    config: loadConfig({ UPLOAD_DIR: uploadDir, ...env }),
    logger: createLogger("api", "silent"),
    embedder: new MockEmbedder(),
    models: offlineModels(env),
    clock: () => new Date("2026-06-01T12:00:00Z"),
  });
  const upload = async (content: Buffer, query = "") => {
    const res = await app.inject({
      method: "POST",
      url: `/api/documents${query}`,
      ...multipart([{ filename: "contract.pdf", content }]),
    });
    return { status: res.statusCode, body: res.json<UploadResponse>(), raw: res };
  };
  const post = (path: string, body?: Record<string, unknown>) => {
    const url = `/api/documents/${path}`;
    return body === undefined
      ? app.inject({ method: "POST", url })
      : app.inject({ method: "POST", url, payload: body });
  };
  const detail = async (id: string, query = "") => {
    const res = await app.inject({ method: "GET", url: `/api/documents/${id}${query}` });
    return { status: res.statusCode, res, body: () => DocumentDetailSchema.parse(res.json()) };
  };
  return { app, upload, post, detail, enqueued };
}

// A document that finished one run with this model. Returns the extraction id.
function addCompleted(
  n: number,
  content: Buffer,
  model: ModelSelection,
  opts: { prompt?: string; needsReview?: boolean; vendor?: string } = {},
): string {
  createDocument(db, {
    id: docId(n),
    original_name: `doc-${String(n)}.pdf`,
    mime: "application/pdf",
    size_bytes: content.length,
    sha256: sha(content),
    storage_path: `${docId(n)}.pdf`,
    status: "queued",
    model,
  });
  transitionStatus(db, docId(n), "processing", { from: "queued", bumpAttempts: true });
  transitionStatus(db, docId(n), "completed", {
    from: "processing",
    needs_review: opts.needsReview ?? false,
  });
  return addRun(n, 1, model, opts);
}

function addRun(
  n: number,
  run: number,
  model: ModelSelection,
  opts: { prompt?: string; vendor?: string } = {},
): string {
  const result: ExtractionResult = extractionResult();
  if (opts.vendor !== undefined) result.vendor_name = { ...result.vendor_name, value: opts.vendor };
  return insertExtraction(db, {
    document_id: docId(n),
    run,
    provider: model.provider,
    model: model.model,
    prompt_version: opts.prompt ?? PROMPT,
    result,
    grounding_score: 0.9,
    chunk_count: 1,
    input_tokens: 10,
    output_tokens: 20,
    duration_ms: 30,
  });
}

describe("GET /api/models", () => {
  it("lists every provider with availability, reason and models, and the default", async () => {
    const { app } = await setup();

    const res = await app.inject({ method: "GET", url: "/api/models" });

    expect(res.statusCode).toBe(200);
    expect(ModelsResponseSchema.parse(res.json())).toEqual({
      default: OLLAMA,
      providers: [
        {
          provider: "ollama",
          available: false,
          reason: "Ollama is not reachable at localhost:11434",
          models: [],
        },
        { provider: "openai", available: true, reason: null, models: ["gpt-5-mini", "gpt-5"] },
        {
          provider: "anthropic",
          available: false,
          reason: "ANTHROPIC_API_KEY is not set",
          models: ["claude-sonnet-5-5"],
        },
        { provider: "mock", available: true, reason: null, models: ["mock", "mock-alt"] },
      ],
    });
    expect(res.body).not.toContain(ENV.OPENAI_API_KEY);
  });
});

describe("POST /api/documents with a model", () => {
  it("stores the selection on the document and puts it in the job", async () => {
    const { upload, enqueued } = await setup();

    const { status, body } = await upload(pdf(), "?provider=openai&model=gpt-5-mini");

    expect(status).toBe(202);
    const id = body.accepted[0]?.id ?? "";
    expect(getDocument(db, id)).toMatchObject({
      status: "queued",
      run: 1,
      llm_provider: "openai",
      llm_model: "gpt-5-mini",
    });
    expect(enqueued).toEqual([{ id, run: 1, model: GPT }]);
  });

  it("uses the default from the environment when no model is named, without checking it", async () => {
    // The default is ollama and ollama is down. As before model selection, the upload is taken
    // and the job gets its retries.
    const { upload, enqueued } = await setup();

    const { status, body } = await upload(pdf());

    expect(status).toBe(202);
    const id = body.accepted[0]?.id ?? "";
    expect(getDocument(db, id)).toMatchObject({
      llm_provider: "ollama",
      llm_model: "qwen2.5:7b-instruct",
    });
    expect(enqueued).toEqual([{ id, run: 1, model: OLLAMA }]);
  });

  it.each([
    ["?provider=anthropic&model=claude-sonnet-5-5", "ANTHROPIC_API_KEY is not set"],
    ["?provider=ollama&model=qwen2.5:7b-instruct", "Ollama is not reachable at localhost:11434"],
    ["?provider=openai&model=gpt-5-pro", "Model gpt-5-pro is not in OPENAI_MODELS"],
    ["?provider=mock&model=gpt-5-mini", "Model gpt-5-mini is not a mock model"],
  ])("answers 400 with the reason for %s and stores nothing", async (query, reason) => {
    const { upload, enqueued } = await setup();

    const { status, raw } = await upload(pdf(), query);

    expect(status).toBe(400);
    expect(ErrorBodySchema.parse(raw.json()).error).toEqual({
      code: "MODEL_UNAVAILABLE",
      message: reason,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
    expect(enqueued).toEqual([]);
    expect(await readdir(uploadDir)).toEqual([]);
  });

  it("refuses the mock when ALLOW_MOCK is not true", async () => {
    const { upload } = await setup({ OPENAI_API_KEY: "test-openai-key" });

    const { status, raw } = await upload(pdf(), "?provider=mock&model=mock");

    expect(status).toBe(400);
    expect(ErrorBodySchema.parse(raw.json()).error.message).toBe(
      "The mock provider is off (ALLOW_MOCK is not true)",
    );
  });

  it.each([
    "?provider=openai",
    "?model=gpt-5-mini",
    "?provider=gemini&model=x",
    "?provider=openai&model=",
  ])("answers 400 for half a selection or an unknown provider: %s", async (query) => {
    const { upload, enqueued } = await setup();

    const { status, raw } = await upload(pdf(), query);

    expect(status).toBe(400);
    expect(ErrorBodySchema.parse(raw.json()).error.code).toBe("VALIDATION_ERROR");
    expect(enqueued).toEqual([]);
  });
});

describe("dedupe key: file, model and prompt version", () => {
  const content = pdf(300);

  it("reuses the result when the same file is uploaded for the same model and prompt", async () => {
    const extractionId = addCompleted(1, content, MOCK);
    const { upload, enqueued } = await setup();

    const { body } = await upload(content, "?provider=mock&model=mock");

    expect(body.accepted[0]).toMatchObject({ status: "completed", duplicate_of: docId(1) });
    expect(getDocument(db, body.accepted[0]?.id ?? "")).toMatchObject({
      latest_extraction_id: extractionId,
      llm_provider: "mock",
      llm_model: "mock",
    });
    expect(enqueued).toEqual([]);
  });

  it("analyzes the same file again for another model of the same provider", async () => {
    addCompleted(1, content, MOCK);
    const { upload, enqueued } = await setup();

    const { body } = await upload(content, "?provider=mock&model=mock-alt");

    expect(body.accepted[0]).toMatchObject({ status: "queued", duplicate_of: null });
    expect(enqueued).toMatchObject([{ run: 1, model: MOCK_ALT }]);
  });

  it("analyzes the same file again for another provider", async () => {
    addCompleted(1, content, MOCK);
    const { upload, enqueued } = await setup();

    const { body } = await upload(content, "?provider=openai&model=gpt-5-mini");

    expect(body.accepted[0]).toMatchObject({ status: "queued", duplicate_of: null });
    expect(enqueued).toMatchObject([{ model: GPT }]);
  });

  it("analyzes the same file again when the result is from another prompt version", async () => {
    addCompleted(1, content, MOCK, { prompt: "extract.v2" });
    const { upload, enqueued } = await setup();

    const { body } = await upload(content, "?provider=mock&model=mock");

    expect(body.accepted[0]).toMatchObject({ status: "queued", duplicate_of: null });
    expect(enqueued).toHaveLength(1);
  });

  it("matches on the default selection for an upload without a model", async () => {
    addCompleted(1, content, MOCK);
    addCompleted(2, content, OLLAMA);
    const { upload, enqueued } = await setup();

    const { body } = await upload(content);

    // The ollama result, not the newer-or-older mock one.
    expect(body.accepted[0]).toMatchObject({ status: "completed", duplicate_of: docId(2) });
    expect(enqueued).toEqual([]);
  });

  it("does not reuse a result that needs review, as before", async () => {
    addCompleted(1, content, MOCK, { needsReview: true });
    const { upload } = await setup();

    const { body } = await upload(content, "?provider=mock&model=mock");

    expect(body.accepted[0]).toMatchObject({ status: "queued", duplicate_of: null });
  });

  it("goes by the latest run of a document: after a reanalysis the older model no longer matches", async () => {
    addCompleted(1, content, MOCK);
    const second = addRun(1, 2, MOCK_ALT);
    db.prepare("UPDATE documents SET run = 2 WHERE id = ?").run(docId(1));
    const { upload } = await setup();

    const older = await upload(content, "?provider=mock&model=mock");
    const newer = await upload(content, "?provider=mock&model=mock-alt");

    expect(older.body.accepted[0]).toMatchObject({ status: "queued", duplicate_of: null });
    expect(newer.body.accepted[0]).toMatchObject({ status: "completed", duplicate_of: docId(1) });
    expect(getDocument(db, newer.body.accepted[0]?.id ?? "")?.latest_extraction_id).toBe(second);
  });
});

describe("POST /api/documents/:id/retry with a model", () => {
  function addFailed(model: ModelSelection | null) {
    createDocument(db, {
      id: docId(1),
      original_name: "a.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: "s",
      storage_path: "a.pdf",
      status: "queued",
      model,
    });
    transitionStatus(db, docId(1), "processing", { from: "queued", bumpAttempts: true });
    transitionStatus(db, docId(1), "failed", {
      from: "processing",
      error_code: "LLM_UNAVAILABLE",
      error_message: "down",
    });
  }

  it("keeps the model the document had when the body names none", async () => {
    addFailed(GPT);
    const { post, enqueued } = await setup();

    expect((await post(`${docId(1)}/retry`)).statusCode).toBe(202);

    expect(getDocument(db, docId(1))).toMatchObject({ run: 2, llm_model: "gpt-5-mini" });
    expect(enqueued).toEqual([{ id: docId(1), run: 2, model: GPT }]);
  });

  it("falls back to the default for a document from before a model could be chosen", async () => {
    addFailed(null);
    const { post, enqueued } = await setup();

    await post(`${docId(1)}/retry`);

    expect(enqueued).toEqual([{ id: docId(1), run: 2, model: OLLAMA }]);
    expect(getDocument(db, docId(1))).toMatchObject({ llm_provider: "ollama" });
  });

  it("switches to the model in the body", async () => {
    addFailed(OLLAMA);
    const { post, enqueued } = await setup();

    const res = await post(`${docId(1)}/retry`, MOCK_ALT);

    expect(res.statusCode).toBe(202);
    expect(getDocument(db, docId(1))).toMatchObject({
      status: "queued",
      run: 2,
      llm_provider: "mock",
      llm_model: "mock-alt",
    });
    expect(enqueued).toEqual([{ id: docId(1), run: 2, model: MOCK_ALT }]);
  });

  it("answers 400 and leaves the document failed when the model in the body is unavailable", async () => {
    addFailed(OLLAMA);
    const { post, enqueued } = await setup();

    const res = await post(`${docId(1)}/retry`, {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });

    expect(res.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(res.json()).error).toEqual({
      code: "MODEL_UNAVAILABLE",
      message: "ANTHROPIC_API_KEY is not set",
    });
    expect(getDocument(db, docId(1))).toMatchObject({ status: "failed", run: 1 });
    expect(enqueued).toEqual([]);
  });
});

describe("POST /api/documents/:id/reanalyze", () => {
  const content = pdf(250);

  it("queues a new run with the other model and keeps the old extraction", async () => {
    const first = addCompleted(1, content, MOCK);
    const { post, enqueued } = await setup();

    const res = await post(`${docId(1)}/reanalyze`, GPT);

    expect(res.statusCode).toBe(202);
    expect(DocumentSummarySchema.parse(res.json())).toMatchObject({
      id: docId(1),
      status: "queued",
    });
    expect(getDocument(db, docId(1))).toMatchObject({
      status: "queued",
      run: 2,
      attempts: 0,
      needs_review: 0,
      llm_provider: "openai",
      llm_model: "gpt-5-mini",
      // Still the first run's, until the second one finishes.
      latest_extraction_id: first,
    });
    expect(enqueued).toEqual([{ id: docId(1), run: 2, model: GPT }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM extractions").get()).toEqual({ n: 1 });
    expect(listEvents(db, docId(1)).at(-1)).toMatchObject({
      run: 2,
      stage: "queue",
      outcome: "info",
      message: "reanalysis with openai / gpt-5-mini",
    });
  });

  it("works on a document that completed without needing review, which retry refuses", async () => {
    addCompleted(1, content, MOCK);
    const { post } = await setup();

    expect((await post(`${docId(1)}/retry`)).statusCode).toBe(409);
    expect((await post(`${docId(1)}/reanalyze`, MOCK_ALT)).statusCode).toBe(202);
  });

  it("works on a failed document", async () => {
    addCompleted(1, content, MOCK);
    transitionStatus(db, docId(1), "queued", { from: "completed", bumpRun: true });
    transitionStatus(db, docId(1), "processing", { from: "queued" });
    transitionStatus(db, docId(1), "failed", {
      from: "processing",
      error_code: "LLM_AUTH",
      error_message: "bad key",
    });
    const { post, enqueued } = await setup();

    expect((await post(`${docId(1)}/reanalyze`, MOCK_ALT)).statusCode).toBe(202);

    expect(getDocument(db, docId(1))).toMatchObject({ status: "queued", run: 3, error_code: null });
    expect(enqueued).toEqual([{ id: docId(1), run: 3, model: MOCK_ALT }]);
  });

  it("answers 409 while the document is queued or processing", async () => {
    addCompleted(1, content, MOCK);
    transitionStatus(db, docId(1), "queued", { from: "completed", bumpRun: true });
    const { post, enqueued } = await setup();

    const queued = await post(`${docId(1)}/reanalyze`, MOCK_ALT);
    transitionStatus(db, docId(1), "processing", { from: "queued" });
    const processing = await post(`${docId(1)}/reanalyze`, MOCK_ALT);

    for (const res of [queued, processing]) {
      expect(res.statusCode).toBe(409);
      expect(ErrorBodySchema.parse(res.json()).error.code).toBe("NOT_REANALYZABLE");
    }
    expect(enqueued).toEqual([]);
  });

  it("answers 400 with the reason for a model that is not available, and changes nothing", async () => {
    addCompleted(1, content, MOCK);
    const before = getDocument(db, docId(1));
    const { post, enqueued } = await setup();

    const res = await post(`${docId(1)}/reanalyze`, { provider: "openai", model: "gpt-5-pro" });

    expect(res.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(res.json()).error).toEqual({
      code: "MODEL_UNAVAILABLE",
      message: "Model gpt-5-pro is not in OPENAI_MODELS",
    });
    expect(getDocument(db, docId(1))).toEqual(before);
    expect(enqueued).toEqual([]);
  });

  it("needs provider and model in the body, and an existing document", async () => {
    addCompleted(1, content, MOCK);
    const { post } = await setup();

    expect((await post(`${docId(1)}/reanalyze`)).statusCode).toBe(400);
    expect((await post(`${docId(1)}/reanalyze`, { provider: "mock" })).statusCode).toBe(400);
    expect(
      (await post(`${docId(1)}/reanalyze`, { provider: "gemini", model: "x" })).statusCode,
    ).toBe(400);
    expect((await post(`${docId(9)}/reanalyze`, MOCK)).statusCode).toBe(404);
  });
});

describe("a completed document and a later run that fails", () => {
  const content = pdf(270);
  const QWEN: ModelSelection = { provider: "ollama", model: "qwen2.5:7b-instruct" };

  // The worker claims the queued run and it ends without a result.
  function failCurrentRun(code: "LLM_AUTH" | "LLM_UNAVAILABLE", message: string) {
    const doc = getDocument(db, docId(1));
    if (!doc || doc.llm_provider === null || doc.llm_model === null) throw new Error("no run");
    transitionStatus(db, docId(1), "processing", { from: "queued", bumpAttempts: true });
    return failRun(db, {
      documentId: docId(1),
      run: doc.run,
      model: { provider: doc.llm_provider, model: doc.llm_model },
      promptVersion: PROMPT,
      code,
      message,
    });
  }

  it("a reanalysis remembers the review state to go back to", async () => {
    addCompleted(1, content, MOCK, { needsReview: true });
    const { post } = await setup();

    await post(`${docId(1)}/reanalyze`, GPT);

    // The run itself starts without needing review, the fallback keeps what it was.
    expect(getDocument(db, docId(1))).toMatchObject({
      status: "queued",
      needs_review: 0,
      fallback_needs_review: 1,
    });
  });

  it("a retry of a completed document that needs review does the same", async () => {
    addCompleted(1, content, MOCK, { needsReview: true });
    const { post } = await setup();

    expect((await post(`${docId(1)}/retry`)).statusCode).toBe(202);

    expect(getDocument(db, docId(1))).toMatchObject({
      status: "queued",
      needs_review: 0,
      fallback_needs_review: 1,
    });
  });

  it("a failed retry leaves the document completed, needing review, with its extraction", async () => {
    const first = addCompleted(1, content, MOCK, { needsReview: true, vendor: "Run One Ltd" });
    const { post, detail, app } = await setup();
    await post(`${docId(1)}/retry`);

    expect(failCurrentRun("LLM_UNAVAILABLE", "provider is down")).toBe("kept_completed");

    const doc = (await detail(docId(1))).body();
    expect(doc).toMatchObject({
      status: "completed",
      needs_review: true,
      error_code: null,
      run: 2,
      vendor_name: "Run One Ltd",
    });
    expect(getDocument(db, docId(1))?.latest_extraction_id).toBe(first);
    expect(doc.runs).toMatchObject([
      { run: 2, status: "failed", error_code: "LLM_UNAVAILABLE", latest: false },
      { run: 1, status: "completed", latest: true },
    ]);
    expect(doc.events.at(-1)).toMatchObject({
      outcome: "error",
      message:
        "run 2 with mock / mock failed, the previous result is kept. LLM_UNAVAILABLE: provider is down",
    });
    // Still a completed document that needs review, so it can be retried again.
    expect((await post(`${docId(1)}/retry`)).statusCode).toBe(202);
    await app.close();
  });

  it("a new run of a failed document has nothing to go back to, from retry or from reanalyze", async () => {
    createDocument(db, {
      id: docId(1),
      original_name: "a.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: "s",
      storage_path: "a.pdf",
      status: "queued",
      model: GPT,
    });
    expect(failCurrentRun("LLM_AUTH", "bad key")).toBe("failed");
    const { post } = await setup();

    await post(`${docId(1)}/retry`);
    expect(getDocument(db, docId(1))).toMatchObject({
      status: "queued",
      fallback_needs_review: null,
    });
    // It fails again: failed, as today.
    expect(failCurrentRun("LLM_AUTH", "bad key")).toBe("failed");
    expect(getDocument(db, docId(1))).toMatchObject({ status: "failed", run: 2 });

    await post(`${docId(1)}/reanalyze`, MOCK);
    expect(getDocument(db, docId(1))?.fallback_needs_review).toBeNull();
    expect(failCurrentRun("LLM_AUTH", "bad key")).toBe("failed");
    expect(getDocument(db, docId(1))).toMatchObject({ status: "failed", run: 3 });
  });

  it("after a failed reanalysis with gpt-5-mini the row still shows the qwen values, labelled qwen", async () => {
    const first = addCompleted(1, content, QWEN, { vendor: "Qwen Vendor Ltd" });
    const { post, detail, app } = await setup();
    const row = async () => {
      const res = await app.inject({ method: "GET", url: "/api/documents" });
      const [summary] = DocumentSummarySchema.array().parse(res.json());
      if (!summary) throw new Error("no row");
      return summary;
    };
    expect(await row()).toMatchObject({
      vendor_name: "Qwen Vendor Ltd",
      result_provider: "ollama",
      result_model: "qwen2.5:7b-instruct",
      result_prompt_version: PROMPT,
      requested_provider: "ollama",
      requested_model: "qwen2.5:7b-instruct",
    });

    // While the gpt run is queued the row already says what was asked for, and still shows and
    // labels what it has.
    const queued = await post(`${docId(1)}/reanalyze`, GPT);
    expect(DocumentSummarySchema.parse(queued.json())).toMatchObject({
      status: "queued",
      requested_model: "gpt-5-mini",
      // The answer to the request carries no values, so no label either.
      vendor_name: null,
      result_model: null,
    });
    expect(await row()).toMatchObject({
      status: "queued",
      vendor_name: "Qwen Vendor Ltd",
      result_model: "qwen2.5:7b-instruct",
      requested_model: "gpt-5-mini",
    });

    expect(failCurrentRun("LLM_AUTH", "Incorrect API key provided")).toBe("kept_completed");

    const after = await row();
    expect(after).toMatchObject({
      status: "completed",
      error_code: null,
      vendor_name: "Qwen Vendor Ltd",
      // The chip: the model that produced the values on the row.
      result_provider: "ollama",
      result_model: "qwen2.5:7b-instruct",
      result_prompt_version: PROMPT,
      // What the last run was asked to use, kept apart.
      requested_provider: "openai",
      requested_model: "gpt-5-mini",
    });
    expect(getDocument(db, docId(1))?.latest_extraction_id).toBe(first);

    const doc = (await detail(docId(1))).body();
    expect(doc).toMatchObject({
      status: "completed",
      vendor_name: "Qwen Vendor Ltd",
      result_provider: "ollama",
      result_model: "qwen2.5:7b-instruct",
      requested_provider: "openai",
      requested_model: "gpt-5-mini",
    });
    expect(doc.extraction).toMatchObject({ provider: "ollama", model: "qwen2.5:7b-instruct" });
    expect(doc.runs).toEqual([
      {
        run: 2,
        status: "failed",
        error_code: "LLM_AUTH",
        error_message: "Incorrect API key provided",
        provider: "openai",
        model: "gpt-5-mini",
        prompt_version: PROMPT,
        grounding_score: null,
        chunk_count: null,
        input_tokens: null,
        output_tokens: null,
        duration_ms: null,
        created_at: expect.any(String) as string,
        latest: false,
      },
      expect.objectContaining({
        run: 1,
        status: "completed",
        model: "qwen2.5:7b-instruct",
        latest: true,
      }),
    ]);
    expect(doc.events.at(-1)).toMatchObject({
      stage: "job",
      outcome: "error",
      message:
        "run 2 with openai / gpt-5-mini failed, the previous result is kept. LLM_AUTH: Incorrect API key provided",
    });
    // A failed run has no extraction to show.
    expect((await detail(docId(1), "?run=2")).status).toBe(404);
    expect((await detail(docId(1), "?run=1")).status).toBe(200);
  });

  it("labels the values with the new model once a reanalysis works", async () => {
    addCompleted(1, content, QWEN, { vendor: "Qwen Vendor Ltd" });
    const { post, app } = await setup();
    await post(`${docId(1)}/reanalyze`, GPT);
    // The worker finishes the run: a second extraction, and the document points at it.
    transitionStatus(db, docId(1), "processing", { from: "queued" });
    transitionStatus(db, docId(1), "completed", { from: "processing" });
    addRun(1, 2, GPT, { vendor: "Gpt Vendor Ltd" });

    const res = await app.inject({ method: "GET", url: "/api/documents" });
    const [row] = DocumentSummarySchema.array().parse(res.json());

    expect(row).toMatchObject({
      vendor_name: "Gpt Vendor Ltd",
      result_provider: "openai",
      result_model: "gpt-5-mini",
      requested_model: "gpt-5-mini",
    });
  });

  it("labels an older run with its own model when the detail is asked for that run", async () => {
    addCompleted(1, content, QWEN, { vendor: "Qwen Vendor Ltd" });
    addRun(1, 2, GPT, { vendor: "Gpt Vendor Ltd", prompt: "extract.v2" });
    db.prepare(
      "UPDATE documents SET run = 2, llm_provider = 'openai', llm_model = 'gpt-5-mini'",
    ).run();
    const { detail } = await setup();

    expect((await detail(docId(1))).body()).toMatchObject({
      vendor_name: "Gpt Vendor Ltd",
      result_model: "gpt-5-mini",
      result_prompt_version: "extract.v2",
    });
    expect((await detail(docId(1), "?run=1")).body()).toMatchObject({
      vendor_name: "Qwen Vendor Ltd",
      result_provider: "ollama",
      result_model: "qwen2.5:7b-instruct",
      result_prompt_version: PROMPT,
      // The request does not change with the run that is shown.
      requested_model: "gpt-5-mini",
    });
  });

  it("has no result label without values: queued, failed, or a stored result that cannot be read", async () => {
    createDocument(db, {
      id: docId(1),
      original_name: "a.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: "s",
      storage_path: "a.pdf",
      status: "queued",
      model: GPT,
    });
    const { app } = await setup();
    const row = async () => {
      const res = await app.inject({ method: "GET", url: "/api/documents" });
      return DocumentSummarySchema.array().parse(res.json())[0];
    };
    const unlabelled = { result_provider: null, result_model: null, result_prompt_version: null };

    expect(await row()).toMatchObject({ ...unlabelled, requested_model: "gpt-5-mini" });
    failCurrentRun("LLM_AUTH", "bad key");
    expect(await row()).toMatchObject({ status: "failed", ...unlabelled });

    // A completed document whose stored json is broken shows no values, so it gets no label.
    db.prepare("UPDATE documents SET status = 'completed', error_code = NULL").run();
    const broken = addRun(1, 2, QWEN);
    db.prepare("UPDATE extractions SET result_json = '{not json' WHERE id = ?").run(broken);
    expect(await row()).toMatchObject({ status: "completed", vendor_name: null, ...unlabelled });
  });

  it("lists the failed run of a document that failed in the ordinary way too", async () => {
    createDocument(db, {
      id: docId(1),
      original_name: "a.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: "s",
      storage_path: "a.pdf",
      status: "queued",
      model: GPT,
    });
    transitionStatus(db, docId(1), "processing", { from: "queued" });
    expect(
      failRun(db, {
        documentId: docId(1),
        run: 1,
        model: GPT,
        promptVersion: PROMPT,
        code: "NO_TEXT_LAYER",
        message: "PDF has no extractable text",
      }),
    ).toBe("failed");
    const { detail } = await setup();

    const doc = (await detail(docId(1))).body();

    expect(doc).toMatchObject({ status: "failed", error_code: "NO_TEXT_LAYER", extraction: null });
    expect(doc.runs).toMatchObject([
      { run: 1, status: "failed", error_code: "NO_TEXT_LAYER", latest: false },
    ]);
  });
});

describe("GET /api/documents/:id runs", () => {
  const content = pdf(260);

  it("lists every finished run with provider, model and prompt version, newest first", async () => {
    addCompleted(1, content, MOCK, { vendor: "Run One Ltd" });
    db.prepare("UPDATE extractions SET created_at = '2026-05-01T10:00:00.000Z'").run();
    addRun(1, 2, GPT, { vendor: "Run Two Ltd", prompt: "extract.v2" });
    db.prepare(
      "UPDATE documents SET run = 2, llm_provider = 'openai', llm_model = 'gpt-5-mini'",
    ).run();
    const { detail } = await setup();

    const doc = (await detail(docId(1))).body();

    expect(doc.runs).toEqual([
      {
        run: 2,
        status: "completed",
        error_code: null,
        error_message: null,
        provider: "openai",
        model: "gpt-5-mini",
        prompt_version: "extract.v2",
        grounding_score: 0.9,
        chunk_count: 1,
        input_tokens: 10,
        output_tokens: 20,
        duration_ms: 30,
        created_at: expect.any(String) as string,
        latest: true,
      },
      expect.objectContaining({
        run: 1,
        provider: "mock",
        model: "mock",
        prompt_version: "extract.v3",
        latest: false,
      }),
    ]);
    // The document's own values are the latest run's.
    expect(doc).toMatchObject({
      vendor_name: "Run Two Ltd",
      requested_provider: "openai",
      requested_model: "gpt-5-mini",
      result_provider: "openai",
      result_model: "gpt-5-mini",
      result_prompt_version: "extract.v2",
    });
    expect(doc.extraction).toMatchObject({ provider: "openai", model: "gpt-5-mini" });
  });

  it("shows an older run when asked for it, for comparing", async () => {
    addCompleted(1, content, MOCK, { vendor: "Run One Ltd" });
    addRun(1, 2, GPT, { vendor: "Run Two Ltd" });
    const { detail } = await setup();

    const first = (await detail(docId(1), "?run=1")).body();

    expect(first.vendor_name).toBe("Run One Ltd");
    expect(first.extraction).toMatchObject({ provider: "mock", model: "mock" });
    // The list is the same whichever run is shown.
    expect(first.runs.map((r) => r.run)).toEqual([2, 1]);
  });

  it("answers 404 for a run without an extraction and 400 for a run that is not a number", async () => {
    addCompleted(1, content, MOCK);
    const { detail } = await setup();

    const missing = await detail(docId(1), "?run=7");
    expect(missing.status).toBe(404);
    expect(ErrorBodySchema.parse(missing.res.json()).error.code).toBe("RUN_NOT_FOUND");
    expect((await detail(docId(1), "?run=first")).status).toBe(400);
  });

  it("has no runs for a document that is still queued, and the model it was asked to use", async () => {
    createDocument(db, {
      id: docId(1),
      original_name: "a.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: "s",
      storage_path: "a.pdf",
      status: "queued",
      model: MOCK_ALT,
    });
    const { detail } = await setup();

    const doc = (await detail(docId(1))).body();

    expect(doc).toMatchObject({
      runs: [],
      extraction: null,
      requested_provider: "mock",
      requested_model: "mock-alt",
    });
  });

  it("lists the reused run for a duplicate, which has none of its own", async () => {
    const extractionId = addCompleted(1, content, MOCK);
    createDocument(db, {
      id: docId(2),
      original_name: "copy.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: sha(content),
      storage_path: "copy.pdf",
      status: "completed",
      duplicate_of: docId(1),
      latest_extraction_id: extractionId,
      model: MOCK,
    });
    const { detail } = await setup();

    const doc = (await detail(docId(2))).body();

    expect(doc.runs).toMatchObject([{ run: 1, provider: "mock", model: "mock", latest: true }]);
  });
});
