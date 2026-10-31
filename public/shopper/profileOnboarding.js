/**
 * A short guide: ZIP and stores, then optional receipts.
 * Allergies and diets are asked the first time a meal idea opens.
 * Skip for now leaves the rest of the guide. Category questions wait until an item is added.
 * Closing the guide saves the step so the next visit resumes.
 */

import { emptyProfile, parseProfile, PROFILE_OPTIONS } from "./profile.js";
import { familyLabel } from "./productPreference.js";

export const SKIP_LABEL = "Skip for now";

const FLOW = [
  {
    id: "place",
    title: "Where do you shop?",
    hint: "A ZIP picks nearby stores. Leave a store unchecked to keep it out of the plan.",
    kind: "place",
  },
  {
    id: "receipts",
    title: "Upload receipts",
    hint: "We'll learn the brands you already buy.",
    kind: "receipts",
  },
];

const DIET_FLOW = [
  {
    id: "allergies",
    title: "Any allergies?",
    hint: "These are never included. We match the words on the product. Still read the label.",
    kind: "multi",
    options: "allergies",
  },
  { id: "diets", title: "Any diets?", hint: "A diet beats a saved product. A receipt never overrides this.", kind: "multi", options: "diets" },
];

const EXTRA = [
  { id: "summary", title: "Here's what we'll shop for", hint: "Edit anything that looks off, then start shopping.", kind: "summary" },
  {
    id: "products",
    title: "What do you buy?",
    hint: "Optional. Mark what you never buy, or answer one category when you add it.",
    kind: "products",
  },
];

const STEP_DEFS = [...FLOW, ...DIET_FLOW, ...EXTRA];

const LABELS = {
  "save-money": "Save money",
  "less-stress": "Less stress",
  "feed-family": "Feed a family",
  "meal-ideas": "Meal ideas",
  "specific-diet": "A specific diet",
  "stock-up": "Stock up",
  fruit: "Fruit",
  vegetables: "Vegetables",
  chicken: "Chicken",
  beef: "Beef",
  pork: "Pork",
  seafood: "Seafood",
  eggs: "Eggs",
  dairy: "Dairy",
  cheese: "Cheese",
  bread: "Bread",
  pasta: "Pasta",
  rice: "Rice",
  beans: "Beans",
  snacks: "Snacks",
  sweets: "Sweets",
  coffee: "Coffee",
  soda: "Soda",
  mexican: "Mexican",
  italian: "Italian",
  american: "American",
  chinese: "Chinese",
  indian: "Indian",
  mediterranean: "Mediterranean",
  thai: "Thai",
  southern: "Southern",
  japanese: "Japanese",
  "middle-eastern": "Middle Eastern",
  peanut: "Peanut",
  "tree-nut": "Tree nuts",
  milk: "Milk",
  egg: "Egg",
  wheat: "Wheat",
  soy: "Soy",
  fish: "Fish",
  shellfish: "Shellfish",
  sesame: "Sesame",
  carnivore: "Carnivore",
  atkins: "Atkins",
  paleo: "Paleo",
  whole30: "Whole30",
  "low-carb": "Low-carb",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  "gluten-free": "Gluten-free",
  "dairy-free": "Dairy-free",
  pescatarian: "Pescatarian",
  keto: "Keto",
  halal: "Halal",
  kosher: "Kosher",
  "low-sodium": "Low sodium",
  "diabetic-friendly": "Diabetic-friendly",
  name: "Name brand",
  store: "Store brand",
  cheaper: "Whichever is cheaper",
  dairyAisle: "Dairy",
  "one-stop": "One stop",
  split: "Split for the best price",
  weekly: "A weekly shop",
  quick: "Quick trips",
  1: "1 store",
  2: "2 stores",
  3: "3 stores",
  more: "As many as it takes",
  beginner: "I'm just starting",
  comfortable: "I can follow a recipe",
  confident: "I cook most nights",
  15: "About 15 minutes",
  30: "About 30 minutes",
  60: "About an hour",
  unhurried: "I have time",
};

export function optionLabel(id) {
  return LABELS[id] || id;
}

function decorate(steps) {
  return steps.map((step, index) => ({
    ...step,
    index,
    choices: step.options ? (PROFILE_OPTIONS[step.options] || []).map((id) => ({ id, label: optionLabel(id) })) : [],
  }));
}

/** Questions asked up front. Allergies and diets wait until a meal idea. */
export function profileSteps() {
  return decorate(FLOW);
}

/** Asked the first time meal ideas or a recipe list is opened. */
export function dietSteps() {
  return decorate(DIET_FLOW);
}

