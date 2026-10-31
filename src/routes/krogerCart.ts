import { Router, Request, Response } from "express";
import { requestAuth } from "../auth/middleware";
import { Account } from "../auth/models";
import {
  addItemsToKrogerCart,
  authorizeLocationIsSafe,
  buildKrogerAuthorizeUrl,
  exchangeAuthorizationCode,
  issueShortCartState,
  krogerCartSessions,
  verifyShortCartState,
  readCartModality,
  readKrogerOAuthConfig,
  clearShopperCookieHeader,
  readRequestCookie,
  revokeSealedShopperCookie,
  sealShopperToken,
  shopperTokenForRequest,
  krogerCartSummary,
  normalizeKrogerUpc,
  toCartLines,
  verifyCartState,
  KROGER_SHOPPER_COOKIE,
  type KrogerCartLine,
  type KrogerOAuthConfig,
  type ShopperToken,
} from "../krogerCartAuth";
import { krogerSearchUrl } from "../storeHandoff";
import { blockUnlessFeature } from "../billing/middleware";

const router = Router();
const PRODUCT_NAME = "Grocery Gitter";
const KROGER_CART_PAGE = "https://www.kroger.com/cart";

function htmlPage(title: string, body: string, returnPath = "/", navigate = true): string {
  const redirect =
    !navigate || returnPath === "/"
      ? ""
      : `<script>location.replace(${JSON.stringify(returnPath).replace(/</g, "\\u003c")});</script>`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — ${PRODUCT_NAME}</title>
    ${redirect}
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 2.5rem auto; padding: 0 1.25rem; line-height: 1.5; color: #171717; }
      a { color: #047857; }
      a.ready-back { display: inline-block; margin-top: 0.5rem; background: #047857; color: #fff; text-decoration: none; font-weight: 700; padding: 0.85rem 1.1rem; border-radius: 999px; }
      .status { padding: 0.85rem 1rem; border-radius: 10px; background: #ecfdf5; }
      .error { background: #fef3f2; color: #b42318; }
      ul { padding-left: 1.2rem; }
    </style>
  </head>
  <body>
    <p><a href="${escapeHtml(returnPath)}">← Back to ${PRODUCT_NAME}</a></p>
    <h1>${escapeHtml(title)}</h1>
    ${body}
    ${returnPath === "/" ? "" : `<p>Sending you back to ${PRODUCT_NAME}.</p>`}
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function headerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(",");
  return value ?? "";
}

/**
 * JSON cart posts must answer with JSON. fetch() often omits
 * application/json from Accept, then follows a 302 to api.kroger.com
 * cross-origin and reports "Failed to fetch". Classic form posts, which
 * are not application/json, still get that 302.
 */
function wantsJson(req: Request): boolean {
  const accept = headerText(req.headers.accept).toLowerCase();
  if (accept.includes("application/json")) return true;
  const contentType = headerText(req.headers["content-type"]).toLowerCase();
  return req.method === "POST" && contentType.includes("application/json");
}

type StartItem = {
  quantity?: unknown;
  productId?: unknown;
  upc?: unknown;
  name?: unknown;
};

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asOptionalQuantity(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

/** A browser form can post `items` as one JSON field. fetch posts an array. */
function readStartItems(value: unknown): StartItem[] | null {
  let items = value;
  if (typeof items === "string") {
    const trimmed = items.trim();
    if (!trimmed) return null;
    try {
      items = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(items) || items.length === 0) return null;
  return items as StartItem[];
}

function parseStartBody(body: unknown): {
  items: StartItem[];
  locationId?: string;
  modality: string;
} | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const items = readStartItems(record.items);
  if (!items) {
    return null;
  }
  const modality =
    typeof record.modality === "string" && record.modality.trim()
      ? record.modality.trim().toUpperCase()
      : readCartModality();
  const locationId =
    typeof record.locationId === "string" && record.locationId.trim()
      ? record.locationId.trim()
      : undefined;
  return { items, locationId, modality };
}

const RETURN_MESSAGE_MAX = 240;

/** Same-origin path the shopper app reads to toast the cart result and pick a step. */
function shopperReturnPath(
  kind: "added" | "error" | "connected",
  message: string,
  step?: "plan" | "shop"
): string {
  const clean = message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, RETURN_MESSAGE_MAX);
  const params = new URLSearchParams({ kroger: kind, message: clean });
  if (step) params.set("step", step);
  return `/?${params.toString()}`;
}

function returnStepFor(
  pending: { purpose?: string; items: unknown[] } | undefined,
  fallback: "plan" | "shop" = "plan"
): "plan" | "shop" {
  if (!pending) return fallback;
  if (pending.purpose === "connect" || pending.items.length === 0) return "plan";
  return "shop";
}

function searchUrlForLine(item: KrogerCartLine): string {
  return krogerSearchUrl({
    name: item.name || item.upc,
    upc: item.upc,
  });
}

function searchLinkItems(items: KrogerCartLine[]): Array<{
  label: string;
  url: string;
  quantity: number;
}> {
  return items.map((item) => ({
    label: item.name || item.upc,
    url: searchUrlForLine(item),
    quantity: item.quantity,
  }));
}

function searchLinkHtml(items: KrogerCartLine[]): string {
  return searchLinkItems(items)
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.url)}" rel="noopener" target="_blank">${escapeHtml(
          item.label
        )}</a> × ${item.quantity}</li>`
    )
    .join("");
}

function cookieValue(req: Request, name: string): string | undefined {
  return readRequestCookie(req.headers.cookie, name);
}

async function rememberAccountKroger(res: Response, config: KrogerOAuthConfig, token: ShopperToken): Promise<void> {
  const auth = requestAuth(res);
  if (!auth) return;
  await Account.updateOne({ _id: auth.accountId }, { $set: { krogerSealed: sealShopperToken(config.clientSecret, token) } });
}

async function sealedShopper(req: Request, res: Response): Promise<string | undefined> {
  const cookie = cookieValue(req, KROGER_SHOPPER_COOKIE);
  if (cookie) return cookie;
  const auth = requestAuth(res);
  if (!auth) return undefined;
  const account = await Account.findById(auth.accountId).select("krogerSealed").lean();
  return account?.krogerSealed || undefined;
}

function appendShopperCookie(res: Response, config: KrogerOAuthConfig, token: ShopperToken): void {
  const sealed = sealShopperToken(config.clientSecret, token);
  const maxAge = token.refreshToken ? 7 * 24 * 60 * 60 : 2400;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function pendingFromState(
  config: KrogerOAuthConfig,
  state: string | undefined
): { items: KrogerCartLine[]; locationId?: string; purpose?: "cart" | "connect"; skipped?: string[]; requested?: number } | undefined {
  if (!state) {
    return undefined;
  }
  const signed = verifyCartState(config, state);
  if (signed) {
    krogerCartSessions.takePending(state);
    return {
      items: signed.items,
      locationId: signed.locationId,
      purpose: signed.purpose,
      skipped: signed.skipped,
      requested: signed.requested,
    };
  }
  if (!verifyShortCartState(config, state)) {
    return undefined;
  }
  const memory = krogerCartSessions.takePending(state);
  if (memory) {
    return {
      items: memory.items,
      locationId: memory.locationId,
      purpose: memory.purpose,
      skipped: memory.skipped,
      requested: memory.requested,
    };
  }
  return undefined;
}

function cartSummaryFor(
  lines: KrogerCartLine[],
  pending?: { skipped?: string[]; requested?: number }
): { summary: string; skipped: string[] } {
  const skipped = pending?.skipped || [];
  const total = pending?.requested ?? lines.length + skipped.length;
  return { summary: krogerCartSummary(lines.length, total, skipped), skipped };
}

function addedListHtml(lines: KrogerCartLine[], skipped: string[]): string {
  const added = lines
    .map((item) => `<li>${escapeHtml(item.name || item.upc)}</li>`)
    .join("");
  const missed = skipped.map((name) => `<li>${escapeHtml(name)}</li>`).join("");
  return `${added ? `<p>Added</p><ul>${added}</ul>` : ""}${missed ? `<p>Couldn't be matched</p><ul>${missed}</ul>` : ""}`;
}

function savePendingCart(
  config: KrogerOAuthConfig,
  cart: { items: KrogerCartLine[]; locationId?: string; purpose?: "cart" | "connect"; skipped?: string[]; requested?: number }
): { state: string; authorizeUrl: string } | null {
  const state = issueShortCartState(config);
  krogerCartSessions.savePending(state, cart);
  const authorizeUrl = buildKrogerAuthorizeUrl(config, state);
  if (!authorizeLocationIsSafe(authorizeUrl)) {
    krogerCartSessions.takePending(state);
    return null;
  }
  return { state, authorizeUrl };
}

function navigatePath(state: string): string {
  return `/api/kroger/oauth/authorize?state=${encodeURIComponent(state)}`;
}

router.get("/kroger/logout", async (req, res) => {
  const sealed = cookieValue(req, KROGER_SHOPPER_COOKIE);
  try {
    await revokeSealedShopperCookie(sealed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Kroger logout revoke failed: ${message}`);
  }
  res.append("Set-Cookie", clearShopperCookieHeader());
  res.status(200).send(
    htmlPage(
      "Kroger sign-in removed",
      `<p class="status">The Kroger sign-in on this browser is gone. You can close this page and return to ${PRODUCT_NAME}.</p>`
    )
  );
});

