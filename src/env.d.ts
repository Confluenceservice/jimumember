/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PAYMENT_PROVIDER?: string;
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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
