export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigError";
  }
}

/** Webhook request lacks the signature header or the signing secret is unset. */
export class WebhookConfigError extends Error {
  constructor(message = "Missing webhook config.") {
    super(message);
    this.name = "WebhookConfigError";
  }
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature.") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}
