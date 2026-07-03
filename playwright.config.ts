import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke harness. Drives the REAL built Astro server (node-standalone
 * adapter, port 4321) so client→route wiring is exercised end-to-end — the
 * exact surface bug-004 (stale /api/professional/* → 404) escaped through.
 *
 * External services are neutralised by the E2E_STUB server shim (see
 * src/lib/upload-sheet.ts + src/lib/email-sender.ts), NOT by Playwright route
 * mocks: Stripe/Sheets/Mailgun are server-side Node calls a browser cannot
 * intercept. A single stubbed server drives both the email-success and
 * email-failure paths via a recipient sentinel ("forcefail…") — see apply.spec.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      E2E_STUB: "1",
      PUBLIC_APP_URL: "http://localhost:4321",
      // Present, non-empty: upload-sheet helpers assert this before reaching the
      // (stubbed) Sheets client. Value is never used — no real call is made.
      GOOGLE_SHEETS_SPREADSHEET_ID: "e2e-stub",
      // Harmless if any checkout path is hit during a load smoke.
      CHECKOUT_DRY_RUN: "true",
    },
  },
});
