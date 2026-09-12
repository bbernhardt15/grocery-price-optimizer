import puppeteer, { type Browser, type Page } from "puppeteer-core";
import {
  GroceryScraperError,
  isNetworkError,
  isTimeoutError,
} from "./errors";
import { parsePrice } from "./parsePrice";
import { defaultGrocerySite } from "./sites";
import type { GrocerySiteConfig, ScrapedProduct, ScrapeOptions } from "./types";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_SELECTOR_TIMEOUT_MS = 15_000;

type RawCard = {
  title: string | null;
  priceText: string | null;
  brand: string | null;
  href: string | null;
};

function chromePath(explicit?: string): string {
  return (
    explicit ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    "/usr/bin/google-chrome-stable"
  );
}

function wrapError(error: unknown, fallback: string): GroceryScraperError {
  if (error instanceof GroceryScraperError) {
    return error;
  }

  if (isTimeoutError(error)) {
    return new GroceryScraperError(
      `${fallback}: timed out waiting for the page. ${error instanceof Error ? error.message : String(error)}`,
      "TIMEOUT",
      { cause: error }
    );
  }

  if (isNetworkError(error)) {
    return new GroceryScraperError(
      `${fallback}: network error. ${error instanceof Error ? error.message : String(error)}`,
      "NETWORK",
      { cause: error }
    );
  }

  return new GroceryScraperError(
    `${fallback}: ${error instanceof Error ? error.message : String(error)}`,
    "BROWSER",
    { cause: error }
  );
}

async function dismissCookies(page: Page, site: GrocerySiteConfig): Promise<void> {
  const selectors = [
    ...(site.cookieAccept
      ? site.cookieAccept.split(",").map((part) => part.trim())
      : []),
  ];

  for (const selector of selectors) {
    const handle = await page.waitForSelector(selector, {
      timeout: 1500,
      visible: true,
    }).catch(() => null);

    if (handle) {
      await handle.click().catch(() => undefined);
      return;
    }
  }

  await page.evaluate(`(function () {
    var buttons = Array.from(document.querySelectorAll("button"));
    var accept = buttons.find(function (node) {
      return /accept/i.test(node.textContent || "");
    });
    if (accept) accept.click();
  })()`);
}

async function typeKeyword(
  page: Page,
  site: GrocerySiteConfig,
  keyword: string,
  selectorTimeoutMs: number
): Promise<void> {
  try {
    await page.waitForSelector(site.searchInput, {
      visible: true,
      timeout: selectorTimeoutMs,
    });
  } catch (error) {
    throw new GroceryScraperError(
      `Search bar not found (${site.searchInput}) on ${site.name}. The page layout may have changed.`,
      isTimeoutError(error) ? "MISSING_ELEMENT" : "BROWSER",
      { cause: error }
    );
  }

  try {
    await page.locator(site.searchInput).fill(keyword);
  } catch (error) {
    throw new GroceryScraperError(
      `Could not type into the search bar on ${site.name}.`,
      isTimeoutError(error) ? "TIMEOUT" : "MISSING_ELEMENT",
      { cause: error }
    );
  }
}

async function submitSearch(
  page: Page,
  site: GrocerySiteConfig,
  keyword: string,
  navigationTimeoutMs: number
): Promise<void> {
  const waitForResultsPage = page
    .waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    })
    .catch(() => null);

  await page.evaluate(`(function () {
    var keyword = ${JSON.stringify(keyword)};
    var input = document.querySelector(${JSON.stringify(site.searchInput)});
    if (!input) {
      throw new Error("Search input was missing after typing.");
    }
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(input, keyword);
    } else {
      input.value = keyword;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    var form = input.closest("form");
    if (!form) {
      throw new Error("Search form was missing after typing.");
    }
    form.submit();
  })()`);

  await waitForResultsPage;

  if (urlLooksLikeSearch(page.url(), keyword)) {
    return;
  }

  const retryNavigation = page
    .waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    })
    .catch(() => null);

  try {
    if (site.searchSubmit) {
      await page.click(site.searchSubmit);
    } else {
      await page.keyboard.press("Enter");
    }
  } catch (error) {
    throw wrapError(error, "Could not submit the grocery search form");
  }

  await retryNavigation;

  if (!urlLooksLikeSearch(page.url(), keyword)) {
    throw new GroceryScraperError(
      `Search did not navigate to results for "${keyword}". Current URL: ${page.url()}`,
      "TIMEOUT"
    );
  }
}

function urlLooksLikeSearch(url: string, keyword: string): boolean {
  const lowered = url.toLowerCase();
  const compact = keyword.trim().toLowerCase().replace(/\s+/g, "+");
  const encoded = encodeURIComponent(keyword.trim()).toLowerCase();
  return (
    lowered.includes("/search") ||
    lowered.includes(`q=${compact}`) ||
    lowered.includes(`q=${encoded}`) ||
    lowered.includes(`query=${compact}`)
  );
}

