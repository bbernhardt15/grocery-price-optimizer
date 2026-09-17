import { Router, Request, Response } from "express";
import {
  addItemsToKrogerCart,
  buildKrogerAuthorizeUrl,
  exchangeAuthorizationCode,
  krogerCartSessions,
  newOAuthState,
  readKrogerOAuthConfig,
  toCartLines,
  KROGER_SHOPPER_COOKIE,
  DEFAULT_CART_MODALITY,
} from "../krogerCartAuth";
import { krogerSearchUrl } from "../storeHandoff";

const router = Router();

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — Cheapest Cart</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 2.5rem auto; padding: 0 1.25rem; line-height: 1.5; color: #171717; }
      a { color: #047857; }
      .status { padding: 0.85rem 1rem; border-radius: 10px; background: #ecfdf5; }
      .error { background: #fef3f2; color: #b42318; }
      ul { padding-left: 1.2rem; }
    </style>
  </head>
  <body>
    <p><a href="/">← Back to Cheapest Cart</a></p>
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
      : DEFAULT_CART_MODALITY;
  const locationId =
    typeof record.locationId === "string" && record.locationId.trim()
      ? record.locationId.trim()
      : undefined;
  return { items: record.items as StartItem[], locationId, modality };
}

router.get("/kroger/auth-status", (_req, res) => {
  const config = readKrogerOAuthConfig();
  res.json({
    oauthConfigured: Boolean(config),
    cartScope: config?.scope ?? null,
    /**
     * Client-credentials (product.compact) already used for pricing cannot
     * add to a shopper cart. A registered redirect URI is required.
     */
    requiresShopperLogin: true,
  });
});

router.post("/kroger/cart/start", (req: Request, res: Response) => {
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
        "Kroger cart OAuth is not configured. Set KROGER_REDIRECT_URI (and register it on the Kroger developer app) in addition to KROGER_CLIENT_ID/SECRET. Until then use the Open at Kroger search links.",
      oauthConfigured: false,
    });
    return;
  }

  const lines = toCartLines(
    parsed.items.map((item) => ({
      upc: asOptionalString(item.upc),
      productId: asOptionalString(item.productId),
      quantity: asOptionalQuantity(item.quantity),
    })),
    parsed.modality
  );
  if (lines.length === 0) {
    res.status(400).json({
      error:
        "None of these Kroger items have a UPC/productId, so PUT /v1/cart/add cannot run. Use the Open at Kroger search links instead.",
    });
    return;
  }

  const state = newOAuthState();
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
      detail:
        "Redirect the shopper to authorizeUrl. Kroger must show a login/consent screen; this app will only call Cart API after that callback succeeds.",
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
        `<p class="status error">Set KROGER_REDIRECT_URI on the server and register that exact URL on your Kroger developer app.</p>`
      )
    );
    return;
  }

  if (errorParam) {
    res.status(400).send(
      htmlPage(
        "Kroger login was not completed",
        `<p class="status error">${escapeHtml(errorDescription || errorParam)}</p>
         <p>Cart write did not run. Use <strong>Open at Kroger</strong> search links from the trip plan, or retry after logging in with a Kroger account that can authorize <code>cart.basic:write</code>.</p>`
      )
    );
    return;
  }

  if (!code || !state) {
    res.status(400).send(
      htmlPage(
        "Missing OAuth code",
        `<p class="status error">Kroger did not return an authorization code. Nothing was added to a cart.</p>`
      )
    );
    return;
  }

  const pending = krogerCartSessions.takePending(state);
  if (!pending) {
    res.status(400).send(
      htmlPage(
        "Kroger cart session expired",
        `<p class="status error">Start again from <strong>Add to Kroger cart</strong> on the trip plan. Pending items are kept only ~15 minutes and only in this server process.</p>`
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
         <p>The Cart API was not called. Confirm the redirect URI matches KROGER_REDIRECT_URI and that the Kroger app is allowed to request <code>cart.basic:write</code>.</p>`
      )
    );
    return;
  }

  const sessionId = newOAuthState();
  krogerCartSessions.saveShopper(sessionId, token);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2400${secure}`
  );

  const result = await addItemsToKrogerCart(token.accessToken, pending.items);
  const searchLinks = pending.items
    .map((item) => {
      const url = krogerSearchUrl({ name: item.upc, upc: item.upc });
      return `<li><a href="${escapeHtml(url)}" rel="noopener" target="_blank">${escapeHtml(item.upc)}</a> × ${item.quantity}</li>`;
    })
    .join("");

  if (!result.ok) {
    const status = result.status >= 400 ? result.status : 502;
    res.status(status).send(
      htmlPage(
        "Kroger did not add items to the cart",
        `<p class="status error">${escapeHtml(result.error)}</p>
         <p>This app will not claim a cart fill unless Kroger acknowledges <code>PUT /v1/cart/add</code>. Common causes: the developer app lacks cart scopes, the shopper cancelled login, or the UPC is not orderable for pickup.</p>
         <p>Open each item on Kroger instead:</p>
         <ul>${searchLinks}</ul>`
      )
    );
    return;
  }

  res.send(
    htmlPage(
      "Added to your Kroger cart",
      `<p class="status">Kroger accepted ${result.added} item${result.added === 1 ? "" : "s"} via the Cart API. Finish pickup/delivery on Kroger while logged into the <strong>same</strong> shopper account.</p>
       <p><a href="https://www.kroger.com/cart" rel="noopener" target="_blank">Open Kroger cart</a></p>`
    )
  );
});

export default router;
