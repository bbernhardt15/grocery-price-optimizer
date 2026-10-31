/**
 * Server-side view of public/shopper/stapleFamilies.js.
 * The browser module is the source of truth. This loads it without a bundler
 * so browse, import, and the plan use the same family rules.
 */

import fs from "node:fs";
import path from "node:path";

export type StapleProduct = {
  id?: string;
  name?: string;
  brand?: string;
  familyName?: string;
  catalogName?: string;
  departmentId?: string;
  subcategory?: string;
  categories?: string[];
  categoryPaths?: string[];
  size?: string;
  sizeLabel?: string;
  variantLabel?: string;
  imageUrl?: string;
  imageUrls?: string[];
  storeBrand?: boolean;
  price?: number;
  typicalPrice?: number;
  bestOffer?: { price?: number; storeName?: string };
  offers?: Array<{ storeName?: string; price?: number; unitPrice?: number }>;
};

type FamilyModule = {
  productMatchesFamily: (product: StapleProduct, familyId: string) => boolean;
  classifyProduct: (product: StapleProduct) => string;
  familyFromQuery: (query: string) => string;
  familyLabel: (id: string) => string;
  searchTermFor: (id: string) => string;
  selectStapleTiles: (items: StapleProduct[], familyId: string, limit?: number, query?: string) => StapleProduct[];
  preferRealImages: <T>(products: T[]) => T[];
  isPlaceholderProduct: (product: StapleProduct) => boolean;
  isHouseBrand: (product: StapleProduct, storeName?: string) => boolean;
  rankFamilyScore: (product: StapleProduct, familyId: string, query?: string) => number;
  reportStapleFamilies: (
    products: StapleProduct[],
    options?: { limit?: number; only?: string }
  ) => {
    scanned: number;
    families: Array<{
      id: string;
      label: string;
      matchCount: number;
      suspectedCount: number;
      top: Array<Record<string, unknown>>;
      suspected: Array<Record<string, unknown>>;
    }>;
  };
  pickAtStore: (
    products: StapleProduct[],
    familyId: string,
    mode: string,
    storeName: string,
    preference?: { brand?: string; brands?: string[] }
  ) => StapleProduct | null;
  PREFERENCE_CATEGORIES: Array<{ id: string; label: string; search: string }>;
};

function loadFamilies(): FamilyModule {
  const file = path.join(__dirname, "../../public/shopper/stapleFamilies.js");
  const source = fs
    .readFileSync(file, "utf8")
    .replace(/^export function /gm, "function ")
    .replace(/^export const /gm, "const ")
    .replace(/^export \{[^}]*\};?\s*$/gm, "");
  const factory = new Function(`${source}\nreturn { productMatchesFamily, classifyProduct, familyFromQuery, familyLabel, searchTermFor, selectStapleTiles, preferRealImages, isPlaceholderProduct, isHouseBrand, rankFamilyScore, reportStapleFamilies, pickAtStore, PREFERENCE_CATEGORIES };`);
  return factory() as FamilyModule;
}

const api = loadFamilies();

export const productMatchesFamily = api.productMatchesFamily;
export const classifyProduct = api.classifyProduct;
export const familyFromQuery = api.familyFromQuery;
export const familyLabel = api.familyLabel;
export const searchTermFor = api.searchTermFor;
export const selectStapleTiles = api.selectStapleTiles;
export const preferRealImages = api.preferRealImages;
export const isPlaceholderProduct = api.isPlaceholderProduct;
export const isHouseBrand = api.isHouseBrand;
export const rankFamilyScore = api.rankFamilyScore;
export const reportStapleFamilies = api.reportStapleFamilies;
export const pickAtStore = api.pickAtStore;
export const PREFERENCE_CATEGORIES = api.PREFERENCE_CATEGORIES;
