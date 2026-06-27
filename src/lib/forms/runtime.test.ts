import { describe, expect, it } from "vitest";
import {
  validate,
  toRow,
  walkFields,
  SchemaNotFoundError,
} from "./runtime.js";
import { UnknownTierError } from "./tiers.js";
import type { FormSchema } from "./types.js";

const schema: FormSchema = {
  id: "testSample",
  content: {
    title: "Test form",
    steps: {
      identity: { title: "Identity", fields: { firstName: { label: "First name" } } },
      consent: { title: "Consent", fields: {} },
    },
  },
  steps: [
    {
      id: "identity",
      fields: [
        {
          name: "firstName",
          type: "text",
          required: true,
          contentKey: "identity.firstName",
          validators: [{ kind: "required", message: "Required" }],
        },
        {
          name: "agreedToTerms",
          type: "radio",
          required: true,
          contentKey: "identity.agreedToTerms",
          serialize: "boolean",
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
          validators: [{ kind: "ynRadio", message: "Yes or No required" }],
        },
        {
          name: "country",
          type: "text",
          contentKey: "identity.country",
          serialize: "upper",
          defaultValue: "nz",
        },
        {
          name: "pdEntries",
          type: "repeatable",
          contentKey: "renewal.pdEntries",
          serialize: "json",
          itemFields: [
            { name: "activity", type: "text", contentKey: "renewal.pdEntries.activity" },
            { name: "hours", type: "number", contentKey: "renewal.pdEntries.hours" },
          ],
        },
      ],
    },
    {
      id: "contact",
      fields: [
        {
          name: "email",
          type: "email",
          contentKey: "contact.email",
          validators: [
            { kind: "required", message: "Required" },
            { kind: "email", message: "Valid email required" },
          ],
        },
        {
          name: "details",
          type: "group",
          contentKey: "contact.details",
          fields: [
            {
              name: "phone",
              type: "tel",
              contentKey: "contact.details.phone",
            },
          ],
        },
      ],
    },
  ],
  storage: {
    kind: "sheet",
    sheetName: "Test Sheet",
    columnMap: {
      firstName: "A",
      agreedToTerms: "B",
      country: "C",
      pdEntries: "D",
      email: "E",
      "details.phone": "F",
    },
    rowFactory: "appendRenewal",
  },
};

describe("walkFields", () => {
  it("yields leaf fields in declaration order, descending into groups", () => {
    const names = Array.from(walkFields(schema)).map((w) => w.path);
    expect(names).toEqual([
      "firstName",
      "agreedToTerms",
      "country",
      "pdEntries",
      "email",
      "details.phone",
    ]);
  });
});

describe("validate", () => {
  it("returns errors for every missing required field", () => {
    const r = validate(schema, {});
    expect(r.ok).toBe(false);
    expect(r.errors.firstName).toBe("Required");
    expect(r.errors.agreedToTerms).toBe("Yes or No required");
    expect(r.errors.email).toBe("Required");
  });

  it("passes when all required fields are present and valid", () => {
    const r = validate(schema, {
      firstName: "Alice",
      agreedToTerms: "yes",
      email: "alice@example.com",
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
  });

  it("rejects CR/LF email payloads", () => {
    const r = validate(schema, {
      firstName: "Alice",
      agreedToTerms: "yes",
      email: "a@b.com\r\nBcc: v@y.com",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.email).toBe("Valid email required");
  });

  it("copies populated values into the values bag regardless of error state", () => {
    const r = validate(schema, { firstName: "Alice" });
    expect(r.values.firstName).toBe("Alice");
    expect(r.values.country).toBeUndefined(); // no default — runtime reads raw input
  });
});

describe("validate (implicit required safety net)", () => {
  // These schemas pair `required: true` with format-only validators (or none),
  // which previously let empty input pass. The implicit check in validate()
  // must catch them.

  function schemaWith(field: Partial<FormSchema["steps"][number]["fields"][number]> & { name: string; type: "text" | "email" }): FormSchema {
    return {
      id: "implicitRequiredTest",
      content: { title: "t", steps: { s: { title: "S", fields: {} } } },
      steps: [{ id: "s", fields: [field as FormSchema["steps"][number]["fields"][number]] }],
      storage: { kind: "sheet", sheetName: "X", columnMap: {}, rowFactory: "appendRenewal" },
    };
  }

  it("rejects empty when required:true with format-only validator (emailNZ)", () => {
    const s = schemaWith({
      name: "email",
      type: "email",
      required: true,
      contentKey: "s.email",
      validators: [{ kind: "email", message: "Valid email required" }],
    });
    const r = validate(s, {});
    expect(r.ok).toBe(false);
    expect(r.errors.email).toBe("Required");
  });

  it("rejects empty when required:true with no validators at all", () => {
    const s = schemaWith({
      name: "firstName",
      type: "text",
      required: true,
      contentKey: "s.firstName",
    });
    const r = validate(s, {});
    expect(r.ok).toBe(false);
    expect(r.errors.firstName).toBe("Required");
  });

  it("accepts empty when required:false with format-only validator (regression guard)", () => {
    const s = schemaWith({
      name: "email",
      type: "email",
      required: false,
      contentKey: "s.email",
      validators: [{ kind: "email", message: "Valid email required" }],
    });
    const r = validate(s, {});
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
  });

  it("honours requiredMessage override", () => {
    const s = schemaWith({
      name: "firstName",
      type: "text",
      required: true,
      requiredMessage: "Please enter your first name",
      contentKey: "s.firstName",
      validators: [{ kind: "minLength", value: 2, message: "Too short" }],
    });
    const r = validate(s, {});
    expect(r.errors.firstName).toBe("Please enter your first name");
  });

  it("explicit required validator wins over implicit message", () => {
    const s = schemaWith({
      name: "firstName",
      type: "text",
      required: true,
      requiredMessage: "implicit",
      contentKey: "s.firstName",
      validators: [{ kind: "required", message: "explicit" }],
    });
    const r = validate(s, {});
    expect(r.errors.firstName).toBe("explicit");
  });
});

describe("toRow", () => {
  it("maps field names to column letters and applies serialize rules", () => {
    const row = toRow(schema, {
      firstName: "Alice",
      agreedToTerms: "yes",
      country: "nz",
      pdEntries: [{ dateCompleted: "2026-01-15", hours: 3 }],
      email: "alice@example.com",
      details: { phone: "021234567" },
    });
    expect(row).toEqual({
      A: "Alice",
      B: "TRUE",
      C: "NZ",
      D: JSON.stringify([{ dateCompleted: "2026-01-15", hours: 3 }]),
      E: "alice@example.com",
      F: "021234567",
    });
  });

  it("emits FALSE for no / empty string for blank optionals", () => {
    const row = toRow(schema, {
      firstName: "Alice",
      agreedToTerms: "no",
      email: "a@b.com",
      pdEntries: [],
    });
    expect(row.B).toBe("FALSE");
    expect(row.D).toBe("[]");
    expect(row.C).toBe(""); // no value, no default at row time
  });

  it("drops fields not in columnMap", () => {
    const loose: FormSchema = {
      ...schema,
      storage: {
        ...schema.storage,
        columnMap: { firstName: "A" },
      },
    };
    const row = toRow(loose, {
      firstName: "Alice",
      email: "alice@example.com",
    });
    expect(row).toEqual({ A: "Alice" });
  });
});

describe("error classes", () => {
  it("UnknownTierError + SchemaNotFoundError carry id", () => {
    expect(new UnknownTierError("foo").message).toBe("Unknown tier: foo");
    expect(new SchemaNotFoundError("bar").message).toBe("Schema not found: bar");
  });
});