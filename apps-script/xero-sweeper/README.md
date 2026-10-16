# Xero sweeper trigger (Apps Script)

Standalone Google Apps Script that calls `GET /api/xero/sync-pending` every
hour. That endpoint re-drives rows left `pending` in the **Xero Sync** tab by
`src/lib/xero-sync.ts`.

## Why a scheduled GET is the whole retry mechanism

The Stripe webhook pushes to Xero **inline** and gives up after one attempt.
It has to: it runs inside Stripe's request timeout, and `fly.toml` sets
`min_machines_running = 0` with `auto_stop_machines = 'stop'`, so a promise
scheduled after the response can be killed along with the machine. There is
no queue and no worker process.

So anything that fails at webhook time stays `pending` in the sheet, and this
trigger is what retries it. The inbound request also **wakes the stopped Fly
machine**, which is the second reason this shape works without extra
infrastructure.

Standalone rather than container-bound to the membership spreadsheet: this
script touches no spreadsheet directly and has its own schedule.

## Setup

1. Create a **standalone** Apps Script project at <https://script.google.com>.
2. Copy `.clasp.json.example` to `.clasp.json` and put the new project's
   script id in it.
3. Push: `npx @google/clasp push` from this directory.
4. In the Apps Script editor, open **Project Settings → Script Properties**
   and add:

   | Property | Value |
   |---|---|
   | `APP_BASE_URL` | your deployed base URL, e.g. `https://members.example.org` (prod) or `https://<your-fly-app>.fly.dev` (staging) |
   | `XERO_SYNC_SECRET` | must match the `XERO_SYNC_SECRET` Fly secret for that environment |

   The secret lives only here — never inline it in `Code.js`.
5. Run `sweepXeroPending` once from the editor to authorize `UrlFetchApp`.
6. Run `installTrigger` once to schedule the hourly sweep.

To stop the sweep without deleting the project, run `removeTrigger`.

## Reading the results

A successful run logs the endpoint's JSON:

```
xero sweep ok: {"enabled":true,"swept":3,"done":2,"stillPending":1,"permanentFailures":0}
```

- `enabled: false` — `XERO_ENABLED` is off on that deployment. The sweep did
  nothing; this is reported rather than 404'd so the cause is visible here.
- `stillPending` — transient failures, will be retried next hour.
- `permanentFailures` — will **never** be retried. These need a human: a bad
  account code, an unconfigured env var, or a malformed payload. Check the
  `last_error` column of the **Xero Sync** tab.

A non-2xx response throws, which marks the execution as failed and triggers
Apps Script's failure-notification email.

## Related

- Endpoint: `src/pages/api/xero/sync-pending.ts`
- Sweep logic: `src/lib/xero-sync.ts` (`sweepPending`)
- Spec: `spec/016-xero-integration/`
- Runbook: `docs/runbooks/xero-connect.md`
- `/api/xero/` is exempt from the rate limiter in `src/middleware.ts` — at 30
  requests per IP per 15 minutes this trigger would eventually be throttled,
  and callers without a forwarded-for header share a single bucket.
