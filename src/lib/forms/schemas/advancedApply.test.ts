import { describe, expect, it } from "vitest";
import { schema, COMPETENCY_IDS } from "./advancedApply";
import { validate, toRow } from "../runtime";
import { getTier } from "../tiers";

describe("advancedApply schema", () => {
  it("matches the tier config for advanced", () => {
    const tier = getTier("advanced");
    expect(tier.applicationSchemaId).toBe("advancedApply");
    expect(schema.id).toBe(tier.applicationSchemaId);
    expect(schema.storage.sheetName).toBe(tier.sheetName);
  });

  it("has 8 steps in order", () => {
    expect(schema.steps.map((s) => s.id)).toEqual([
      "about",
      "training",
      "experience",
      "furtherRequirements",
      "competencies",
      "referees",
      "declarations",
      "uploads",
    ]);
  });

  it("exposes 21 competency columns in the legacy order (plan finding m2)", () => {
    expect(COMPETENCY_IDS).toHaveLength(21);
    expect(COMPETENCY_IDS[0]).toBe("effectiveCommunication");
    expect(COMPETENCY_IDS[20]).toBe("mentorship");
    // The grid must reference every competency id in order.
    const grid = schema.steps[4].fields[0];
    expect(grid.name).toBe("coreCompetencies");
    if (grid.type === "grid") {
      expect(grid.columns.map((c) => c.name)).toEqual([...COMPETENCY_IDS]);
    }
  });

  it("rejects missing identity fields", () => {
    const r = validate(schema, {});
    expect(r.ok).toBe(false);
    expect(r.errors.firstName).toBe("Required");
    expect(r.errors.lastName).toBe("Required");
    expect(r.errors.email).toBe("Required");
    expect(r.errors.dateOfBirth).toBe("Required");
  });

  it("rejects CR/LF email injection", () => {
    const r = validate(schema, {
      firstName: "A",
      lastName: "B",
      dateOfBirth: "1990-01-01",
      email: "a@b.com\r\nBcc: v@y.com",
    });
    expect(r.errors.email).toBe("Valid email required");
  });

  it("accepts a complete valid payload", () => {
    const r = validate(schema, {
      firstName: "Alice",
      lastName: "Smith",
      dateOfBirth: "1990-01-01",
      email: "alice@example.com",
      qualifications: [{ name: "Foundations Training", provider: "Example Institute", year: 2024 }],
      furtherRequirements: { agreeMemberServices: "YES", agreeInterview: "YES" },
      coreCompetencies: { effectiveCommunication: "YES" },
      referee1Name: "R1",
      referee1Email: "r1@example.com",
      referee2Name: "R2",
      referee2Email: "r2@example.com",
      declarationAccuracy: true,
      declarationEthics: true,
      declarationScope: true,
      declarationMemberServices: true,
      declarationInterview: true,
      declarationProfessionalDev: true,
      declarationCriminalCheck: true,
      declarationMeetings: true,
      signature: "Alice Smith",
    });
    expect(r.ok).toBe(true);
  });

  it("has a required signature field on the declarations step", () => {
    const declarations = schema.steps[6];
    expect(declarations.id).toBe("declarations");
    const sig = declarations.fields.find((f) => f.name === "signature");
    expect(sig?.type).toBe("signature");
    expect(sig?.required).toBe(true);
  });

  it("requires the signature (rejects blank, accepts typed name OR drawn Drive link)", () => {
    const base = {
      firstName: "Alice", lastName: "Smith", dateOfBirth: "1990-01-01", email: "a@b.com",
      qualifications: [{ name: "Foundations", provider: "X", year: 2024 }],
      referee1Name: "R1", referee1Email: "r1@example.com",
      referee2Name: "R2", referee2Email: "r2@example.com",
      declarationAccuracy: true, declarationEthics: true, declarationScope: true,
      declarationMemberServices: true, declarationInterview: true,
      declarationProfessionalDev: true, declarationCriminalCheck: true, declarationMeetings: true,
    };
    expect(validate(schema, base).errors.signature).toBe("Required");
    expect(validate(schema, { ...base, signature: "Alice Smith" }).errors.signature).toBeUndefined();
    expect(
      validate(schema, { ...base, signature: "https://drive.google.com/file/d/abc/view" }).errors.signature,
    ).toBeUndefined();
  });

  it("serializes the signature value to column AV via toRow", () => {
    const link = "https://drive.google.com/file/d/abc/view";
    const r = validate(schema, {
      firstName: "Alice", lastName: "Smith", dateOfBirth: "1990-01-01", email: "a@b.com",
      signature: link,
    });
    expect(toRow(schema, r.values).AV).toBe(link);
  });

  it("emits the correct column letters via toRow (form-derived only)", () => {
    const r = validate(schema, {
      firstName: "Alice",
      lastName: "Smith",
      dateOfBirth: "1990-01-01",
      email: "alice@example.com",
    });
    const row = toRow(schema, r.values);
    expect(row.C).toBe("Alice");
    expect(row.D).toBe("Smith");
    expect(row.B).toBe("alice@example.com");
    expect(row.F).toBe("1990-01-01");
  });

  it("does not include managed cells (emailHash, doc counts, complete, paid)", () => {
    const r = validate(schema, {
      firstName: "A", lastName: "B", dateOfBirth: "1990-01-01", email: "a@b.com",
    });
    const row = toRow(schema, r.values);
    // AH (emailHash), AS (created_at), AT paid_at, AU email_verified,
    // AP complete, AQ payment_ref, AR paid, AI-AO doc counts.
    // (NB: AU is email_verified per upload-sheet.ts:89 — CLAUDE.md's
    // "spare/reserved" is stale; the code is the source of truth.)
    const managed = ["AH", "AS", "AT", "AU", "AP", "AQ", "AR", "AI", "AJ", "AK", "AL", "AM", "AN", "AO"];
    managed.forEach((col) => expect(row[col]).toBeUndefined());
  });

  it("registers all 7 doc types (6 required + 1 optional)", () => {
    expect(schema.uploads?.docTypes).toHaveLength(7);
    const required = schema.uploads?.docTypes.filter((d) => d.required) ?? [];
    expect(required).toHaveLength(6);
    expect(schema.uploads?.docTypes.find((d) => d.id === "insurance")?.required).toBe(false);
  });

  it("declares 8 steps in wizard order (about → training → experience → furtherRequirements → competencies → referees → declarations → uploads)", () => {
    // Phase J1: Step + FieldRenderer walks steps in declaration order. The
    // wizard UX assumes this order; reorder breaks the visual flow.
    expect(schema.steps.map((s) => s.id)).toEqual([
      "about", "training", "experience", "furtherRequirements",
      "competencies", "referees", "declarations", "uploads",
    ]);
  });
});