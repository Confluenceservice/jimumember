/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_ASSOCIATE: string;
  readonly STRIPE_PRICE_PROFESSIONAL: string;
  readonly STRIPE_UPFRONT_PRICE_ASSOCIATE?: string;
  readonly STRIPE_UPFRONT_PRICE_PROFESSIONAL?: string;
  readonly STRIPE_PROMO_CODE_ID?: string;
  readonly PUBLIC_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
