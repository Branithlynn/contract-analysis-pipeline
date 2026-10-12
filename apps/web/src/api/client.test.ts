import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDetail, DocumentSummary, UploadResponse } from "@nexus/shared";
import {
  ApiError,
  exportCsvUrl,
  getDocument,
  getDocuments,
  retryDocument,
  uploadDocuments,
} from "./client.js";

const ID = "7b0c0f0e-6f0a-4a43-9d0e-2f0f6f1f7a11";
const NOW = "2026-10-11T00:00:00.000Z";

const summary: DocumentSummary = {
  id: ID,
  original_name: "msa.pdf",
  status: "queued",
  stage: null,
  needs_review: false,
  error_code: null,
  error_message: null,
  duplicate_of: null,
  index_status: null,
  requested_provider: null,
  requested_model: null,
  result_provider: null,
  result_model: null,
  result_prompt_version: null,
  created_at: NOW,
  updated_at: NOW,
  vendor_name: null,
  total_contract_value: null,
  expiration_date: null,
  current_term_end: null,
  auto_renewal: null,
  notice_deadline: null,
  days_until_notice_deadline: null,
  max_risk_severity: null,
  risk_count: null,
  alerts: [],
  grounding_score: null,
};

const detail: DocumentDetail = {
  ...summary,
  mime: "application/pdf",
  size_bytes: 1234,
  attempts: 0,
  run: 2,
  extraction: null,
  runs: [],
  events: [
    {
      stage: "enqueue",
      outcome: "retry",
      message: "queue unavailable, left for the reconciler",
      duration_ms: null,
      created_at: NOW,
    },
  ],
};

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const err: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error(`expected ApiError, got ${String(err)}`);
  return err;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDocuments", () => {
  it("reads the list from a relative url", async () => {
    fetchMock.mockResolvedValue(json(200, [summary]));
    await expect(getDocuments()).resolves.toEqual([summary]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/documents");
  });

  it("turns an error body into ApiError", async () => {
    fetchMock.mockResolvedValue(
      json(500, { error: { code: "INTERNAL", message: "Internal error" } }),
    );
    const err = await rejection(getDocuments());
    expect(err).toMatchObject({ status: 500, code: "INTERNAL", message: "Internal error" });
  });

  it("still gives an ApiError when the error body is not json", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    const err = await rejection(getDocuments());
    expect(err).toMatchObject({ status: 502, code: "HTTP_502", message: "Bad Gateway" });
  });

  it("rejects a 2xx body that does not match the schema", async () => {
    fetchMock.mockResolvedValue(json(200, [{ ...summary, status: "exploded" }]));
    const err = await rejection(getDocuments());
    expect(err).toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
  });

  it("reports a failed connection as ApiError with status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const err = await rejection(getDocuments());
    expect(err).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("lets an abort through untouched", async () => {
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValue(abort);
    await expect(getDocuments()).rejects.toBe(abort);
  });
});

describe("getDocument", () => {
  it("reads one document with its events", async () => {
    fetchMock.mockResolvedValue(json(200, detail));
    await expect(getDocument(ID)).resolves.toEqual(detail);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/documents/${ID}`);
  });

  it("maps 404 to ApiError", async () => {
    fetchMock.mockResolvedValue(
      json(404, { error: { code: "NOT_FOUND", message: "Document not found" } }),
    );
    const err = await rejection(getDocument(ID));
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("uploadDocuments", () => {
  const accepted: UploadResponse["accepted"][number] = {
    id: ID,
    original_name: "msa.pdf",
    status: "queued",
    duplicate_of: null,
  };

  it("posts every file under the files field", async () => {
    fetchMock.mockResolvedValue(json(202, { accepted: [accepted], rejected: [] }));
    const files = [new File(["a"], "msa.pdf"), new File(["b"], "sow.docx")];

    await expect(uploadDocuments(files)).resolves.toEqual({ accepted: [accepted], rejected: [] });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/documents");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error("expected a FormData body");
    const sent = body.getAll("files");
    expect(sent.map((f) => (f instanceof File ? f.name : f))).toEqual(["msa.pdf", "sow.docx"]);
  });

  it("returns the body of a 400 where every file was rejected", async () => {
    const body: UploadResponse = {
      accepted: [],
      rejected: [
        { original_name: "a.txt", code: "UNSUPPORTED_TYPE", message: "Not a pdf or docx" },
      ],
    };
    fetchMock.mockResolvedValue(json(400, body));
    await expect(uploadDocuments([new File(["a"], "a.txt")])).resolves.toEqual(body);
  });

  it("keeps the request-level error next to the accepted files", async () => {
    const body: UploadResponse = {
      accepted: [accepted],
      rejected: [],
      error: { code: "TOO_MANY_FILES", message: "Too many files in one request" },
    };
    fetchMock.mockResolvedValue(json(202, body));
    await expect(uploadDocuments([new File(["a"], "msa.pdf")])).resolves.toEqual(body);
  });

  it("returns a 400 that only carries a request-level error", async () => {
    const body: UploadResponse = {
      accepted: [],
      rejected: [],
      error: { code: "NO_FILES", message: "No files in request" },
    };
    fetchMock.mockResolvedValue(json(400, body));
    await expect(uploadDocuments([])).resolves.toEqual(body);
  });

  it("throws ApiError for a 400 that is a plain error body", async () => {
    fetchMock.mockResolvedValue(
      json(400, { error: { code: "BAD_REQUEST", message: "Invalid field name" } }),
    );
    const err = await rejection(uploadDocuments([new File(["a"], "msa.pdf")]));
    expect(err).toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("throws ApiError for other statuses", async () => {
    fetchMock.mockResolvedValue(
      json(413, { error: { code: "TOO_MANY_PARTS", message: "Too many parts in one request" } }),
    );
    const err = await rejection(uploadDocuments([new File(["a"], "msa.pdf")]));
    expect(err).toMatchObject({ status: 413, code: "TOO_MANY_PARTS" });
  });
});

describe("retryDocument", () => {
  it("posts to the retry route and returns the queued summary", async () => {
    fetchMock.mockResolvedValue(json(202, summary));
    await expect(retryDocument(ID)).resolves.toEqual(summary);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/documents/${ID}/retry`);
    expect(init?.method).toBe("POST");
  });

  it("maps 409 to ApiError", async () => {
    fetchMock.mockResolvedValue(
      json(409, {
        error: { code: "NOT_RETRYABLE", message: "A queued document cannot be retried" },
      }),
    );
    const err = await rejection(retryDocument(ID));
    expect(err).toMatchObject({ status: 409, code: "NOT_RETRYABLE" });
  });
});

describe("exportCsvUrl", () => {
  it("is relative", () => {
    expect(exportCsvUrl()).toBe("/api/documents/export.csv");
  });
});
