import { describe, expect, it } from "vitest";
import { trapTarget } from "./focusTrap.js";

// Walks tab presses the way the dialog does: the trap decides at the edges, and where it returns
// null the browser moves one step.
function press(count: number, current: number, backwards: boolean): number {
  const target = trapTarget(count, current, backwards);
  if (target !== null) return target;
  return backwards ? current - 1 : current + 1;
}

describe("trapTarget", () => {
  it("leaves the steps in the middle to the browser", () => {
    expect(trapTarget(4, 0, false)).toBeNull();
    expect(trapTarget(4, 2, false)).toBeNull();
    expect(trapTarget(4, 3, true)).toBeNull();
    expect(trapTarget(4, 1, true)).toBeNull();
  });

  it("wraps from the last element to the first", () => {
    expect(trapTarget(4, 3, false)).toBe(0);
  });

  it("wraps from the first element to the last with shift", () => {
    expect(trapTarget(4, 0, true)).toBe(3);
  });

  it("pulls focus in when it is on none of the elements", () => {
    expect(trapTarget(4, -1, false)).toBe(0);
    expect(trapTarget(4, -1, true)).toBe(3);
    // An index left over from a list that got shorter.
    expect(trapTarget(2, 5, false)).toBe(0);
  });

  it("keeps focus on the only element", () => {
    expect(trapTarget(1, 0, false)).toBe(0);
    expect(trapTarget(1, 0, true)).toBe(0);
  });

  it("swallows the key when nothing can take focus", () => {
    expect(trapTarget(0, -1, false)).toBe(-1);
    expect(trapTarget(0, -1, true)).toBe(-1);
  });

  it("never leaves the list, however many times tab is pressed", () => {
    for (const backwards of [false, true]) {
      let current = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 12; i++) {
        current = press(3, current, backwards);
        expect(current).toBeGreaterThanOrEqual(0);
        expect(current).toBeLessThan(3);
        seen.add(current);
      }
      expect([...seen].sort()).toEqual([0, 1, 2]);
    }
  });
});
