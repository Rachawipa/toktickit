import { describe, it, expect } from "vitest";

// DEMO ONLY: this test fails on purpose to show that the required "test" check blocks the merge.
// To see the gate open again, fix the assertion (or close this PR).
describe("quality gate demo", () => {
  it("fails on purpose", () => {
    expect(1 + 1).toBe(3);
  });
});
