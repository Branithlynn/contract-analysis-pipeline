import { describe, expect, it } from "vitest";
import { createSseParser, readAskEvents, toAskEvent, type SseMessage } from "./sse.js";

function parse(...chunks: string[]): SseMessage[] {
  const messages: SseMessage[] = [];
  const parser = createSseParser((message) => messages.push(message));
  for (const chunk of chunks) parser.push(chunk);
  return messages;
}

const STARTED = { thread_id: "t1", model: { provider: "ollama", model: "qwen2.5:7b-instruct" } };
const CALL = { type: "tool_call", tool: "search_clauses", input: { query: "liability" } };

describe("createSseParser", () => {
  it("reads an event with its name and data", () => {
    expect(parse('event: step\ndata: {"a":1}\n\n')).toEqual([{ event: "step", data: '{"a":1}' }]);
  });

  it("reads several events from one chunk, in order", () => {
    const messages = parse(
      "event: started\ndata: 1\n\nevent: step\ndata: 2\n\nevent: done\ndata: 3\n\n",
    );

    expect(messages.map((m) => [m.event, m.data])).toEqual([
      ["started", "1"],
      ["step", "2"],
      ["done", "3"],
    ]);
  });

  it("waits for the blank line before it hands an event on", () => {
    const messages: SseMessage[] = [];
    const parser = createSseParser((message) => messages.push(message));

    parser.push("event: step\ndata: 1\n");
    expect(messages).toEqual([]);
    parser.push("\n");
    expect(messages).toEqual([{ event: "step", data: "1" }]);
  });

  it("puts an event back together that arrives one character at a time", () => {
    const text = 'event: step\ndata: {"tool":"search_clauses"}\n\n';

    expect(parse(...text)).toEqual([{ event: "step", data: '{"tool":"search_clauses"}' }]);
  });

  it("ignores comment lines, which is what the heartbeat is", () => {
    expect(parse(": waiting\n\n", "event: done\ndata: 1\n\n", ": waiting\n\n")).toEqual([
      { event: "done", data: "1" },
    ]);
  });

  it("reads \\r\\n and \\r line ends, also when a chunk ends between \\r and \\n", () => {
    expect(parse("event: step\r\ndata: 1\r\n\r\n")).toEqual([{ event: "step", data: "1" }]);
    expect(parse("event: step\rdata: 1\r\r", "event: done\ndata: 2\n\n")).toEqual([
      { event: "step", data: "1" },
      { event: "done", data: "2" },
    ]);
    expect(parse("event: step\r", "\ndata: 1\r", "\n\r", "\n")).toEqual([
      { event: "step", data: "1" },
    ]);
  });

  it("joins several data lines with a newline", () => {
    expect(parse("data: first\ndata: second\n\n")).toEqual([
      { event: "message", data: "first\nsecond" },
    ]);
  });

  it("takes one space after the colon as part of the format and keeps the rest", () => {
    expect(parse("data:tight\n\n", "data:  two spaces\n\n", "data: a: b\n\n")).toEqual([
      { event: "message", data: "tight" },
      { event: "message", data: " two spaces" },
      { event: "message", data: "a: b" },
    ]);
  });

  it("does not carry an event name over to the next event", () => {
    expect(parse("event: step\ndata: 1\n\ndata: 2\n\n").map((m) => m.event)).toEqual([
      "step",
      "message",
    ]);
  });

  it("drops a block without data and fields it does not use", () => {
    expect(parse("event: step\n\n", "id: 7\nretry: 100\ndata: 1\n\n")).toEqual([
      { event: "message", data: "1" },
    ]);
  });

  it("keeps an event that was cut off by the end of the stream to itself", () => {
    expect(parse("event: done\ndata: 1")).toEqual([]);
  });
});

describe("toAskEvent", () => {
  it("reads the events of the ask stream", () => {
    expect(toAskEvent({ event: "started", data: JSON.stringify(STARTED) })).toEqual({
      event: "started",
      data: STARTED,
    });
    expect(toAskEvent({ event: "step", data: JSON.stringify(CALL) })).toEqual({
      event: "step",
      data: CALL,
    });
    expect(
      toAskEvent({
        event: "error",
        data: JSON.stringify({ status: 503, error: { code: "MODEL_BUSY", message: "busy" } }),
      }),
    ).toEqual({
      event: "error",
      data: { status: 503, error: { code: "MODEL_BUSY", message: "busy" } },
    });
  });

  it("returns null for an event it does not know, data that is not json or the wrong shape", () => {
    expect(toAskEvent({ event: "token", data: '{"text":"a"}' })).toBeNull();
    expect(toAskEvent({ event: "step", data: "not json" })).toBeNull();
    expect(toAskEvent({ event: "step", data: '{"type":"tool_call"}' })).toBeNull();
    expect(toAskEvent({ event: "message", data: JSON.stringify(STARTED) })).toBeNull();
  });
});

describe("readAskEvents", () => {
  function body(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  it("hands on every event of a response body and skips what it cannot read", async () => {
    const text =
      `event: started\ndata: ${JSON.stringify(STARTED)}\n\n` +
      ": waiting\n\n" +
      'event: token\ndata: {"text":"a"}\n\n' +
      `event: step\ndata: ${JSON.stringify(CALL)}\n\n`;
    const events: string[] = [];

    await readAskEvents(body([new TextEncoder().encode(text)]), (event) =>
      events.push(event.event),
    );

    expect(events).toEqual(["started", "step"]);
  });

  it("reads a character whose bytes are split over two chunks", async () => {
    const call = { ...CALL, input: { query: "Kündigung – § 5" } };
    const bytes = new TextEncoder().encode(`event: step\ndata: ${JSON.stringify(call)}\n\n`);
    // Inside the two bytes of the ü.
    const cut = bytes.indexOf(0xc3) + 1;
    const events: unknown[] = [];

    await readAskEvents(body([bytes.slice(0, cut), bytes.slice(cut)]), (event) =>
      events.push(event.data),
    );

    expect(events).toEqual([call]);
  });
});
