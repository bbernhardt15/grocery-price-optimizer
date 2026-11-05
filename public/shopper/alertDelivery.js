/**
 * Price alerts on the shopping list. Web Push (VAPID) is implemented.
 * Price drops are not emailed. When the server has no VAPID key, the
 * toggle must not pretend a notification will go out.
 */

export const PUSH_ALERT_COPY = "We'll send a push notification.";
export const ALERTS_COMING_SOON = "Coming soon";
export const ALERT_CHANNEL_NOTE =
  "Delivery is a push notification on this phone. Grocery Gitter does not email price alerts.";
export const SHOPPING_LIST_NAME = "Shopping list";
export const SHOPPING_LIST_NOTE = "Change a quantity, take something off, or send this list to whoever is shopping with you.";

/**
 * A missing VAPID key hides the control. A disabled switch reads as broken.
 * @param {{ webPush?: { enabled?: boolean, publicKey?: string } } | null | undefined} status
 */
export function alertDeliveryState(status) {
  const web = status?.webPush;
  const key = String(web?.publicKey || "").trim();
  if (web?.enabled && key) {
    return { mode: "push", copy: PUSH_ALERT_COPY, disabled: false, visible: true };
  }
  return { mode: "hidden", copy: "", disabled: true, visible: false };
}