function toAbsoluteUrl(href: string | null, homepageUrl: string): string | null {
  if (!href) {
    return null;
  }

  try {
    return new URL(href, homepageUrl).toString();
  } catch {
    return href;
  }
}

function cleanBrand(brand: string | null): string | null {
  if (!brand) {
    return null;
  }

  const cleaned = brand.replace(/^\s*vendor:\s*/i, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

async function readProductCards(
  page: Page,
  site: GrocerySiteConfig
): Promise<ScrapedProduct[]> {
  const selectors = {
    resultItem: site.resultItem,
    title: site.title,
    price: site.price,
    brand: site.brand ?? "",
    link: site.link ?? "a[href]",
  };

  const rawCards = (await page.evaluate(`(function () {
    var selectors = ${JSON.stringify(selectors)};
    function textOf(root, selector) {
      if (!selector) return null;
      var parts = selector.split(",");
      for (var i = 0; i < parts.length; i++) {
        var node = root.querySelector(parts[i].trim());
        var text = node && node.textContent ? node.textContent.replace(/\\s+/g, " ").trim() : "";
        if (text) return text;
      }
      return null;
    }
    var elements = Array.from(document.querySelectorAll(selectors.resultItem));
    return elements.map(function (element) {
      var linkSelector = selectors.link ? selectors.link.split(",")[0].trim() : "a[href]";
      var link = element.querySelector(linkSelector);
      var heading = element.querySelector("h2, h3");
      var headingText = heading && heading.textContent
        ? heading.textContent.replace(/\\s+/g, " ").trim()
        : null;
      return {
        title: textOf(element, selectors.title) || headingText,
        priceText: textOf(element, selectors.price),
        brand: textOf(element, selectors.brand),
        href: link && link.href ? link.href : null
      };
    });
  })()`)) as RawCard[];

  const products: ScrapedProduct[] = [];

  for (const card of rawCards as RawCard[]) {
    if (!card.title) {
      continue;
    }

    const price = card.priceText ? parsePrice(card.priceText) : null;
    if (price === null) {
      continue;
    }

    products.push({
      title: card.title,
      price,
      brand: cleanBrand(card.brand),
      storeName: site.name,
      url: toAbsoluteUrl(card.href, site.homepageUrl),
      currency: site.currency,
    });
  }

  return products;
}

/**
 * Opens a grocery e-commerce site, types `keyword` into the search bar,
 * and returns structured product title/price objects parsed from the HTML results.
 */
export async function scrapeGrocerySearch(
  keyword: string,
  options: ScrapeOptions = {}
): Promise<ScrapedProduct[]> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new GroceryScraperError(
      "A product keyword is required.",
      "INVALID_KEYWORD"
    );
  }

  const site = options.site ?? defaultGrocerySite;
  const navigationTimeoutMs =
    options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  const selectorTimeoutMs =
    options.selectorTimeoutMs ?? DEFAULT_SELECTOR_TIMEOUT_MS;

  let browser: Browser | null = null;

  try {
    try {
      browser = await puppeteer.launch({
        executablePath: chromePath(options.executablePath),
        headless: options.headless ?? true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
    } catch (error) {
      throw new GroceryScraperError(
        `Could not launch Chrome at ${chromePath(options.executablePath)}. Set PUPPETEER_EXECUTABLE_PATH if Chrome lives elsewhere.`,
        "BROWSER",
        { cause: error }
      );
    }

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(navigationTimeoutMs);
    page.setDefaultTimeout(selectorTimeoutMs);
    await page.setViewport({ width: 1400, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    try {
      const response = await page.goto(site.homepageUrl, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });

      if (response && response.status() >= 400) {
        throw new GroceryScraperError(
          `${site.name} returned HTTP ${response.status()} for ${site.homepageUrl}.`,
          "NETWORK"
        );
      }
    } catch (error) {
      throw wrapError(error, `Failed to open ${site.name}`);
    }

    await dismissCookies(page, site);
    await typeKeyword(page, site, trimmed, selectorTimeoutMs);

    try {
      await submitSearch(page, site, trimmed, navigationTimeoutMs);
    } catch (error) {
      throw wrapError(error, `Failed to submit the search on ${site.name}`);
    }

    try {
      await page.waitForFunction(
        `document.title.toLowerCase().includes("search") || /\\/search/i.test(location.pathname)`,
        { timeout: navigationTimeoutMs }
      );
    } catch (error) {
      throw wrapError(
        error,
        `Timed out waiting for ${site.name} search results page`
      );
    }

    try {
      await page.waitForSelector(site.resultItem, {
        timeout: selectorTimeoutMs,
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        return [];
      }

      throw wrapError(error, `Failed to read search results on ${site.name}`);
    }

    await page
      .waitForNetworkIdle({ idleTime: 750, timeout: selectorTimeoutMs })
      .catch(() => null);

    return await readProductCards(page, site);
  } catch (error) {
    throw wrapError(error, `Grocery scrape failed for "${trimmed}"`);
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

export type { ScrapedProduct, GrocerySiteConfig, ScrapeOptions };