router.get("/kroger/auth-status", async (req, res) => {
  const config = readKrogerOAuthConfig();
  let connected = false;
  if (config) {
    const token = await shopperTokenForRequest(config, cookieValue(req, KROGER_SHOPPER_COOKIE));
    connected = Boolean(token);
  }
  res.json({
    oauthConfigured: Boolean(config),
    connected,
    cartScope: config?.scope ?? null,
    redirectUri: config?.redirectUri ?? null,
    modality: readCartModality(),
    /**
     * Client-credentials (product.compact) already used for pricing cannot
     * add to a shopper cart. A registered redirect URI is required.
     */
    requiresShopperLogin: true,
  });
});

/** Optional sign-in with no cart items. Nothing is added until a later cart start. */
router.post("/kroger/connect", async (req, res) => {
  const config = readKrogerOAuthConfig();
  if (!config) {
    res.status(501).json({
      error:
        "Kroger sign-in is not configured. Set KROGER_REDIRECT_URI to the exact URL registered on the Kroger developer app.",
      oauthConfigured: false,
    });
    return;
  }

  const existing = await shopperTokenForRequest(config, cookieValue(req, KROGER_SHOPPER_COOKIE));
  if (existing) {
    res.json({ status: "connected", oauthConfigured: true });
    return;
  }

  const issued = savePendingCart(config, { items: [], purpose: "connect" });
  if (!issued) {
    res.status(502).json({
      error: "Kroger couldn't open. Nothing was added to your cart. Try again.",
      oauthConfigured: true,
    });
    return;
  }
  res.json({
    authorizeUrl: issued.authorizeUrl,
    navigateUrl: navigatePath(issued.state),
    status: "needs_shopper_login",
    oauthConfigured: true,
  });
});

