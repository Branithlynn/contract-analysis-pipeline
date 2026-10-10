import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger, loadConfig, openMemoryDb } from "@nexus/shared/node";
import { HttpError } from "./errors.js";
import type { JobQueue } from "./queue.js";
import { buildServer } from "./server.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const okQueue: JobQueue = {
  enqueue: () => Promise.resolve(),
  ping: () => Promise.resolve(),
  isReady: () => true,
  onReady: () => () => undefined,
  close: () => Promise.resolve(),
};

async function setup(env: Record<string, string> = {}) {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  const app = await buildServer({
    db: openMemoryDb(),
    queue: okQueue,
    config: loadConfig(env),
    logger: createLogger("api", "info", stream),
    clock: () => new Date("2026-06-01T12:00:00Z"),
  });

  app.get("/http-error", () => {
    throw new HttpError(404, "NOT_FOUND", "document not found", { id: "abc" });
  });
  app.get("/zod-error", () => z.object({ name: z.string() }).parse({}));
  app.get("/crash", () => {
    throw new Error("secret path /var/data/app.db");
  });
  app.post("/json", (request) => request.body);
  app.post("/upload", async (request) => {
    let bytes = 0;
    for await (const part of request.parts()) {
      if (part.type === "file") bytes += (await part.toBuffer()).length;
    }
    return { bytes };
  });
  // The server turns throwFileSizeLimit off for per file rejection; this opts back in to hit the fallback mapping.
  app.post("/upload-throwing", async (request) => {
    let bytes = 0;
    for await (const part of request.files({ throwFileSizeLimit: true })) {
      bytes += (await part.toBuffer()).length;
    }
    return { bytes };
  });

  return { app, lines };
}

type Part = { name: string; filename?: string; content: string | Buffer };

function multipart(parts: Part[]) {
  const boundary = "nexus-test-boundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: application/octet-stream`
      : `form-data; name="${part.name}"`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const file = (name: string, size = 10): Part => ({
  name: "files",
  filename: name,
  content: Buffer.alloc(size, 1),
});

describe("error handler", () => {
  it("answers unknown routes with a 404 ErrorBody", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route GET /nope not found" },
    });
  });

  it("sends an HttpError with its status, code and details", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/http-error" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "document not found", details: { id: "abc" } },
    });
  });

  it("maps a ZodError to 400 VALIDATION_ERROR with the flattened issues", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/zod-error" });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; details: unknown } }>();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toMatchObject({
      formErrors: [],
      fieldErrors: { name: [expect.any(String)] },
    });
  });

  it("hides unknown errors behind 500 INTERNAL and logs the real one with the request id", async () => {
    const { app, lines } = await setup();
    const res = await app.inject({ method: "GET", url: "/crash" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "INTERNAL", message: "Internal error" } });
    expect(res.body).not.toContain("secret");
    expect(res.body).not.toContain("stack");

    const logged = lines.find((line) => line.level === 50);
    expect(logged?.reqId).toMatch(UUID);
    expect(logged?.err).toMatchObject({ message: "secret path /var/data/app.db" });
  });

  it("maps too many files to 413 TOO_MANY_FILES", async () => {
    const { app } = await setup({ MAX_FILES_PER_REQUEST: "1" });
    const res = await app.inject({
      method: "POST",
      url: "/upload",
      ...multipart([file("a.pdf"), file("b.pdf")]),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("TOO_MANY_FILES");
  });

  it("maps a thrown file size limit to 413 FILE_TOO_LARGE", async () => {
    const { app } = await setup({ MAX_UPLOAD_MB: "1" });
    const res = await app.inject({
      method: "POST",
      url: "/upload-throwing",
      ...multipart([file("big.pdf", 1024 * 1024 + 1)]),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects text fields because the upload only takes files", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/upload",
      ...multipart([{ name: "note", content: "hi" }, file("a.pdf")]),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("UNEXPECTED_FIELD");
  });

  it("maps a non multipart request to a multipart route to 415", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/upload", payload: { a: 1 } });
    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("does not apply the 1mb bodyLimit to multipart uploads", async () => {
    const { app } = await setup({ MAX_UPLOAD_MB: "2" });
    const size = 1.5 * 1024 * 1024;
    const res = await app.inject({
      method: "POST",
      url: "/upload",
      ...multipart([file("a.pdf", size)]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ bytes: size });
  });

  it("maps a json body over 1mb to 413 PAYLOAD_TOO_LARGE", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/json",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "x".repeat(1024 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("maps invalid json to 400 BAD_REQUEST", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/json",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("BAD_REQUEST");
  });

  it("maps an unsupported content type to 415", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/json",
      headers: { "content-type": "text/xml" },
      payload: "<a/>",
    });
    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });
});
