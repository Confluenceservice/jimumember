import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Static guards for the bug-004 class: stale route literals that survive a
 * `professional → advanced` rename, and client `fetch()`/`xhr.open()` paths in
 * `.astro` inline scripts that point at API routes which do not exist.
 *
 * These bugs lived entirely in string literals inside `.astro` inline scripts
 * and API redirect URLs — places the node-only Vitest suite never executed and
 * the Playwright smoke can only reach for paths an interaction actually fires.
 * This file closes that gap cheaply by reading the source as text.
 *
 * See .wolf/buglog.json bug-004 / bug-006 and the e2e/ smoke layer.
 */

const SRC_DIR = join(process.cwd(), "src");
const THIS_FILE = "src/lib/__guards__/stale-paths.test.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|astro)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = walk(SRC_DIR)
  .map((f) => relative(process.cwd(), f))
  .filter((f) => f !== THIS_FILE);

describe("stale-path guard: no /professional route literals survive the rename", () => {
  // Matches a `/professional` or `/api/professional` URL *segment* — i.e. one
  // that ends at a path boundary (slash, quote, query, hash, whitespace, close
  // paren, or end of line). Deliberately does NOT match the legitimate non-route
  // uses: `declaration_professional_dev` (no leading slash), "Professional
  // Development" (no slash, capitalised), or external `…/professional-membership`
  // marketing URLs (followed by `-`).
  const STALE_ROUTE = /\/(?:api\/)?professional(?=[/"'`?#\s)]|$)/;

  it("has no /professional/ or /api/professional references in src", () => {
    const violations: string[] = [];
    for (const file of SOURCE_FILES) {
      const lines = readFileSync(join(process.cwd(), file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (STALE_ROUTE.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      violations,
      `Stale /professional route literal(s) found — rename them to /advanced/:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});

describe("client↔route contract: every API path the apply wizard fetches has a route file", () => {
  // Extract the static prefix of each `fetch("/api/…")` / `xhr.open(…, "/api/…")`
  // literal, up to the first query/template/quote boundary. This is the exact
  // bug-004 surface: a client path with no matching src/pages/api/*.ts route 404s.
  const API_LITERAL = /["'`](\/api\/[A-Za-z0-9/_-]+)/g;

  function routeFileExists(apiPath: string): boolean {
    // /api/advanced/apply -> src/pages/api/advanced/apply.ts
    const rel = apiPath.replace(/^\//, "");
    const base = join(process.cwd(), "src", "pages", rel);
    if (existsSync(`${base}.ts`)) return true;
    // Dynamic route fallback: /api/renew/checkout/basic -> .../checkout/[tier].ts
    const parts = rel.split("/");
    parts.pop();
    const dynDir = join(process.cwd(), "src", "pages", ...parts);
    if (existsSync(dynDir)) {
      for (const entry of readdirSync(dynDir)) {
        if (/^\[.+\]\.ts$/.test(entry)) return true;
      }
    }
    return false;
  }

  const CLIENT_PAGES = [
    "src/pages/advanced/apply.astro",
    "src/pages/apply.astro",
  ].filter((f) => existsSync(join(process.cwd(), f)));

  it("maps each fetched /api/ path in the apply pages to an existing route", () => {
    const missing: string[] = [];
    for (const page of CLIENT_PAGES) {
      const text = readFileSync(join(process.cwd(), page), "utf8");
      const seen = new Set<string>();
      for (const m of text.matchAll(API_LITERAL)) {
        const apiPath = m[1];
        if (seen.has(apiPath)) continue;
        seen.add(apiPath);
        if (!routeFileExists(apiPath)) {
          missing.push(`${page}: fetch("${apiPath}") has no route file under src/pages`);
        }
      }
    }
    expect(
      missing,
      `Client fetch path(s) with no matching API route (bug-004 class):\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
