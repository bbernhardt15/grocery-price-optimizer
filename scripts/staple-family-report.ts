import { demoBrowseProducts } from "../src/catalog/demoCatalog";
import { reportStapleFamilies } from "../src/catalog/stapleFamilies";

const report = reportStapleFamilies(demoBrowseProducts(), { limit: 20 });
for (const family of report.families) {
  console.log(`\n${family.label} (${family.matchCount} matches, ${family.suspectedCount} suspected)`);
  for (const row of family.top) console.log(`  + ${row.brand} ${row.name}`);
  for (const row of family.suspected) console.log(`  ? ${row.name} — ${row.reason}`);
}
