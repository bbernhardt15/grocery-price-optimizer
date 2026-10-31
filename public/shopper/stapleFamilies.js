/**
 * Staple families.
 *
 * A family is the thing the shopper means: butter the dairy food, not a
 * candy bar or a wine whose name contains the word. Membership needs the
 * head noun (the product type) and, when the catalog sent one, the
 * department or taxonomy path. Pet food and non-grocery aisles stay out of
 * human food. Size and brand choose the order. They do not decide membership.
 */

const IGNORE = new Set(
  "of a an the and with for pack packs pk ct count oz lb lbs fl floz gal gallon gallons ml liter litre liters litres bag bags box boxes can cans bottle bottles carton cartons jug jugs jar jars tub tubs stick sticks mini classic original style size king snack sleeve sleeves roll rolls".split(
    /\s+/
  )
);

const BLOCKED_FOOD_DEPTS = new Set(["pet", "personal-care", "household", "other", "baby"]);

const PET = /\b(?:fancy feast|friskies|purina|iams|meow mix|9[\s-]?lives|whiskas|sheba|pedigree|kibbles|blue buffalo|cesar|alpo|reveal|friskies)\b|\b(?:cat|kitten|dog|puppy|feline|canine)\b/i;
const ALCOHOL = /\b(?:wine|wines|chardonnay|merlot|cabernet|pinot|sauvignon|riesling|beer|beers|lager|vodka|whiskey|whisky|bourbon|tequila|champagne|prosecco|spirits|liquor)\b/i;
const COSMETIC = /\b(?:lotion|shampoo|lipstick|mascara|moisturizer|body wash|deodorant|foundation|cosmetic)\b/i;
const CANDY = /\b(?:candy|candies|butterfinger|reeses?|snickers|twix|kit\s*kat|gumm(?:y|ies)|chocolate bar)\b/i;
const NUT_BUTTER = /\b(?:peanut|almond|cashew|sunflower|hazelnut|walnut|pecan|pistachio|macadamia|seed|soy|cookie)\s+butters?\b|\bnut\s+butters?\b|\bcookie\s+butter\b/i;
const BUTTER_FLAVORED = /\bbutter[-\s]?(?:flavou?red|flavou?r)\b|\b(?:flavou?red|flavou?r)\s+butter\b/i;
const SOUP = /\b(?:soup|soups|condensed|broth|stock|bisque|chowder)\b/i;
const READY_CHICKEN = /\b(?:fried|breaded|nugget|nuggets|popcorn|crispy|battered|rotisserie|fully\s+cooked|ready\s+to\s+eat)\b/i;
const SUPPLY = /\b(?:detergent|soap|pods?|pacs?|tablets?|rinse aid|liquid|gel)\b/i;
const APPLIANCE_TEXT = /\b(?:appliances?|undercounter|under-counter|glasswashers?|built-?in booster|\d{2,3}\s*-\s*\d{2,3}\s*v|\b\d{3}\s*v\b|kitchen equipment)\b/i;
const MACHINE = /\b(?:dishwasher|washer|oven|refrigerator|freezer|range|stove|microwave)\b/i;

function groceryTitle(name) {
  return String(name || "")
    .split("|")[0]
    .replace(/\([^)]*\)/g, " ")
    .replace(/[®™©℠]/g, " ");
}

function headParts(head) {
  return String(head || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9%]+/)
    .filter((part) => part && part !== "and");
}

/** Appliances, commercial equipment, and general merchandise are not grocery. */
export function isNonGroceryProduct(product) {
  const dept = String(product?.departmentId || "").toLowerCase();
  if (dept === "other") return true;
  const text = blob(product, true);
  if (APPLIANCE_TEXT.test(text) && !SUPPLY.test(text)) return true;
  if (/\b(?:commercial|industrial)\b/i.test(text) && MACHINE.test(text) && !SUPPLY.test(text)) return true;
  if (/\bdishwashers?\b/i.test(text) && !SUPPLY.test(text)) return true;
  if (/\b(?:electronics|furniture|jewelry|automotive)\b/i.test(text) && !SUPPLY.test(text)) return true;
  return false;
}

const HOUSE = {
  walmart: ["great value", "marketside", "equate", "parent's choice"],
  kroger: ["kroger", "simple truth", "private selection"],
  target: ["good & gather", "market pantry", "up & up", "favorite day"],
  aldi: [
    "friendly farms",
    "kirkwood",
    "goldhen",
    "earthly grains",
    "reggano",
    "countryside creamery",
    "millville",
    "clancy's",
    "specially selected",
    "l'oven fresh",
  ],
};

const ALL_HOUSE = new Set(Object.values(HOUSE).flat());

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9%]+/)
    .filter((token) => token && !IGNORE.has(token) && !/^\d+$/.test(token));
}

function headMatches(name, heads, after) {
  const tokens = words(name);
  const phrases = heads
    .map((head) => headParts(head))
    .filter((phrase) => phrase.length)
    .sort((a, b) => b.length - a.length || a.join(" ").localeCompare(b.join(" ")));
  for (const phrase of phrases) {
    for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
      let same = true;
      for (let offset = 0; offset < phrase.length; offset += 1) {
        if (tokens[index + offset] !== phrase[offset]) same = false;
      }
      if (!same) continue;
      const rest = tokens.slice(index + phrase.length);
      if (rest.every((token) => after.has(token))) return true;
    }
  }
  return false;
}

