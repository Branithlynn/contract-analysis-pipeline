// The unit tests cover the logic with a fake queue. This one proves the wiring between the parts:
// http -> real bullmq on a real redis -> worker -> db. Run it with `npm run test:e2e`.
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Queue, type Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DocumentDetailSchema,
  UploadResponseSchema,
  type DocumentDetail,
  type LlmExtraction,
} from "@nexus/shared";
import {
  QUEUE_NAME,
  assertMigrated,
  createLogger,
  jobIdFor,
  loadConfig,
  migrate,
  openDb,
  type Db,
} from "@nexus/shared/node";
import { BullMqJobQueue } from "../../services/api/src/queue.js";
import { buildServer } from "../../services/api/src/server.js";
import type { WorkerDeps } from "../../services/worker/src/deps.js";
import { LlmError } from "../../services/worker/src/llm/errors.js";
import { MockProvider } from "../../services/worker/src/llm/mock.js";
import { createWorker } from "../../services/worker/src/worker.js";

const SAMPLES = fileURLToPath(new URL("../../samples/generated/", import.meta.url));
// The day the expected dates in evals/cases were worked out for.
const CLOCK = () => new Date("2026-10-09T12:00:00Z");
const POLL_MS = 200;
const WAIT_MS = 20_000;

const high = <T>(value: T, quote: string) => ({ value, quote, confidence: "high" as const });

// What a model that reads saas-subscription correctly would reply. Every quote is copied exactly
// from samples/source/saas-subscription.ts, so the quote check finds all of them: grounding is 1
// and nothing sends the document to review. The dedupe step depends on that.
const SAAS_REPLY: LlmExtraction = {
  document_type: high("contract", "Software as a Service Subscription Agreement"),
  vendor_name: high(
    "Cloudhaven Software Ltd.",
    "Cloudhaven Software Ltd., a company incorporated in England (the Vendor)",
  ),
  customer_name: high("Nexus Corp", "Nexus Corp, a Delaware corporation (the Customer)"),
  payment_terms: high("Net 30", "Payment terms are Net 30 from the date of invoice."),
  governing_law: high("England and Wales", "governed by the laws of England and Wales"),
  liability_cap: high(
    "the Fees paid or payable by Customer in the 12 months preceding the claim",
    "limited to the Fees paid or payable by Customer in the 12 months preceding the claim",
  ),
  effective_date: high("2025-01-15", "effective as of 15 January 2025 (the Effective Date)"),
  expiration_date: { value: null, quote: "", confidence: "low" },
  initial_term_months: high(12, "continues for an initial term of 12 months (the Initial Term)"),
  renewal_term_months: high(12, "renews automatically for successive terms of 12 months"),
  termination_notice_days: high(
    60,
    "at least 60 days written notice before the end of the then current term",
  ),
  auto_renewal: high(true, "this Agreement renews automatically for successive terms of 12 months"),
  total_contract_value: high(
    { amount: 84000, currency: "EUR" },
    "The total fees for the Initial Term are EUR 84,000.",
  ),
  risk_clauses: [
    {
      category: "auto_renewal",
      severity: "medium",
      title: "Automatic renewal",
      explanation: "Renews for a year unless Nexus Corp gives notice in time.",
      quote: "this Agreement renews automatically for successive terms of 12 months",
    },
    {
      category: "unilateral_price_increase",
      severity: "medium",
      title: "Price increase on renewal",
      explanation: "The vendor can raise the price at each renewal without agreement.",
      quote: "Vendor may increase the Fees by up to 9% upon each renewal.",
    },
  ],
  summary:
    "Cloudhaven Software Ltd. provides a hosted spend analytics platform to Nexus Corp for 12 months at EUR 84,000.",
};

