# Delete my data

Grocery Gitter has no account. A shopper still needs a way to delete the data this device stored before the iOS app ships. Apple expects that control inside the app. The same control is on the website and in the Capacitor shells.

Open **Settings** (top bar, My list, or the footer). Choose **Delete my data**. Type `DELETE`. The app calls `DELETE /api/me/data`, clears this device, and loads a fresh start at `/`.

Doing it again is safe. The second response is 200 with zero counts.

## How the caller is recognized

There is no password. The request is limited to what this device can prove:

| Proof | What it authorizes |
| --- | --- |
| `deviceId` | The random id in `gg-device` (8–80 letters, numbers, dashes, or underscores). Required. Watches, alert records, and push subscriptions for that id are deleted. A missing or malformed id is rejected with 400 and nothing is deleted. |
| `lists[].ownerToken` plus `lists[].shareToken` | Deletes that shared list only when the owner secret matches the stored hash. A wrong owner secret does not delete the list (`sharedListsRefused`). A list that is already gone counts as zero. |
| `kroger_shopper` cookie | The encrypted Kroger access token and refresh token. When the cookie is present and can be unsealed, both tokens are revoked. The cookie is then cleared. A request that fails validation does not clear the cookie. |

The client sends at most the one owner secret stored on this device (`gg-owner`). The server accepts up to 8.

## Inventory

### On this device (`localStorage`)

Cleared in the page after a successful response. Every key that starts with `gg-` is removed, then the page navigates to `/`.

| Key | What it holds |
| --- | --- |
| `gg-device` | Anonymous device id. Not a hardware id and not an advertising id. Created with `crypto.randomUUID` when the browser has it. |
| `gg-list-id` | Id for the on-device list, used as `listId` on a price watch until a list is shared. |
| `gg-list` | Saved list: name, brand, size, quantity, checked, catalog id, baseline price, watch mode, target price. |
| `gg-list-personal` | Copy of the on-device list kept while a shared list is open. |
| `gg-zip` | Shopper ZIP. |
| `gg-subs` | Whether substitutes are allowed in the trip plan. |
| `gg-list-alerts` | Whether the list-level price alert checkbox is on. |
| `gg-theme` | Light, dark, or match this device. |
| `gg-display-name` | Optional name shown on a shared list. |
| `gg-share` | Current share token. |
| `gg-owner` | Share token plus owner secret for a list this device created. |
| `gg-push` | Flag that this browser opted into Web Push. |
| `gg-watch-synced` | Flag that a watch has been uploaded. |
| `gg-watch-list` | List id of the watch last uploaded, so a list switch can disable the previous watch. |

No `sessionStorage` keys are used. The Kroger cookie is HttpOnly, so the page cannot delete it itself. The server sends `Set-Cookie` with `Max-Age=0`.

### In MongoDB, tied to this caller

| Collection | What it holds | Delete action |
| --- | --- | --- |
| `PriceWatch` | `deviceId`, `listId`, list name, ZIP, enabled flag, and items (product id, name, brand, watch mode, baseline price, baseline store, optional target). | Deleted where `deviceId` is the caller. Also deleted where `listId` is a share token whose list was deleted in this request, including another person’s watch of that link. Those rows store the raw link and the item names. |
| `PriceAlert` | `deviceId`, list id and name, item, store, old and new price, savings, baseline, target, seen time, push state. | Same rule as `PriceWatch`. |
| `PushSubscription` | `deviceId`, channel (`web` or `native`), endpoint, `p256dh`, `auth`, optional native token and platform. | Deleted for this `deviceId`. The page also calls `PushSubscription.unsubscribe()` so the browser drops the push registration. No VAPID keys are required to delete the row. |
| `SharedList` | Hashes of the share secret and the owner secret, up to 10 retired share hashes, title, edit or view-only, `revokedAt`, items (name, brand, size, quantity, catalog id, checked, optional display name, timestamps, deletion markers), and a sequence number. The raw secrets are not stored. | The document is deleted when the owner secret matches. Live listeners are notified so an open link refreshes and then fails. Revoke link, by itself, still does not delete the document. |

