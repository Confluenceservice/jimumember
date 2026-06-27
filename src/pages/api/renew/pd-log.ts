import type { APIRoute } from "astro";
import { getRenewalById, updateRenewalPdEntries } from "../../../lib/renewal-sheet";
import type { PdEntry } from "../../../lib/renewal-sheet";
import { logger } from "../../../lib/logger";
import { validate } from "../../../lib/forms/runtime";
import { schema as pdLogSchema } from "../../../lib/forms/schemas/pdLog";
import type { FormSchema } from "../../../lib/forms/types";

/**
 * Build a per-entry validator schema from pdLogSchema's `entries` itemFields.
 * `walkFields` treats `repeatable` as a leaf and doesn't descend into
 * itemFields, so we synthesise a single-step schema from itemFields to
 * validate each entry individually.
 */
const entrySchema: FormSchema = {
  id: pdLogSchema.id + "_entry",
  content: pdLogSchema.content,
  steps: pdLogSchema.steps.map((step) => ({
    ...step,
    id: step.id + "_entry",
    fields: step.fields.flatMap((f) => (f.type === "repeatable" ? f.itemFields : [f])),
  })),
  storage: pdLogSchema.storage,
};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  if (!token) {
    return Response.json({ error: "Missing token" }, { status: 400 });
  }

  let renewal;
  try {
    renewal = await getRenewalById(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("pd_log.get_failed", { err: msg, token });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }

  if (!renewal) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (renewal.paymentStatus !== "paid") {
    return Response.json({ error: "Payment not confirmed" }, { status: 403 });
  }

  return Response.json({
    firstName: renewal.firstName,
    lastName: renewal.lastName,
    email: renewal.email,
    renewalYear: renewal.renewalYear,
    tier: renewal.tier,
    pdEntries: renewal.pdEntries,
  });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token, entries } = body as { token?: unknown; entries?: unknown };
  if (!token || typeof token !== "string") {
    return Response.json({ error: "Missing token" }, { status: 400 });
  }
  if (!Array.isArray(entries)) {
    return Response.json({ error: "entries must be an array" }, { status: 400 });
  }

  const cleaned: PdEntry[] = [];
  for (const raw of entries) {
    const r = validate(entrySchema, raw);
    if (!r.ok) {
      const first = Object.entries(r.errors)[0];
      return Response.json(
        { error: `Invalid entry: ${first?.[1] ?? "validation failed"}`, field: first?.[0] },
        { status: 400 },
      );
    }
    const v = r.values as Record<string, unknown>;
    cleaned.push({
      dateCompleted: String(v.dateCompleted ?? ""),
      activity: String(v.activity ?? ""),
      totalHours: Number(v.totalHours ?? 0),
      provider: String(v.provider ?? ""),
    });
  }

  let renewal;
  try {
    renewal = await getRenewalById(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("pd_log.post_lookup_failed", { err: msg, token });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }

  if (!renewal) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (renewal.paymentStatus !== "paid") {
    return Response.json({ error: "Payment not confirmed" }, { status: 403 });
  }

  try {
    await updateRenewalPdEntries(token, cleaned);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("pd_log.save_failed", { err: msg, token });
    return Response.json({ error: "Failed to save", retryable: true }, { status: 500 });
  }

  logger.info("pd_log.saved", { token, count: cleaned.length });
  return Response.json({ success: true });
};
