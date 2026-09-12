import type { GrocerySiteConfig } from "./types";

export const vitacostSite: GrocerySiteConfig = {
  name: "Vitacost",
  homepageUrl: "https://www.vitacost.com/",
  currency: "USD",
  searchInput: "#Search-In-Header",
  searchSubmit: 'form.search button[type="submit"]',
  resultItem: ".boost-sd__product-item",
  title: ".boost-sd__product-title, .boost-sd__product-link",
  price: ".boost-sd__product-price",
  brand: ".boost-sd__product-vendor",
  link: "a[href]",
  cookieAccept:
    "#onetrust-accept-btn-handler, #shopify-pc__banner__btn-accept, button[name='accept']",
};

export const defaultGrocerySite = vitacostSite;
