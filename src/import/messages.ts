/** Shopper-facing copy. No file-format or provider jargon. */

export const IMPORT_MESSAGES = {
  photoOff: "Photo import isn't switched on yet. Paste the text instead.",
  speechOff: "Voice import isn't switched on yet. Type or paste your list instead.",
  askOff: "Suggestions aren't switched on yet. You can still paste or speak a list.",
  linkHidden: "That store hides the list behind sign-in. Paste its text or send a screenshot instead.",
  linkUnread: "That link can't be read from here. Paste the list or send a screenshot instead.",
  empty: "We couldn't find any grocery items in that. Try one item per line.",
  tooLong: "That list is too long to import at once. Split it into two pastes.",
  tooBig: "That file is too large. Try a smaller screenshot or paste the text.",
  badImage: "That photo didn't open. Try a screenshot, or paste the text.",
  badAudio: "That recording didn't open. Try again, or paste the list.",
  tooLongAudio: "That recording is too long. Keep it under a minute and a half, or paste the list.",
  rate: "That's a lot of lists at once. Wait a few minutes and try again.",
  daily: "Voice and photo import are paused until tomorrow so this stays affordable. You can still paste a list.",
  askFailed: "We couldn't make a list from that. Try a shorter goal, like taco night for 6.",
  generic: "Something went wrong reading that. Paste the list instead.",
  goalMissing: "Say what you want, like taco night for 6.",
  textMissing: "Paste a list first.",
  pdfNoText: "That PDF doesn't have readable text. Screenshot the order from the store app, or paste the text.",
  urlMissing: "Paste the link to the shared list.",
} as const;

export const KROGER_HISTORY_REASON =
  "Kroger's public API does not offer purchase history or a saved-list read. The cart scope this app uses (cart.basic:write) only adds items, and product.compact is the catalog. Import from Kroger is not offered.";
