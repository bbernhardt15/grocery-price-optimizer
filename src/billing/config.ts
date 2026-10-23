export function revenueCatWebhookSecret(): string {
  return (process.env.REVENUECAT_WEBHOOK_SECRET || "").trim();
}

/** Gates run only after the webhook secret is set. Until then every feature stays available. */
export function billingEnforced(): boolean {
  return revenueCatWebhookSecret().length > 0;
}

export function entitlementId(): string {
  return (process.env.REVENUECAT_ENTITLEMENT_ID || "pro").trim() || "pro";
}

export function revenueCatSecretApiKey(): string {
  return (process.env.REVENUECAT_SECRET_API_KEY || "").trim();
}

export function publicSdkKeys(): { ios: string; android: string } {
  return {
    ios: (process.env.REVENUECAT_IOS_API_KEY || "").trim(),
    android: (process.env.REVENUECAT_ANDROID_API_KEY || "").trim(),
  };
}

export const MANAGE_LINKS = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions?package=app.grocerygitter",
};

export const STRIPE_STUB = {
  enabled: false,
  note: "Web checkout is not offered. Subscriptions are available in the iOS and Android apps.",
};