function listText(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function blob(product, includeBrand) {
  return [
    includeBrand ? product?.brand : "",
    product?.name,
    product?.familyName,
    product?.catalogName,
    product?.subcategory,
    ...listText(product?.categories),
    ...listText(product?.categoryPaths),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * @type {Array<{
 *   id: string,
 *   label: string,
 *   search: string,
 *   order: number,
 *   humanFood: boolean,
 *   departments: string[],
 *   subcategories: string[],
 *   heads: string[],
 *   after: string[],
 *   exclude: RegExp[],
 *   suspect: RegExp,
 *   brands: string[],
 *   size: { dim: string, ideal: number, min: number, max: number } | null,
 *   attributes: Array<{ id: string, label: string, test: RegExp }>,
 * }>}
 */
const DEFS = [
  food("eggs", "Eggs", "large eggs", 1, ["dairy-eggs"], ["Eggs"], ["egg", "eggs"], ["large", "white", "brown", "grade", "a", "jumbo", "medium", "organic", "cage", "free", "pasture", "raised"], [/\beggplant\b/i, /\b(?:noodle|noodles|nog|roll|rolls|bite|bites|salad|dye|mcmuffin)\b/i, CANDY, SOUP], /\begg/i, ["eggland's best", "vital farms", "pete and gerry's", "nellie's", "organic valley"], { dim: "count", ideal: 12, min: 12, max: 18 }, [
    attr("large", "Large", /\blarge\b/i),
    attr("dozen", "Dozen", /\b(?:12|dozen)\b/i),
    attr("organic", "Organic", /\borganic\b/i),
    attr("cage-free", "Cage-free", /\bcage[-\s]?free\b/i),
  ]),
  food("milk", "Milk", "whole milk", 2, ["dairy-eggs"], ["Milk"], ["milk"], ["whole", "2%", "1%", "skim", "fat", "free", "reduced", "lowfat", "low", "vitamin", "d", "organic", "lactose", "chocolate", "grass", "fed", "a2", "ultra", "filtered"], [/\b(?:almond|oat|soy|coconut|rice|cashew|flax|hemp|goat)\s+milks?\b/i, /\bmilk\s+chocolate\b/i, /\b(?:buttermilk|creamer|evaporated|condensed)\b/i, CANDY, SOUP], /\bmilk/i, ["dairy pure", "fairlife", "organic valley", "horizon", "lactaid"], { dim: "volume", ideal: 128, min: 64, max: 128 }, [
    attr("whole", "Whole", /\bwhole\b/i),
    attr("2%", "2%", /\b2%/i),
    attr("gallon", "Gallon", /\bgal/i),
    attr("organic", "Organic", /\borganic\b/i),
  ]),
  food("butter", "Butter", "butter", 3, ["dairy-eggs"], ["Butter"], ["butter"], ["salted", "unsalted", "sweet", "cream", "whipped", "european", "cultured", "organic", "grass", "fed", "irish", "sea", "plant", "dairy", "free", "vegan", "spread"], [NUT_BUTTER, BUTTER_FLAVORED, CANDY, ALCOHOL, SOUP, COSMETIC, /\b(?:popcorn|cracker|cookie|cup|cups|syrup)\b/i], /butter/i, ["land o lakes", "kerrygold", "challenge", "kroger", "tillamook", "plugra", "organic valley"], { dim: "weight", ideal: 16, min: 8, max: 16 }, [
    attr("salted", "Salted", /\bsalted\b/i),
    attr("unsalted", "Unsalted", /\bunsalted\b/i),
    attr("organic", "Organic", /\borganic\b/i),
  ]),
  food("bread", "Bread", "sandwich bread", 4, ["bakery", "frozen"], ["Bread"], ["bread"], ["white", "wheat", "whole", "sandwich", "sourdough", "rye", "italian", "honey", "oat", "sliced", "organic", "classic"], [/\b(?:crumb|crumbs|pudding|breading|stuffing)\b/i, /\b(?:banana|pumpkin|zucchini)\s+bread\b/i, CANDY], /\bbread/i, ["nature's own", "dave's killer bread", "sara lee", "pepperidge farm", "arnold"], { dim: "weight", ideal: 20, min: 16, max: 24 }, [
    attr("white", "White", /\bwhite\b/i),
    attr("wheat", "Wheat", /\bwheat\b/i),
    attr("sandwich", "Sandwich", /\bsandwich\b/i),
  ]),
  food("bacon", "Bacon", "bacon", 5, ["meat-seafood"], ["Pork"], ["bacon"], ["thick", "cut", "regular", "applewood", "smoked", "uncured", "hardwood", "hickory", "center", "original"], [/\b(?:bits|bit|jam|candy|chocolate|seasoning|salt|grease)\b/i, PET, CANDY], /\bbacon/i, ["oscar mayer", "smithfield", "wright", "hormel", "applegate"], { dim: "weight", ideal: 16, min: 12, max: 24 }, [
    attr("regular", "Regular", /\bregular\b|\boriginal\b/i),
    attr("thick", "Thick cut", /\bthick\b/i),
    attr("uncured", "Uncured", /\buncured\b/i),
  ]),
  house("toilet-paper", "Toilet paper", "toilet paper", 6, ["household"], ["Paper"], ["toilet paper", "bath tissue"], ["mega", "double", "soft", "ultra", "strong", "septi", "rolls"], [/\b(?:paper towel|facial tissue|napkin)\b/i], /toilet paper|bath tissue/i, ["charmin", "angel soft", "cottonelle", "scott", "quilted northern"], { dim: "count", ideal: 12, min: 4, max: 30 }, [
    attr("mega", "Mega", /\bmega\b/i),
    attr("soft", "Soft", /\bsoft\b/i),
  ]),
  house("paper-towels", "Paper towels", "paper towels", 7, ["household"], ["Paper"], ["paper towel", "paper towels"], ["select", "a", "size", "mega", "double", "sheets"], [/\b(?:toilet|bath tissue|napkin)\b/i], /paper towels?/i, ["bounty", "brawny", "viva", "sparkle"], { dim: "count", ideal: 6, min: 1, max: 12 }, []),
  food("cheese", "Cheese", "cheddar cheese", 8, ["dairy-eggs", "deli"], ["Cheese"], ["cheese", "cheddar", "mozzarella", "swiss", "provolone", "colby", "parmesan", "gouda", "jack"], ["shredded", "sliced", "block", "mild", "sharp", "extra", "medium", "natural", "mexican", "blend", "fancy", "white", "yellow", "aged", "snack", "stick", "sticks", "string"], [SOUP, CANDY, PET, /\b(?:cracker|crackers|puff|puffs|curl|curls|ball|balls|doodle|doodles|sauce|whiz|its|mac)\b/i], /\bcheeses?\b|\bcheddar\b/i, ["kraft", "sargento", "tillamook", "cabot", "crystal farms", "horizon", "belgioioso", "galbani", "philadelphia", "boar's head", "cracker barrel", "lucerne"], { dim: "weight", ideal: 8, min: 5, max: 16 }, [
    attr("shredded", "Shredded", /\bshredded\b/i),
    attr("cheddar", "Cheddar", /\bcheddar\b/i),
    attr("sliced", "Sliced", /\bsliced\b/i),
  ]),
  food("chicken", "Chicken", "chicken breast", 9, ["meat-seafood", "frozen"], ["Chicken"], ["chicken"], ["breast", "breasts", "thigh", "thighs", "wing", "wings", "drumstick", "drumsticks", "tender", "tenders", "tenderloin", "leg", "legs", "quarter", "quarters", "whole", "ground", "cutlet", "cutlets", "boneless", "skinless", "thin", "family", "pack", "tray", "air", "chilled"], [READY_CHICKEN, SOUP, PET, CANDY, /\b(?:broth|stock|soup|noodle|nugget|flavor|flavored|patty|patties)\b/i], /\bchicken\b/i, ["perdue", "tyson", "pilgrim's", "springer mountain", "miller farms", "miller", "just bare", "bell & evans", "sanderson farms"], { dim: "weight", ideal: 16, min: 12, max: 48 }, [
    attr("breast", "Breast", /\bbreast/i),
    attr("thighs", "Thighs", /\bthigh/i),
    attr("drums", "Drums", /\bdrums?\b|\bdrumsticks?\b/i),
    attr("wings", "Wings", /\bwings?\b/i),
  ]),
  food("ground-beef", "Ground beef", "ground beef", 10, ["meat-seafood"], ["Beef"], ["ground beef"], ["lean", "chuck", "sirloin", "round"], [PET, CANDY, SOUP, /\b(?:jerky|dog|chili|sauce|broth)\b/i], /\bground beef\b|\bbeef\b/i, ["all natural", "laura's lean", "meyer"], { dim: "weight", ideal: 16, min: 12, max: 48 }, [
    attr("80/20", "80/20", /\b80\s*\/\s*20\b|\b80\/20\b/i),
    attr("90/10", "90/10", /\b90\s*\/\s*10\b/i),
  ]),
  food("steak", "Steak", "steak", 11, ["meat-seafood"], ["Beef"], ["steak", "filet mignon"], ["ribeye", "sirloin", "strip", "ny", "new", "york", "t", "bone", "filet", "mignon", "flank", "skirt", "choice", "select", "usda", "beef"], [/\b(?:sauce|seasoning|fries|fry|burger|dog)\b/i, PET, CANDY], /\bsteak\b|\bfilet\b/i, ["certified angus beef", "omaha steaks", "national beef"], { dim: "weight", ideal: 16, min: 8, max: 32 }, [
    attr("ny-strip", "New York strip", /\b(?:ny|new york)\s+strip\b|\bstrip steak\b/i),
    attr("sirloin", "Sirloin", /\bsirloin\b/i),
    attr("ribeye", "Ribeye", /\bribeye\b/i),
    attr("filet", "Filet", /\bfilet\b/i),
    attr("flank", "Flank", /\bflank\b/i),
  ]),
  food("pasta", "Pasta", "spaghetti", 12, ["pantry"], ["Pasta & Rice"], ["pasta", "spaghetti", "penne", "macaroni", "fettuccine", "linguine", "rigatoni", "rotini", "ziti"], ["whole", "wheat", "protein", "gluten", "free", "enriched"], [/\b(?:sauce|meal|dinner|salad|ramen)\b/i, CANDY], /\b(?:pasta|spaghetti)\b/i, ["barilla", "ronzoni", "de cecco", "buitoni"], { dim: "weight", ideal: 16, min: 12, max: 32 }, [
    attr("spaghetti", "Spaghetti", /\bspaghetti\b/i),
  ]),
  food("rice", "Rice", "white rice", 13, ["pantry"], ["Pasta & Rice"], ["rice"], ["white", "brown", "jasmine", "basmati", "long", "grain", "enriched", "instant", "organic", "calrose"], [/\b(?:milk|krispies|crispy|cake|vinegar|paper|wine|cereal|cracker|treat|flour|pudding|aroni)\b/i, CANDY, PET], /\brice\b/i, ["mahatma", "minute", "carolina", "botan", "lundberg"], { dim: "weight", ideal: 32, min: 16, max: 80 }, [
    attr("white", "White", /\bwhite\b/i),
    attr("brown", "Brown", /\bbrown\b/i),
  ]),
  food("cereal", "Cereal", "cereal", 14, ["breakfast"], ["Cereal"], ["cereal"], ["toasted", "oats", "whole", "grain", "family", "size"], [/\b(?:bar|bars|treat|treats|candy|marshmallow snack)\b/i, /\belf on the shelf\b/i, CANDY, PET, SOUP], /\bcereal/i, ["general mills", "kellogg's", "post", "quaker", "malt-o-meal"], { dim: "weight", ideal: 12, min: 8, max: 18 }, []),
  food("coffee", "Coffee", "ground coffee", 15, ["beverages", "pantry"], ["Coffee & Tea"], ["coffee"], ["ground", "grounds", "whole", "bean", "beans", "roast", "medium", "dark", "light", "breakfast", "blend", "classic", "pods", "pod", "k", "cups", "cup", "kcup"], [/\b(?:creamer|candy|cake|syrup|liqueur|ice cream)\b/i, CANDY, ALCOHOL], /\bcoffee\b/i, ["folgers", "maxwell house", "peet's", "starbucks", "dunkin'"], { dim: "weight", ideal: 16, min: 10, max: 32 }, [
    attr("ground", "Ground", /\bground\b/i),
  ]),
  food("soda", "Soda", "cola", 16, ["beverages"], ["Soda"], ["soda", "cola", "coke", "pepsi", "sprite"], ["diet", "zero", "cherry", "vanilla", "cream", "classic", "caffeine", "free", "sugar"], [/\b(?:baking|club|caustic|washing)\s+sodas?\b/i, ALCOHOL], /\b(?:soda|cola|coke|pepsi)\b/i, ["coca-cola", "pepsi", "sprite", "dr pepper"], { dim: "count", ideal: 12, min: 6, max: 24 }, []),
  food("yogurt", "Yogurt", "greek yogurt", 17, ["dairy-eggs"], ["Yogurt"], ["yogurt", "yoghurt"], ["greek", "plain", "vanilla", "strawberry", "blueberry", "peach", "nonfat", "lowfat", "whole", "organic", "original", "fat", "free", "low"], [/\b(?:covered|raisins|pretzel|candy|bark)\b/i, CANDY, PET], /\byogurt/i, ["chobani", "fage", "oikos", "yoplait", "siggi's"], { dim: "weight", ideal: 32, min: 16, max: 32 }, [
    attr("greek", "Greek", /\bgreek\b/i),
    attr("plain", "Plain", /\bplain\b/i),
  ]),
  food("cilantro", "Cilantro", "cilantro", 18, ["produce"], ["Fresh Herbs", "Vegetables"], ["cilantro", "coriander"], ["fresh", "organic", "bunch", "packaged"], [CANDY, PET], /\bcilantro\b|\bcoriander\b/i, [], null, [
    attr("bunch", "Bunch", /\bbunch\b/i),
    attr("packaged", "Packaged", /\b(?:packaged|clamshell|container|chopped)\b/i),
    attr("organic", "Organic", /\borganic\b/i),
  ]),
  food("lettuce", "Lettuce", "lettuce", 19, ["produce"], ["Vegetables"], ["lettuce"], ["romaine", "iceberg", "butter", "green", "red", "leaf", "organic", "hearts", "shredded", "head"], [CANDY, PET, SOUP], /\blettuce\b/i, [], null, [
    attr("romaine", "Romaine head", /\bromaine\b/i),
    attr("hearts", "Hearts", /\bhearts?\b/i),
    attr("packaged", "Packaged", /\b(?:packaged|bag|clamshell)\b/i),
    attr("organic", "Organic", /\borganic\b/i),
  ]),
  food("onions", "Onions", "onions", 20, ["produce"], ["Vegetables"], ["onion", "onions"], ["yellow", "white", "red", "sweet", "vidalia", "organic", "whole", "bag"], [/\b(?:ring|rings|powder|soup|salt|chips)\b/i, CANDY, PET], /\bonions?\b/i, [], null, [
    attr("yellow", "Yellow", /\byellow\b/i),
    attr("red", "Red", /\bred\b/i),
    attr("sweet", "Sweet", /\bsweet\b|\bvidalia\b/i),
    attr("packaged", "Packaged", /\b(?:bag|packaged)\b/i),
    attr("organic", "Organic", /\borganic\b/i),
  ]),
  food("tomatoes", "Tomatoes", "tomatoes", 21, ["produce"], ["Vegetables", "Fruit"], ["tomato", "tomatoes"], ["roma", "grape", "cherry", "beefsteak", "vine", "organic", "hot", "house"], [/\b(?:sauce|soup|paste|ketchup|juice|canned)\b/i, CANDY, PET], /\btomatoes?\b/i, [], null, [
    attr("roma", "Roma", /\broma\b/i),
    attr("vine", "Vine", /\bvine\b/i),
    attr("grape", "Grape", /\bgrape\b/i),
    attr("packaged", "Packaged", /\b(?:clamshell|container|packaged)\b/i),
    attr("organic", "Organic", /\borganic\b/i),
  ]),
  food("bananas", "Bananas", "bananas", 22, ["produce"], ["Fruit"], ["banana", "bananas"], ["organic", "fresh", "bunch"], [/\b(?:chip|chips|pudding|bread|candy)\b/i, CANDY], /\bbananas?\b/i, [], null, []),
  food("peanut-butter", "Peanut butter", "peanut butter", 23, ["pantry"], ["Condiments"], ["peanut butter"], ["creamy", "crunchy", "smooth", "natural", "organic", "no", "stir"], [/\b(?:cup|cups|candy|cookie|pie|cracker|sandwich|cereal)\b/i, CANDY, /\bcookie\s+butter\b/i], /peanut butter/i, ["jif", "skippy", "peter pan", "smucker's", "smucker's natural", "justin's"], { dim: "weight", ideal: 16, min: 12, max: 40 }, [
    attr("creamy", "Creamy", /\bcreamy\b/i),
    attr("crunchy", "Crunchy", /\bcrunchy\b/i),
  ]),
  food("ketchup", "Ketchup", "ketchup", 24, ["pantry"], ["Condiments"], ["ketchup", "catsup"], ["tomato", "organic", "classic"], [/\b(?:chip|chips|flavou?red|candy)\b/i, CANDY], /\bketchup\b|\bcatsup\b/i, ["heinz", "hunt's"], { dim: "weight", ideal: 20, min: 14, max: 32 }, []),
  food("oil", "Oil", "vegetable oil", 25, ["pantry"], ["Baking", "Condiments"], ["oil"], ["olive", "extra", "virgin", "vegetable", "canola", "avocado", "coconut", "corn", "peanut", "sunflower", "pure", "light", "cooking", "classic"], [/\b(?:motor|essential|hair|body|fish|skin|massage|machine|lamp|cbd|petroleum|mineral|fragrance)\b/i, COSMETIC, PET], /\boil\b/i, ["bertolli", "filippo berio", "crisco", "mazola"], { dim: "volume", ideal: 24, min: 16, max: 48 }, [
    attr("vegetable", "Vegetable", /\bvegetable\b/i),
    attr("olive", "Olive", /\bolive\b/i),
  ]),
  house("laundry-detergent", "Laundry detergent", "laundry detergent", 26, ["household"], ["Laundry"], ["laundry detergent", "detergent"], ["liquid", "pods", "powder", "free", "clear", "sensitive", "original"], [/\bdish\b/i, PET], /laundry detergent|\bdetergent\b/i, ["tide", "gain", "persil", "all", "arm & hammer"], { dim: "volume", ideal: 92, min: 46, max: 150 }, []),
  house("dish-soap", "Dish soap", "dish soap", 27, ["household"], ["Cleaning"], ["dishwasher detergent", "dish detergent", "dishwasher soap", "dishwasher pods", "dish soap", "dishwashing liquid"], ["original", "ultra", "free", "clear", "pods", "pod", "pacs", "pac", "tablets", "tablet", "gel", "liquid"], [/\blaundry\b/i, PET, /\b(?:undercounter|glasswasher|commercial dishwasher|industrial dishwasher)\b/i], /dish soap|dishwashing|dishwasher detergent|dish detergent/i, ["dawn", "cascade", "mrs. meyer's", "mrs meyers", "palmolive", "ajax", "seventh generation", "finish"], { dim: "volume", ideal: 18, min: 12, max: 32 }, []),
  food("chili", "Chili", "chili", 28, ["pantry"], ["Canned"], ["chili"], ["beans", "with", "beef", "turkey", "no", "canned", "hot", "mild"], [/\b(?:powder|dog|seasoning|flakes|candy|cheese)\b/i, PET, CANDY], /\bchili\b/i, ["hormel", "stagg", "wolf brand", "dennison's"], { dim: "weight", ideal: 15, min: 10, max: 19 }, []),
  food("chips", "Chips", "potato chips", 29, ["snacks"], ["Chips"], ["chips", "chip"], ["potato", "classic", "original", "wavy", "kettle", "barbecue", "bbq", "sour", "cream"], [/\bchocolate\s+chips\b/i, CANDY, PET], /\bchips\b/i, ["lay's", "ruffles", "kettle brand", "pringles", "doritos", "tostitos", "cape cod", "miss vickie's", "utz", "wise", "popchips"], { dim: "weight", ideal: 8, min: 5, max: 13 }, []),
  food("bbq-sauce", "BBQ sauce", "bbq sauce", 30, ["pantry"], ["Condiments"], ["bbq sauce", "barbecue sauce", "barbeque sauce"], ["original", "honey", "sweet", "spicy", "smoky", "kansas", "carolina"], [CANDY, PET, /\b(?:chips|rub|seasoning)\b/i], /\b(?:bbq|barbecue|barbeque)\s+sauces?\b/i, ["sweet baby ray's", "kraft", "stubb's", "famous dave's", "kinders", "cattlemen's", "jack daniel's", "open pit", "bull's-eye"], { dim: "weight", ideal: 18, min: 12, max: 40 }, []),
  food("chicken-nuggets", "Chicken nuggets", "chicken nuggets", 31, ["frozen"], ["Frozen Chicken"], ["chicken nuggets", "chicken nugget", "chicken tenders"], ["breaded", "frozen", "dinosaurs", "original", "family"], [PET, SOUP, CANDY], /\bchicken\s+(?:nuggets?|tenders?)\b/i, ["tyson", "perdue", "pilgrim's", "just bare", "bell & evans", "banquet", "applegate", "fast fixin'"], { dim: "weight", ideal: 24, min: 12, max: 48 }, []),
  food("cookies", "Cookies", "chocolate chip cookies", 32, ["snacks", "bakery"], ["Cookies"], ["cookies", "cookie"], ["chocolate", "chip", "sandwich", "original", "family", "fudge"], [CANDY, /\b(?:dough|butter|ice cream|cereal)\b/i], /\bcookies?\b/i, ["oreo", "chips ahoy!", "keebler", "pepperidge farm", "girl scouts", "famous amos", "nutter butter", "mother's", "walkers"], { dim: "weight", ideal: 13, min: 8, max: 20 }, []),
  food("ice-cream", "Ice cream", "ice cream", 33, ["frozen"], ["Ice Cream"], ["ice cream"], ["vanilla", "chocolate", "strawberry", "neapolitan", "mint"], [CANDY, /\b(?:cone|sandwich|bar|bars|novelties)\b/i], /\bice\s+cream\b/i, ["häagen-dazs", "ben & jerry's", "breyers", "blue bell", "tillamook", "turkey hill", "edys", "dreyer's", "talenti", "friendly's"], { dim: "volume", ideal: 48, min: 14, max: 64 }, []),
  house("cleaner", "Cleaner", "all purpose cleaner", 34, ["household"], ["Cleaning"], ["all-purpose cleaner", "all purpose cleaner", "multi-surface cleaner", "disinfecting cleaner"], ["original", "lemon", "fresh", "spray", "refill"], [PET, COSMETIC, /\blaundry\b/i], /\bcleaners?\b/i, ["lysol", "clorox", "mr. clean", "formula 409", "fabuloso", "method", "seventh generation", "pine-sol", "windex"], { dim: "volume", ideal: 32, min: 16, max: 64 }, []),
  food("donuts", "Donuts", "donuts", 35, ["bakery", "breakfast"], ["Donuts", "Bakery"], ["donut", "donuts", "doughnut", "doughnuts"], ["glazed", "chocolate", "yeast", "cake", "plain", "original", "powdered", "cinnamon", "assorted", "dozen", "mini"], [/\b(?:holes?|muffin|cereal|cookie)\b/i, CANDY, PET], /\bdonuts?\b|\bdoughnuts?\b/i, ["entenmann's", "hostess", "krispy kreme", "little debbie"], { dim: "count", ideal: 12, min: 6, max: 16 }, []),
  food("mac-and-cheese", "Mac and cheese", "macaroni and cheese", 36, ["pantry"], ["Pasta & Rice", "Canned"], ["mac and cheese", "macaroni and cheese", "macaroni & cheese"], ["original", "classic", "shells", "cup", "cups", "boxed", "deluxe", "dinner"], [/\b(?:macbook|makeup|macadamia)\b/i, PET, CANDY], /mac(?:aroni)?\s*(?:and|&)\s*cheese/i, ["kraft", "velveeta", "annie's", "great value"], { dim: "count", ideal: 1, min: 1, max: 12 }, []),
];

function attr(id, label, test) {
  return { id, label, test };
}

function base(id, label, search, order, humanFood, departments, subcategories, heads, after, exclude, suspect, brands, size, attributes) {
  return {
    id,
    label,
    search,
    order,
    humanFood,
    departments,
    subcategories,
    heads,
    after,
    exclude,
    suspect,
    brands,
    size,
    attributes,
  };
}

function food(id, label, search, order, departments, subcategories, heads, after, exclude, suspect, brands, size, attributes) {
  return base(id, label, search, order, true, departments, subcategories, heads, after, [PET, ALCOHOL, COSMETIC, ...exclude], suspect, brands, size, attributes);
}

function house(id, label, search, order, departments, subcategories, heads, after, exclude, suspect, brands, size, attributes) {
  return base(id, label, search, order, false, departments, subcategories, heads, after, [PET, ...exclude], suspect, brands, size, attributes);
}

const FAMILIES = DEFS.map((family) => ({ ...family, after: new Set(family.after) })).sort((a, b) => a.order - b.order);
const BY_ID = new Map(FAMILIES.map((family) => [family.id, family]));

function blockedFoodDepartment(product) {
  const dept = String(product?.departmentId || "").toLowerCase();
  return Boolean(dept && BLOCKED_FOOD_DEPTS.has(dept));
}

function taxonomyOk(product, family) {
  const dept = String(product?.departmentId || "").toLowerCase();
  const sub = String(product?.subcategory || "");
  const paths = [...listText(product?.categories), ...listText(product?.categoryPaths)].join(" | ");
  if (family.humanFood && dept && BLOCKED_FOOD_DEPTS.has(dept)) return false;
  if (family.humanFood && paths && /\b(?:candy|wine|wines|beer|spirits|liquor|pet|pets|beauty|cosmetic)\b/i.test(paths)) return false;
  const has = Boolean(dept || sub || paths);
  if (!has) return true;
  if (dept && family.departments.length && !family.departments.includes(dept)) return false;
  if (sub && family.subcategories.length && !family.subcategories.some((name) => name.toLowerCase() === sub.toLowerCase())) return false;
  if (!dept && !sub && paths) {
    const allow = family.departments.concat(family.subcategories).join("|");
    if (allow && !new RegExp(allow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\|/g, "|"), "i").test(paths) && !family.heads.some((head) => new RegExp(`\\b${head}\\b`, "i").test(paths))) {
      return false;
    }
  }
  return true;
}

function escapeHead(head) {
  return String(head).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Cilantro & White Onions" is a prepared mix, not cilantro and not onions. */
export function isMixedStaple(name) {
  const text = String(name || "");
  if (/\bmac(?:aroni)?\s*(?:and|&)\s*cheese\b/i.test(text)) return false;
  if (!/[&/]|\band\b|\bwith\b/i.test(text)) return false;
  const parts = text.split(/\s*(?:&|\/|\band\b|\bwith\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const ids = new Set();
  for (const part of parts) {
    for (const family of FAMILIES) {
      if (family.heads.some((head) => new RegExp(`\\b${escapeHead(head)}\\b`, "i").test(part))) ids.add(family.id);
    }
  }
  return ids.size >= 2;
}

export function productMatchesFamily(product, familyId) {
  const family = BY_ID.get(familyId);
  if (!family || !product) return false;
  const nameText = groceryTitle([product.name, product.familyName, product.catalogName].filter(Boolean).join(" "));
  if (!nameText.trim()) return false;
  if (isNonGroceryProduct(product)) return false;
  if (isMixedStaple(nameText)) return false;
  const exclusionText = blob(product, true);
  if (family.humanFood && blockedFoodDepartment(product)) return false;
  for (const rule of family.exclude) {
    if (rule.test(exclusionText)) return false;
  }
  if (!headMatches(nameText, family.heads, family.after)) return false;
  if (!taxonomyOk(product, family)) return false;
  return true;
}

export function classifyProduct(product) {
  const hits = FAMILIES.filter((family) => productMatchesFamily(product, family.id));
  hits.sort((a, b) => Math.max(...b.heads.map((head) => head.split(/\s+/).length)) - Math.max(...a.heads.map((head) => head.split(/\s+/).length)));
  return hits[0]?.id || "";
}

function queryIsFamily(text, family) {
  const tokens = words(text);
  const phrases = family.heads
    .map((head) => headParts(head))
    .filter((phrase) => phrase.length)
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
      if (!phrase.every((part, offset) => tokens[index + offset] === part)) continue;
      const before = tokens.slice(0, index);
      const after = tokens.slice(index + phrase.length);
      const allowed = (token) => family.after.has(token) || family.heads.some((head) => headParts(head).includes(token));
      if (before.every(allowed) && after.every((token) => family.after.has(token))) return true;
    }
  }
  return false;
}

export function familyFromQuery(query) {
  const text = String(query || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^beef$/i.test(text)) return "ground-beef";
  const hits = FAMILIES.filter((family) => productMatchesFamily({ name: text }, family.id) && queryIsFamily(text, family));
  hits.sort(
    (a, b) =>
      Math.max(...b.heads.map((head) => head.split(/\s+/).length)) - Math.max(...a.heads.map((head) => head.split(/\s+/).length))
  );
  return hits[0]?.id || "";
}

export function familyLabel(id) {
  return BY_ID.get(id)?.label || "";
}

export function stapleById(id) {
  return BY_ID.get(id) || null;
}

export function searchTermFor(id) {
  return BY_ID.get(id)?.search || familyLabel(id);
}

/** Onboarding order: everyday staples first. */
export const PREFERENCE_CATEGORIES = FAMILIES.map((family) => ({
  id: family.id,
  label: family.label,
  search: family.search,
  attributes: family.attributes.map((row) => ({ id: row.id, label: row.label })),
}));

export function attributeTests(familyId) {
  return BY_ID.get(familyId)?.attributes || [];
}

export function knownBrandNames(familyId) {
  return (BY_ID.get(familyId)?.brands || []).slice();
}

const PLACEHOLDER_IMAGE = /placeholder|no[-_]?image|image[-_]?not[-_]?available|noimage|missing[-_]?image|default[-_]?image|place-holder/i;

export function isPlaceholderImage(url) {
  const value = String(url || "").trim();
  if (!value) return true;
  return PLACEHOLDER_IMAGE.test(value);
}

export function imageList(product) {
  const urls = [];
  if (Array.isArray(product?.imageUrls)) urls.push(...product.imageUrls);
  if (product?.imageUrl) urls.push(product.imageUrl);
  return urls.map((url) => String(url || "").trim()).filter(Boolean);
}

export function isPlaceholderProduct(product) {
  const name = String(product?.name || product?.familyName || "").trim();
  if (/^WM\s+/i.test(name)) return true;
  const urls = imageList(product);
  if (!urls.length) return true;
  return urls.every((url) => isPlaceholderImage(url));
}

export function isHouseBrand(product, storeName) {
  const brand = String(product?.brand || "").trim().toLowerCase();
  if (product?.storeBrand === true && !storeName) return true;
  if (storeName) {
    const key = String(storeName).trim().toLowerCase();
    const list = HOUSE[key] || [];
    if (list.some((name) => brand.includes(name))) return true;
    return false;
  }
  if (product?.storeBrand === true) return true;
  return ALL_HOUSE.has(brand) || [...ALL_HOUSE].some((name) => brand.includes(name));
}

function sizeOf(product) {
  const text = `${product?.sizeLabel || ""} ${product?.size || ""} ${product?.variantLabel || ""} ${product?.name || ""}`;
  const gallon = text.match(/(\d+(?:\.\d+)?)\s*(?:gal|gallons?)\b/i);
  if (gallon) return { dim: "volume", amount: Number(gallon[1]) * 128 };
  const floz = text.match(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|floz)\b/i);
  if (floz) return { dim: "volume", amount: Number(floz[1]) };
  const liter = text.match(/(\d+(?:\.\d+)?)\s*(?:l|liters?|litres?)\b/i);
  if (liter) return { dim: "volume", amount: Number(liter[1]) * 33.814 };
  const pound = text.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/i);
  if (pound) return { dim: "weight", amount: Number(pound[1]) * 16 };
  const ounce = text.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ounce) return { dim: "weight", amount: Number(ounce[1]) };
  const count = text.match(/(\d+(?:\.\d+)?)\s*(?:ct|count|pk|pack)\b/i);
  if (count) return { dim: "count", amount: Number(count[1]) };
  return null;
}

