import { describe, expect, it } from "vitest";
import { readSelectedId, selectionHref } from "./selection.js";

describe("readSelectedId", () => {
  it("reads ?doc", () => {
    expect(readSelectedId("?doc=abc")).toBe("abc");
    expect(readSelectedId("?x=1&doc=abc")).toBe("abc");
  });

  it("is null when the param is missing or empty", () => {
    expect(readSelectedId("")).toBeNull();
    expect(readSelectedId("?doc=")).toBeNull();
  });
});

describe("selectionHref", () => {
  it("sets the param and keeps the others", () => {
    expect(selectionHref("", "abc")).toBe("?doc=abc");
    expect(selectionHref("?x=1&doc=old", "abc")).toBe("?x=1&doc=abc");
  });

  it("drops the param when nothing is selected", () => {
    expect(selectionHref("?doc=abc", null)).toBe(".");
    expect(selectionHref("?x=1&doc=abc", null)).toBe("?x=1");
  });
});
