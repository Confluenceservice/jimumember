import { describe, expect, it } from "vitest";
import { schema } from "./pdLog";
import { validate } from "../runtime";
import type { RepeatableField } from "../types";

describe("pdLog schema", () => {
  it("id is pdLog", () => {
    expect(schema.id).toBe("pdLog");
  });

  it("has a single 'entries' repeatable with 4 itemFields", () => {
    expect(schema.steps).toHaveLength(1);
    const fields = schema.steps[0].fields;
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe("repeatable");
    expect(fields[0].name).toBe("entries");
    expect((fields[0] as RepeatableField).itemFields.map((f: { name: string }) => f.name)).toEqual([
      "dateCompleted", "activity", "totalHours", "provider",
    ]);
  });

  it("validate(schema, {}) accepts — entries is optional + treated as leaf", () => {
    // walkFields treats repeatable as a leaf; per-entry validation lives in
    // the handler. validate(schema, body) therefore only fails on shape
    // errors, of which there are none when entries is absent.
    const r = validate(schema, {});
    expect(r.ok).toBe(true);
  });

  it("validate(schema, { entries: [...] }) accepts an entries array", () => {
    const r = validate(schema, {
      entries: [{ dateCompleted: "2026-02-15", activity: "Workshop", totalHours: 3, provider: "Hospice NZ" }],
    });
    expect(r.ok).toBe(true);
  });

  it("entries repeatable allows minRows 0 (no floor)", () => {
    const repeatable = schema.steps[0].fields[0] as RepeatableField;
    expect(repeatable.type).toBe("repeatable");
    expect(repeatable.minRows ?? 0).toBe(0);
  });

  it("columnMap targets Renewals H column for JSON-encoded entries", () => {
    expect(schema.storage.columnMap.pdEntries).toBe("H");
    expect(schema.storage.sheetName).toBe("Renewals");
  });
});
