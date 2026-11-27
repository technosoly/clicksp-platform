import { describe, expect, it } from "vitest";
import { retryDelayMs } from "../domain/outbox";

describe("outbox retry delay", () => {
  it("doubles from 30 seconds and stops at an hour", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(30)).toBe(3_600_000);
    expect(retryDelayMs(0)).toBe(30_000);
  });
});
