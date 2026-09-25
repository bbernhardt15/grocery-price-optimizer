/**
 * Seeded queries for retailers that cannot browse by category.
 * Kroger Products is search-only. Walmart uses these only when taxonomy or
 * paginated items returns nothing. Two terms per department keeps browse
 * inside typical Affiliate / Products rate limits; results are cached.
 */
export const DEPARTMENT_SEARCH_TERMS: Record<string, readonly string[]> = {
  produce: ["bananas", "apples"],
  "dairy-eggs": ["whole milk", "large eggs"],
  "meat-seafood": ["chicken breast", "ground beef"],
  bakery: ["sandwich bread", "bagels"],
  deli: ["sliced turkey"],
  pantry: ["spaghetti", "peanut butter"],
  frozen: ["frozen vegetables", "ice cream"],
  snacks: ["potato chips"],
  beverages: ["orange juice", "ground coffee"],
  breakfast: ["cereal", "oatmeal"],
  baby: ["diapers"],
  household: ["paper towels", "dish soap"],
  "personal-care": ["shampoo"],
  pet: ["dog food"],
};

export const SEARCH_TERMS_PER_DEPARTMENT = 2;

export function searchTermsFor(departmentId: string): string[] {
  const terms = DEPARTMENT_SEARCH_TERMS[departmentId] ?? [];
  return terms.slice(0, SEARCH_TERMS_PER_DEPARTMENT);
}
