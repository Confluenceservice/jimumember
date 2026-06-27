/**
 * Schema-driven form — client runtime.
 *
 * Five DOM utilities that wire up interactivity on top of the static HTML
 * emitted by `FieldRenderer.astro`. Every primitive reads field `name`s
 * from the schema (passed as a serialized JSON island) — never from
 * hardcoded selectors — so the same runtime drives every form.
 *
 *   attachAutosaveQueue     — serializes POSTs to the save endpoint, one in-flight
 *   attachRepeatable        — add/remove rows for `repeatable` fields
 *   attachVisibleWhen       — show/hide wrappers via `visibleWhen` predicates
 *   attachUploadLock        — disables per-file upload buttons while in-flight
 *   hydrateFromResponse     — rehydrates the DOM from a saved-values API response
 *   mount                   — orchestrates all of the above for a form root
 *
 * Phase A ships functional skeletons. Phase C fills them out as forms
 * migrate (autosave retry/backoff, repeatable min/max enforcement,
 * visibleWhen for nested groups, upload lock token-bucket, etc.).
 */

import type { FieldDefinition, FormSchema } from "../types";

export interface AutosaveOptions {
  endpoint: string;
  /** Debounce window in ms (default 400). */
  debounceMs?: number;
  /** Trigger after every blur OR after every input (default blur). */
  trigger?: "blur" | "input";
  /**
   * Custom body serializer. Receives FormData and returns a string body.
   * Default: URL-encoded FormData (browser-native). For pages that need a
   * JSON payload with nested groups flattened or repeatables serialised,
   * pass `serialize: (fd) => JSON.stringify(buildPayload(fd))`.
   */
  serialize?: (fd: FormData) => string;
  /** Content-Type header. Default: "application/x-www-form-urlencoded". */
  contentType?: string;
}

export interface MountOptions {
  schema: FormSchema;
  /** Optional resume hydration payload (from the GET-by-token response). */
  initialValues?: Record<string, unknown>;
  /** Optional endpoint for autosave; omit to disable autosave entirely. */
  autosave?: AutosaveOptions;
}

// ----------------------------------------------------------------------------
// Autosave queue — serialized POSTs, no races. Phase A skeleton: serial FIFO
// driven by debounced blur events. Phase C replaces with retry/backoff +
// per-applicant queue + visibility-aware flush.
// ----------------------------------------------------------------------------

export function attachAutosaveQueue(
  form: HTMLFormElement,
  options: AutosaveOptions,
): { flush: () => Promise<void> } {
  const debounceMs = options.debounceMs ?? 400;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const submit = async () => {
    const fd = new FormData(form);
    const body = options.serialize ? options.serialize(fd) : new URLSearchParams(fd as unknown as Record<string, string>).toString();
    const contentType = options.contentType ?? (options.serialize ? "application/json" : "application/x-www-form-urlencoded");
    const res = await fetch(options.endpoint, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    if (!res.ok && res.status >= 500) {
      throw new Error(`autosave ${res.status}`);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      inflight = inflight.then(submit).catch((err) => {
        console.warn("[forms] autosave failed", err);
      });
    }, debounceMs);
  };

  form.addEventListener(options.trigger === "input" ? "input" : "focusout", schedule);

  return {
    flush: () => {
      if (timer) clearTimeout(timer);
      return (inflight = inflight.then(submit));
    },
  };
}

// ----------------------------------------------------------------------------
// Repeatable — add/remove rows. Phase A skeleton: clones the inline <template>,
// names `[ROW]` → row index, wires the remove button. Phase C adds min/max
// enforcement + serialised paste + accessibility announcements.
// ----------------------------------------------------------------------------

