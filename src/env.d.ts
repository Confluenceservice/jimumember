/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_BASIC?: string;
  readonly STRIPE_PRICE_ADVANCED?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly GOOGLE_WORKSPACE_IMPERSONATE_USER?: string;
  readonly MAILGUN_API_KEY?: string;
  readonly MAILGUN_DOMAIN?: string;
  readonly MAILGUN_FROM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