export function shouldAskDietPrompt(profile) {
  const parsed = parseProfile(profile);
  if (parsed.dietPrompt === "asked" || parsed.dietPrompt === "skipped") return false;
  if ((parsed.allergies || []).length || (parsed.diets || []).length || (parsed.dietNotes || []).length) return false;
  return true;
}

export function markDietPrompt(profile, value, at = Date.now()) {
  const next = parseProfile(profile);
  next.dietPrompt = value === "skipped" ? "skipped" : "asked";
  next.updatedAt = at;
  return next;
}

export function stepById(id) {
  return decorate(STEP_DEFS).find((step) => step.id === id) || profileSteps()[0];
}

export function nextStepId(id) {
  const steps = profileSteps();
  const index = steps.findIndex((step) => step.id === id);
  if (index < 0 || index >= steps.length - 1) return steps[steps.length - 1].id;
  return steps[index + 1].id;
}

export function prevStepId(id) {
  const steps = profileSteps();
  const index = steps.findIndex((step) => step.id === id);
  if (index <= 0) return steps[0].id;
  return steps[index - 1].id;
}

export function progressLabel(id) {
  const steps = profileSteps();
  const index = steps.findIndex((step) => step.id === id);
  if (index >= 0) return `${index + 1} of ${steps.length}`;
  const diets = dietSteps();
  const dietIndex = diets.findIndex((step) => step.id === id);
  if (dietIndex >= 0) return `${dietIndex + 1} of ${diets.length}`;
  return "";
}

export function primaryLabel(id) {
  return id === "summary" ? "Start shopping" : "Next";
}

function withStep(profile, stepId, at) {
  const next = parseProfile(profile);
  next.onboarding = { status: "in_progress", step: stepId, updatedAt: at };
  next.updatedAt = at;
  return next;
}

function phrases(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 3)
    .slice(0, 24);
}

/** Save this screen and move on. An empty answer is still an answer. */
export function answerStep(profile, stepId, answer, at = Date.now()) {
  const next = parseProfile(profile);
  if (stepId === "why") next.why = answer || [];
  if (stepId === "household") {
    next.household = {
      size: answer?.size ?? next.household.size,
      kids: answer?.kids ?? null,
      picky: answer?.picky ?? null,
    };
  }
  if (stepId === "place" && answer && typeof answer === "object") {
    next.shopStores = Array.isArray(answer.stores) ? answer.stores : next.shopStores;
  }
  if (stepId === "loves") next.loves = answer || [];
  if (stepId === "avoids") next.avoids = answer || [];
  if (stepId === "cuisines") next.cuisines = answer || {};
  if (stepId === "allergies") next.allergies = answer || [];
  if (stepId === "diets") {
    if (answer && typeof answer === "object" && !Array.isArray(answer)) {
      next.diets = answer.diets || [];
      next.dietNotes = phrases(answer.notes);
    } else {
      next.diets = answer || [];
      if (answer == null) next.dietNotes = [];
    }
  }
  if (stepId === "always-never") {
    next.always = phrases(answer?.always);
    next.never = phrases(answer?.never);
    next.mustHaves = next.always.slice();
  }
  if (stepId === "brand") {
    next.brand = {
      default: answer?.default || null,
      organicIfClose: answer?.organicIfClose === true,
      overrides: answer?.overrides || {},
    };
  }
  if (stepId === "shopping") next.style = { ...next.style, shopping: answer || null };
  if (stepId === "cooking") next.style = { ...next.style, cooking: answer || null };
  if (stepId === "time") next.style = { ...next.style, time: answer || null };
  if (stepId === "stops") next.style = { ...next.style, stops: answer || null };
  return parseProfile(withStep(next, nextStepId(stepId), at));
}

/** Leave this screen blank and move on. */
export function skipStep(profile, stepId, at = Date.now()) {
  const cleared = answerStep(profile, stepId, stepId === "household" ? { size: null, kids: null, picky: null } : stepId === "always-never" ? { always: "", never: "" } : stepId === "brand" ? { default: null, organicIfClose: false, overrides: {} } : stepId === "cuisines" ? {} : null, at);
  if (stepId === "shopping" || stepId === "cooking" || stepId === "time") {
    cleared.style = { ...cleared.style, [stepId === "shopping" ? "shopping" : stepId]: null };
  }
  return parseProfile(withStep(cleared, nextStepId(stepId), at));
}

export function goBack(profile, stepId, at = Date.now()) {
  return withStep(profile, prevStepId(stepId), at);
}

/** Leave the rest of the guide. Answers already given stay. */
export function skipForNow(profile, at = Date.now()) {
  const next = parseProfile(profile);
  next.onboarding = { status: "skipped", step: next.onboarding.step || "place", updatedAt: at };
  next.updatedAt = at;
  return next;
}