export function attachRepeatable(container: HTMLElement): void {
  const tmpl = container.querySelector<HTMLTemplateElement>(
    "template[data-repeatable-template]",
  );
  const addBtn = container.querySelector<HTMLButtonElement>(
    "button[data-repeatable-add]",
  );
  if (!tmpl || !addBtn) return;

  const minRows = Number(container.dataset.minRows ?? "0");
  let rowCount = container.querySelectorAll<HTMLElement>("[data-repeatable-row]").length;

  const renumber = () => {
    const rows = container.querySelectorAll<HTMLElement>("[data-repeatable-row]");
    rows.forEach((row, idx) => {
      row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      ).forEach((el) => {
        if (!el.name) return;
        // Replace the template placeholder AND any existing numeric suffix so
        // deletions leave a dense, zero-indexed name array. Without this,
        // deleting row 0 would leave `.1`/`.2` in place and the server would
        // see a sparse array with a hole at index 0.
        el.name = el.name.replace(/\.\[ROW\]/g, `.${idx}`).replace(/\.\d+(?=\b|$)/g, `.${idx}`);
      });
    });
    rowCount = rows.length;
    addBtn.disabled =
      container.dataset.maxRows !== undefined && rowCount >= Number(container.dataset.maxRows);
    if (rowCount <= minRows) {
      container
        .querySelectorAll<HTMLButtonElement>("[data-repeatable-remove]")
        .forEach((b) => {
          (b as HTMLButtonElement).disabled = true;
        });
    }
  };

  addBtn.addEventListener("click", () => {
    const frag = tmpl.content.cloneNode(true) as DocumentFragment;
    const row = frag.querySelector<HTMLElement>("[data-repeatable-row]");
    if (!row) return;
    container.insertBefore(row, addBtn);
    renumber();
  });

  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.matches("[data-repeatable-remove]")) return;
    const row = target.closest<HTMLElement>("[data-repeatable-row]");
    if (!row) return;
    row.remove();
    renumber();
  });

  renumber();
}

// ----------------------------------------------------------------------------
// VisibleWhen — show/hide fields via the schema's `visibleWhen` predicates.
// Phase A skeleton: re-evaluates on every input/blur. Phase C throttles and
// also handles nested groups + repeatable-row scoping.
// ----------------------------------------------------------------------------

export function attachVisibleWhen(form: HTMLFormElement, schema: FormSchema): void {
  const readValues = () => {
    const out: Record<string, unknown> = {};
    new FormData(form).forEach((v, k) => {
      out[k] = v;
    });
    return out;
  };

  const apply = () => {
    const values = readValues();
    for (const step of schema.steps) {
      for (const field of step.fields) {
        if (!field.visibleWhen) continue;
        const wrapper = form.querySelector<HTMLElement>(`[data-field-name="${field.name}"]`);
        if (!wrapper) continue;
        wrapper.hidden = !field.visibleWhen(values);
      }
    }
  };

  form.addEventListener("input", apply);
  form.addEventListener("change", apply);
  apply();
}

// ----------------------------------------------------------------------------
// Upload lock — disables per-file upload buttons while a request is in-flight.
// Phase A skeleton: single-button lock keyed by `data-upload-button`.
// Phase C handles file-level retry, multi-button per row, and the existing
// per-applicant serialisation queue.
// ----------------------------------------------------------------------------

export function attachUploadLock(form: HTMLFormElement, endpoint: string): void {
  form.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    if (!target.matches("[data-upload-button]")) return;
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>(
      `[data-upload-input-for="${target.dataset.uploadButton}"]`,
    );
    if (!input?.files?.[0]) return;
    (target as HTMLButtonElement).disabled = true;
    try {
      const fd = new FormData();
      fd.set("file", input.files[0]);
      fd.set("docType", target.dataset.uploadButton ?? "");
      await fetch(endpoint, { method: "POST", body: fd });
    } finally {
      (target as HTMLButtonElement).disabled = false;
    }
  });
}

// ----------------------------------------------------------------------------
// Resume hydration — sets field values from a saved API response.
// Phase A skeleton: text/email/tel/date/number/textarea + select + radio.
// Phase C adds nested groups, repeatable reconstruction, and grid-cell
// deserialisation (plan finding m2 — positional boolean arrays).
// ----------------------------------------------------------------------------

