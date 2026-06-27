import { describe, expect, it } from "vitest";
import { schema } from "./example.memberSurvey";
import { validate, toRow } from "../runtime";

describe("exampleMemberSurvey schema (Phase E reference)", () => {
  it("id is exampleMemberSurvey", () => {
    expect(schema.id).toBe("exampleMemberSurvey");
  });

  it("exercises every FieldDefinition variant", () => {
    const types = new Set<string>();
    type F = { type: string; fields?: F[]; itemFields?: F[] };
    const visit = (field: F) => {
      types.add(field.type);
      if (Array.isArray(field.fields)) field.fields.forEach(visit);
      if (Array.isArray(field.itemFields)) field.itemFields.forEach(visit);
    };
    for (const step of schema.steps) step.fields.forEach(visit);
    expect(types).toEqual(
      new Set([
        "text", "email", "tel", "date", "number",
        "textarea", "select", "radio", "checkbox",
        "repeatable", "grid", "group",
      ]),
    );
  });

  it("validates identity fields", () => {
    const r = validate(schema, {});
    expect(r.errors.firstName).toBe("Required");
    expect(r.errors.lastName).toBe("Required");
    expect(r.errors.email).toBe("Required");
    expect(r.errors.memberSince).toBe("Required");
    expect(r.errors.satisfaction).toBe("Required");
  });

  it("requires referralDetail only when referralSource=other", () => {
    const base = {
      firstName: "A", lastName: "B", email: "a@b.com", memberSince: "2024-01-01",
      satisfaction: "very", improvementAreas: "events",
    };

    const noDetail = validate(schema, { ...base, referralSource: "friend" });
    expect(noDetail.errors.referralDetail).toBeUndefined();

    const otherEmpty = validate(schema, { ...base, referralSource: "other", referralDetail: "" });
    expect(otherEmpty.errors.referralDetail).toBe("Required");

    const otherFilled = validate(schema, { ...base, referralSource: "other", referralDetail: "Search engine" });
    expect(otherFilled.errors.referralDetail).toBeUndefined();
  });

  it("hides referralDetail when referralSource !== 'other' (visibleWhen skip)", () => {
    const r = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", memberSince: "2024-01-01",
      satisfaction: "very", improvementAreas: "events",
      referralSource: "friend", referralDetail: "ignored",
    });
    // detail is hidden via visibleWhen — value is NOT copied into values bag
    expect(r.values.referralDetail).toBeUndefined();
  });

  it("emits column letters via toRow", () => {
    const r = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", memberSince: "2024-01-01",
      satisfaction: "very", improvementAreas: "events",
    });
    const row = toRow(schema, r.values);
    expect(row.A).toBe("A");
    expect(row.B).toBe("B");
    expect(row.C).toBe("a@b.com");
    expect(row.E).toBe("2024-01-01");
    expect(row.F).toBe("very");
  });
});