A guest who only has the share link can delete their own device rows. They cannot delete the owner’s list.

A rotated (retired) share token can still identify the document when the owner secret matches. Watches are removed for the token the caller presented. A collaborator’s watch that still uses an older token, which this device no longer has, stays until that collaborator uses Delete my data. The old link no longer opens the list, because the document is gone.

### Kroger tokens

Not in MongoDB. After Kroger login, the access token and refresh token are encrypted with AES-256-GCM and kept in the HttpOnly cookie `kroger_shopper` (SameSite=Lax, Secure in production). About 7 days with a refresh token, otherwise about 40 minutes.

`DELETE /api/me/data` unseals the cookie when `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, and `KROGER_REDIRECT_URI` are set. It POSTs each token to `https://api.kroger.com/v1/connect/oauth2/revoke`. A Kroger `invalid_token` or `invalid_grant` counts as already revoked. If Kroger is down, the cookie is still cleared and `kroger.revoked` is false. The response always reports `kroger.cookieCleared: true` on a successful delete.

The in-memory cart session helper is not used for the live cookie. A pending cart rides in a signed OAuth `state` value for about 15 minutes. It is not a saved profile. It expires on its own.

On the website the cookie is on this origin, so the delete request includes it (`credentials: "include"`).

On the iOS and Android shells the WebView calls the Railway API with `apiUrl()` and does not send that cookie (`credentials: "omit"`). Kroger login opens the system browser, and the cookie is set there. After the WebView delete succeeds, the shell opens `apiUrl("/api/kroger/logout")` with the Capacitor Browser plugin. That top-level GET revokes and clears the cookie in the system browser. Opening it twice is safe.

### Not tied to a person

These are not deleted. Removing them would change counts other shoppers rely on, and there is no device id on the row to know which hits were this caller’s.

| Collection | What it holds | Why it stays |
| --- | --- | --- |
| `ShopperZip` | 5-digit ZIP, hit count, last seen, sometimes a Kroger location id. Written from browse and trip planning. | No device id and no name. The catalog job uses recent ZIPs to refresh prices. |
| `CatalogDemand` | `kind` `search` or `list`, the phrase or `upc:` key, hit count, last seen. Search comes from catalog browse. List lines come from trip planning. Kept for 30 days of priority in cross-store lookup. | This is the search history used for refresh prioritization. It is a shared counter, not a per-shopper log. |

Product documents (`CatalogMaster`, `CatalogOffer`), ingest checkpoints, and shelf cache are catalog data, not a shopper profile.

Host request logs (IP address, time, path), when the host keeps them, are outside this button. Email [CONTACT EMAIL] to ask about a ZIP total, a search phrase, or a request log.

## Response

`DELETE /api/me/data` returns:

```json
{
  "deleted": {
    "priceWatches": 0,
    "priceAlerts": 0,
    "pushSubscriptions": 0,
    "sharedLists": 0,
    "sharedListsRefused": 0
  },
  "kroger": { "hadToken": false, "revoked": false, "cookieCleared": true },
  "notLinkedToYou": {
    "shopperZips": "ZIP totals have no device id and were left in place.",
    "catalogDemand": "Search and list phrases have no device id and were left in place."
  }
}
```

`cookieCleared` means the response told the browser to drop the cookie. `hadToken` is true only when a cookie unsealed into a token. `revoked` is true when every revoke call succeeded or Kroger said the token was already invalid.

## Web Push keys

Price-alert Web Push reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optionally `VAPID_SUBJECT` (`mailto:` or `https:`). If either key is unset, push stays off: the status route omits the public key, `POST /api/price-alerts/push` returns 503, and delivery does not call the push service. Alerts still show in the app. An unusable subject falls back to `mailto:price-alerts@grocerygitter.app`. Generate a pair with `npx web-push generate-vapid-keys`. The steps are in the README under Price drop alerts.
