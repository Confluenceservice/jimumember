/**
 * Xero sweeper trigger — Google Apps Script (standalone, not container-bound).
 *
 * Calls GET /api/xero/sync-pending on an hourly time-based trigger. That
 * endpoint re-drives rows left `pending` in the "Xero Sync" tab by
 * src/lib/xero-sync.ts.
 *
 * Why this exists at all: the Stripe webhook pushes to Xero inline and gives
 * up after a single attempt, because it runs inside Stripe's request timeout
 * and fly.toml sets min_machines_running = 0 — a promise scheduled after the
 * response may simply be killed with the machine. There is no queue and no
 * worker, so a scheduled GET is the retry loop. The request also wakes the
 * stopped Fly machine, which is the second reason this shape works.
 *
 * Deliberately standalone rather than added to renewal-views/: that project
 * is container-bound to the "Renewal views" spreadsheet and its 15-minute
 * trigger. This one touches no spreadsheet and runs on its own schedule.
 *
 * Manual setup after `clasp push` (see README.md):
 *   1. Script Properties: set APP_BASE_URL and XERO_SYNC_SECRET.
 *   2. Run sweepXeroPending once from the editor to authorize UrlFetchApp.
 *   3. Run installTrigger once to schedule the hourly sweep.
 */

/** Script Property names. The secret must never be inlined in this file. */
var PROP_BASE_URL = "APP_BASE_URL";
var PROP_SECRET = "XERO_SYNC_SECRET";

var TRIGGER_HANDLER = "sweepXeroPending";
var TRIGGER_HOURS = 1;

function getProps_() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = (props.getProperty(PROP_BASE_URL) || "").replace(/\/+$/, "");
  var secret = props.getProperty(PROP_SECRET) || "";

  if (!baseUrl || !secret) {
    throw new Error(
      "Missing Script Properties. Set " + PROP_BASE_URL + " and " + PROP_SECRET +
        " under Project Settings > Script Properties."
    );
  }
  return { baseUrl: baseUrl, secret: secret };
}

/**
 * Hits the sweeper endpoint and logs the outcome.
 *
 * muteHttpExceptions is on so a non-2xx produces a readable log line rather
 * than an opaque Apps Script exception — the execution log is the only place
 * an operator sees this run.
 */
function sweepXeroPending() {
  var cfg = getProps_();

  var response = UrlFetchApp.fetch(cfg.baseUrl + "/api/xero/sync-pending", {
    method: "get",
    headers: { "X-Sync-Secret": cfg.secret },
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status !== 200) {
    // Thrown, not just logged: a throw marks the execution as failed, which
    // is what surfaces in the Apps Script failure notification email.
    throw new Error("xero sweep failed: HTTP " + status + " " + body.slice(0, 300));
  }

  Logger.log("xero sweep ok: " + body);
}

/** Run once from the editor. Replaces any existing trigger for this handler. */
function installTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyHours(TRIGGER_HOURS).create();
  Logger.log("Installed " + TRIGGER_HOURS + "-hourly trigger for " + TRIGGER_HANDLER);
}

/** Run once from the editor to stop the sweep without deleting the project. */
function removeTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  Logger.log("Removed " + removed + " trigger(s)");
}
