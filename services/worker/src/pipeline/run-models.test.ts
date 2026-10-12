import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDocument,
  getExtraction,
  listEvents,
  LlmError,
  type ModelSelection,
} from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import { createProviderRegistry } from "../llm/factory.js";
import { MockProvider } from "../llm/mock.js";
import { docId, makeDeps as makeBaseDeps, seedDocument } from "../test-support/fixtures.js";
import { makePdf } from "../test-support/pdf.js";
import { processJob, type ExtractJob } from "./run.js";

// The provider is built per job from what the job asks for.

const LINE = "The supplier shall provide the services described in this agreement";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-run-models-"));
  await writeFile(join(dir, `${docId(1)}.pdf`), await makePdf([[LINE], [LINE]]));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function job(data: unknown, attemptsMade = 0): ExtractJob {
  return { id: "job-1", data, attemptsMade, opts: { attempts: 3 } };
}

// Deps whose registry records what it was asked for and answers with a mock named after it.
function setup(env: Record<string, string> = {}) {
  const { deps: base, lines } = makeBaseDeps({ UPLOAD_DIR: dir, ...env });
  const asked: ModelSelection[] = [];
  const built: MockProvider[] = [];
  const deps: WorkerDeps = {
    ...base,
    providers: {
      get(selection) {
        asked.push(selection);
        const provider = new MockProvider(undefined, selection.model);
        Object.assign(provider, { name: selection.provider });
        built.push(provider);
        return provider;
      },
    },
  };
  return { deps, lines, asked, built };
}

describe("processJob: the model of the job", () => {
  it("builds the provider from the payload and stores that provider and model on the extraction", async () => {
    const { deps, asked, built } = setup();
    const id = seedDocument(deps, { model: { provider: "openai", model: "gpt-5-mini" } });

    await processJob(
      job({ documentId: id, run: 1, provider: "openai", model: "gpt-5-mini" }),
      deps,
    );

    expect(asked).toEqual([{ provider: "openai", model: "gpt-5-mini" }]);
    expect(built[0]?.calls.length).toBeGreaterThan(0);
    const doc = getDocument(deps.db, id);
    expect(doc).toMatchObject({ status: "completed" });
    expect(getExtraction(deps.db, doc?.latest_extraction_id ?? "")).toMatchObject({
      run: 1,
      provider: "openai",
      model: "gpt-5-mini",
      prompt_version: "extract.v3",
    });
  });

  it("gives two jobs with different models two different providers", async () => {
    const { deps, asked } = setup();
    const a = seedDocument(deps);
    const b = seedDocument(deps, {
      id: docId(2),
      sha256: "b".repeat(64),
      storage_path: `${docId(1)}.pdf`,
    });

    await processJob(
      job({ documentId: a, run: 1, provider: "anthropic", model: "claude-sonnet-5-5" }),
      deps,
    );
    await processJob(job({ documentId: b, run: 1, provider: "mock", model: "mock-alt" }), deps);

    expect(asked).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5-5" },
      { provider: "mock", model: "mock-alt" },
    ]);
    const models = [a, b].map(
      (id) => getExtraction(deps.db, getDocument(deps.db, id)?.latest_extraction_id ?? "")?.model,
    );
    expect(models).toEqual(["claude-sonnet-5-5", "mock-alt"]);
  });

  it("falls back to the document row for a job that carries no model", async () => {
    const { deps, asked } = setup();
    const id = seedDocument(deps, { model: { provider: "mock", model: "mock-alt" } });

    await processJob(job({ documentId: id, run: 1 }), deps);

    expect(asked).toEqual([{ provider: "mock", model: "mock-alt" }]);
  });

  it("falls back to LLM_PROVIDER / LLM_MODEL when neither the job nor the row has a model", async () => {
    const { deps, asked } = setup({ LLM_MODEL: "llama3.2:3b" });
    const id = seedDocument(deps);
    expect(getDocument(deps.db, id)).toMatchObject({ llm_provider: null, llm_model: null });

    await processJob(job({ documentId: id, run: 1 }), deps);

    expect(asked).toEqual([{ provider: "ollama", model: "llama3.2:3b" }]);
    const doc = getDocument(deps.db, id);
    expect(getExtraction(deps.db, doc?.latest_extraction_id ?? "")).toMatchObject({
      provider: "ollama",
      model: "llama3.2:3b",
    });
  });

  it("logs which model and queue a job runs with", async () => {
    const { deps, lines } = setup();
    const id = seedDocument(deps);

    await processJob(
      job({ documentId: id, run: 1, provider: "mock", model: "mock" }),
      deps,
      "hosted",
    );

    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: "job started",
        documentId: id,
        provider: "mock",
        model: "mock",
        queue: "hosted",
      }),
    );
  });
});

