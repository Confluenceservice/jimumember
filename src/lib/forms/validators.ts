/**
 * Schema-driven form system — validator library.
 *
 * Single source of truth for input checks. Replaces the three copies of
 * `EMAIL_RE` that previously lived in `apply.ts`, `checkout-pm.ts`,
 * `checkout-am.ts` — and unifies them on the CR/LF-injection-safe regex
 * (`checkout-pm.ts:7`). `apply.ts:35` previously used a weaker class
 * (`[^\s@]`), which is a latent header-injection bug now closed by routing
 * all email validation through `emailNZ`.
 */

import type { Validator, FieldValues } from "./types.js";

/**
 * Header-injection-safe email regex.
 * Same character class used in `checkout-pm.ts:7` and `checkout-am.ts:7`:
 * excludes CR, LF, `@`, and whitespace in every segment. Rejects payloads
 * like `attacker@x.com\r\nBcc: victim@y.com`.
 */
export const EMAIL_RE = /^[^\r\n@\s]+@[^\r\n@\s]+\.[^\r\n@\s]+$/;

export const NZ_PHONE_RE = /^\+?[0-9 \-()]{7,20}$/;

export const emailNZ: Validator = {
  kind: "email",
  message: "Valid email required",
};

export const phoneNZ: Validator = {
  kind: "phone",
  message: "Valid phone number required",
};

export const ynRadio: Validator = {
  kind: "ynRadio",
  message: "Yes or No required",
};

/** Coerces a string body into a JSON array (used for repeatable rows / object bags). */
export const jsonArray: Validator = {
  kind: "jsonArray",
  message: "Expected a JSON array",
};

export function minLength(n: number): Validator {
  return { kind: "minLength", value: n, message: `Must be at least ${n} characters` };
}

export function maxLength(n: number): Validator {
  return { kind: "maxLength", value: n, message: `Must be at most ${n} characters` };
}

export function min(n: number): Validator {
  return { kind: "min", value: n, message: `Must be ≥ ${n}` };
}

export function max(n: number): Validator {
  return { kind: "max", value: n, message: `Must be ≤ ${n}` };
}

export function regex(pattern: RegExp, message = "Invalid format"): Validator {
  return { kind: "regex", value: pattern.source, message };
}

export const required: Validator = {
  kind: "required",
  message: "Required",
};

export const integer: Validator = {
  kind: "integer",
  message: "Must be a whole number",
};

/**
 * `required` that only fires when the predicate returns true. Used for the
 * Associate-apply `listingDetails` gate: only required when `listOnPage === "yes"`.
 */
export function conditional(predicate: (values: FieldValues) => boolean): Validator {
  return { kind: "conditional", when: predicate, message: "Required" };
}

// -- internals: pure predicate functions used by runtime.ts --------------------

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function runValidator(
  validator: Validator,
  value: unknown,
  allValues: FieldValues,
): string | null {
  switch (validator.kind) {
    case "required":
      return isBlank(value) ? validator.message ?? "Required" : null;

    case "conditional": {
      const fires = validator.when?.(allValues) ?? false;
      if (!fires) return null;
      return isBlank(value) ? validator.message ?? "Required" : null;
    }

    case "email":
      if (isBlank(value)) return null;
      return typeof value === "string" && EMAIL_RE.test(value)
        ? null
        : validator.message ?? "Valid email required";

    case "phone":
      if (isBlank(value)) return null;
      return typeof value === "string" && NZ_PHONE_RE.test(value)
        ? null
        : validator.message ?? "Valid phone number required";

    case "ynRadio": {
      if (isBlank(value)) return validator.message ?? "Yes or No required";
      const v = String(value).toLowerCase();
      return v === "yes" || v === "no"
        ? null
        : validator.message ?? "Yes or No required";
    }

    case "minLength":
      if (isBlank(value)) return null;
      return typeof value === "string" && value.length >= Number(validator.value)
        ? null
        : validator.message ?? `Must be at least ${validator.value} characters`;

    case "maxLength":
      if (isBlank(value)) return null;
      return typeof value === "string" && value.length <= Number(validator.value)
        ? null
        : validator.message ?? `Must be at most ${validator.value} characters`;

    case "min":
      if (isBlank(value)) return null;
      return Number(value) >= Number(validator.value)
        ? null
        : validator.message ?? `Must be ≥ ${validator.value}`;

    case "max":
      if (isBlank(value)) return null;
      return Number(value) <= Number(validator.value)
        ? null
        : validator.message ?? `Must be ≤ ${validator.value}`;

    case "integer":
      if (isBlank(value)) return null;
      return Number.isInteger(Number(value))
        ? null
        : validator.message ?? "Must be a whole number";

    case "regex": {
      if (isBlank(value)) return null;
      const source = String(validator.value);
      const re = new RegExp(source);
      return typeof value === "string" && re.test(value)
        ? null
        : validator.message ?? "Invalid format";
    }

    case "jsonArray":
      if (isBlank(value)) return null;
      if (Array.isArray(value)) return null;
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? null : validator.message ?? "Expected a JSON array";
        } catch {
          return validator.message ?? "Expected a JSON array";
        }
      }
      return validator.message ?? "Expected a JSON array";

    default: {
      const _exhaustive: never = validator.kind;
      return `Unknown validator: ${String(_exhaustive)}`;
    }
  }
}