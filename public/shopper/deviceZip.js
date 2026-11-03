/**
 * ZIP from the phone's own coordinates. Never from the server's IP.
 * A coarse reading (cell or reduced accuracy) is labeled approximate.
 */

export const COARSE_ACCURACY_METERS = 1000;
export const APPROXIMATE_ZIP_NOTE = "Approximate: is this your ZIP?";

/** @param {number | null | undefined} accuracyMeters */
export function accuracyIsApproximate(accuracyMeters) {
  if (accuracyMeters == null || accuracyMeters === "") return true;
  const meters = Number(accuracyMeters);
  if (!Number.isFinite(meters) || meters < 0) return true;
  return meters > COARSE_ACCURACY_METERS;
}

/**
 * @param {{ lat?: number, lng?: number, accuracy?: number | null, approximate?: boolean } | null | undefined} coords
 */
export function describeDeviceFix(coords) {
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  const accuracy = Number(coords?.accuracy);
  const approximate = coords?.approximate === true || accuracyIsApproximate(Number.isFinite(accuracy) ? accuracy : null);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    approximate,
    note: approximate ? APPROXIMATE_ZIP_NOTE : "",
  };
}

/** Five digits, or "" when the field is still short. */
export function fiveDigitZip(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}
