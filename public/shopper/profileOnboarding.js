/**
 * One question per screen. Skip this one is on every step.
 * Closing the guide saves the step so the next visit resumes.
 */

import { emptyProfile, parseProfile, PROFILE_OPTIONS } from "./profile.js";

export const SKIP_LABEL = "Skip this one";

const STEP_DEFS = [
  { id: "why", title: "Why are you here?", hint: "Pick any that fit. You can change this later.", kind: "multi", options: "why" },
  { id: "household", title: "Who are you shopping for?", hint: "A guess is fine.", kind: "household" },
  { id: "loves", title: "Foods you love", hint: "We'll lean starter lists toward these.", kind: "multi", options: "foods" },
  { id: "avoids", title: "Foods you avoid", hint: "We'll keep these off starter lists.", kind: "multi", options: "foods" },
  { id: "cuisines", title: "Cuisines", hint: "Tap once if you like it. Tap again if you don't.", kind: "cuisine", options: "cuisines" },
  {
    id: "allergies",
    title: "Any allergies?",
    hint: "These are never included. We filter by the words on the product. Shoppers should still read the label.",
    kind: "multi",
    options: "allergies",
  },
  { id: "diets", title: "Any diets?", hint: "A diet beats a favorite product.", kind: "multi", options: "diets" },
  {
    id: "always-never",
    title: "Always or never",
    hint: "Things you always buy are pinned under Your usuals.",
    kind: "text",
  },
  {
    id: "brand",
    title: "Name brand or store brand?",
    hint: "You can set a different choice for an aisle. Organic is used only when the price is close.",
    kind: "brand",
  },
  { id: "shopping", title: "How do you like to shop?", hint: "We'll keep this in mind for the trip.", kind: "single", options: "shopping" },
  { id: "cooking", title: "How do you cook?", hint: "Meal ideas stay inside this.", kind: "single", options: "cooking" },
  { id: "time", title: "How much time do you have?", hint: "Most nights, not a special occasion.", kind: "single", options: "time" },
  {
    id: "products",
    title: "Pick your go-to products",
    hint: "Optional. Tap the one you actually buy. No store prices.",
    kind: "products",
  },
  { id: "summary", title: "Here's what we learned", hint: "Edit anything that looks off, then build your first list.", kind: "summary" },
];

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
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  "gluten-free": "Gluten-free",
  "dairy-free": "Dairy-free",
  pescatarian: "Pescatarian",
  keto: "Keto",
  halal: "Halal",
  kosher: "Kosher",
  name: "Name brand",
  store: "Store brand",
  cheaper: "Whichever is cheaper",
  dairyAisle: "Dairy",
  "one-stop": "One stop",
  split: "Split for the best price",
  weekly: "A weekly shop",
  quick: "Quick trips",
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

export function profileSteps() {
  return STEP_DEFS.map((step, index) => ({
    ...step,
    index,
    choices: step.options ? (PROFILE_OPTIONS[step.options] || []).map((id) => ({ id, label: optionLabel(id) })) : [],
  }));
}

export function stepById(id) {
  return profileSteps().find((step) => step.id === id) || profileSteps()[0];
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
  const index = Math.max(0, steps.findIndex((step) => step.id === id));
  return `${index + 1} of ${steps.length}`;
}

export function primaryLabel(id) {
  return id === "summary" ? "Build my first list" : "Next";
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
  if (stepId === "loves") next.loves = answer || [];
  if (stepId === "avoids") next.avoids = answer || [];
  if (stepId === "cuisines") next.cuisines = answer || {};
  if (stepId === "allergies") next.allergies = answer || [];
  if (stepId === "diets") next.diets = answer || [];
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

export function completeProfile(profile, at = Date.now()) {
  const next = parseProfile(profile);
  next.onboarding = { status: "done", step: "summary", updatedAt: at };
  next.updatedAt = at;
  return next;
}

export function resumeStep(profile) {
  const parsed = parseProfile(profile || emptyProfile());
  if (parsed.onboarding.status === "done" || parsed.onboarding.status === "skipped") return "summary";
  return stepById(parsed.onboarding.step).id;
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
  return [
    { id: "why", step: "why", label: "Why you're here", value: joinLabels(parsed.why) },
    { id: "household", step: "household", label: "Household", value: householdLine(parsed.household) },
    { id: "loves", step: "loves", label: "Foods you love", value: joinLabels(parsed.loves) },
    { id: "avoids", step: "avoids", label: "Foods you avoid", value: joinLabels(parsed.avoids) },
    { id: "cuisines", step: "cuisines", label: "Cuisines", value: cuisineLine(parsed.cuisines) },
    { id: "allergies", step: "allergies", label: "Allergies", value: joinLabels(parsed.allergies) },
    { id: "diets", step: "diets", label: "Diets", value: joinLabels(parsed.diets) },
    {
      id: "always-never",
      step: "always-never",
      label: "Always / never",
      value: `Always: ${parsed.always.join(", ") || "—"}. Never: ${parsed.never.join(", ") || "—"}.`,
    },
    { id: "brand", step: "brand", label: "Brands", value: brandLine(parsed.brand) },
    { id: "shopping", step: "shopping", label: "How you shop", value: styleLine(parsed.style) },
    {
      id: "products",
      step: "products",
      label: "Go-to products",
      value: products.length ? products.map((pref) => `${familyName(pref.family)}: ${pref.brand ? `${pref.brand} ` : ""}${pref.name}`).join(", ") : "Not set yet",
    },
  ];
}

function familyName(id) {
  return (
    {
      butter: "Butter",
      milk: "Milk",
      eggs: "Eggs",
      bread: "Bread",
      cheese: "Cheese",
      coffee: "Coffee",
      cereal: "Cereal",
      chicken: "Chicken",
      "ground-beef": "Ground beef",
      pasta: "Pasta",
      soda: "Soda",
      yogurt: "Yogurt",
      chips: "Chips",
      bananas: "Bananas",
    }[id] || id
  );
}

export const AISLE_LABELS = [
  { id: "dairy", label: "Dairy" },
  { id: "meat", label: "Meat" },
  { id: "produce", label: "Produce" },
  { id: "pantry", label: "Pantry" },
  { id: "snacks", label: "Snacks" },
  { id: "drinks", label: "Drinks" },
];
