import { krogerPricingProvider } from "./krogerProvider";
import { targetPricingProvider } from "./targetProvider";
import type { StorePricingProvider } from "./types";
import { walmartPricingProvider } from "./walmartProvider";
import { FallbackPricingProvider } from "./fallbackProvider";
import { flippProviderForStore } from "./flipp/flippProvider";
import { canonicalGroceryStoreName, mappingForStore } from "./flipp/merchants";

export const DEFAULT_COMPETING_STORES = [
  "Kroger",
  "Walmart",
  "Target",
  "Aldi",
] as const;

const dedicatedProviders: StorePricingProvider[] = [
  krogerPricingProvider,
  walmartPricingProvider,
  targetPricingProvider,
];

export function dedicatedProviderForStore(
  storeName: string
): StorePricingProvider | undefined {
  const key = storeName.trim().toLowerCase();
  return dedicatedProviders.find(
    (provider) => provider.storeName.toLowerCase() === key
  );
}

export function allPricingProviders(): StorePricingProvider[] {
  const names = new Set<string>([
    ...dedicatedProviders.map((provider) => provider.storeName),
    ...DEFAULT_COMPETING_STORES,
  ]);
  return [...names].map((name) => providerForStore(name)).filter(
    (provider): provider is StorePricingProvider => Boolean(provider)
  );
}

export function providerForStore(
  storeName: string
): StorePricingProvider | undefined {
  const canonical = mappingForStore(storeName)?.storeName ?? storeName.trim();
  const dedicated = dedicatedProviderForStore(canonical);
  const flipp = flippProviderForStore(canonical);
  if (dedicated && flipp) {
    return new FallbackPricingProvider(canonical, dedicated, flipp);
  }
  return dedicated ?? flipp;
}

export function competingStoreNames(stores: string[] = []): string[] {
  const requested = stores.map((store) => store.trim()).filter(Boolean);
  const source = requested.length === 0 ? [...DEFAULT_COMPETING_STORES] : requested;

  const seen = new Set<string>();
  const names: string[] = [];
  for (const store of source) {
    const canonical = canonicalGroceryStoreName(store);
    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(canonical);
  }
  return names;
}
