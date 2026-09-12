import { GroceryScraperError } from "./scraper/errors";
import { scrapeGrocerySearch } from "./scraper/scrapeGrocerySearch";

function usage(): never {
  console.error(
    'Usage: npm run scrape -- "<keyword>"\nExample: npm run scrape -- "almond milk"'
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const keyword = process.argv.slice(2).join(" ").trim();
  if (!keyword || keyword === "-h" || keyword === "--help") {
    usage();
  }

  try {
    const products = await scrapeGrocerySearch(keyword);
    process.stdout.write(`${JSON.stringify(products, null, 2)}\n`);
  } catch (error) {
    if (error instanceof GroceryScraperError) {
      console.error(`scrape-grocery [${error.code}]: ${error.message}`);
      process.exit(2);
    }

    console.error(
      "scrape-grocery: unexpected error",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

void main();
