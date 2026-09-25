import { groupOffersByUpc } from "./normalize";
import type { BrowseProduct, RawCatalogRecord } from "./types";

type Shelf = {
  name: string;
  brand: string;
  upc: string;
  departmentId: string;
  subcategory?: string;
  size: string;
  storeBrand?: boolean;
  offers: Array<{ store: string; price: number; onSale?: boolean }>;
};

function placeholder(departmentId: string, title: string): string {
  const params = new URLSearchParams({ d: departmentId, t: title });
  return `/api/catalog/placeholder.svg?${params.toString()}`;
}

/**
 * Demo assortment used when a store has no catalog API (and as the shelf
 * underneath live samples). UPCs are synthetic (009999…) so they do not merge
 * with a real retailer code. Shared UPCs group across stores; store brands
 * use their own codes so a missing exact item can suggest a substitute.
 */
const SHELVES: Shelf[] = [
  {
    name: "Bananas",
    brand: "Fresh",
    upc: "0099990000018",
    departmentId: "produce",
    subcategory: "Fruit",
    size: "1 lb",
    offers: [
      { store: "Aldi", price: 0.49 },
      { store: "Walmart", price: 0.54 },
      { store: "Kroger", price: 0.62 },
      { store: "Target", price: 0.69 },
    ],
  },
  {
    name: "Gala Apples",
    brand: "Fresh",
    upc: "0099990000025",
    departmentId: "produce",
    subcategory: "Fruit",
    size: "3 lb",
    offers: [
      { store: "Aldi", price: 3.29 },
      { store: "Walmart", price: 3.48, onSale: true },
      { store: "Kroger", price: 3.99 },
      { store: "Target", price: 4.29 },
    ],
  },
  {
    name: "Baby Spinach",
    brand: "Fresh",
    upc: "0099990000032",
    departmentId: "produce",
    subcategory: "Vegetables",
    size: "5 oz",
    offers: [
      { store: "Aldi", price: 1.89 },
      { store: "Walmart", price: 1.98 },
      { store: "Kroger", price: 2.29 },
      { store: "Target", price: 2.49 },
    ],
  },
  {
    name: "Whole Milk",
    brand: "Dairy Pure",
    upc: "0099991000011",
    departmentId: "dairy-eggs",
    subcategory: "Milk",
    size: "1 gal",
    offers: [
      { store: "Walmart", price: 3.18 },
      { store: "Kroger", price: 3.29 },
      { store: "Target", price: 3.49 },
    ],
  },
  {
    name: "Whole Milk",
    brand: "Great Value",
    upc: "0099991000110",
    departmentId: "dairy-eggs",
    subcategory: "Milk",
    size: "1 gal",
    storeBrand: true,
    offers: [{ store: "Walmart", price: 2.48 }],
  },
  {
    name: "Whole Milk",
    brand: "Kroger",
    upc: "0099991000127",
    departmentId: "dairy-eggs",
    subcategory: "Milk",
    size: "1 gal",
    storeBrand: true,
    offers: [{ store: "Kroger", price: 2.89 }],
  },
  {
    name: "Whole Milk",
    brand: "Good & Gather",
    upc: "0099991000134",
    departmentId: "dairy-eggs",
    subcategory: "Milk",
    size: "1 gal",
    storeBrand: true,
    offers: [{ store: "Target", price: 2.99 }],
  },
  {
    name: "Whole Milk",
    brand: "Friendly Farms",
    upc: "0099991000141",
    departmentId: "dairy-eggs",
    subcategory: "Milk",
    size: "1 gal",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 2.19 }],
  },
  {
    name: "Whole Milk",
    brand: "Dairy Pure",
    upc: "0099991000219",
    departmentId: "dairy-eggs",
    subcategory: "Milk",
    size: "0.5 gal",
    offers: [
      { store: "Walmart", price: 2.18 },
      { store: "Kroger", price: 2.29 },
      { store: "Target", price: 2.39 },
    ],
  },
  {
    name: "Large Eggs",
    brand: "Eggland's Best",
    upc: "0099991000318",
    departmentId: "dairy-eggs",
    subcategory: "Eggs",
    size: "12 ct",
    offers: [
      { store: "Walmart", price: 3.24 },
      { store: "Kroger", price: 3.49 },
      { store: "Target", price: 3.79 },
    ],
  },
  {
    name: "Large Eggs",
    brand: "Great Value",
    upc: "0099991000325",
    departmentId: "dairy-eggs",
    subcategory: "Eggs",
    size: "12 ct",
    storeBrand: true,
    offers: [{ store: "Walmart", price: 2.14, onSale: true }],
  },
  {
    name: "Large Eggs",
    brand: "Goldhen",
    upc: "0099991000332",
    departmentId: "dairy-eggs",
    subcategory: "Eggs",
    size: "12 ct",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 1.89 }],
  },
  {
    name: "Large Eggs",
    brand: "Kroger",
    upc: "0099991000349",
    departmentId: "dairy-eggs",
    subcategory: "Eggs",
    size: "18 ct",
    storeBrand: true,
    offers: [{ store: "Kroger", price: 3.18 }],
  },
  {
    name: "Salted Butter",
    brand: "Challenge",
    upc: "0099991000417",
    departmentId: "dairy-eggs",
    subcategory: "Butter",
    size: "16 oz",
    offers: [
      { store: "Walmart", price: 4.48 },
      { store: "Kroger", price: 4.29, onSale: true },
      { store: "Target", price: 4.69 },
    ],
  },
  {
    name: "Salted Butter",
    brand: "Countryside Creamery",
    upc: "0099991000424",
    departmentId: "dairy-eggs",
    subcategory: "Butter",
    size: "16 oz",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 3.29 }],
  },
  {
    name: "Plain Greek Yogurt",
    brand: "Chobani",
    upc: "0099991000516",
    departmentId: "dairy-eggs",
    subcategory: "Yogurt",
    size: "32 oz",
    offers: [
      { store: "Walmart", price: 4.98 },
      { store: "Kroger", price: 5.29 },
      { store: "Target", price: 5.49 },
    ],
  },
  {
    name: "Shredded Cheddar Cheese",
    brand: "Kraft",
    upc: "0099991000615",
    departmentId: "dairy-eggs",
    subcategory: "Cheese",
    size: "8 oz",
    offers: [
      { store: "Walmart", price: 2.48 },
      { store: "Kroger", price: 2.79 },
      { store: "Target", price: 2.99 },
      { store: "Aldi", price: 2.35 },
    ],
  },
  {
    name: "Boneless Chicken Breast",
    brand: "Just Bare",
    upc: "0099992000017",
    departmentId: "meat-seafood",
    subcategory: "Chicken",
    size: "1 lb",
    offers: [
      { store: "Walmart", price: 4.67 },
      { store: "Kroger", price: 4.99 },
      { store: "Target", price: 5.49 },
    ],
  },
  {
    name: "Boneless Chicken Breast",
    brand: "Kirkwood",
    upc: "0099992000116",
    departmentId: "meat-seafood",
    subcategory: "Chicken",
    size: "1 lb",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 3.99, onSale: true }],
  },
  {
    name: "Ground Beef 80/20",
    brand: "All Natural",
    upc: "0099992000215",
    departmentId: "meat-seafood",
    subcategory: "Beef",
    size: "1 lb",
    offers: [
      { store: "Walmart", price: 5.24 },
      { store: "Kroger", price: 5.49 },
      { store: "Target", price: 5.99 },
      { store: "Aldi", price: 4.89 },
    ],
  },
  {
    name: "Atlantic Salmon Fillet",
    brand: "Fresh",
    upc: "0099992000314",
    departmentId: "meat-seafood",
    subcategory: "Seafood",
    size: "1 lb",
    offers: [
      { store: "Walmart", price: 9.94 },
      { store: "Kroger", price: 10.99 },
      { store: "Target", price: 11.49 },
    ],
  },
  {
    name: "White Sandwich Bread",
    brand: "Nature's Own",
    upc: "0099993000016",
    departmentId: "bakery",
    subcategory: "Bread",
    size: "20 oz",
    offers: [
      { store: "Walmart", price: 2.88 },
      { store: "Kroger", price: 3.19 },
      { store: "Target", price: 3.29 },
    ],
  },
  {
    name: "White Bread",
    brand: "L'oven Fresh",
    upc: "0099993000115",
    departmentId: "bakery",
    subcategory: "Bread",
    size: "20 oz",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 1.79 }],
  },
  {
    name: "Everything Bagels",
    brand: "Thomas'",
    upc: "0099993000214",
    departmentId: "bakery",
    subcategory: "Rolls & Bagels",
    size: "6 ct",
    offers: [
      { store: "Walmart", price: 3.98 },
      { store: "Kroger", price: 4.29 },
      { store: "Target", price: 4.49 },
    ],
  },
  {
    name: "Sliced Turkey Breast",
    brand: "Hillshire Farm",
    upc: "0099994000015",
    departmentId: "deli",
    subcategory: "Sliced Meat",
    size: "9 oz",
    offers: [
      { store: "Walmart", price: 4.48 },
      { store: "Kroger", price: 4.79 },
      { store: "Target", price: 4.99 },
    ],
  },
  {
    name: "Spaghetti Pasta",
    brand: "Barilla",
    upc: "0099995000014",
    departmentId: "pantry",
    subcategory: "Pasta & Rice",
    size: "16 oz",
    offers: [
      { store: "Walmart", price: 1.48 },
      { store: "Kroger", price: 1.59 },
      { store: "Target", price: 1.79 },
    ],
  },
  {
    name: "Spaghetti",
    brand: "Reggano",
    upc: "0099995000113",
    departmentId: "pantry",
    subcategory: "Pasta & Rice",
    size: "16 oz",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 0.95 }],
  },
  {
    name: "Long Grain Rice",
    brand: "Mahatma",
    upc: "0099995000212",
    departmentId: "pantry",
    subcategory: "Pasta & Rice",
    size: "2 lb",
    offers: [
      { store: "Walmart", price: 2.84 },
      { store: "Kroger", price: 3.19 },
      { store: "Target", price: 3.49 },
      { store: "Aldi", price: 2.49 },
    ],
  },
  {
    name: "Creamy Peanut Butter",
    brand: "Jif",
    upc: "0099995000311",
    departmentId: "pantry",
    subcategory: "Condiments",
    size: "16 oz",
    offers: [
      { store: "Walmart", price: 2.67 },
      { store: "Kroger", price: 2.99 },
      { store: "Target", price: 3.19 },
    ],
  },
  {
    name: "Creamy Peanut Butter",
    brand: "Peanut Delight",
    upc: "0099995000328",
    departmentId: "pantry",
    subcategory: "Condiments",
    size: "16 oz",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 1.85 }],
  },
  {
    name: "Frozen Green Peas",
    brand: "Birds Eye",
    upc: "0099996000013",
    departmentId: "frozen",
    subcategory: "Vegetables",
    size: "12 oz",
    offers: [
      { store: "Walmart", price: 1.48 },
      { store: "Kroger", price: 1.69 },
      { store: "Target", price: 1.79 },
      { store: "Aldi", price: 1.19 },
    ],
  },
  {
    name: "Vanilla Ice Cream",
    brand: "Blue Bunny",
    upc: "0099996000112",
    departmentId: "frozen",
    subcategory: "Ice Cream",
    size: "48 fl oz",
    offers: [
      { store: "Walmart", price: 3.48, onSale: true },
      { store: "Kroger", price: 3.99 },
      { store: "Target", price: 4.29 },
    ],
  },
  {
    name: "Classic Potato Chips",
    brand: "Lay's",
    upc: "0099997000012",
    departmentId: "snacks",
    subcategory: "Chips",
    size: "8 oz",
    offers: [
      { store: "Walmart", price: 3.28 },
      { store: "Kroger", price: 3.49 },
      { store: "Target", price: 3.69 },
    ],
  },
  {
    name: "Potato Chips",
    brand: "Clancy's",
    upc: "0099997000111",
    departmentId: "snacks",
    subcategory: "Chips",
    size: "8 oz",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 1.89 }],
  },
  {
    name: "Orange Juice",
    brand: "Simply",
    upc: "0099998000011",
    departmentId: "beverages",
    subcategory: "Juice",
    size: "52 fl oz",
    offers: [
      { store: "Walmart", price: 3.98 },
      { store: "Kroger", price: 4.29 },
      { store: "Target", price: 4.49 },
    ],
  },
  {
    name: "Ground Coffee",
    brand: "Folgers",
    upc: "0099998000110",
    departmentId: "beverages",
    subcategory: "Coffee & Tea",
    size: "22.6 oz",
    offers: [
      { store: "Walmart", price: 8.96 },
      { store: "Kroger", price: 9.49 },
      { store: "Target", price: 9.99 },
      { store: "Aldi", price: 6.95 },
    ],
  },
  {
    name: "Toasted Oats Cereal",
    brand: "General Mills",
    upc: "0099999000010",
    departmentId: "breakfast",
    subcategory: "Cereal",
    size: "12 oz",
    offers: [
      { store: "Walmart", price: 3.64 },
      { store: "Kroger", price: 3.99 },
      { store: "Target", price: 4.19 },
    ],
  },
  {
    name: "Toasted Oats Cereal",
    brand: "Millville",
    upc: "0099999000119",
    departmentId: "breakfast",
    subcategory: "Cereal",
    size: "12 oz",
    storeBrand: true,
    offers: [{ store: "Aldi", price: 1.95 }],
  },
  {
    name: "Old Fashioned Oats",
    brand: "Quaker",
    upc: "0099999000218",
    departmentId: "breakfast",
    subcategory: "Oatmeal",
    size: "18 oz",
    offers: [
      { store: "Walmart", price: 3.98 },
      { store: "Kroger", price: 4.29 },
      { store: "Target", price: 4.49 },
      { store: "Aldi", price: 2.85 },
    ],
  },
  {
    name: "Baby Diapers Size 3",
    brand: "Parent's Choice",
    upc: "0099999100016",
    departmentId: "baby",
    subcategory: "Diapers",
    size: "33 ct",
    storeBrand: true,
    offers: [{ store: "Walmart", price: 8.97 }],
  },
  {
    name: "Baby Diapers Size 3",
    brand: "Up & Up",
    upc: "0099999100115",
    departmentId: "baby",
    subcategory: "Diapers",
    size: "32 ct",
    storeBrand: true,
    offers: [{ store: "Target", price: 9.49 }],
  },
  {
    name: "Paper Towels",
    brand: "Bounty",
    upc: "0099999200012",
    departmentId: "household",
    subcategory: "Paper",
    size: "6 ct",
    offers: [
      { store: "Walmart", price: 9.97 },
      { store: "Kroger", price: 10.49 },
      { store: "Target", price: 11.99 },
    ],
  },
  {
    name: "Dish Soap",
    brand: "Dawn",
    upc: "0099999200111",
    departmentId: "household",
    subcategory: "Cleaning",
    size: "18 fl oz",
    offers: [
      { store: "Walmart", price: 2.97 },
      { store: "Kroger", price: 3.19 },
      { store: "Target", price: 3.29 },
      { store: "Aldi", price: 1.65 },
    ],
  },
  {
    name: "Daily Shampoo",
    brand: "Suave",
    upc: "0099999300018",
    departmentId: "personal-care",
    subcategory: "Hair",
    size: "12.6 fl oz",
    offers: [
      { store: "Walmart", price: 1.97 },
      { store: "Kroger", price: 2.19 },
      { store: "Target", price: 2.29 },
    ],
  },
  {
    name: "Dry Dog Food",
    brand: "Purina Dog Chow",
    upc: "0099999400014",
    departmentId: "pet",
    subcategory: "Dog",
    size: "4 lb",
    offers: [
      { store: "Walmart", price: 8.48 },
      { store: "Kroger", price: 8.99 },
      { store: "Target", price: 9.49 },
    ],
  },
];

function toRecords(): RawCatalogRecord[] {
  const records: RawCatalogRecord[] = [];
  for (const shelf of SHELVES) {
    for (const offer of shelf.offers) {
      records.push({
        name: shelf.name,
        brand: shelf.brand,
        storeName: offer.store,
        price: offer.price,
        upc: shelf.upc,
        productId: `${shelf.upc}-${offer.store.slice(0, 2).toUpperCase()}`,
        retailerItemId: `${shelf.upc}-${offer.store.slice(0, 2).toUpperCase()}`,
        size: shelf.size,
        departmentId: shelf.departmentId,
        subcategory: shelf.subcategory,
        imageUrls: [placeholder(shelf.departmentId, shelf.name)],
        onSale: Boolean(offer.onSale),
        availability: "unknown",
        priceSource: "seed",
        storeBrand: shelf.storeBrand,
      });
    }
  }
  return records;
}

let cached: BrowseProduct[] | null = null;

export function demoBrowseProducts(): BrowseProduct[] {
  if (!cached) {
    cached = groupOffersByUpc(toRecords());
  }
  return cached;
}

export function demoRecords(): RawCatalogRecord[] {
  return toRecords();
}
