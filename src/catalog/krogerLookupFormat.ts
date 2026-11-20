/**
 * Unset, or any value other than 0 / false / off, pauses Kroger match lookup
 * and Kroger offer refresh. Both use the same product id, and an empty
 * Products response writes no offer. Discovery by search term keeps running.
 */
export function krogerMatchLookupPaused(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.KROGER_MATCH_LOOKUP_PAUSED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/**
 * Kroger refresh uses the configured product id. An empty Products body still
 * spends the call and leaves today's refreshed-offer count at 0.
 */
export const KROGER_REFRESH_EMPTY_NOTE =
  "Kroger refresh sends the configured product id (KROGER_LOOKUP_FORMAT, default no-check: 13 digits with the check digit removed). An empty Products response writes no offer and still counts as a call. Match lookup and this refresh stay paused until KROGER_MATCH_LOOKUP_PAUSED is 0, false, or off. Discovery by search term is unchanged.";
