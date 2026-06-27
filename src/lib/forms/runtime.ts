/**
 * Schema-driven form system — runtime.
 *
 * Five pure functions used by both the server (API routes) and (read-only)
 * the client (resume hydration):
 *
 *   loadSchema(id)              — load + freeze a schema (TS + JSON content)
 *   validate(schema, body)      — produce ValidationResult
 *   toRow(schema, values)       — produce Record<columnLetter, string> for sheet write
 *   mapApiResponseToValues      — hydrate form values from a saved row / API response
 *   validateTier(slug, body)    — tier-aware validate (uses TIERS to pick schema)
 *
 * `toRow` is the single place that knows a form's column layout. API
 * handlers call it before handing the row to existing `createApplicantRow`
 * / `appendRenewal` / `appendAssociateApplication`. The 47/14/16-column
 * layouts in `upload-sheet.ts` / `renewal-sheet.ts` / `google-sheets.ts`
 * stay byte-identical; this layer is an adapter, not a replacement.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  FieldDefinition,
  FieldValues,
  FormContent,
  FormSchema,
  Step,
} from "./types.js";
import { runValidator } from "./validators.js";

export interface ValidationResult {
  ok: boolean;
  /** fieldName → first error message */
  errors: Record<string, string>;
  /** Coerced + default-applied values bag (post-validation, ready for toRow). */
  values: FieldValues;
}

export class SchemaNotFoundError extends Error {
  constructor(id: string) {
    super(`Schema not found: ${id}`);
    this.name = "SchemaNotFoundError";
  }
}

// -- schema loader -------------------------------------------------------------

const SCHEMA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "schemas");

/** Resolve a schema file by id. The .ts file must `export const schema: FormSchema`. */
function resolveSchemaPath(id: string): { tsPath: string; jsonPath: string } {
  return {
    tsPath: resolve(SCHEMA_DIR, `${id}.ts`),
    jsonPath: resolve(SCHEMA_DIR, `${id}.content.json`),
  };
}

/**
 * Load a schema by id. Reads sibling `.ts` (TS structure) + `.content.json`
 * (editable content) and freezes the merged object. Implemented as a
 * dynamic import + JSON read so the runtime can pick the schema by id
 * without forcing callers to import every form's TS file up front.
 *
 * Throws `SchemaNotFoundError` if either file is missing.
 */
export async function loadSchema(id: string): Promise<FormSchema> {
  const { tsPath, jsonPath } = resolveSchemaPath(id);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(tsPath)) as Record<string, unknown>;
  } catch (cause) {
    throw new SchemaNotFoundError(`${id} (${tsPath})`);
  }
  const tsSchema = mod.schema ?? mod.default;
  if (!tsSchema || typeof tsSchema !== "object") {
    throw new SchemaNotFoundError(`${id} — no schema export in ${tsPath}`);
  }
  let content: FormContent;
  try {
    content = JSON.parse(readFileSync(jsonPath, "utf8")) as FormContent;
  } catch (cause) {
    throw new SchemaNotFoundError(`${id} (${jsonPath})`);
  }
  return Object.freeze({ ...(tsSchema as FormSchema), content }) as FormSchema;
}

// -- field walker --------------------------------------------------------------

/**
 * Walk all leaf fields in a schema in declaration order, yielding
 * `(field, path)` pairs. `path` is the dotted FormData key the client
 * should use (e.g. `referee1.email`, `qualifications[0].provider`,
 * `coreCompetencies.decisionMaking`).
 */
export function* walkFields(
  schema: FormSchema,
): Generator<{ field: FieldDefinition; path: string }> {
  for (const step of schema.steps) {
    yield* walkStep(step, "");
  }
}

function* walkStep(step: Step, prefix: string): Generator<{ field: FieldDefinition; path: string }> {
  for (const field of step.fields) {
    yield* walkField(field, prefix);
  }
}

function* walkField(
  field: FieldDefinition,
  prefix: string,
): Generator<{ field: FieldDefinition; path: string }> {
  const path = prefix ? `${prefix}.${field.name}` : field.name;
  if (field.type === "group") {
    for (const child of field.fields) {
      yield* walkField(child, path);
    }
    return;
  }
  yield { field, path };
}

// -- validate ------------------------------------------------------------------

/**
 * Validate a raw request body against a schema. Walks every leaf field,
 * applies its validators, collects first error per field, and returns a
 * coerced values bag ready for `toRow`.
 *
 * Note: `visibleWhen` is a render-time concern, not a validation one.
 * Hidden fields are skipped (their values are not required).
 */
