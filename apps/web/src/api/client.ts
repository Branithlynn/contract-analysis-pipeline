import {
  DocumentDetailSchema,
  DocumentSummarySchema,
  ErrorBodySchema,
  UploadResponseSchema,
  type DocumentDetail,
  type DocumentSummary,
  type UploadResponse,
} from "@nexus/shared";

// Relative on purpose: vite proxies /api in dev and nginx does in docker, so there is no api origin to configure.
const DOCUMENTS = "/api/documents";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}

// The slice of a zod schema this file uses, so web does not need its own zod dependency.
interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

const DocumentListSchema = DocumentSummarySchema.array();

async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    // fetch rejects with a TypeError when no response arrived at all. An abort is a DOMException and is
    // rethrown as is, so react-query still sees its own cancellation.
    if (err instanceof TypeError) {
      throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server", { cause: err });
    }
    throw err;
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function toApiError(res: Response, body: unknown): ApiError {
  const parsed = ErrorBodySchema.safeParse(body);
  if (parsed.success) {
    return new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
  }
  // A proxy answering for a dead api sends html, not ErrorBody.
  return new ApiError(
    res.status,
    `HTTP_${res.status}`,
    res.statusText || `Request failed with status ${res.status}`,
  );
}

function invalidResponse(res: Response, cause: unknown): ApiError {
  return new ApiError(
    res.status,
    "INVALID_RESPONSE",
    "The server answered with a body this page does not understand",
    { cause },
  );
}

async function request<T>(schema: Parser<T>, url: string, init?: RequestInit): Promise<T> {
  const res = await send(url, init);
  const body = await readJson(res);
  if (!res.ok) throw toApiError(res, body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalidResponse(res, parsed.error);
  return parsed.data;
}

function withSignal(signal: AbortSignal | undefined): RequestInit {
  return signal ? { signal } : {};
}

export function getDocuments(signal?: AbortSignal): Promise<DocumentSummary[]> {
  return request(DocumentListSchema, DOCUMENTS, withSignal(signal));
}

export function getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail> {
  return request(
    DocumentDetailSchema,
    `${DOCUMENTS}/${encodeURIComponent(id)}`,
    withSignal(signal),
  );
}

export async function uploadDocuments(files: readonly File[]): Promise<UploadResponse> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);

  const res = await send(DOCUMENTS, { method: "POST", body: form });
  const body = await readJson(res);
  // 400 means no file was accepted, but the body still says why per file, so it is a result and not an error.
  // A 400 that is a plain ErrorBody (malformed multipart) fails this parse and is thrown below.
  if (res.status === 202 || res.status === 400) {
    const parsed = UploadResponseSchema.safeParse(body);
    if (parsed.success) return parsed.data;
    if (res.ok) throw invalidResponse(res, parsed.error);
  }
  if (!res.ok) throw toApiError(res, body);
  throw invalidResponse(res, undefined);
}

// 202 also when redis is down: the document comes back queued and the reconciler delivers it later.
export function retryDocument(id: string): Promise<DocumentSummary> {
  return request(DocumentSummarySchema, `${DOCUMENTS}/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
}

export function exportCsvUrl(): string {
  return `${DOCUMENTS}/export.csv`;
}
