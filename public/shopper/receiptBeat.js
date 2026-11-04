/**
 * The "we read your receipt" beat. It stays up long enough to see, with a
 * ring that fills in about 2.5 seconds. Tapping the ring or Continue skips it.
 */

export const READ_BEAT_MS = 2500;

/** @param {number} count */
export function readBeatHeadline(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? "Read 1 item" : `Read ${n} items`;
}

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {number} count */
export function readBeatHtml(count) {
  const headline = escapeText(readBeatHeadline(count));
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const detail = n === 1 ? "Read 1 item from your receipt" : `Read ${n} items from your receipt`;
  const seconds = (READ_BEAT_MS / 1000).toFixed(1);
  return `<div class="read-beat" data-read-beat="1">
    <p class="read-beat-count">${headline}</p>
    <p class="read-beat-detail">${escapeText(detail)}</p>
    <button type="button" class="read-beat-ring" id="read-beat-skip" aria-label="Continue">
      <svg class="read-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="read-ring-track" cx="18" cy="18" r="15"></circle>
        <circle class="read-ring-fill" cx="18" cy="18" r="15" style="animation-duration: ${seconds}s"></circle>
      </svg>
    </button>
    <button type="button" class="primary" id="read-beat-continue">Continue</button>
  </div>`;
}
