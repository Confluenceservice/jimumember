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