describe("processJob: a model the worker cannot serve", () => {
  it("fails the document once with LLM_AUTH when the worker has no key for the provider", async () => {
    const { deps: base } = makeBaseDeps({ UPLOAD_DIR: dir });
    // The real registry on a config without keys.
    const deps: WorkerDeps = { ...base, providers: createProviderRegistry(base.config) };
    const id = seedDocument(deps);

    const err = await processJob(
      job({ documentId: id, run: 1, provider: "openai", model: "gpt-5-mini" }),
      deps,
    ).catch((e: unknown) => e);

    // Unrecoverable: bullmq does not spend the other two attempts on a missing key.
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: "LLM_AUTH",
      error_message: "OPENAI_API_KEY is not set for the worker",
      attempts: 1,
    });
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM extractions").get()).toEqual({ n: 0 });
  });

  it("fails the document when the job names a hosted model outside the allowlist", async () => {
    const { deps: base } = makeBaseDeps({ UPLOAD_DIR: dir, OPENAI_API_KEY: "test-openai-key" });
    const deps: WorkerDeps = { ...base, providers: createProviderRegistry(base.config) };
    const id = seedDocument(deps);

    await expect(
      processJob(job({ documentId: id, run: 1, provider: "openai", model: "gpt-5-pro" }), deps),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_message: "Model gpt-5-pro is not in OPENAI_MODELS",
    });
  });

  it("retries when the provider itself is unavailable, as before", async () => {
    const { deps: base } = makeBaseDeps({ UPLOAD_DIR: dir });
    const deps: WorkerDeps = {
      ...base,
      providers: {
        get: () => ({
          name: "ollama",
          model: "qwen2.5:7b-instruct",
          complete: () => Promise.reject(new LlmError("unavailable", "Cannot reach Ollama")),
        }),
      },
    };
    const id = seedDocument(deps);

    await expect(processJob(job({ documentId: id, run: 1 }), deps)).rejects.toBeInstanceOf(
      LlmError,
    );

    expect(getDocument(deps.db, id)).toMatchObject({ status: "processing" });
    expect(listEvents(deps.db, id).at(-1)).toMatchObject({ outcome: "retry" });
  });
});

describe("processJob: the queue a job arrived on", () => {
  it("refuses an ollama job on the hosted queue, where it could run next to another one", async () => {
    const { deps, asked } = setup();
    const id = seedDocument(deps);

    await expect(
      processJob(
        job({ documentId: id, run: 1, provider: "ollama", model: "qwen2.5:7b-instruct" }),
        deps,
        "hosted",
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    // No provider was built and no call made.
    expect(asked).toEqual([]);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: "INTERNAL",
      error_message: "A ollama job arrived on the hosted queue",
    });
  });

  it("refuses a hosted job on the local queue too", async () => {
    const { deps, asked } = setup();
    const id = seedDocument(deps);

    await expect(
      processJob(
        job({ documentId: id, run: 1, provider: "openai", model: "gpt-5-mini" }),
        deps,
        "local",
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(asked).toEqual([]);
  });

  it("runs an ollama job on the local queue and a hosted or mock job on the hosted queue", async () => {
    const { deps, asked } = setup();
    const a = seedDocument(deps);
    const b = seedDocument(deps, {
      id: docId(2),
      sha256: "b".repeat(64),
      storage_path: `${docId(1)}.pdf`,
    });

    await processJob(
      job({ documentId: a, run: 1, provider: "ollama", model: "qwen2.5:7b-instruct" }),
      deps,
      "local",
    );
    await processJob(
      job({ documentId: b, run: 1, provider: "mock", model: "mock" }),
      deps,
      "hosted",
    );

    expect(asked.map((s) => s.provider)).toEqual(["ollama", "mock"]);
    expect(getDocument(deps.db, a)?.status).toBe("completed");
    expect(getDocument(deps.db, b)?.status).toBe("completed");
  });
});
