import { describe, expect, it } from "vitest";
import { assertOptionValuesExist } from "./form-client";
import type { FormSchema } from "../types";

describe("assertOptionValuesExist (pure — no DOM)", () => {
  it("returns no violations for a schema with no visibleWhen", () => {
    const schema: FormSchema = {
      id: "x", content: {} as FormSchema["content"],
      steps: [{
        id: "s",
        fields: [{ name: "color", type: "radio", contentKey: "s.color", options: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }] }],
      }],
      storage: { kind: "sheet", sheetName: "X", columnMap: {}, rowFactory: "appendRenewal" },
    };
    expect(assertOptionValuesExist(schema)).toEqual([]);
  });

  it("returns no violations when visibleWhen references an existing option value", () => {
    const schema: FormSchema = {
      id: "x", content: {} as FormSchema["content"],
      steps: [{
        id: "s",
        fields: [
          { name: "listOnPage", type: "radio", contentKey: "s.lop", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
          { name: "details", type: "textarea", contentKey: "s.d", visibleWhen: (v) => v.listOnPage === "yes" },
        ],
      }],
      storage: { kind: "sheet", sheetName: "X", columnMap: {}, rowFactory: "appendRenewal" },
    };
    expect(assertOptionValuesExist(schema)).toEqual([]);
  });

  it("flags visibleWhen predicates that reference a non-existent option value", () => {
    const schema: FormSchema = {
      id: "x", content: {} as FormSchema["content"],
      steps: [{
        id: "s",
        fields: [
          { name: "listOnPage", type: "radio", contentKey: "s.lop", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
          { name: "details", type: "textarea", contentKey: "s.d", visibleWhen: (v) => v.listOnPage === "maybe" },
        ],
      }],
      storage: { kind: "sheet", sheetName: "X", columnMap: {}, rowFactory: "appendRenewal" },
    };
    const violations = assertOptionValuesExist(schema);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("maybe");
    expect(violations[0]).toContain("details");
  });

  it("descends into group fields when checking visibleWhen", () => {
    const schema: FormSchema = {
      id: "x", content: {} as FormSchema["content"],
      steps: [{
        id: "s",
        fields: [
          {
            name: "nested", type: "group", contentKey: "s.n",
            fields: [
              { name: "pick", type: "radio", contentKey: "s.n.p", options: [{ value: "a", label: "A" }] },
              { name: "followup", type: "text", contentKey: "s.n.f", visibleWhen: (v) => v.pick === "z" },
            ],
          },
        ],
      }],
      storage: { kind: "sheet", sheetName: "X", columnMap: {}, rowFactory: "appendRenewal" },
    };
    expect(assertOptionValuesExist(schema).length).toBe(1);
  });
});

// NOTE: attachAutosaveQueue, attachRepeatable, attachVisibleWhen, mount, and
// hydrateFromResponse all touch the DOM and need a DOM environment. Those
// tests are deferred to a follow-up that wires jsdom/happy-dom into
// vitest.config.ts — the function-level coverage above locks in the
// schema-validation safety net (plan finding M3) which is the most critical
// pure-function path.
