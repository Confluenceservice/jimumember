import { describe, expect, it } from "vitest";
import {
  EMAIL_RE,
  NZ_PHONE_RE,
  emailNZ,
  phoneNZ,
  ynRadio,
  jsonArray,
  integer,
  minLength,
  maxLength,
  min,
  max,
  regex,
  required,
  conditional,
  runValidator,
} from "./validators.js";

describe("EMAIL_RE", () => {
  it("accepts plain addresses", () => {
    expect(EMAIL_RE.test("alice@example.com")).toBe(true);
    expect(EMAIL_RE.test("a.b+tag@sub.example.co.nz")).toBe(true);
  });

  it("rejects empty / missing parts", () => {
    expect(EMAIL_RE.test("")).toBe(false);
    expect(EMAIL_RE.test("alice@")).toBe(false);
    expect(EMAIL_RE.test("@example.com")).toBe(false);
    expect(EMAIL_RE.test("alice@example")).toBe(false);
  });

  it("rejects CR/LF injection (header injection guard)", () => {
    expect(EMAIL_RE.test("attacker@x.com\r\nBcc: victim@y.com")).toBe(false);
    expect(EMAIL_RE.test("a@b.com\nX-Test: 1")).toBe(false);
    expect(EMAIL_RE.test("a@b.com\rfoo")).toBe(false);
  });

  it("rejects whitespace in segments", () => {
    expect(EMAIL_RE.test("a b@c.com")).toBe(false);
    expect(EMAIL_RE.test("a@b c.com")).toBe(false);
  });
});

describe("NZ_PHONE_RE", () => {
  it("accepts common NZ formats", () => {
    expect(NZ_PHONE_RE.test("021234567")).toBe(true);
    expect(NZ_PHONE_RE.test("+64 21 234 5678")).toBe(true);
    expect(NZ_PHONE_RE.test("(09) 123-4567")).toBe(true);
  });

  it("rejects pathological input", () => {
    expect(NZ_PHONE_RE.test("")).toBe(false);
    expect(NZ_PHONE_RE.test("phone: 021234567")).toBe(false);
    expect(NZ_PHONE_RE.test("a".repeat(50))).toBe(false);
  });
});

describe("runValidator — required", () => {
  it("fails on blank values", () => {
    expect(runValidator(required, "", {})).toBe("Required");
    expect(runValidator(required, "   ", {})).toBe("Required");
    expect(runValidator(required, null, {})).toBe("Required");
    expect(runValidator(required, undefined, {})).toBe("Required");
    expect(runValidator(required, [], {})).toBe("Required");
  });

  it("passes on populated values", () => {
    expect(runValidator(required, "x", {})).toBeNull();
    expect(runValidator(required, 0, {})).toBeNull();
    expect(runValidator(required, false, {})).toBeNull();
  });
});

describe("runValidator — emailNZ", () => {
  it("passes on valid + skips blank (required is separate)", () => {
    expect(runValidator(emailNZ, "alice@example.com", {})).toBeNull();
    expect(runValidator(emailNZ, "", {})).toBeNull();
  });

  it("rejects CR/LF payloads", () => {
    expect(runValidator(emailNZ, "a@b.com\r\nBcc: v@y.com", {})).toBe(
      "Valid email required",
    );
  });
});

describe("runValidator — phoneNZ", () => {
  it("passes on valid", () => {
    expect(runValidator(phoneNZ, "021234567", {})).toBeNull();
  });
  it("fails on garbage", () => {
    expect(runValidator(phoneNZ, "not-a-phone", {})).toBe("Valid phone number required");
  });
});

describe("runValidator — ynRadio", () => {
  it("accepts yes/no (case-insensitive)", () => {
    expect(runValidator(ynRadio, "yes", {})).toBeNull();
    expect(runValidator(ynRadio, "NO", {})).toBeNull();
  });
  it("rejects other values and blanks", () => {
    expect(runValidator(ynRadio, "maybe", {})).toBe("Yes or No required");
    expect(runValidator(ynRadio, "", {})).toBe("Yes or No required");
  });
});

describe("runValidator — length + numeric bounds", () => {
  it("minLength / maxLength", () => {
    expect(runValidator(minLength(3), "ab", {})).toMatch(/at least 3/);
    expect(runValidator(minLength(3), "abc", {})).toBeNull();
    expect(runValidator(maxLength(5), "abcdef", {})).toMatch(/at most 5/);
  });
  it("min / max", () => {
    expect(runValidator(min(18), 17, {})).toMatch(/≥ 18/);
    expect(runValidator(max(99), 100, {})).toMatch(/≤ 99/);
  });
  it("integer", () => {
    expect(runValidator(integer, 5, {})).toBeNull();
    expect(runValidator(integer, "5", {})).toBeNull();
    expect(runValidator(integer, 5.5, {})).toBe("Must be a whole number");
    expect(runValidator(integer, "abc", {})).toBe("Must be a whole number");
    expect(runValidator(integer, "", {})).toBeNull(); // blank => optional
  });
});

describe("runValidator — regex", () => {
  const lettersOnly = regex(/^[a-z]+$/, "lowercase only");
  it("matches / fails", () => {
    expect(runValidator(lettersOnly, "abc", {})).toBeNull();
    expect(runValidator(lettersOnly, "Abc", {})).toBe("lowercase only");
  });
});

describe("runValidator — jsonArray", () => {
  it("accepts arrays + JSON strings", () => {
    expect(runValidator(jsonArray, [{ a: 1 }], {})).toBeNull();
    expect(runValidator(jsonArray, "[1,2,3]", {})).toBeNull();
  });
  it("rejects other shapes", () => {
    expect(runValidator(jsonArray, "not-json", {})).toBe("Expected a JSON array");
    expect(runValidator(jsonArray, { a: 1 }, {})).toBe("Expected a JSON array");
  });
});

describe("runValidator — conditional", () => {
  it("only fires when predicate is true", () => {
    const v = conditional((vals) => vals.listOnPage === "yes");
    expect(runValidator(v, "", { listOnPage: "yes" })).toBe("Required");
    expect(runValidator(v, "anything", { listOnPage: "yes" })).toBeNull();
    expect(runValidator(v, "", { listOnPage: "no" })).toBeNull(); // skipped
  });
});