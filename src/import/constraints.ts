/** Pull only the lists the ask box is allowed to send. Free-form instructions are ignored. */

function phrases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 40))
    .filter((item) => item.length > 0)
    .slice(0, 16);
}

export function constraintNote(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  const lines: string[] = [];
  const add = (label: string, key: string) => {
    const items = phrases(row[key]);
    if (items.length) lines.push(`${label}: ${items.join(", ")}`);
  };
  add("Never include", "allergies");
  add("Diets", "diets");
  add("Avoid", "avoids");
  add("Never buy", "never");
  add("Likes", "loves");
  add("Cuisines", "cuisinesLiked");
  add("Skip cuisines", "cuisinesDisliked");
  for (const line of phrases(row.hardExclusions)) lines.push(line);
  return lines.join("\n").slice(0, 800);
}
