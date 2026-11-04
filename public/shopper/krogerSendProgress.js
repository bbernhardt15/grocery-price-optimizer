/**
 * Cart send progress stays inside the button. Nothing is inserted above
 * or below it, so the Review page does not shift when the tap starts.
 */

export const KROGER_SEND_IDLE = "Send to Kroger cart";
export const KROGER_SEND_BUSY = "Sending…";
export const KROGER_SEND_CONNECTED = "Sending with your saved Kroger sign-in…";
export const KROGER_SEND_CONNECTING = "Connecting to Kroger…";

/**
 * @param {"idle" | "sending" | string} phase
 * @param {{ connected?: boolean }} [options]
 */
export function krogerSendPatch(phase, options = {}) {
  const busy = phase === "sending";
  const connected = Boolean(options.connected);
  return {
    text: busy ? KROGER_SEND_BUSY : KROGER_SEND_IDLE,
    ariaLabel: busy ? (connected ? KROGER_SEND_CONNECTED : KROGER_SEND_CONNECTING) : KROGER_SEND_IDLE,
    disabled: busy,
    busy,
    insertSibling: false,
  };
}
