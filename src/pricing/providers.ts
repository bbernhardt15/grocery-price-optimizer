import { krogerPricingProvider } from "./krogerProvider";
import { targetPricingProvider } from "./targetProvider";
import type { StorePricingProvider } from "./types";
import { walmartPricingProvider } from "./walmartProvider";

export const DEFAULT_COMPETING_STORES = [
  "Kroger",
  "Walmart",
  "Target",
  "Aldi",
] as const;

const providers: StorePricingProvider[] = [
  krogerPricingProvider,
  walmartPricingProvider,
  targetPricingProvider,
];

export function allPricingProviders(): StorePricingProvider[] {
  return [...providers];
}

export function providerForStore(
  storeName: string
): StorePricingProvider | undefined {
  const key = storeName.trim().toLowerCase();
  return providers.find((provider) => provider.storeName.toLowerCase() === key);
}

export function competingStoreNames(stores: string[] = []): string[] {
  const requested = stores.map((store) => store.trim()).filter(Boolean);
  if (requested.length === 0) {
    return [...DEFAULT_COMPETING_STORES];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const store of requested) {
    const key = store.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(store);
  }
  return names;
}
