import type { BaseMessage } from "@langchain/core/messages";
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import {
  AskResponseSchema,
  AskStreamEventSchema,
  type AskResponse,
  type AskStreamEvent,
} from "@nexus/shared";
import {
  createLogger,
  loadConfig,
  MockEmbedder,
  type Db,
  type ModelSelection,
} from "@nexus/shared/node";
import { ScriptedChatModel, type ChatScript } from "../ask/scripted-model.js";
import type { JobQueue } from "../queue.js";
import { buildServer } from "../server.js";
import type { ModelCatalog } from "../services/models.js";
import { seedContracts } from "./ask.js";
import { NOW, offlineModels, okQueue } from "./fixtures.js";

// The api with two seeded contracts and a scripted chat model, for the tests of the ask routes.

const MOCK_ENV = { ALLOW_MOCK: "true", LLM_PROVIDER: "mock", LLM_MODEL: "mock" };

export interface AskServerOptions {
  env?: Record<string, string>;
  queue?: JobQueue;
  models?: ModelCatalog;
  // Without a script the real factory is used, with its own mock model.
  script?: ChatScript;
  // How often an open stream sends its comment line.
  heartbeatMs?: number;
}

const open: Db[] = [];

// For afterEach.
export function closeAskServers(): void {
  for (const db of open.splice(0)) db.close();
}

// The events of a finished stream, each checked against the schema the web client parses with.
export function parseStream(payload: string): AskStreamEvent[] {
  const events: AskStreamEvent[] = [];
  for (const block of payload.split("\n\n")) {
    // A block of comment lines only is the heartbeat.
    const lines = block.split("\n").filter((line) => line !== "" && !line.startsWith(":"));
    if (lines.length === 0) continue;
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
    events.push(AskStreamEventSchema.parse({ event, data: JSON.parse(data ?? "null") }));
  }
  return events;
}

type Body = Record<string, unknown>;

// Spelled out, because the inferred type would have to name better-sqlite3's own Database type.
export interface AskServer {
  app: Awaited<ReturnType<typeof buildServer>>;
  db: Db;
  ask: (body: Body) => Promise<LightMyRequestResponse>;
  // The parsed body of a 200.
  answer: (body: Body) => Promise<AskResponse>;
  askStream: (body: Body) => Promise<LightMyRequestResponse>;
  get: (url: string) => Promise<LightMyRequestResponse>;
  model: ScriptedChatModel | undefined;
  // The selections the model factory was asked for.
  created: ModelSelection[];
  // The log lines, parsed.
  lines: Record<string, unknown>[];
  everythingSeen: () => string[];
}

export async function setupAskServer(opts: AskServerOptions = {}): Promise<AskServer> {
  const env = { ...MOCK_ENV, ...opts.env };
  const db = seedContracts();
  open.push(db);
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  };
  // One scripted model for every question, so a test can read everything that was sent to it.
  const model = opts.script === undefined ? undefined : new ScriptedChatModel(opts.script);
  const created: ModelSelection[] = [];
  const app = await buildServer({
    db,
    queue: opts.queue ?? okQueue,
    config: loadConfig(env),
    logger: createLogger("api", "info", stream),
    embedder: new MockEmbedder(),
    models: opts.models ?? offlineModels(env),
    clock: () => NOW,
    ...(opts.heartbeatMs === undefined ? {} : { askHeartbeatMs: opts.heartbeatMs }),
    ...(model === undefined
      ? {}
      : {
          chatModels: {
            create: (selection: ModelSelection) => {
              created.push(selection);
              return model;
            },
            close: () => Promise.resolve(),
          },
        }),
  });
  const ask = (body: Body) => app.inject({ method: "POST", url: "/api/ask", payload: body });
  const answer = async (body: Body): Promise<AskResponse> => {
    const res = await ask(body);
    expect(res.statusCode, res.body).toBe(200);
    return AskResponseSchema.parse(res.json());
  };
  const askStream = (body: Body) =>
    app.inject({ method: "POST", url: "/api/ask/stream", payload: body });
  const get = (url: string) => app.inject({ method: "GET", url });
  // Every text the model was ever given, system prompt and tool results included.
  const everythingSeen = () => (model?.seen ?? []).flat().map((m) => m.text);
  return { app, db, ask, answer, askStream, get, model, created, lines, everythingSeen };
}

export const texts = (messages: readonly BaseMessage[] | undefined) =>
  (messages ?? []).map((m) => [m.getType(), m.text]);
