import { describe, it, expect } from "vitest";

// DEMO ONLY: fails on purpose to show the required "test" check blocks the merge.
describe("quality gate demo", () => {
  it("fails on purpose", () => {
    expect(1 + 1).toBe(3);
  });
});
