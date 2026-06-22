/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_ASSOCIATE?: string;
  readonly STRIPE_PRICE_PROFESSIONAL?: string;
  readonly STRIPE_PRODUCT_PM_RENEWAL?: string;
  readonly STRIPE_PRODUCT_AM_RENEWAL?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly GOOGLE_WORKSPACE_IMPERSONATE_USER?: string;
  readonly MAILGUN_API_KEY?: string;
  readonly MAILGUN_DOMAIN?: string;
  readonly MAILGUN_FROM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
