# Optional accounts

Grocery Gitter still works with no account. A shopper can browse, keep a list on the device, share a link, and use Delete my data exactly as before.

Sign-in is optional. When it is configured, Settings offers:

- **Sign in with Apple** (required by Apple if the app also offers another social login)
- **Google**
- **Email magic link**

Signing in merges this device into the account:

- the saved list (`gg-list`)
- price watches, alert records, and push subscriptions for `gg-device`
- shared lists this device created (the owner secret in `gg-owner` must match)
- the Kroger shopper link, when the `kroger_shopper` cookie is present and Kroger is configured

Another device that signs into the same account gets that list and those alerts. Guest mode does not call these routes.

There is no password. A session is a random token stored hashed in Mongo (`AuthSession`, 30 days). The website also sets an HttpOnly cookie `gg_session`. The iOS and Android shells keep the token in `gg-session` and send `Authorization: Bearer`.

Delete my data still deletes this device. If the request includes a session, it also deletes the account, the other devices on that account, the saved list, and shared lists linked to the account. See [DATA_DELETION.md](DATA_DELETION.md).

## Turn a provider on

Leave a variable unset to keep that provider off. The API returns 503 for a provider that is off, and `GET /api/auth/status` reports `enabled: false` until `AUTH_SECRET` and at least one provider are set. The shopper UI hides sign-in in that case.

Set these on the Railway **web** service. The ingest worker does not need them.

### Required for any sign-in

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Long random string, at least 32 bytes. Signs OAuth `state` and seals the share tokens stored on the account. `openssl rand -base64 32` |

Do not set `AUTH_ALLOW_TEST_TOKENS`. It is only for the test suite. If it is `1`, tokens of the form `test:apple:subject:email@example.com` are accepted.

### Sign in with Apple

| Variable | Purpose |
| --- | --- |
| `APPLE_CLIENT_ID` | Services ID for the website, for example `app.grocerygitter.service`. This is also an accepted identity-token audience. Comma-separate extra audiences if you have more than one. |
| `APPLE_BUNDLE_ID` | Optional. Defaults to `app.grocerygitter`. Accepted as an audience so the iOS app token verifies. |
| `APPLE_TEAM_ID` | Apple Developer Team ID. Only needed to exchange an authorization code when Apple does not post an identity token. |
| `APPLE_KEY_ID` | Key ID of the Sign in with Apple key. Same case as the code exchange. |
| `APPLE_PRIVATE_KEY` | Contents of the `.p8` key. Newlines can be written as `\n`. Same case as the code exchange. |

Apple setup:

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), open the App ID `app.grocerygitter` and enable **Sign in with Apple**.
2. Create a Services ID, for example `app.grocerygitter.service`. Enable Sign in with Apple. Register the return URL `https://<your-railway-domain>/api/auth/apple/callback` and the domain of that host.
3. Create a Sign in with Apple key, download the `.p8` once, and note the Key ID.
4. Put `APPLE_CLIENT_ID` on Railway. Add the team id, key id, and private key if you want code exchange. The redirect flow verifies the identity token Apple posts back and works with only `APPLE_CLIENT_ID` plus `AUTH_SECRET`.

The website uses Apple's JS popup when `APPLE_CLIENT_ID` is set. The iOS shell uses the native Sign in with Apple plugin when `Capacitor.Plugins.SignInWithApple` is present (`@capacitor-community/apple-sign-in` after `npm run cap:sync`). Otherwise the shell navigates to `/api/auth/apple/start`, and Apple returns to `capacitor://localhost` (iOS) or `https://localhost` (Android).

### Google

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Web client id. Comma-separate the iOS and Android client ids so those ID tokens verify too. |
| `GOOGLE_WEB_CLIENT_ID` | Optional. The button uses this when it differs from the first `GOOGLE_CLIENT_ID`. |
| `GOOGLE_CLIENT_SECRET` | Web client secret. Required for the redirect flow (`/api/auth/google/start`). The ID-token POST works without it. |

Google setup:

1. In Google Cloud, create an OAuth client of type **Web**. Authorized redirect URI: `https://<your-railway-domain>/api/auth/google/callback`. Authorized JavaScript origin: that same origin.
2. Create an **iOS** client with bundle id `app.grocerygitter` and an **Android** client with package `app.grocerygitter` and your signing certificate, if the native shells request tokens themselves.
3. On the OAuth consent screen, add the scopes `openid`, `email`, and `profile`.