export function hydrateFromResponse(
  form: HTMLFormElement,
  values: Record<string, unknown>,
): void {
  for (const [name, raw] of Object.entries(values)) {
    if (raw === null || raw === undefined) continue;
    const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name="${CSS.escape(name)}"]`,
    );
    if (inputs.length === 0) continue;

    if (inputs[0].tagName === "INPUT" && (inputs[0] as HTMLInputElement).type === "radio") {
      const str = String(raw);
      inputs.forEach((el) => {
        if ((el as HTMLInputElement).value === str) (el as HTMLInputElement).checked = true;
      });
      continue;
    }

    if (inputs[0].tagName === "SELECT") {
      (inputs[0] as HTMLSelectElement).value = String(raw);
      continue;
    }

    if (inputs[0].tagName === "TEXTAREA") {
      (inputs[0] as HTMLTextAreaElement).value = String(raw);
      continue;
    }

    if ((inputs[0] as HTMLInputElement).type === "checkbox") {
      (inputs[0] as HTMLInputElement).checked = Boolean(raw);
      continue;
    }

    (inputs[0] as HTMLInputElement).value = String(raw);
  }
}

// ----------------------------------------------------------------------------
// Mount — orchestrates all primitives for a form root. The parent page
// passes the schema (loaded server-side from `.content.json` + a small TS
// stub) plus optional initial values + autosave options.
// ----------------------------------------------------------------------------

export function mount(root: HTMLElement, options: MountOptions): {
  form: HTMLFormElement | null;
} {
  const form = root.querySelector<HTMLFormElement>("form[data-schema-driven]");
  if (!form) return { form: null };

  if (options.initialValues) hydrateFromResponse(form, options.initialValues);
  attachVisibleWhen(form, options.schema);
  root.querySelectorAll<HTMLElement>("[data-repeatable-name]").forEach(attachRepeatable);
  if (options.autosave) attachAutosaveQueue(form, options.autosave);

  return { form };
}

// ----------------------------------------------------------------------------
// Schema-validation helper (plan finding M3): assert every value referenced
// by a `visibleWhen` / validator predicate exists in that field's option
// set. This is the safety net for keeping option **values** in TS while
// labels live in JSON.
// ----------------------------------------------------------------------------

export function assertOptionValuesExist(schema: FormSchema): string[] {
  const violations: string[] = [];
  // First pass: collect every option value across the schema so visibleWhen
  // predicates can reference ANY field's options.
  const allValues = new Set<string>();
  const collectValues = (field: FieldDefinition) => {
    if (field.type === "select" || field.type === "radio") {
      field.options.forEach((o) => allValues.add(o.value));
    }
    if (field.type === "group") field.fields.forEach(collectValues);
    if (field.type === "repeatable") field.itemFields.forEach(collectValues);
  };
  schema.steps.forEach((step) => step.fields.forEach(collectValues));

  // Second pass: every visibleWhen predicate must reference known option values.
  const collect = (field: FieldDefinition, path: string) => {
    if (field.visibleWhen) {
      const triggerValues = valuesOf(field.visibleWhen.toString());
      triggerValues.forEach((v) => {
        if (!allValues.has(v)) violations.push(`${path}: visibleWhen references ${v}`);
      });
    }
    if (field.type === "group") field.fields.forEach((child) => collect(child, `${path}.${child.name}`));
    if (field.type === "repeatable") field.itemFields.forEach((child) => collect(child, `${path}.${child.name}.[ROW]`));
  };
  schema.steps.forEach((step) => step.fields.forEach((f) => collect(f, f.name)));
  return violations;
}

function valuesOf(source: string): string[] {
  // Extract string literals from predicate source: "yes", 'no', etc.
  const matches = source.match(/["'`]([^"'`]+)["'`]/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}