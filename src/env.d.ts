/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_1?: string;
  readonly STRIPE_PRICE_2?: string;
  readonly STRIPE_PRICE_1_RENEWAL?: string;
  readonly STRIPE_PRICE_2_RENEWAL?: string;
  readonly PUBLIC_APP_URL?: string;
  readonly RENEWAL_ANCHOR_MONTH?: string;
  readonly RENEWAL_ANCHOR_DAY?: string;
  readonly GOOGLE_WORKSPACE_IMPERSONATE_USER?: string;
  readonly MAILGUN_API_KEY?: string;
  readonly MAILGUN_DOMAIN?: string;
  readonly MAILGUN_FROM?: string;
  // Xero integration — see docs/runbooks/xero-connect.md and spec/016.
  readonly XERO_ENABLED?: string;
  readonly XERO_AUTH_MODE?: "custom" | "authcode";
  readonly XERO_CLIENT_ID?: string;
  readonly XERO_CLIENT_SECRET?: string;
  readonly XERO_TENANT_ID?: string;
  readonly XERO_ALLOW_LIVE?: string;
  readonly XERO_SALES_ACCOUNT_CODE?: string;
  readonly XERO_STRIPE_FEED_ACCOUNT_ID?: string;
  readonly XERO_TAX_TYPE?: string;
  readonly XERO_REDIRECT_URI?: string;
  readonly XERO_SYNC_SECRET?: string;
  /** Separate from XERO_SYNC_SECRET: passed as a query param, so it lands in access logs. */
  readonly XERO_CONSENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