// Null when redis answers, otherwise why it did not.
async function redisProblem(url: string | undefined): Promise<string | null> {
  if (url === undefined || url === "") return "REDIS_URL is not set";
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    // One try: the default reconnects forever.
    retryStrategy: () => null,
  });
  // Without a listener ioredis prints the connection error itself.
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.ping();
    return null;
  } catch (err) {
    return `no answer from ${url} (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    client.disconnect();
  }
}

const redisUrl = process.env.REDIS_URL ?? "";
const problem = await redisProblem(process.env.REDIS_URL);
if (problem !== null) {
  const text = `the pipeline e2e test needs a reachable redis: ${problem}. Start one with "docker run --rm -p 6379:6379 redis:7.4-alpine" and set REDIS_URL (npm run test:e2e reads .env).`;
  // A CI run that quietly skips its only wiring test would pass for the wrong reason.
  if (process.env.CI) throw new Error(text);
  process.stderr.write(`\nSKIPPED: ${text}\n\n`);
}

describe.skipIf(problem !== null)("pipeline e2e", () => {
  // Unique per run, so two runs against the same redis, or a dev queue on it, never see each other's jobs.
  const prefix = `nexus-e2e-${randomUUID()}`;
  let dir: string;
  let apiDb: Db;
  let workerDb: Db;
  let queue: BullMqJobQueue;
  // A second handle on the same queue, for looking at jobs and for wiping it afterwards.
  let inspector: Queue;
  let worker: Worker;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  // How many of the next model calls fail as "provider unavailable".
  let failNextCalls = 0;
  let firstId = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nexus-e2e-"));
    const config = loadConfig({
      DATABASE_PATH: join(dir, "app.db"),
      UPLOAD_DIR: join(dir, "uploads"),
      REDIS_URL: redisUrl,
      LLM_PROVIDER: "mock",
    });
    const logger = createLogger("e2e", "silent");

    // Two connections to one file, like the two services: the api migrates, the worker only checks.
    apiDb = openDb(config.DATABASE_PATH);
    migrate(apiDb);
    workerDb = openDb(config.DATABASE_PATH);
    assertMigrated(workerDb);

    // 100ms backoff instead of 5s, so the retry step waits 300ms in total and not 15s.
    queue = new BullMqJobQueue(redisUrl, config.JOB_ATTEMPTS, logger, 100, prefix);
    inspector = new Queue(QUEUE_NAME, { connection: { url: redisUrl }, prefix });

    app = await buildServer({ db: apiDb, queue, config, logger, clock: CLOCK });
    await app.listen({ host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`;

    const provider = new MockProvider((req) => {
      if (failNextCalls > 0) {
        failNextCalls--;
        throw new LlmError("unavailable", "provider is down");
      }
      return req.schemaName === "contract_summary" ? { summary: SAAS_REPLY.summary } : SAAS_REPLY;
    });
    const deps: WorkerDeps = { db: workerDb, config, logger, provider, clock: CLOCK };
    // The production worker: same bullmq options and handlers as services/worker/src/index.ts.
    worker = createWorker(config, deps, prefix);
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await queue.close();
    await inspector.obliterate({ force: true });
    await inspector.close();
    workerDb.close();
    apiDb.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function upload(file: string) {
    const form = new FormData();
    form.append("files", new Blob([await readFile(join(SAMPLES, file))]), file);
    const res = await fetch(`${baseUrl}/api/documents`, { method: "POST", body: form });
    const body = UploadResponseSchema.parse(await res.json());
    const [accepted] = body.accepted;
    if (!accepted) throw new Error(`${file} was not accepted: ${JSON.stringify(body)}`);
    return { status: res.status, accepted };
  }

  async function detail(id: string): Promise<DocumentDetail> {
    const res = await fetch(`${baseUrl}/api/documents/${id}`);
    return DocumentDetailSchema.parse(await res.json());
  }

  // Polls like the dashboard does. Stops at the first terminal status, so a document that failed
  // when it should have completed shows up as a wrong status and not as a timeout.
  async function waitUntilDone(id: string): Promise<DocumentDetail> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const doc = await detail(id);
      if (doc.status === "completed" || doc.status === "failed") return doc;
      if (Date.now() >= deadline) {
        throw new Error(`document ${id} is still ${doc.status} after ${String(WAIT_MS)}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  const jobCount = async () =>
    Object.values(await inspector.getJobCounts()).reduce((sum, n) => sum + n, 0);

  it("accepts the pdf, processes it and serves the extracted values", async () => {
    const { status, accepted } = await upload("saas-subscription.pdf");
    expect(status).toBe(202);
    expect(accepted).toMatchObject({ status: "queued", duplicate_of: null });
    firstId = accepted.id;

    const doc = await waitUntilDone(firstId);

    expect(doc).toMatchObject({
      status: "completed",
      error_code: null,
      attempts: 1,
      vendor_name: "Cloudhaven Software Ltd.",
      total_contract_value: { amount: 84000, currency: "EUR" },
      // The term ends 2027-01-14 after one renewal, minus 60 days notice.
      notice_deadline: "2026-11-15",
      grounding_score: 1,
      needs_review: false,
    });
    expect(doc.extraction).toMatchObject({ provider: "mock", chunk_count: 1 });
    const ok = doc.events.filter((event) => event.outcome === "ok").map((event) => event.stage);
    expect(ok).toEqual(["parsing", "extracting", "validating"]);
  });

  // Only works because the first result did not need review: dedupe reuses trusted results only.
  it("links the same file to the first result without a new job", async () => {
    const before = await jobCount();

    const { status, accepted } = await upload("saas-subscription.pdf");

    expect(status).toBe(202);
    expect(accepted).toMatchObject({ status: "completed", duplicate_of: firstId });
    expect(accepted.id).not.toBe(firstId);
    expect(await inspector.getJob(jobIdFor(accepted.id, 1))).toBeUndefined();
    expect(await jobCount()).toBe(before);
    const doc = await detail(accepted.id);
    expect(doc).toMatchObject({ vendor_name: "Cloudhaven Software Ltd.", attempts: 0 });
  });

  it("fails a scan without text as NO_TEXT_LAYER after exactly one attempt", async () => {
    const { accepted } = await upload("scanned-quote.pdf");

    const doc = await waitUntilDone(accepted.id);

    expect(doc).toMatchObject({ status: "failed", error_code: "NO_TEXT_LAYER", attempts: 1 });
    // bullmq agrees: the job is failed for good and not waiting for a second attempt. The worker
    // marks the row before bullmq moves the job, so the job state can lag a moment behind.
    const jobId = jobIdFor(accepted.id, 1);
    await expect
      .poll(async () => (await inspector.getJob(jobId))?.getState(), {
        timeout: 5000,
        interval: POLL_MS,
      })
      .toBe("failed");
    expect((await inspector.getJob(jobId))?.attemptsMade).toBe(1);
  });

  it("completes on the third attempt when the provider is down for the first two", async () => {
    failNextCalls = 2;
    // The docx of the same contract: a new hash, so it is not a duplicate of the pdf.
    const { accepted } = await upload("saas-subscription.docx");

    const doc = await waitUntilDone(accepted.id);

    expect(failNextCalls).toBe(0);
    expect(doc).toMatchObject({ status: "completed", error_code: null, attempts: 3 });
    const retries = doc.events.filter((event) => event.outcome === "retry");
    expect(retries.map((event) => event.message)).toEqual([
      "LLM_UNAVAILABLE: provider is down, retrying as attempt 2 of 3",
      "LLM_UNAVAILABLE: provider is down, retrying as attempt 3 of 3",
    ]);
  });
});
