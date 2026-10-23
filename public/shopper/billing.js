export function platformOf(capacitor) {
  const platform = capacitor?.getPlatform?.();
  if (platform === "ios" || platform === "android") return platform;
  return "web";
}

export function sdkKeyFor(status, platform) {
  if (platform === "ios") return String(status?.keys?.ios || "");
  if (platform === "android") return String(status?.keys?.android || "");
  return "";
}

export function manageUrl(status, platform) {
  if (platform === "ios") return String(status?.manage?.ios || "");
  if (platform === "android") return String(status?.manage?.android || "");
  return "";
}

export function packageChoices(offerings) {
  const current = offerings?.current || offerings?.all?.default || null;
  const packages = Array.isArray(current?.availablePackages) ? current.availablePackages : [];
  return packages
    .map((pkg) => ({
      id: String(pkg?.identifier || pkg?.packageType || ""),
      title: String(pkg?.product?.title || pkg?.identifier || "Grocery Gitter Pro"),
      price: String(pkg?.product?.priceString || ""),
      raw: pkg,
    }))
    .filter((pkg) => pkg.raw);
}

/**
 * What the paywall should show. Purchases run only in the iOS or Android shell,
 * and only after the shopper is signed in and a public SDK key is configured.
 */
export function paywallView({ status, platform, signedIn }) {
  const native = platform === "ios" || platform === "android";
  const key = sdkKeyFor(status, platform);
  return {
    enforced: Boolean(status?.enforced),
    pro: Boolean(status?.pro),
    native,
    key,
    canPurchase: native && Boolean(signedIn) && Boolean(key),
    needsSignIn: native && !signedIn && Boolean(key),
    unconfigured: native && !key,
    showWebNote: !native,
    webNote: status?.stripe?.note || "Subscriptions are available in the iOS and Android apps.",
    manageUrl: manageUrl(status, platform),
    terms: status?.terms || "/terms",
    privacy: status?.privacy || "/privacy",
  };
}
