/**
 * Silence watch for the ask-box microphone.
 * A pause after speech submits the list. Stop stays available the whole time.
 */

export const SILENCE_MS = 1700;

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
