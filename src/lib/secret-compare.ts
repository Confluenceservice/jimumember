import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time shared-secret comparison for the /api/xero/* endpoints.
 *
 * Two traps this exists to avoid:
 *
 *  1. `crypto.timingSafeEqual` THROWS `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`
 *     when the buffers differ in length. A naive wrapper therefore leaks
 *     "wrong length" vs "wrong value" through which code path runs. Hashing
 *     both sides to a fixed 32 bytes first makes every comparison the same
 *     width, so only the value is ever in question.
 *
 *  2. An UNSET expected secret must never mean "no auth required". Callers
 *     get `false` for an empty/missing expected value, so a misconfigured
 *     deploy fails closed rather than opening the endpoint to anyone.
 */
export function safeSecretCompare(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected) return false;
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
