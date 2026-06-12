import { google } from "googleapis";
import type { JWT } from "google-auth-library";
import { logger } from "./logger";

// Service-account impersonation. When set, the service account JWT carries a
// `subject` claim and Google acts on behalf of that Workspace user. This is
// how we route around the "service accounts have no Drive storage" quota:
// uploads are attributed to a real user with storage, not to the SA itself.
//
// Workspace admin must enable Domain-Wide Delegation on the service account
// (GCP → IAM & Admin → Service Accounts → <SA> → Show domain-wide delegation
// → Client ID) and authorize at least these scopes for that client ID in
// Workspace Admin Console → Security → API Controls → Domain-wide Delegation:
//
//   https://www.googleapis.com/auth/drive
//   https://www.googleapis.com/auth/documents
//   https://www.googleapis.com/auth/spreadsheets
//
// See docs/runbooks/google-workspace-domain-wide-delegation.md.
const IMPERSONATE_USER_ENV = "GOOGLE_WORKSPACE_IMPERSONATE_USER";
const SA_EMAIL_ENV = "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL";
const SA_KEY_ENV = "GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY";

let impersonationLogged = false;

function getImpersonationUser(): string | null {
  const raw = process.env[IMPERSONATE_USER_ENV]?.trim();
  if (!raw) return null;
  return raw;
}

function getServiceAccountCreds(): { email: string; key: string } {
  const email = process.env[SA_EMAIL_ENV]?.trim();
  const keyRaw = process.env[SA_KEY_ENV]?.trim();
  if (!email || !keyRaw) {
    throw new Error(
      `Missing ${SA_EMAIL_ENV} or ${SA_KEY_ENV} env vars. Both are required.`,
    );
  }
  // Fly secrets inject the JSON key with literal "\n" sequences; the JWT
  // signer needs actual newlines.
  return { email, key: keyRaw.replace(/\\n/g, "\n") };
}

// Build a service-account JWT auth client. When GOOGLE_WORKSPACE_IMPERSONATE_USER
// is set, the JWT carries a `subject` claim so Google acts on behalf of that
// Workspace user (Domain-Wide Delegation). Otherwise the SA acts as itself —
// fine for Sheets reads/writes, but Drive uploads 403 with
// `storageQuotaExceeded` because SAs have no Drive storage.
export function getServiceAccountJwtAuth(scopes: string[]): JWT {
  const { email, key } = getServiceAccountCreds();
  const subject = getImpersonationUser();

  if (!impersonationLogged) {
    impersonationLogged = true;
    if (subject) {
      logger.info("google_service_account_auth", {
        impersonating: true,
        subject,
        scopes,
      });
    } else {
      logger.warn("google_service_account_auth", {
        impersonating: false,
        reason:
          `${IMPERSONATE_USER_ENV} not set; Drive uploads may 403 with ` +
          "storageQuotaExceeded. See docs/runbooks/google-workspace-domain-wide-delegation.md.",
        scopes,
      });
    }
  }

  return new google.auth.JWT({
    email,
    key,
    scopes,
    ...(subject ? { subject } : {}),
  });
}
