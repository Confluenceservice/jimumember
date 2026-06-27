import { describe, expect, it } from "vitest";
import { schema } from "./renewAdvanced";
import { validate, toRow } from "../runtime";
import { getTier } from "../tiers";

describe("renewPro schema", () => {
  it("matches the tier config for advanced", () => {
    const tier = getTier("advanced");
    expect(tier.renewalSchemaId).toBe("renewAdvanced");
    expect(schema.id).toBe(tier.renewalSchemaId);
  });

  it("requires phone (Pro-only; Associate doesn't collect it)", () => {
    const r = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", year: 2026,
    });
    expect(r.errors.phone).toBe("Required");
  });

  it("accepts a complete valid payload with PD entries", () => {
    const r = validate(schema, {
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      phone: "021234567",
      year: 2026,
      pdEntries: [
        { dateCompleted: "2026-01-15", activity: "Workshop", totalHours: 3, provider: "Hospice NZ" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("emits column letters C/D/E/F/G + H for JSON pdEntries", () => {
    const r = validate(schema, {
      firstName: "Alice", lastName: "Smith",
      email: "alice@example.com", phone: "021234567", year: 2026,
      pdEntries: [{ activity: "Workshop", totalHours: 3 }],
    });
    const row = toRow(schema, r.values);
    expect(row.C).toBe("2026");
    expect(row.D).toBe("Alice");
    expect(row.E).toBe("Smith");
    expect(row.F).toBe("alice@example.com");
    expect(row.G).toBe("021234567");
    expect(row.H).toBe(JSON.stringify([{ activity: "Workshop", totalHours: 3 }]));
  });
});