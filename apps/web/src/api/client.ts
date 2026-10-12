import {
  DocumentDetailSchema,
  DocumentSummarySchema,
  ErrorBodySchema,
  ModelsResponseSchema,
  UploadResponseSchema,
  type DocumentDetail,
  type DocumentSummary,
  type ModelSelection,
  type ModelsResponse,
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

const MODELS = "/api/models";

// refresh asks the api to check ollama again instead of answering from its cache.
export function getModels(refresh = false, signal?: AbortSignal): Promise<ModelsResponse> {
  return request(
    ModelsResponseSchema,
    refresh ? `${MODELS}?refresh=1` : MODELS,
    withSignal(signal),
  );
}

// The detail with the values of one older run instead of the latest, for comparing two runs.
export function getDocumentRun(
  id: string,
  run: number,
  signal?: AbortSignal,
): Promise<DocumentDetail> {
  return request(
    DocumentDetailSchema,
    `${DOCUMENTS}/${encodeURIComponent(id)}?run=${String(run)}`,
    withSignal(signal),
  );
}

export function reanalyzeDocument(id: string, model: ModelSelection): Promise<DocumentSummary> {
  return request(DocumentSummarySchema, `${DOCUMENTS}/${encodeURIComponent(id)}/reanalyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(model),
  });
}

function uploadUrl(model: ModelSelection | null): string {
  if (model === null) return DOCUMENTS;
  const query = new URLSearchParams({ provider: model.provider, model: model.model });
  return `${DOCUMENTS}?${query.toString()}`;
}

// One file per request, through XMLHttpRequest: fetch cannot report how much of a body has been
// sent, and a progress bar per file needs exactly that. The answer is read like uploadDocuments
// reads it: 202 and 400 both carry a result per file.
export function uploadFile(
  file: File,
  model: ModelSelection | null,
  onProgress: (fraction: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl(model));
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Could not reach the server"));
    xhr.onload = () => {
      const body: unknown = xhr.response;
      const result = UploadResponseSchema.safeParse(body);
      if ((xhr.status === 202 || xhr.status === 400) && result.success) {
        resolve(result.data);
        return;
      }
      const error = ErrorBodySchema.safeParse(body);
      reject(
        error.success
          ? new ApiError(xhr.status, error.data.error.code, error.data.error.message)
          : new ApiError(
              xhr.status,
              `HTTP_${xhr.status}`,
              xhr.statusText || `Request failed with status ${xhr.status}`,
            ),
      );
    };
    const form = new FormData();
    form.append("files", file, file.name);
    xhr.send(form);
  });
}
