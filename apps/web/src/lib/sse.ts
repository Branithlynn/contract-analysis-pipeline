import { AskStreamEventSchema, type AskStreamEvent } from "@nexus/shared";

// Reading server-sent events from a fetch response. EventSource cannot do it: it only sends GET
// and the question goes in a POST body.

export interface SseMessage {
  // "message" when the server named none, as in the browser's own EventSource.
  event: string;
  data: string;
}

export interface SseParser {
  // Takes the text as it arrives, in pieces of any size.
  push(chunk: string): void;
}

// The part of the event stream format the api uses, and what a proxy may do to it on the way:
// events end with a blank line, a line is "field: value", lines that start with ":" are comments
// (the api's heartbeat), several data lines are one value joined by newlines, and a line may end
// in \n, \r\n or \r. A chunk can end anywhere, also in the middle of a line or between \r and \n.
export function createSseParser(onMessage: (message: SseMessage) => void): SseParser {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  function dispatch(): void {
    // A blank line after comments only is no event.
    if (data.length > 0)
      onMessage({ event: event === "" ? "message" : event, data: data.join("\n") });
    event = "";
    data = [];
  }

  function line(text: string): void {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    // One space after the colon belongs to the format, any further one to the value.
    const value = colon < 0 ? "" : text.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    // id and retry are for reconnecting, which a POST stream does not do.
  }

  return {
    push(chunk) {
      buffer += chunk;
      for (;;) {
        const end = buffer.search(/[\r\n]/);
        if (end < 0) return;
        // A \r at the very end may be the first half of \r\n. Wait for what follows.
        if (buffer[end] === "\r" && end === buffer.length - 1) return;
        const width = buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1;
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + width);
      }
    },
  };
}

// Null for an event this page does not know or cannot read. A newer api may send more kinds,
// and one of those must not break a chat that only needs the ones it knows.
export function toAskEvent(message: SseMessage): AskStreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(message.data);
  } catch {
    return null;
  }
  const parsed = AskStreamEventSchema.safeParse({ event: message.event, data });
  return parsed.success ? parsed.data : null;
}

// Reads a response body to its end and hands on every ask event in it.
export async function readAskEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AskStreamEvent) => void,
): Promise<void> {
  const parser = createSseParser((message) => {
    const event = toAskEvent(message);
    if (event !== null) onEvent(event);
  });
  const decoder = new TextDecoder();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // stream: a character of several bytes can be cut in two by a chunk boundary.
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
}
