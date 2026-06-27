import { describe, expect, it } from "vitest";
import { schema } from "./renewBasic";
import { validate, toRow } from "../runtime";
import { getTier } from "../tiers";

describe("renewAssociate schema", () => {
  it("loads and matches the tier config", () => {
    const tier = getTier("basic");
    expect(tier.renewalSchemaId).toBe("renewBasic");
    expect(schema.id).toBe(tier.renewalSchemaId);
    expect(schema.storage.sheetName).toBe(tier.renewalSheetName);
  });

  it("rejects empty / missing required fields", () => {
    const r = validate(schema, {});
    expect(r.ok).toBe(false);
    expect(r.errors.firstName).toBe("Required");
    expect(r.errors.lastName).toBe("Required");
    expect(r.errors.email).toBe("Required");
    expect(r.errors.year).toBe("Required");
  });

  it("rejects malformed email (incl. CR/LF injection)", () => {
    const r = validate(schema, {
      firstName: "A",
      lastName: "B",
      email: "a@b.com\r\nBcc: v@y.com",
      year: 2026,
    });
    expect(r.errors.email).toBe("Valid email required");
  });

  it("accepts a complete valid payload", () => {
    const r = validate(schema, {
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      year: 2026,
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
  });

  it("rejects out-of-range year", () => {
    const r1 = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", year: 2020,
    });
    expect(r1.errors.year).toMatch(/≥ 2024/);
    const r2 = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", year: 2200,
    });
    expect(r2.errors.year).toMatch(/≤ 2100/);
  });

  it("rejects non-integer year (covers float / string payloads)", () => {
    const r = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", year: 2025.5,
    });
    expect(r.errors.year).toBe("Must be a whole number");
  });

  it("emits the correct column letters via toRow", () => {
    const r = validate(schema, {
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      year: 2026,
    });
    const row = toRow(schema, r.values);
    expect(row).toEqual({
      C: "2026",
      D: "Alice",
      E: "Smith",
      F: "alice@example.com",
    });
  });

  it("does NOT include managed cells (renewal_id, tier, paid_at, etc.)", () => {
    const r = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", year: 2026,
    });
    const row = toRow(schema, r.values);
    const managed = ["A", "B", "G", "H", "I", "J", "K", "L", "M", "N"];
    managed.forEach((col) => expect(row[col]).toBeUndefined());
  });
});