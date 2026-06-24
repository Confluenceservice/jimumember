/**
 * Returns the staging folder-name prefix for the current environment.
 *
 * Set STAGING_PREFIX=testing- on the staging Fly app to keep staging
 * applicants visually separate from production in the shared Drive. The
 * upload + review-doc code prepends this to top-level application
 * subfolder names (e.g. "PM Applications" → "testing-PM Applications"),
 * creating an isolated subtree for staging data without touching the
 * production folders.
 *
 * Production and local dev leave the env var unset (empty string = no
 * prefix), so the existing `PM Applications` / `AM Applications` folders
 * are reused.
 */
export function getStagingPrefix(): string {
  return process.env.STAGING_PREFIX?.trim() ?? "";
}

/**
 * Returns the public base URL for the current environment.
 *
 * Used to build absolute links in outbound emails (e.g. PD-log link,
 * resume links) so they point at the app the recipient is actually on.
 *
 * Resolution order:
 *   1. PUBLIC_APP_URL — explicit override (preferred for staging/prod split)
 *   2. STAGING_PREFIX set → https://subscribe-test.eldaa.org.nz (staging)
 *   3. fallback → https://subscribe.eldaa.org.nz (production)
 *
 * Production keeps no env vars. Staging sets only STAGING_PREFIX=testing-
 * and gets the staging URL automatically. Setting PUBLIC_APP_URL wins.
 */
export function getPublicAppUrl(): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit;
  if (getStagingPrefix()) return "https://subscribe-test.eldaa.org.nz";
  return "https://subscribe.eldaa.org.nz";
}