export function validate(schema: FormSchema, body: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  const values: FieldValues = {};
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  for (const { field, path } of walkFields(schema)) {
    if (field.visibleWhen && !field.visibleWhen(raw as FieldValues)) {
      continue; // hidden — skip both validation and copy-through
    }
    const value = readPath(raw, path);
    const validators = field.validators ?? [];

    let firstError: string | null = null;
    for (const v of validators) {
      const err = runValidator(v, value, raw as FieldValues);
      if (err && !firstError) firstError = err;
    }
    if (firstError) errors[path] = firstError;
    writePath(values, path, value);
  }

  return { ok: Object.keys(errors).length === 0, errors, values };
}

// -- toRow ---------------------------------------------------------------------

/**
 * Produce a column-letter → cell-value map suitable for positional sheet
 * writers. Applies per-field `serialize` rules and uses `storage.columnMap`
 * for the field-to-letter translation. Fields not in `columnMap` are
 * dropped (managed cells like `emailHash`, `created_at`, doc counts stay
 * in `upload-sheet.ts` / `renewal-sheet.ts` and are appended by those
 * layers — see plan finding M2).
 */
export function toRow(schema: FormSchema, values: FieldValues): Record<string, string> {
  const out: Record<string, string> = {};
  const map = schema.storage.columnMap;

  for (const { field, path } of walkFields(schema)) {
    const column = map[path] ?? map[field.name];
    if (!column) continue;
    const value = readPath(values, path);
    out[column] = serializeValue(value, field);
  }

  return out;
}

function serializeValue(value: unknown, field: FieldDefinition): string {
  if (value === null || value === undefined) return "";
  const rule = field.serialize ?? "string";

  switch (rule) {
    case "string":
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return JSON.stringify(value);

    case "upper":
      return String(value).toUpperCase();

    case "boolean": {
      // Y/N radio → "TRUE"/"FALSE" for the sheet
      const v = String(value).toLowerCase();
      if (v === "yes" || v === "true") return "TRUE";
      if (v === "no" || v === "false") return "FALSE";
      return "";
    }

    case "json":
      // Repeatable rows / object bags → JSON-encoded string in a single cell
      return JSON.stringify(value);
  }
}

// -- resume hydration ----------------------------------------------------------

/**
 * Hydrate a form values bag from a saved API response. Used by the client
 * resume flow: GET `/api/.../apply?token=...` returns a partial applicant
 * record; the client maps the JSON-shaped fields back into FormData names
 * so the renderer can rehydrate the DOM.
 *
 * This is a thin pass-through for v1 — schema-driven mapping (including
 * nested group/repeatable reconstruction) lands when forms migrate in
 * Phase B-D.
 */
export function mapApiResponseToValues(
  response: Record<string, unknown>,
  _schema: FormSchema,
): FieldValues {
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(response)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

// -- tier-aware validate -------------------------------------------------------

/**
 * Tier-aware entry point: looks up the schema for a tier slug and
 * validates the body against it. Throws `UnknownTierError` if the slug
 * is not registered. Used by the dynamic `/api/renew/checkout/[tier]`
 * route (Phase B2+).
 */
export async function validateTier(tierSlug: string, body: unknown): Promise<ValidationResult> {
  const { getTier } = await import("./tiers.js");
  const tier = getTier(tierSlug);
  const schema = await loadSchema(tier.renewalSchemaId);
  return validate(schema, body);
}

// -- path helpers --------------------------------------------------------------

function readPath(obj: Record<string, unknown>, path: string): unknown {
  // Dotted paths (groups like "referees.referee1Name") try nested first,
  // then fall back to the flat last-segment key — FormData posts flat
  // keys even when the schema groups them. Nested takes priority so
  // callers that DO send grouped payloads are read correctly.
  if (!path.includes(".")) return obj[path];
  const segments = path.split(".");
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      cur = undefined;
      break;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur === undefined) {
    return obj[segments[segments.length - 1]];
  }
  return cur;
}

function writePath(obj: FieldValues, path: string, value: unknown): void {
  if (!path.includes(".")) {
    obj[path] = value;
    return;
  }
  const segments = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = cur[seg];
    if (next === null || next === undefined || typeof next !== "object") {
      const fresh: Record<string, unknown> = {};
      cur[seg] = fresh;
      cur = fresh;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  cur[segments[segments.length - 1]] = value;
}