/**
 * Browser navigation only. Always a 302 (or a 302 back into the app).
 * Never JSON: Safari would download that as authorize.json.
 */
router.get("/kroger/oauth/authorize", (req, res) => {
  const config = readKrogerOAuthConfig();
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const fail = (message: string) => {
    res.set("Cache-Control", "no-store");
    res.redirect(302, shopperReturnPath("error", message, "plan"));
  };
  if (!config) {
    fail("Kroger cart sign-in is not set up. Nothing was added to your cart.");
    return;
  }
  const known = verifyShortCartState(config, state) || Boolean(verifyCartState(config, state));
  if (!state || !known || !krogerCartSessions.peekPending(state)) {
    fail("That Kroger cart session expired. Start again from Send to Kroger cart.");
    return;
  }
  const authorizeUrl = buildKrogerAuthorizeUrl(config, state);
  if (!authorizeLocationIsSafe(authorizeUrl)) {
    fail("Kroger couldn't open. Nothing was added to your cart. Try again.");
    return;
  }
  res.set("Cache-Control", "no-store");
  res.redirect(302, authorizeUrl);
});

router.post("/kroger/cart/start", async (req: Request, res: Response) => {
  const parsed = parseStartBody(req.body);
  if (!parsed) {
    res.status(400).json({
      error: "Body must include items[] from the Kroger store handoff.",
    });
    return;
  }
  if (await blockUnlessFeature(req, res, "cartHandoffs", "Cart handoffs are part of Grocery Gitter Pro.")) {
    return;
  }

  const config = readKrogerOAuthConfig();
  if (!config) {
    res.status(501).json({
      error:
        "Kroger cart OAuth is not configured. Set KROGER_REDIRECT_URI to the exact URL registered on the Kroger developer app (Railway: https://<your-domain>/api/kroger/oauth/callback) in addition to KROGER_CLIENT_ID/SECRET. Until then use the Open at Kroger search links.",
      oauthConfigured: false,
    });
    return;
  }

  const requestedItems = parsed.items.map((item) => ({
    upc: asOptionalString(item.upc),
    productId: asOptionalString(item.productId),
    quantity: asOptionalQuantity(item.quantity),
    name: asOptionalString(item.name),
  }));
  const skipped = requestedItems
    .filter((item) => !normalizeKrogerUpc(item.upc || item.productId))
    .map((item) => item.name || "Item");
  const lines = toCartLines(requestedItems, parsed.modality);
  const requested = requestedItems.length;
  if (lines.length === 0) {
    res.status(400).json({
      error: "None of these items could be matched to a Kroger product, so nothing was sent.",
      skipped,
      summary: krogerCartSummary(0, requested, skipped),
      searchLinks: [],
    });
    return;
  }

  const existing = await shopperTokenForRequest(config, await sealedShopper(req, res));
  if (existing) {
    const result = await addItemsToKrogerCart(existing.accessToken, lines);
    if (result.ok) {
      appendShopperCookie(res, config, existing);
      await rememberAccountKroger(res, config, existing);
      const { summary } = cartSummaryFor(lines, { skipped, requested });
      res.json({
        status: "added",
        added: lines.length,
        skipped: skipped.length,
        total: requested,
        summary,
        addedItems: lines.map((item) => item.name || item.upc),
        skippedItems: skipped,
        krogerCartUrl: KROGER_CART_PAGE,
        detail:
          "Kroger accepted the cart write. Finish pickup/delivery on kroger.com while logged into the same shopper account.",
      });
      return;
    }
    if (result.status !== 401 && result.status !== 403) {
      res.status(result.status >= 400 ? result.status : 502).json({
        error: result.error,
        oauthConfigured: true,
        searchLinks: searchLinkItems(lines),
        detail:
          "Grocery Gitter did not claim a cart fill because Kroger did not return HTTP 2xx. Use Open at Kroger search links, or retry after logging in again.",
      });
      return;
    }
    // 401/403: shopper token missing cart scopes or expired — fall through to login.
  }

  const issued = savePendingCart(config, {
    items: lines,
    locationId: parsed.locationId,
    skipped,
    requested,
  });
  if (!issued) {
    const message = "Kroger couldn't open. Nothing was added to your cart. Try again.";
    if (wantsJson(req)) {
      res.status(502).json({ error: message, oauthConfigured: true, searchLinks: searchLinkItems(lines) });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.redirect(302, shopperReturnPath("error", message, "plan"));
    return;
  }

  if (wantsJson(req)) {
    res.json({
      authorizeUrl: issued.authorizeUrl,
      navigateUrl: navigatePath(issued.state),
      status: "needs_shopper_login",
      itemCount: lines.length,
      searchLinks: searchLinkItems(lines),
      detail:
        "Send the browser to navigateUrl. That route returns a short 302 to Kroger. Grocery Gitter calls the Cart API only after the callback succeeds with HTTP 2xx.",
    });
    return;
  }

  res.set("Cache-Control", "no-store");
  res.redirect(302, issued.authorizeUrl);
});

router.get("/kroger/oauth/callback", async (req: Request, res: Response) => {
  const config = readKrogerOAuthConfig();
  const errorParam =
    typeof req.query.error === "string" ? req.query.error : undefined;
  const errorDescription =
    typeof req.query.error_description === "string"
      ? req.query.error_description
      : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  if (!config) {
    res.status(501).send(
      htmlPage(
        "Kroger OAuth is not configured",
        `<p class="status error">Set KROGER_REDIRECT_URI on Railway to the exact HTTPS callback URL registered on your Kroger developer app.</p>`,
        shopperReturnPath("error", "Kroger cart sign-in is not set up. Nothing was added to your cart.", "plan")
      )
    );
    return;
  }

  const pending = pendingFromState(config, state);
  const fallbackList = pending
    ? `<p>Open each item on Kroger instead:</p><ul>${searchLinkHtml(pending.items)}</ul>`
    : `<p>Use <strong>Open at Kroger</strong> search links from the ${PRODUCT_NAME} trip plan.</p>`;

  if (errorParam) {
    res.status(400).send(
      htmlPage(
        "Kroger login was not completed",
        `<p class="status error">${escapeHtml(errorDescription || errorParam)}</p>
         <p>Cart write did not run. ${PRODUCT_NAME} never reports items as added unless Kroger acknowledges <code>PUT /v1/cart/add</code>.</p>
         ${fallbackList}`,
        shopperReturnPath(
          "error",
          "Kroger login was not completed. Nothing was added to your cart. Use Open at Kroger from your trip plan.",
          returnStepFor(pending, "plan")
        )
      )
    );
    return;
  }

  if (!code || !state) {
    res.status(400).send(
      htmlPage(
        "Missing OAuth code",
        `<p class="status error">Kroger did not return an authorization code. Nothing was added to a cart.</p>
         ${fallbackList}`,
        shopperReturnPath(
          "error",
          "Kroger did not return a login code. Nothing was added to your cart.",
          returnStepFor(pending, "plan")
        )
      )
    );
    return;
  }

  if (!pending) {
    res.status(400).send(
      htmlPage(
        "Kroger cart session expired",
        `<p class="status error">Start again from <strong>Send to Kroger cart</strong> on the trip plan. Signed cart state is valid for about 15 minutes.</p>`,
        shopperReturnPath("error", "That Kroger cart session expired. Start again from Send to Kroger cart.", "plan")
      )
    );
    return;
  }

  let token;
  try {
    token = await exchangeAuthorizationCode(config, code);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(401).send(
      htmlPage(
        "Could not complete Kroger login",
        `<p class="status error">${escapeHtml(message)}</p>
         <p>The Cart API was not called. Confirm the redirect URI matches KROGER_REDIRECT_URI (including https and hostname) and that the Kroger app is allowed to request <code>cart.basic:write</code>.</p>
         ${fallbackList}`,
        shopperReturnPath(
          "error",
          `Could not complete Kroger login. Nothing was added to your cart. ${message}`,
          returnStepFor(pending, "plan")
        )
      )
    );
    return;
  }

  appendShopperCookie(res, config, token);
  await rememberAccountKroger(res, config, token);

  if (pending.purpose === "connect" || pending.items.length === 0) {
    const back = shopperReturnPath(
      "connected",
      "Kroger connected. Send items from your plan, or open your Kroger cart.",
      "plan"
    );
    res.send(
      htmlPage(
        "Kroger connected",
        `<p class="status">Kroger connected. Nothing was added yet. Send items from your plan, or open the cart on Kroger.</p>
       <p><a href="${KROGER_CART_PAGE}" rel="noopener">Open Kroger cart</a></p>`,
        back
      )
    );
    return;
  }

  const result = await addItemsToKrogerCart(token.accessToken, pending.items);

  if (!result.ok) {
    const status = result.status >= 400 ? result.status : 502;
    res.status(status).send(
      htmlPage(
        "Kroger did not add items to the cart",
        `<p class="status error">${escapeHtml(result.error)}</p>
         <p>${PRODUCT_NAME} will not claim a cart fill unless Kroger acknowledges <code>PUT /v1/cart/add</code> with HTTP 2xx. Common causes: the developer app lacks cart scopes, the shopper cancelled login, or the UPC is not orderable for pickup.</p>
         ${fallbackList}`,
        shopperReturnPath(
          "error",
          `Kroger did not add those items. ${result.error} Use Open at Kroger from your trip plan.`,
          "shop"
        )
      )
    );
    return;
  }

  const { summary, skipped: skippedNames } = cartSummaryFor(pending.items, pending);
  const back = shopperReturnPath("added", summary, "shop");
  res.send(
    htmlPage(
      "Your cart is ready",
      `<p class="status">${escapeHtml(summary)}. Finish checkout in the Kroger app or site.</p>
       ${addedListHtml(pending.items, skippedNames)}
       <p><a class="ready-back" href="${escapeHtml(back)}">Back to ${PRODUCT_NAME}</a></p>
       <p><a href="${KROGER_CART_PAGE}" rel="noopener">Open Kroger cart</a></p>`,
      back,
      false
    )
  );
});

export default router;
