/**
 * Phone feel that does not need a new Capacitor plugin.
 * Haptics uses the shell's Haptics plugin when it is already there,
 * otherwise a short vibration. Wake lock uses the browser API and
 * fails quietly when the phone will not keep the screen on.
 */

export const PULL_THRESHOLD = 72;

/**
 * @param {{ haptics?: { impact?: (options: { style: string }) => Promise<void> }, vibrate?: (ms: number) => void }} [env]
 */
export async function lightTap(env = {}) {
  const haptics = env.haptics;
  if (haptics && typeof haptics.impact === "function") {
    try {
      await haptics.impact({ style: "LIGHT" });
      return "haptics";
    } catch {
      /* try vibration */
    }
  }
  if (typeof env.vibrate === "function") {
    try {
      env.vibrate(12);
      return "vibrate";
    } catch {
      return "none";
    }
  }
  return "none";
}

/**
 * @param {{ requestWakeLock?: (type: string) => Promise<{ release?: () => Promise<void> }> }} [env]
 */
export async function keepAwake(env = {}) {
  if (typeof env.requestWakeLock !== "function") {
    return { active: false, async release() {} };
  }
  try {
    const handle = await env.requestWakeLock("screen");
    return {
      active: true,
      async release() {
        try {
          await handle?.release?.();
        } catch {
          /* already released */
        }
      },
    };
  } catch {
    return { active: false, async release() {} };
  }
}

/**
 * @param {number} startY
 * @param {number} currentY
 * @param {boolean} atTop
 */
export function pullDistance(startY, currentY, atTop) {
  if (!atTop) return 0;
  const delta = Number(currentY) - Number(startY);
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.min(120, delta);
}

/** @param {number} distance */
export function pullShouldRefresh(distance) {
  return Number(distance) >= PULL_THRESHOLD;
}