export function priceAmount(product) {
  const amount = Number(product?.typicalPrice ?? product?.price ?? product?.bestOffer?.price);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export function unitPriceAmount(product) {
  const price = priceAmount(product);
  const size = sizeOf(product);
  if (price == null || !size || size.amount <= 0) return null;
  return price / size.amount;
}

/** A single pricey hit must not set the median. These are ordinary grocery prices. */
const FAMILY_CEILING = {
  bananas: 4,
  donuts: 8,
  "mac-and-cheese": 6,
  "dish-soap": 16,
  "laundry-detergent": 32,
  bread: 9,
  milk: 8,
  eggs: 12,
};

const FAMILY_TYPICAL = {
  bananas: 0.8,
  donuts: 5,
  "mac-and-cheese": 1.5,
  "dish-soap": 4,
  "laundry-detergent": 13,
  bread: 3.5,
  milk: 3.5,
  eggs: 4,
};

export function medianPrice(products) {
  const prices = (products || [])
    .map((product) => priceAmount(product))
    .filter((price) => price != null)
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
}

function brandNamed(product, named) {
  const wanted = String(named || "").trim().toLowerCase();
  if (wanted.length < 3) return false;
  const brand = String(product?.brand || "").trim().toLowerCase();
  if (!brand) return false;
  return brand.includes(wanted) || wanted.includes(brand);
}

function namedFromQuery(query, familyId) {
  const text = String(query || "").toLowerCase();
  const brands = BY_ID.get(familyId)?.brands || [];
  return brands.find((brand) => text.includes(String(brand).toLowerCase())) || "";
}

/**
 * Reject a hit that is far above the family's prices.
 * A brand the shopper named is kept. More than 4x the median, or over the
 * family's ceiling, is not a grocery match.
 */
export function offerFitsFamily(product, familyId, pool, named) {
  if (!product || isNonGroceryProduct(product)) return false;
  if (familyId && !productMatchesFamily(product, familyId)) return false;
  if (brandNamed(product, named)) return true;
  const price = priceAmount(product);
  if (price == null) return true;
  const ceiling = FAMILY_CEILING[familyId];
  if (ceiling && price > ceiling) return false;
  const cousins = (pool || []).filter((row) => !familyId || productMatchesFamily(row, familyId));
  const observed = medianPrice(cousins.length ? cousins : [product]);
  const typical = FAMILY_TYPICAL[familyId];
  const reference = observed == null ? typical : typical && cousins.length < 3 ? Math.min(observed, typical) : observed;
  if (reference && price > reference * 4) return false;
  return true;
}

export function saneFamilyProducts(products, familyId, options = {}) {
  const named = options.namedBrand || namedFromQuery(options.query, familyId);
  const pool = (products || []).filter((product) => productMatchesFamily(product, familyId));
  return pool.filter((product) => offerFitsFamily(product, familyId, pool, named));
}

/** Low when the only hit is a specialty, a bad size, or well above the family. */
export function matchConfidence(product, familyId, pool, query) {
  const family = BY_ID.get(familyId);
  if (!product || !family || isNonGroceryProduct(product)) return "low";
  const askedGluten = /\bgluten/i.test(String(query || ""));
  if (!askedGluten && /\bgluten[\s-]*free\b/i.test(`${product.name || ""} ${product.brand || ""}`)) return "low";
  const price = priceAmount(product);
  const median = medianPrice(pool);
  const named = namedFromQuery(query, familyId);
  if (median && price && price > median * 2 && !brandNamed(product, named)) return "low";
  const brand = String(product.brand || "").toLowerCase();
  const known = family.brands.some((name) => brand.includes(String(name).toLowerCase()));
  const typical = FAMILY_TYPICAL[familyId];
  if (family.brands.length && !known && typical && price && price > typical * 1.5) return "low";
  const size = sizeOf(product);
  if (family.size && size && size.dim === family.size.dim && size.amount < family.size.min / 2) return "low";
  return "high";
}

export function rankFamilyScore(product, familyId, query = "") {
  const family = BY_ID.get(familyId);
  if (!family) return 0;
  const brand = String(product?.brand || "").toLowerCase();
  const name = String(product?.name || product?.familyName || "").toLowerCase();
  let score = 0;
  const index = family.brands.findIndex((wanted) => brand.includes(wanted) || name.includes(wanted));
  if (index >= 0) score += 80 - index * 4;
  else if (isHouseBrand(product)) score += 36;
  const size = sizeOf(product);
  if (family.size && size && size.dim === family.size.dim) {
    if (size.amount >= family.size.min && size.amount <= family.size.max) score += 24;
    score += Math.max(0, 16 - Math.abs(size.amount - family.size.ideal) / 4);
  }
  if (!isPlaceholderProduct(product)) score += 8;
  if (!/\bgluten/i.test(String(query || "")) && /\bgluten[\s-]*free\b/i.test(name)) score -= 40;
  if (isNonGroceryProduct(product)) score -= 200;
  const queryTokens = words(query).filter((token) => !family.heads.some((head) => head.split(/\s+/).includes(token)));
  const have = new Set(words(`${product?.name || ""} ${product?.familyName || ""}`));
  for (const token of queryTokens) if (have.has(token)) score += 12;
  for (const row of family.attributes) {
    if (row.test.test(`${product?.name || ""} ${product?.sizeLabel || ""}`)) score += 1;
  }
  return score;
}

function dedupeKey(product, familyId) {
  const brand = String(product?.brand || "").trim().toLowerCase() || "unbranded";
  return `${familyId}|${brand}`;
}

function flattenItems(items) {
  const rows = [];
  for (const item of items || []) {
    const variants = Array.isArray(item?.variants) && item.variants.length ? item.variants : [item];
    for (const variant of variants) {
      rows.push({
        ...item,
        ...variant,
        name: variant.catalogName || variant.name || item.catalogName || item.name,
        familyName: variant.familyName || item.familyName || item.name,
        brand: variant.brand || item.brand || "",
        departmentId: variant.departmentId || item.departmentId || "",
        subcategory: variant.subcategory || item.subcategory || "",
        categories: variant.categories || item.categories || [],
        categoryPaths: variant.categoryPaths || item.categoryPaths || [],
        imageUrls: variant.imageUrls?.length ? variant.imageUrls : item.imageUrls || [],
        imageUrl: variant.imageUrl || item.imageUrl || "",
        sizeLabel: variant.variantLabel || variant.sizeLabel || variant.label || item.sizeLabel || "",
        id: variant.id || item.id,
      });
    }
  }
  return rows;
}

export function selectStapleTiles(items, familyId, limit = 8, query = "") {
  if (!familyId) return [];
  const matched = flattenItems(items).filter((product) => productMatchesFamily(product, familyId));
  const real = matched.filter((product) => !isPlaceholderProduct(product));
  const pool = real.length ? real : matched;
  const groups = new Map();
  for (const product of pool) {
    const key = dedupeKey(product, familyId);
    const list = groups.get(key) || [];
    list.push(product);
    groups.set(key, list);
  }
  const tiles = [...groups.values()].map((members) => {
    members.sort((a, b) => rankFamilyScore(b, familyId, query) - rankFamilyScore(a, familyId, query) || String(a.name).localeCompare(String(b.name)));
    const best = members[0];
    return { ...best, variants: members, defaultVariantId: best.id };
  });
  tiles.sort((a, b) => rankFamilyScore(b, familyId, query) - rankFamilyScore(a, familyId, query) || String(a.brand).localeCompare(String(b.brand)));
  return tiles.slice(0, Math.max(1, limit));
}

export function preferRealImages(products) {
  const list = products || [];
  const real = list.filter((product) => !isPlaceholderProduct(product));
  return real.length ? real : list;
}

function summaryOf(product, familyId) {
  return {
    id: String(product?.id || product?.key || ""),
    name: String(product?.name || ""),
    brand: String(product?.brand || ""),
    departmentId: String(product?.departmentId || ""),
    subcategory: String(product?.subcategory || ""),
    categories: listText(product?.categories || product?.categoryPaths),
    score: familyId ? rankFamilyScore(product, familyId) : 0,
  };
}

function rejectReason(product, family) {
  const nameText = [product?.name, product?.familyName, product?.catalogName].filter(Boolean).join(" ");
  const exclusionText = blob(product, true);
  if (family.humanFood && (blockedFoodDepartment(product) || PET.test(exclusionText))) return "pet food or non-grocery";
  if (ALCOHOL.test(exclusionText)) return "wine or alcohol";
  if (CANDY.test(exclusionText)) return "candy";
  if (NUT_BUTTER.test(exclusionText) || BUTTER_FLAVORED.test(exclusionText)) return "nut butter or butter-flavored";
  if (SOUP.test(exclusionText)) return "soup";
  if (COSMETIC.test(exclusionText)) return "cosmetic";
  if (READY_CHICKEN.test(exclusionText)) return "ready-to-eat chicken";
  if (!headMatches(nameText, family.heads, family.after)) return "title keyword is not the product";
  if (!taxonomyOk(product, family)) return "wrong department or taxonomy";
  return "does not match the family";
}

/**
 * Top matches and title-only false friends, for the admin route and the script.
 * @param {object[]} products
 * @param {{ limit?: number, only?: string }} [options]
 */
export function reportStapleFamilies(products, options = {}) {
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
  const families = FAMILIES.filter((family) => !options.only || family.id === options.only);
  return {
    scanned: (products || []).length,
    families: families.map((family) => {
      const top = [];
      const suspected = [];
      for (const product of products || []) {
        if (productMatchesFamily(product, family.id)) top.push(summaryOf(product, family.id));
        else if (family.suspect.test(blob(product, true))) {
          suspected.push({ ...summaryOf(product, ""), reason: rejectReason(product, family) });
        }
      }
      top.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      return {
        id: family.id,
        label: family.label,
        matchCount: top.length,
        suspectedCount: suspected.length,
        top: top.slice(0, limit),
        suspected: suspected.slice(0, limit),
      };
    }),
  };
}

export function pickAtStore(products, familyId, mode, storeName, preference = {}) {
  const store = String(storeName || "").trim().toLowerCase();
  const pool = (products || []).filter((product) => {
    if (!productMatchesFamily(product, familyId)) return false;
    const offers = product.offers || (product.bestOffer ? [product.bestOffer] : []);
    return offers.some((offer) => String(offer.storeName || "").trim().toLowerCase() === store);
  });
  let rows = pool;
  const pickedBrands = (Array.isArray(preference.brands) && preference.brands.length ? preference.brands : preference.brand ? [preference.brand] : [])
    .map((brand) => String(brand || "").trim().toLowerCase())
    .filter(Boolean);
  if (mode === "storeBrand") {
    rows = pool.filter((product) => isHouseBrand(product, storeName));
  } else if (mode === "brand") {
    const brand = String(preference.brand || "").trim().toLowerCase();
    const branded = brand ? pool.filter((product) => String(product.brand || "").toLowerCase().includes(brand)) : [];
    rows = branded.length ? branded : pool;
  } else if (mode === "cheapestPicks") {
    rows = pickedBrands.length
      ? pool.filter((product) => {
          const have = String(product.brand || "").trim().toLowerCase();
          return pickedBrands.some((brand) => have.includes(brand) || brand.includes(have));
        })
      : [];
  }
  if (!rows.length) return null;
  if (mode === "cheapest" || mode === "cheapestPicks") {
    const priced = rows
      .map((product) => {
        const offer = (product.offers || []).find((entry) => String(entry.storeName || "").trim().toLowerCase() === store);
        const copy = { ...product, price: offer?.price ?? priceAmount(product) };
        return { product, unit: unitPriceAmount(copy), price: copy.price };
      })
      .filter((row) => row.price != null);
    if (!priced.length) return null;
    priced.sort((a, b) => (a.unit ?? a.price) - (b.unit ?? b.price));
    return priced[0].product;
  }
  rows.sort((a, b) => rankFamilyScore(b, familyId, preference.brand || "") - rankFamilyScore(a, familyId));
  return rows[0];
}

export { FAMILIES as STAPLE_FAMILY_LIST };
