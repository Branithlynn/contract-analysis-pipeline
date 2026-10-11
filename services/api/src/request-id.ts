import { randomUUID } from "node:crypto";

// The header comes from outside and ends up in every log line, so it is only trusted when it
// looks like an id. nginx's $request_id (32 hex chars) and uuids both fit.
const SANE_REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

// One id follows a request from nginx through the api logs. Anything else gets our own uuid.
export function requestIdFrom(header: string | string[] | undefined): string {
  return typeof header === "string" && SANE_REQUEST_ID.test(header) ? header : randomUUID();
}
