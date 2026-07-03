import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke tests for the two bug classes that reached production:
 *
 *  - bug-004: a client fetch() in /advanced/apply.astro hit a stale
 *    /api/professional/* route and 404'd ("Network error." on Start
 *    Application). Flow A asserts the POST resolves to a real route (not 404)
 *    and the verify-email panel renders.
 *  - bug-005: an email-send failure was swallowed; the fix surfaces an
 *    `emailError` string in the verify panel. Flow B forces the send to fail
 *    (recipient sentinel under E2E_STUB) and asserts the diagnostic renders.
 *
 * The server runs with E2E_STUB=1 (see playwright.config.ts), so Sheets/Mailgun
 * are neutralised while the real Astro routes still execute.
 */

/** Collect same-origin 404s so a load smoke fails on any broken sub-request. */
function track404s(page: Page): string[] {
  const bad: string[] = [];
  page.on("response", (r) => {
    if (r.status() === 404 && !r.url().includes("favicon")) bad.push(r.url());
  });
  return bad;
}

test.describe("advanced apply wizard", () => {
  test("Flow A — Start Application reaches a real route and shows the verify panel (bug-004)", async ({
    page,
  }) => {
    const bad404 = track404s(page);
    await page.goto("/advanced/apply");

    await page.fill("#reg-firstName", "Jane");
    await page.fill("#reg-lastName", "Doe");
    await page.fill("#reg-email", "e2e-happy@example.com");

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/advanced/apply") &&
          r.request().method() === "POST",
      ),
      page.click("#register-btn"),
    ]);

    // The bug-004 guard: a stale /api/professional/apply path would 404 here.
    expect(resp.status(), "POST /api/advanced/apply must resolve to a real route").toBe(200);

    const panel = page.locator("#verify-email-panel");
    await expect(panel).toBeVisible();
    await expect(page.locator("#verify-email-address")).toHaveText("e2e-happy@example.com");

    // The "Network error." catch branch must NOT have fired.
    await expect(page.locator("#register-message")).toBeHidden();
    expect(bad404, `unexpected 404s: ${bad404.join(", ")}`).toEqual([]);
  });

  test("Flow B — email-send failure surfaces the diagnostic message (bug-005)", async ({
    page,
  }) => {
    await page.goto("/advanced/apply");

    await page.fill("#reg-firstName", "Fail");
    await page.fill("#reg-lastName", "Case");
    // Recipient sentinel: the E2E_STUB email shim throws for any "forcefail" address.
    await page.fill("#reg-email", "forcefail@example.com");

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/advanced/apply") &&
          r.request().method() === "POST",
      ),
      page.click("#register-btn"),
    ]);
    expect(resp.status()).toBe(200);

    // Panel still renders (requiresVerification: true), and the resend-status
    // line now carries the server-supplied emailError (bug-005 diagnostics).
    await expect(page.locator("#verify-email-panel")).toBeVisible();
    const status = page.locator("#verify-email-resend-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("couldn't send");
    await expect(status).toContainText("(Server:");
  });
});

test.describe("page load smoke (no 404s)", () => {
  for (const path of ["/apply", "/renew/basic"]) {
    test(`loads ${path} with a heading and no broken sub-requests`, async ({ page }) => {
      const bad404 = track404s(page);
      const resp = await page.goto(path);
      expect(resp?.status(), `${path} document response`).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(bad404, `unexpected 404s on ${path}: ${bad404.join(", ")}`).toEqual([]);
    });
  }
});
