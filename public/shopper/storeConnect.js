/**
 * Optional store connection after the ZIP stores are confirmed.
 * Kroger uses its own sign-in page. Walmart has no account connection.
 * A connection does not promise that checkout will skip sign-in.
 */

export const CONNECT_NOW = "Connect stores now";
export const CONNECT_LATER = "Do this at checkout";
export const PROFILE_CONNECT_KEY = "gg-profile-connect";

/**
 * @param {{ stores?: string[] | null, oauthConfigured?: boolean, connected?: boolean }} [input]
 */
export function storeConnectCopy(input = {}) {
  const names = (input.stores || []).map((name) => String(name || "").trim()).filter(Boolean);
  const all = names.length === 0;
  const has = (store) => all || names.some((name) => name.toLowerCase() === store);
  const kroger = has("kroger");
  const walmart = has("walmart");
  const canConnect = Boolean(input.oauthConfigured) && !input.connected && kroger;
  let body = "Kroger sign-in isn't available on this server. You can still shop, and open a cart at checkout.";
  if (input.connected && kroger) {
    body = "Kroger is already connected. Kroger may still ask you to sign in at checkout.";
  } else if (canConnect) {
    body =
      "Optional. Kroger sign-in opens on Kroger's site. We never see your password. Connecting now can skip a login later, but Kroger may still ask you to sign in at checkout.";
  }
  return {
    title: "Connect a store?",
    body,
    walmart: walmart
      ? "Walmart has no account connection. Checkout opens a cart link. That is not a sign-in."
      : "",
    now: CONNECT_NOW,
    later: CONNECT_LATER,
    showNow: canConnect,
  };
}