export function completeProfile(profile, at = Date.now()) {
  const next = parseProfile(profile);
  next.onboarding = { status: "done", step: "summary", updatedAt: at };
  next.updatedAt = at;
  return next;
}

export function resumeStep(profile) {
  const parsed = parseProfile(profile || emptyProfile());
  if (parsed.onboarding.status === "done" || parsed.onboarding.status === "skipped") return "summary";
  const steps = profileSteps();
  if (steps.some((step) => step.id === parsed.onboarding.step)) return parsed.onboarding.step;
  if (parsed.onboarding.step === "allergies" || parsed.onboarding.step === "diets" || parsed.shopStores?.length) return "receipts";
  return steps[0]?.id || "place";
}

function joinLabels(ids) {
  const labels = (ids || []).map(optionLabel).filter(Boolean);
  return labels.length ? labels.join(", ") : "Not set yet";
}

function householdLine(household) {
  if (!household?.size && household?.kids == null && household?.picky == null) return "Not set yet";
  const parts = [];
  if (household.size) parts.push(household.size >= 5 ? "5 or more people" : `${household.size} ${household.size === 1 ? "person" : "people"}`);
  if (household.kids === true) parts.push("kids");
  if (household.kids === false) parts.push("no kids");
  if (household.picky === true) parts.push("picky eaters");
  if (household.picky === false) parts.push("not picky");
  return parts.join(" · ") || "Not set yet";
}

function cuisineLine(cuisines) {
  const likes = Object.entries(cuisines || []).filter(([, stance]) => stance === "like").map(([id]) => optionLabel(id));
  const dislikes = Object.entries(cuisines || []).filter(([, stance]) => stance === "dislike").map(([id]) => optionLabel(id));
  if (!likes.length && !dislikes.length) return "Not set yet";
  const parts = [];
  if (likes.length) parts.push(`Like ${likes.join(", ")}`);
  if (dislikes.length) parts.push(`Dislike ${dislikes.join(", ")}`);
  return parts.join(". ");
}

function brandLine(brand) {
  if (!brand?.default && !brand?.organicIfClose && !Object.keys(brand?.overrides || {}).length) return "Not set yet";
  const parts = [];
  if (brand.default) parts.push(optionLabel(brand.default));
  if (brand.organicIfClose) parts.push("organic when the price is close");
  const overrides = Object.entries(brand.overrides || {}).map(([aisle, mode]) => `${optionLabel(aisle)}: ${optionLabel(mode)}`);
  if (overrides.length) parts.push(overrides.join(", "));
  return parts.join(" · ");
}

function styleLine(style) {
  const parts = [style?.shopping, style?.cooking, style?.time].map((id) => (id ? optionLabel(id) : "")).filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not set yet";
}

/** Sections on the last screen. Each one edits a single step. */
export function summarySections(profile) {
  const parsed = parseProfile(profile);
  const products = Object.values(parsed.productPreferences || {});
  const stores = (parsed.shopStores || []).join(", ");
  return [
    { id: "place", step: "place", label: "Stores", value: stores || "Not set yet" },
    { id: "allergies", step: "allergies", label: "Allergies", value: joinLabels(parsed.allergies) },
    { id: "diets", step: "diets", label: "Diets", value: [joinLabels(parsed.diets), (parsed.dietNotes || []).join(", ")].filter((part) => part && part !== "Not set yet").join(" · ") || "Not set yet" },
    { id: "receipts", step: "receipts", label: "From your receipts", value: preferenceLine(parsed, products) },
  ];
}

function preferenceLine(profile, products) {
  const modes = { brand: "Name brand", storeBrand: "Store brand", cheapest: "Cheapest" };
  const rows = Object.values(profile.categoryPreferences || {}).filter((row) => row?.mode && row.mode !== "skip");
  if (rows.length) {
    return rows
      .slice(0, 8)
      .map((row) => {
        const name = row.label || familyName(row.family) || row.family;
        const how = modes[row.mode] || row.mode;
        if (row.mode === "brand" && row.brand) return `${name}: ${row.brand}`;
        if (row.mode === "storeBrand") return `${name}: Store brand`;
        return `${name}: ${how}`;
      })
      .join(", ");
  }
  return products.length ? products.map((pref) => `${familyName(pref.family)}: ${pref.brand ? `${pref.brand} ` : ""}${pref.name}`).join(", ") : "Not set yet";
}

function familyName(id) {
  return familyLabel(id) || id;
}

export const AISLE_LABELS = [
  { id: "dairy", label: "Dairy" },
  { id: "meat", label: "Meat" },
  { id: "produce", label: "Produce" },
  { id: "pantry", label: "Pantry" },
  { id: "snacks", label: "Snacks" },
  { id: "drinks", label: "Drinks" },
];