A verified Google email joins an Apple or email account that already uses that address, and the other way around. Unverified emails do not.

The installed app uses `Capacitor.Plugins.GoogleAuth` when that plugin is present. Otherwise it uses the redirect flow when `GOOGLE_CLIENT_SECRET` is set, or Google Identity Services in the browser.

### Email magic link

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key. The only email provider wired up today. |
| `AUTH_EMAIL_FROM` | From address Resend has verified, for example `Grocery Gitter <sign-in@grocerygitter.app>`. |
| `APP_PUBLIC_URL` | Optional. Origin used in the link, with no trailing slash. Defaults to the request's forwarded host. Set this on Railway so the link is the public `https` origin. |

`POST /api/auth/email/start` sends one link. It works once and expires in 20 minutes. The same response is returned whether or not that address already has an account. Five emails per address per hour.

On the website the link returns to this site and sets the session cookie. In the installed app the message says the link opens in the browser, because the mail app cannot hand the token back into the WebView without a custom URL scheme. Apple and Google are the in-app buttons.

## Routes

| Route | When it is off |
| --- | --- |
| `GET /api/auth/status` | Always 200. `enabled` is false when nothing is configured. |
| `GET /api/auth/me` | `account: null` when there is no session. |
| `POST /api/auth/apple` | 503 until Apple and `AUTH_SECRET` are set. Body `{ identityToken, displayName?, deviceId?, lists?, list? }`. |
| `GET /api/auth/apple/start` | 503 until Apple redirect is available. |
| `POST /api/auth/apple/callback` | Apple's form post. |
| `POST /api/auth/google` | 503 until Google and `AUTH_SECRET` are set. Body `{ idToken, displayName?, deviceId?, lists?, list? }`. |
| `GET /api/auth/google/start` | 503 until `GOOGLE_CLIENT_SECRET` is set. |
| `POST /api/auth/email/start` | 503 until Resend is set. |
| `GET /api/auth/email/callback` | Consumes the link. |
| `POST /api/auth/merge` | 401 until signed in. Same device payload as sign-in. Safe to call again. |
| `POST /api/auth/logout` | Always 200. Clears this session only. |
| `GET /api/me/list` | 401 until signed in. |
| `PUT /api/me/list` | 401 until signed in. Body is the saved list plus `baseRevision`. The same revision replaces the list. An older revision keeps both sides; the later write of an item wins. |

`lists` entries are `{ shareToken, ownerToken }`, the same shape Delete my data uses, at most 8.

## What is stored

| Collection | What it holds |
| --- | --- |
| `Account` | Optional email, display name, the sealed Kroger blob, and sealed share tokens for lists this account owns. |
| `AuthIdentity` | `apple`, `google`, or `email`, plus the provider subject. Unique per provider and subject. |
| `AuthSession` | SHA-256 of the session token and an expiry. The raw token is not stored. |
| `MagicLink` | SHA-256 of the one-time token, the email, and an expiry. The raw token is not stored. |
| `SavedList` | One list per account: items, ZIP, alert checkbox, revision, and an optional `starterBook`. |

`starterBook` (version 1) holds slot favorites, per-list overrides, and My lists. A save that omits it leaves the stored book alone. A save that includes it merges by `updatedAt`: the later favorite, override, or list wins, and a newer delete stays deleted. Choices store a product family and size, not a price or a store. Guests keep the same book in `gg-starter-book` on the device. Delete my data removes it with the saved list.

`PriceWatch`, `PriceAlert`, `PushSubscription`, and `SharedList` gain an optional `accountId`. Guest rows leave it empty. A shared list also stores `ownerDeviceId` when the client sends `deviceId`, so a later limit can count guest lists. The raw share secret is still only a hash on the list. The account keeps a sealed copy so deleting the account can also drop a collaborator's watch of that link.

The Kroger access token and refresh token stay encrypted with AES-256-GCM. On the account they are the same sealed blob as the cookie, not a new copy of the plaintext. Signing in on a browser that already has the cookie attaches it. Signing in on another browser receives the cookie back when Kroger is configured.
