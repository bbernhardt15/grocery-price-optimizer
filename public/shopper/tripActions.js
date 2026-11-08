/** Review actions another screen can fire without owning the list. */

export const CLEAR_TRIP_EVENT = "gg-clear-trip";
export const COMPLETE_TRIP_EVENT = "gg-complete-trip";
export const CLEAR_TRIP_UNDO_MS = 6000;
export const FINISH_TRIP_UNDO_MS = 4_500;

export function clearTripAction() {
  return { event: CLEAR_TRIP_EVENT, label: "Clear trip", undoMs: CLEAR_TRIP_UNDO_MS };
}

export function completeTripAction() {
  return { event: COMPLETE_TRIP_EVENT, label: "Complete trip", undoMs: FINISH_TRIP_UNDO_MS };
}
