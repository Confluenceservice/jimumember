// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { attachRepeatable, hydrateRepeatable } from "./form-client";

/**
 * Faithful reproduction of the markup FieldRenderer.astro emits for a
 * `repeatable` field (verified against the live /advanced/apply render):
 *   .repeatable[data-repeatable-name] > N live [data-repeatable-row]
 *     + <template data-repeatable-template> + [data-repeatable-add].
 * Live rows use dense `.<i>.` names; the template carries `.[ROW].`.
 */
function makeRepeatable(name: string, opts: { minRows: number; liveRows: number }): HTMLElement {
  const subFields = ["name", "provider", "year"];
  const rowHtml = (idx: string) =>
    `<div data-repeatable-row>${subFields
      .map((f) => `<input name="${name}.${idx}.${f}">`)
      .join("")}<button data-repeatable-remove>Remove</button></div>`;

  const live = Array.from({ length: opts.liveRows }, (_, i) => rowHtml(String(i))).join("");
  const container = document.createElement("div");
  container.className = "repeatable";
  container.dataset.repeatableName = name;
  container.dataset.minRows = String(opts.minRows);
  container.dataset.maxRows = "50";
  container.innerHTML =
    live +
    `<template data-repeatable-template>${rowHtml("[ROW]")}</template>` +
    `<button data-repeatable-add>Add</button>`;
  document.body.appendChild(container);
  return container;
}

const valueByName = (container: HTMLElement, name: string) =>
  (container.querySelector<HTMLInputElement>(`[name="${name}"]`) ?? null)?.value;

describe("hydrateRepeatable", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fills the single pre-rendered row without adding rows (attachRepeatable wired)", () => {
    const c = makeRepeatable("qualifications", { minRows: 1, liveRows: 1 });
    attachRepeatable(c); // wires the Add button, as mount() does

    hydrateRepeatable(c, [{ name: "First Aid", provider: "Red Cross", year: "2024" }]);

    expect(c.querySelectorAll("[data-repeatable-row]").length).toBe(1);
    expect(valueByName(c, "qualifications.0.name")).toBe("First Aid");
    expect(valueByName(c, "qualifications.0.provider")).toBe("Red Cross");
    expect(valueByName(c, "qualifications.0.year")).toBe("2024");
  });

  it("grows the row set via the Add button and renumbers to dense indices", () => {
    const c = makeRepeatable("qualifications", { minRows: 1, liveRows: 1 });
    attachRepeatable(c);

    hydrateRepeatable(c, [
      { name: "A", provider: "P1", year: "2020" },
      { name: "B", provider: "P2", year: "2021" },
      { name: "C", provider: "P3", year: "2022" },
    ]);

    expect(c.querySelectorAll("[data-repeatable-row]").length).toBe(3);
    expect(valueByName(c, "qualifications.0.name")).toBe("A");
    expect(valueByName(c, "qualifications.1.name")).toBe("B");
    expect(valueByName(c, "qualifications.2.name")).toBe("C");
    expect(valueByName(c, "qualifications.2.provider")).toBe("P3");
    // No stray [ROW] placeholders leaked from the template.
    expect(c.querySelector('[name*="[ROW]"]')).toBeNull();
  });

  it("clones the template directly when the Add button is NOT wired (timing fallback)", () => {
    const c = makeRepeatable("experience", { minRows: 0, liveRows: 0 });
    // deliberately do NOT call attachRepeatable — the Add click is a no-op,
    // so hydrateRepeatable must fall back to cloning the <template>.

    hydrateRepeatable(c, [
      { name: "X", provider: "PX", year: "2019" },
      { name: "Y", provider: "PY", year: "2018" },
    ]);

    expect(c.querySelectorAll("[data-repeatable-row]").length).toBe(2);
    expect(valueByName(c, "experience.0.name")).toBe("X");
    expect(valueByName(c, "experience.1.name")).toBe("Y");
    expect(c.querySelector('[name*="[ROW]"]')).toBeNull();
  });

  it("no-ops for empty or non-array input", () => {
    const c = makeRepeatable("qualifications", { minRows: 1, liveRows: 1 });
    attachRepeatable(c);

    hydrateRepeatable(c, []);
    hydrateRepeatable(c, undefined as unknown as unknown[]);

    expect(c.querySelectorAll("[data-repeatable-row]").length).toBe(1);
    expect(valueByName(c, "qualifications.0.name")).toBe("");
  });

  it("skips subkeys with no matching input and tolerates null values", () => {
    const c = makeRepeatable("qualifications", { minRows: 1, liveRows: 1 });
    attachRepeatable(c);

    hydrateRepeatable(c, [{ name: "Solo", unknownField: "ignored", provider: null }]);

    expect(valueByName(c, "qualifications.0.name")).toBe("Solo");
    expect(valueByName(c, "qualifications.0.provider")).toBe("");
  });
});
