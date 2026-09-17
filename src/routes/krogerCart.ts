import { Router, Request, Response } from "express";
import {
  addItemsToKrogerCart,
  buildKrogerAuthorizeUrl,
  exchangeAuthorizationCode,
  krogerCartSessions,
  readCartModality,
  readKrogerOAuthConfig,
  sealShopperToken,
  shopperTokenForRequest,
  signCartState,
  toCartLines,
  verifyCartState,
  KROGER_SHOPPER_COOKIE,
  type KrogerCartLine,
  type KrogerOAuthConfig,
  type ShopperToken,
} from "../krogerCartAuth";
import { krogerSearchUrl } from "../storeHandoff";

const router = Router();
const PRODUCT_NAME = "Grocery Gitter";
const KROGER_CART_PAGE = "https://www.kroger.com/cart";

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — ${PRODUCT_NAME}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 2.5rem auto; padding: 0 1.25rem; line-height: 1.5; color: #171717; }
      a { color: #047857; }
      .status { padding: 0.85rem 1rem; border-radius: 10px; background: #ecfdf5; }
      .error { background: #fef3f2; color: #b42318; }
      ul { padding-left: 1.2rem; }
    </style>
  </head>
  <body>
    <p><a href="/">← Back to ${PRODUCT_NAME}</a></p>
    <h1>${escapeHtml(title)}</h1>
    ${body}
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

function wantsJson(req: Request): boolean {
  const accept = req.headers.accept ?? "";
  return accept.includes("application/json");
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

function parseStartBody(body: unknown): {
  items: StartItem[];
  locationId?: string;
  modality: string;
} | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.items) || record.items.length === 0) {
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
  return { items: record.items as StartItem[], locationId, modality };
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
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return undefined;
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
): { items: KrogerCartLine[]; locationId?: string } | undefined {
  if (!state) {
    return undefined;
  }
  const signed = verifyCartState(config, state);
  if (signed) {
    krogerCartSessions.takePending(state);
    return { items: signed.items, locationId: signed.locationId };
  }
  const memory = krogerCartSessions.takePending(state);
  if (memory) {
    return { items: memory.items, locationId: memory.locationId };
  }
  return undefined;
}

router.get("/kroger/auth-status", (_req, res) => {
  const config = readKrogerOAuthConfig();
  res.json({
    oauthConfigured: Boolean(config),
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

router.post("/kroger/cart/start", async (req: Request, res: Response) => {
  const parsed = parseStartBody(req.body);
  if (!parsed) {
    res.status(400).json({
      error: "Body must include items[] from the Kroger store handoff.",
    });
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

  const lines = toCartLines(
    parsed.items.map((item) => ({
      upc: asOptionalString(item.upc),
      productId: asOptionalString(item.productId),
      quantity: asOptionalQuantity(item.quantity),
      name: asOptionalString(item.name),
    })),
    parsed.modality
  );
  if (lines.length === 0) {
    res.status(400).json({
      error:
        "None of these Kroger items have a UPC/productId, so PUT /v1/cart/add cannot run. Use the Open at Kroger search links instead.",
      searchLinks: [],
    });
    return;
  }

  const existing = await shopperTokenForRequest(
    config,
    cookieValue(req, KROGER_SHOPPER_COOKIE)
  );
  if (existing) {
    const result = await addItemsToKrogerCart(existing.accessToken, lines);
    if (result.ok) {
      appendShopperCookie(res, config, existing);
      res.json({
        status: "added",
        added: result.added,
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

  const state = signCartState(config, {
    items: lines,
    locationId: parsed.locationId,
  });
  krogerCartSessions.savePending(state, {
    items: lines,
    locationId: parsed.locationId,
  });

  const authorizeUrl = buildKrogerAuthorizeUrl(config, state);
  if (wantsJson(req)) {
    res.json({
      authorizeUrl,
      status: "needs_shopper_login",
      itemCount: lines.length,
      searchLinks: searchLinkItems(lines),
      detail:
        "Redirect the shopper to authorizeUrl. Kroger must show a login/consent screen; Grocery Gitter will only call Cart API after that callback succeeds with HTTP 2xx.",
    });
    return;
  }

  res.redirect(302, authorizeUrl);
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
        `<p class="status error">Set KROGER_REDIRECT_URI on Railway to the exact HTTPS callback URL registered on your Kroger developer app.</p>`
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
         ${fallbackList}`
      )
    );
    return;
  }

  if (!code || !state) {
    res.status(400).send(
      htmlPage(
        "Missing OAuth code",
        `<p class="status error">Kroger did not return an authorization code. Nothing was added to a cart.</p>
         ${fallbackList}`
      )
    );
    return;
  }

  if (!pending) {
    res.status(400).send(
      htmlPage(
        "Kroger cart session expired",
        `<p class="status error">Start again from <strong>Add to Kroger cart</strong> on the trip plan. Signed cart state is valid for about 15 minutes.</p>`
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
         ${fallbackList}`
      )
    );
    return;
  }

  appendShopperCookie(res, config, token);

  const result = await addItemsToKrogerCart(token.accessToken, pending.items);

  if (!result.ok) {
    const status = result.status >= 400 ? result.status : 502;
    res.status(status).send(
      htmlPage(
        "Kroger did not add items to the cart",
        `<p class="status error">${escapeHtml(result.error)}</p>
         <p>${PRODUCT_NAME} will not claim a cart fill unless Kroger acknowledges <code>PUT /v1/cart/add</code> with HTTP 2xx. Common causes: the developer app lacks cart scopes, the shopper cancelled login, or the UPC is not orderable for pickup.</p>
         ${fallbackList}`
      )
    );
    return;
  }

  res.send(
    htmlPage(
      "Added to your Kroger cart",
      `<p class="status">Kroger accepted ${result.added} item${result.added === 1 ? "" : "s"} via the Cart API. Finish pickup/delivery on Kroger while logged into the <strong>same</strong> shopper account.</p>
       <p><a href="${KROGER_CART_PAGE}" rel="noopener" target="_blank">Open Kroger cart</a></p>`
    )
  );
});

export default router;
