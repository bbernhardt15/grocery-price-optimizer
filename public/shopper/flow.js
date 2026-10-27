/**
 * Three steps, in order: add items, see the plan, shop.
 * The sticky bar keeps one primary action for the step you're on.
 */

import { priceFigure } from "./calmPlan.js";

export const FLOW_STEPS = [
  { id: "add", label: "Add", title: "Add items" },
  { id: "plan", label: "Plan", title: "Your plan" },
  { id: "shop", label: "Shop", title: "In the store" },
];

/** @param {string | null | undefined} id */
export function readFlowStep(id) {
  return FLOW_STEPS.some((step) => step.id === id) ? id : "add";
}

/** Header title for the step. The bar uses the short label. */
export function stepTitle(id) {
  const step = FLOW_STEPS.find((row) => row.id === readFlowStep(id));
  return step?.title || "Add items";
}

/**
 * One bottom area. Add and Plan share the step dock.
 * The in-store bar is only the Shop step.
 * @param {string | null | undefined} id
 * @returns {"steps" | "shop"}
 */
export function bottomChrome(id) {
  return readFlowStep(id) === "shop" ? "shop" : "steps";
}

/** @param {string | null | undefined} id */
export function nextFlowStep(id) {
  const index = FLOW_STEPS.findIndex((step) => step.id === readFlowStep(id));
  if (index < 0 || index >= FLOW_STEPS.length - 1) return FLOW_STEPS[FLOW_STEPS.length - 1].id;
  return FLOW_STEPS[index + 1].id;
}

/**
 * Copy for the sticky plan bar. A total is shown only when we already
 * have one. Missing prices stay blank instead of becoming $0.
 * @param {{ step?: string, itemCount?: number, total?: number, hasPlan?: boolean, planning?: boolean, left?: number, complete?: boolean }} [input]
 */
export function planBarCopy(input = {}) {
  const step = readFlowStep(input.step);
  const count = Math.max(0, Math.floor(Number(input.itemCount) || 0));
  const left = input.left == null ? count : Math.max(0, Math.floor(Number(input.left) || 0));
  let countLabel = count === 1 ? "1 item" : `${count} items`;
  if (step === "shop") {
    if (count === 0) countLabel = "Nothing to shop";
    else if (left === 0) countLabel = "All checked";
    else countLabel = left === 1 ? "1 left" : `${left} left`;
  }
  const amount = Number(input.total);
  const totalLabel = count > 0 && Number.isFinite(amount) && amount > 0 ? priceFigure(amount) : "";
  let button = "See your plan";
  let enabled = count > 0 && !input.planning;
  if (step === "plan") {
    button = input.hasPlan ? "Shop" : "See your plan";
    enabled = count > 0 && !input.planning && (Boolean(input.hasPlan) || step === "plan");
    if (!input.hasPlan) enabled = count > 0 && !input.planning;
  } else if (step === "shop") {
    button = "Done";
    // A disabled Done swallows the tap. Incomplete trips still respond.
    enabled = count > 0;
  }
  return { step, countLabel, totalLabel, button, enabled };
}

/**
 * Sign-in waits until a save or a cart send. A guest who says not now
 * is not asked again during this visit.
 * @param {{ accountsEnabled?: boolean, signedIn?: boolean, intent?: string, declined?: boolean }} [input]
 */
export function shouldAskToSignIn(input = {}) {
  if (input.declined) return false;
  if (!input.accountsEnabled || input.signedIn) return false;
  return input.intent === "save" || input.intent === "cart";
}
