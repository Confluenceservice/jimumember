import { describe, expect, it } from "vitest";

import { safeSecretCompare } from "./secret-compare";

describe("safeSecretCompare", () => {
  it("matches identical secrets", () => {
    expect(safeSecretCompare("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a different secret of the same length", () => {
    expect(safeSecretCompare("s3cret", "s3crXt")).toBe(false);
  });

  it("rejects a different secret of a different length without throwing", () => {
    // Guards the ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH trap: a raw
    // timingSafeEqual on unequal-length buffers throws, which is itself
    // an oracle for "wrong length" vs "wrong value".
    expect(() => safeSecretCompare("short", "a-much-longer-secret")).not.toThrow();
    expect(safeSecretCompare("short", "a-much-longer-secret")).toBe(false);
  });

  it("fails closed when the expected secret is unset", () => {
    expect(safeSecretCompare("anything", undefined)).toBe(false);
    expect(safeSecretCompare("anything", null)).toBe(false);
    expect(safeSecretCompare("anything", "")).toBe(false);
  });

  it("fails closed when both sides are unset — empty must never match empty", () => {
    expect(safeSecretCompare("", "")).toBe(false);
    expect(safeSecretCompare(undefined, undefined)).toBe(false);
  });

  it("rejects a missing provided value against a real secret", () => {
    expect(safeSecretCompare(null, "s3cret")).toBe(false);
    expect(safeSecretCompare("", "s3cret")).toBe(false);
  });
});
