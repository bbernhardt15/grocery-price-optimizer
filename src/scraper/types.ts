export type ScrapedProduct = {
  title: string;
  price: number;
  brand: string | null;
  storeName: string;
  url: string | null;
  currency: string;
};

export type GrocerySiteConfig = {
  name: string;
  homepageUrl: string;
  currency: string;
  searchInput: string;
  searchSubmit?: string;
  resultItem: string;
  title: string;
  price: string;
  brand?: string;
  link?: string;
  cookieAccept?: string;
};

export type ScrapeOptions = {
  site?: GrocerySiteConfig;
  navigationTimeoutMs?: number;
  selectorTimeoutMs?: number;
  executablePath?: string;
  headless?: boolean;
};
