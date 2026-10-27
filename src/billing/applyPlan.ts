import type { Access } from "./access";

type HandoffCarrier = {
  stores: Array<{
    items: Array<object>;
    handoff?: {
      items?: Array<object>;
      action?: object;
      coupon?: object;
    };
  }>;
};

function withoutUrl<T extends object>(item: T): T {
  const copy = { ...item } as T & { url?: unknown; openLabel?: unknown; offers?: Array<object> };
  delete copy.url;
  delete copy.openLabel;
  if (Array.isArray(copy.offers)) {
    copy.offers = copy.offers.map((offer) => withoutUrl(offer));
  }
  return copy;
}

/** Free trips keep the store cards and drop checkout links. */
export function lockCartHandoffs<T extends HandoffCarrier>(result: T): T {
  return {
    ...result,
    stores: result.stores.map((store) => ({
      ...store,
      items: store.items.map((item) => withoutUrl(item)),
      ...(store.handoff
        ? {
            handoff: {
              ...store.handoff,
              items: (store.handoff.items ?? []).map((item) => withoutUrl(item)),
              action: {
                type: "coming_soon",
                label: "Grocery Gitter Pro",
                status: "coming_soon",
                detail: "Cart handoffs are part of Grocery Gitter Pro.",
              },
            },
          }
        : {}),
    })),
  };
}

export function entitlementPayload(access: Access): { plan: "free" | "pro"; limited: string[] } | null {
  if (!access.enforced) return null;
  const limited: string[] = [];
  if (!access.limits.multiStore) limited.push("multiStoreSplit");
  if (!access.limits.cartHandoffs) limited.push("cartHandoffs");
  if (!access.limits.ownCoupons) limited.push("ownCoupons");
  return { plan: access.plan, limited };
}
