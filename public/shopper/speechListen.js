/**
 * Silence watch for the ask-box microphone.
 * A pause after speech submits the list. Stop stays available the whole time.
 */

export const SILENCE_MS = 1700;

/**
 * iOS Safari's webkitSpeechRecognition invents or replays text and often
 * misses the words just spoken. Record and send the audio instead.
 * @param {{ userAgent?: string, maxTouchPoints?: number } | null | undefined} nav
 */
export function preferServerSpeech(nav) {
  const ua = String(nav?.userAgent || "");
  const touch = Number(nav?.maxTouchPoints) || 0;
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  if (touch > 1 && /Macintosh/i.test(ua)) return true;
  return false;
}

/** First mime the browser can actually record. iOS wants audio/mp4, not webm. */
export function recorderMime(isTypeSupported) {
  const supported = typeof isTypeSupported === "function" ? isTypeSupported : () => false;
  for (const mime of ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
    try {
      if (supported(mime)) return mime;
    } catch {
      /* try the next */
    }
  }
  return "";
}

/**
 * @param {{ onSilence: () => void, ms?: number, now?: () => number, schedule?: (fn: () => void, ms: number) => number, cancel?: (id: number) => void }} options
 */
export function createSilenceWatch(options) {
  const ms = Number(options?.ms) > 0 ? Number(options.ms) : SILENCE_MS;
  const schedule = options?.schedule || ((fn, delay) => setTimeout(fn, delay));
  const cancel = options?.cancel || ((id) => clearTimeout(id));
  let timer = 0;
  let heard = false;
  let stopped = false;

  function clear() {
    if (timer) cancel(timer);
    timer = 0;
  }

  return {
    /** Call when the recognizer returns words. The first words arm the pause. */
    heard() {
      if (stopped) return;
      heard = true;
      clear();
      timer = schedule(() => {
        timer = 0;
        if (!stopped) options.onSilence();
      }, ms);
    },
    get armed() {
      return heard && !stopped;
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
