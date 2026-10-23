# App Store and Play Store checklist

Grocery Gitter’s iOS and Android shells are ready to archive. This file is the list of what is already in the repo, and what you still do on a Mac and in the store consoles. The repo does not submit either store.

Public pages, after the site is deployed:

- Privacy: `https://grocery-price-optimizer-production.up.railway.app/privacy`
- Terms: `https://grocery-price-optimizer-production.up.railway.app/terms`

Replace every `[BRACKET]` on those pages before you send the apps to review. The app does not know your legal name, email, mailing address, or governing law.

## Identifiers and versions

| | iOS | Android |
| --- | --- | --- |
| Bundle / application id | `app.grocerygitter` | `app.grocerygitter` |
| Display name | Grocery Gitter | Grocery Gitter |
| User-facing version | `MARKETING_VERSION` **1.0** | `versionName` **1.0** |
| Build number | `CURRENT_PROJECT_VERSION` **1** | `versionCode` **1** |
| Minimum OS | iOS 15 | Android 7 (API 24) |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY` 1,2) | Phones and tablets |

`package.json` is also `1.0.0`. Keep the three in step when you ship.

Bump the build number on every upload, even when the version shoppers see stays 1.0:

- iOS: `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` (Debug and Release). Bump `MARKETING_VERSION` only when the version shoppers see should change.
- Android: `versionCode` in `android/app/build.gradle` must go up every Play upload. `versionName` is the version shoppers see.

## Icons and splash screens

The source mark is `assets/logo.svg`: a sage **G** and a leaf on the dark canvas `#1c221e` (the same color as the app’s dark theme). Greens are `#7dcea0` and `#0e7a45`.

`npm run assets:generate` rebuilds everything from that file with `@capacitor/assets`:

- iOS app icon, 1024×1024, no transparency: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- iOS launch images, 2732×2732, light and dark: `ios/App/App/Assets.xcassets/Splash.imageset/`
- Android legacy and round icons, plus adaptive foreground and background layers, under `android/app/src/main/res/mipmap-*`
- Android splash PNGs, including night mode, under `drawable*`
- Home-screen icons: `public/icons/icon-192.png`, `icon-512.png`, and `apple-touch-icon.png`

The adaptive icon XML insets the foreground and background by 16.7% so the mark stays inside the circle and squircle masks. The launch screen and the Capacitor splash background are `#1c221e`.

You do not draw a second icon for the stores. Upload the 1024×1024 iOS icon to App Store Connect (it must stay opaque, with no rounded corners — Apple masks it). Upload `public/icons/icon-512.png` as the Play high-res icon.

## Screenshots you still take

Take these on a release build that was synced **without** `CAPACITOR_SERVER_URL`. Suggested shots: the department shelf, a search, My list with the savings meter, a trip plan with a store handoff, and the dark theme.

No alpha channel. JPEG or PNG. Up to 10 per device size. One portrait size per class is enough; the stores scale it down. Landscape is optional.

### App Store

Required, from Apple’s screenshot specifications:

| Device | Portrait sizes | Required? |
| --- | --- | --- |
| iPhone with Dynamic Island (medium) | 1206×2622 or 1179×2556 | Yes |
| iPad 13-inch | 2064×2752 or 2048×2732 | Yes, because the Xcode target includes iPad |

Also upload a large iPhone size if you do not want the biggest phones to use a scaled image: 1320×2868, 1290×2796, or 1260×2736. iPhone Duo screenshots are not required for this project’s iOS 15 target.

### Play Store

| Asset | Size | Required? |
| --- | --- | --- |
| Phone screenshots | At least 2, at most 8. 9:16. Each side between 320 and 3840 px | Yes |
| 7-inch tablet screenshots | Same file rules | Yes if the listing is offered on tablets. The app does not force phones only |
| 10-inch tablet screenshots | Same file rules | Same as 7-inch |
| Feature graphic | 1024×500 JPEG or 24-bit PNG | Yes |
| High-res icon | 512×512 PNG | Yes. Use `public/icons/icon-512.png` |

## Privacy answers, from the code

Sign-in is optional and stays off until the account variables in `docs/ACCOUNTS.md` are set. With no account configured, the app does not ask for an email. There is no analytics SDK, no advertising identifier, and no GPS permission. The iOS app does not declare a location usage string. Android asks only for `INTERNET`.

Crash reporting is Sentry, and only when `SENTRY_DSN` is set. With that variable unset, the app does not initialize Sentry and does not send crash reports. The store answers below assume the build you ship has the DSN set. If you leave it unset, answer “No” for crash data and crash logs.

What the app actually handles:

- **ZIP code.** Saved on the device. Also sent with browse, search, and trip planning. The 5-digit ZIP is stored in MongoDB (`ShopperZip`) with a hit count, last-seen time, and sometimes a Kroger location id. It is not tied to a name. The catalog job keeps a short list of recent shopper ZIPs. A price watch can store the same ZIP again, on that watch.
- **My list, before sharing.** Saved on the device: items (name, brand, size, quantity), substitute choice, and any per-item alert setting. Plan the trip sends name, brand, quantity, catalog id, UPC, and the substitute choice for that request only. That request is not stored as the list.
- **Shared lists.** After Share list, the server stores a `SharedList`: items (name, brand, size, quantity, catalog id, checked, and a deletion marker for removed items), an optional display name on items the shopper adds or checks (max 40 characters; blank means no name), a title, edit or view-only, list and item timestamps, and SHA-256 hashes of the share secret and the owner secret. The raw secrets stay in the browser and in the link. Replacing a link keeps up to 10 retired share hashes. There is no expiry. Revoke link sets `revokedAt` and keeps the items. Guests then get “This link was turned off.” The owner can still open the list and can share a new link, which retires the old hash. Neither revoke nor a new link deletes the document. Delete my data removes lists created on this device and invalidates the link. There is no separate control that deletes one list and leaves another.
- **Price alerts.** A watch is saved when the list checkbox is on, or when one item is watched on its own. `PriceWatch` stores a random id created in the browser (`gg-device`, not a hardware id and not an advertising id), the list id and name, the ZIP, whether the list checkbox is on, and the watched items: product id, name, brand, watch mode, baseline price, baseline store, and an optional target price. Turning the checkbox off sets `enabled` to false and still uploads the current items. It does not delete the watch. An item set to watch on its own can still be checked. Switching lists sets the previous watch to disabled and clears its items; the watch row stays. `PriceAlert` records (item, store, old and new price, savings, baseline, target, seen time) stay until Delete my data. Opening the panel sets `seenAt`. The API returns the latest 40. There is no expiry.
- **Web Push.** Only when `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set, and only after the shopper taps “Notify this browser.” The server then stores the endpoint and the `p256dh` and `auth` keys with the same random device id. Turning alerts off does not delete that row. Delete my data does, and the page unsubscribes the browser. The server also deletes a subscription when the push service returns 404 or 410. The native shells do not register a phone push token.
- **Optional Grocery Gitter account.** Off until `AUTH_SECRET` and a provider are set. Sign in with Apple, Google, or an email link. The server stores the provider subject, a verified email when the provider sends one, an optional display name, a hashed session, and one saved list. The raw session token and the raw magic-link token are not stored. Guest mode does not create these rows.
- **Optional Grocery Gitter Pro.** Off until `REVENUECAT_WEBHOOK_SECRET` is set. Apple or Google charges the subscription. The account stores `pro` or `free` and the period end. No card number is stored. The website does not offer checkout. See `docs/SUBSCRIPTIONS.md`.
- **Kroger tokens.** After the shopper signs in on Kroger’s site, the access token (and refresh token, when Kroger sends one) is encrypted with AES-256-GCM and kept in an HttpOnly cookie named `kroger_shopper`. About 7 days with a refresh token, otherwise about 40 minutes. If the shopper then signs in to Grocery Gitter, the same sealed blob is copied onto the account so another signed-in device can use the cart link. The plaintext is not stored.
- **Retailer handoffs.** Kroger, Walmart, Target, weekly-ad (Flipp), and Instacart, as spelled out on `/privacy`. Instacart runs only when the shopper taps it. Kroger and Instacart login pages open in the system browser.
- **Analytics.** None in the app. The host may keep ordinary request logs (IP address, time, path).
- **Crash reports.** When `SENTRY_DSN` is set, the website, the server, and the iOS and Android shells send Sentry an error message, stack trace, release git sha, OS or browser, and the page or API path. They do not send an email, a name, the grocery list, a Kroger token, the `kroger_shopper` cookie, other cookies, or Authorization headers. Reports are not tied to the random price-alert id. Sentry holds them. They are not MongoDB rows. With `SENTRY_DSN` unset, nothing is sent.
- **Sale of data.** No.
- **Deletion.** Settings → **Delete my data**, then type `DELETE`. The control is on the top bar, in My list, and in the footer, on the website and in the Capacitor shells. It removes this device’s saved list and preferences, price watches, alert records, and push subscriptions for this device, shared lists this device created (the link stops working), and the Kroger cookie after a revoke call. If this device is signed in, it also deletes the Grocery Gitter account, including the free or pro entitlement, and the other devices on it. It does not cancel an App Store or Google Play subscription. On iOS and Android it also opens the system browser to `/api/kroger/logout`, because that cookie is set there during Kroger login, not in the WebView. Doing it again is safe and deletes nothing further. ZIP hit counts (`ShopperZip`) and search or list phrases used to prioritize catalog refresh (`CatalogDemand`) are not tied to a device and are left in place. Host request logs are not deleted by the button. Crash reports in Sentry are not deleted by the button: they are not tied to an account. Email [CONTACT EMAIL] if the in-app control does not work, to ask about a ZIP total or a search phrase, or to ask for a crash report to be removed. Include the approximate time and the platform (website, iPhone, or Android) so a matching Sentry event can be deleted. If that is not enough to find it, say so.

The shopper UI does not call the FatSecret catalog route. Do not list that as data the app collects.

### App Store privacy nutrition labels

Answer “No” to tracking for every type. Guest use is not linked to an identity. When sign-in is on, email, the account name, and the account id are linked to the user for app functionality. The random alert id by itself is not an advertising id. Crash reports stay not linked to an identity. If `SENTRY_DSN` is unset, answer “No” for crash data.

Data Linked to You (fill these in only when sign-in is on; leave them off the label while sign-in stays unset):

| Data type | Collected? | Purpose |
| --- | --- | --- |
| Contact Info → Name | Yes, when sign-in is on | The account name, when Apple, Google, or the shopper provides one. App Functionality. Linked to the user |
| Contact Info → Email Address | Yes, when sign-in is on | The verified email from Apple, Google, or the email link. App Functionality. Linked to the user. Deleted with the account |
| Identifiers → User ID | Yes, when sign-in is on | The account id. App Functionality. Linked to the user |

Data Not Linked to You:

| Data type | Collected? | Purpose |
| --- | --- | --- |
| Contact Info → Name | Yes, if the form has no better row for it | The optional display name on a shared list, only when the shopper types one. App Functionality. People with the link can see it. This row is not the account name |
| Other Contact Info, Health, Financial, Contacts, Sensitive Info | No | |
| Precise Location | No | Do not turn on Location Services |
| Coarse Location | Yes | The typed ZIP, including the copy stored on a price watch. App Functionality |
| User Content → Other User Content | Yes | The grocery list sent when planning a trip, and the shared list stored on the server (items, optional display names, timestamps). App Functionality |
| Search History | Yes | Search words sent to price a shelf. App Functionality. Not kept as a profile |
| Identifiers → Device ID | Yes | The random id created in the browser and stored with watches, alerts, and an optional push subscription. App Functionality. Not an advertising identifier |
| Purchases | Yes, only if subscriptions are on | Apple and Google process Grocery Gitter Pro. The account stores the plan (free or pro) and when it ends. No card number. Leave this off the label while RevenueCat stays unset |
| Usage Data → Product Interaction | Yes | Department and product requests. App Functionality |
| Diagnostics → Crash Data | Yes, when `SENTRY_DSN` is set | Sentry crash and error reports (stack, release git sha, OS or browser, page or API path). App Functionality. Not linked to identity. No email, token, or Kroger cookie. Answer No when the DSN is unset |
| Diagnostics → Other Diagnostic Data | Yes | Host request logs (IP, time, path), if you can read them. App Functionality. Separate from Sentry |
| Advertising Data | No | |

Privacy Policy URL: the deployed `/privacy` link above. Support URL: the same site’s home page.

Age rating: no ads, no unrestricted web view of arbitrary sites beyond the store links, no gambling. There is user-to-user sharing of a grocery list through a link the shopper sends, including an optional display name. You still click through Apple’s questionnaire. The app is a shopping tool for adults.

Export compliance: `Info.plist` sets `ITSAppUsesNonExemptEncryption` to false. The iOS binary only uses HTTPS. The Kroger cookie encryption runs on the server, not in the app.

### Google Play Data safety

- Collect or share user data: **Yes**
- All collected data encrypted in transit: **Yes** (HTTPS)
- Users can ask for deletion: **Yes.** Settings → Delete my data (type DELETE). With no session, that deletes the device’s server rows. With a session, it also deletes the Grocery Gitter account, including the free or pro entitlement. It does not cancel an App Store or Google Play subscription. It invalidates shared lists that device created, unsubscribes push, and drops the Kroger token. Revoke link by itself still does not delete a list, and turning alerts off still does not delete a watch. Aggregate ZIP totals and search phrases are not linked to the shopper. Crash reports are not tied to an account and are not removed by the button. Email [CONTACT EMAIL] if the in-app control does not work, or with the approximate time and whether it was the website, iPhone, or Android to ask for a crash report to be removed
- Data sold: **No**
- Data shared for advertising: **No**

| Play data type | Collected | Shared | Why |
| --- | --- | --- | --- |
| Location → Approximate | Yes | Yes, with the retailer APIs that need a ZIP (Kroger, Walmart, Flipp, Instacart, and a Target feed if you configured one) | Typed ZIP, for prices, the catalog refresh, and a price watch. Also stored as `ShopperZip` |
| Location → Precise | No | No | |
| Personal info → Name | Yes | The shared-list display name is shared with people who open the link, not with advertisers. The account name is not shared | Optional display name on a shared list. When sign-in is on, the account name is also stored and linked to the user for app functionality |
| Personal info → Email address | Only if sign-in is on | No | Linked to the user for app functionality. Apple, Google, or the email link. Not sold. Deleted with the account |
| Personal info → User IDs | Only if sign-in is on | No | The account id, linked to the user for app functionality. Leave this off the form while sign-in stays unset |
| Financial info | Purchase history only, and only if subscriptions are on | No | Plan (free or pro) and the period end. No card number. Apple or Google charges the shopper |
| App activity → In-app search history | Yes | Yes, the search is sent to the price source for that request | Not kept as a profile |
| App activity → Other user-generated content | Yes | With other people who open the share link. Also with Instacart or Kroger only when the shopper uses that handoff | Shared lists are stored (items, timestamps, hashed secrets). Trip planning sends the list for that request. Alert records stay on our server |
| App info → Crash logs | Yes, when `SENTRY_DSN` is set | No | Sentry crash and error reports. Not linked to an account. No email, token, or Kroger cookie. Answer No when the DSN is unset |
| App info → Diagnostics | Yes | No | Host request logs. Separate from crash logs |
| Device or other IDs | Yes | No | The random id created in the browser for watches, alerts, and an optional push subscription. Not an advertising id. Not sent with crash reports |
| Photos, audio, files, contacts, calendar, messages | No | No | |

The Web Push endpoint and keys are stored only when VAPID is configured and the shopper opts in. Treat them as the device-id / app-functionality data above, used only to deliver a notification. They are removed by Delete my data, and when the push service says the subscription is gone.

Content rating: shopping tool, no ads. User-generated content is the shared grocery list (item names and an optional display name) shown to people who have the link. Say that in the questionnaire.

## Signing — what you do

### Before either store build

```bash
npm install
npm run cap:sync
```

Leave `CAPACITOR_SERVER_URL` unset so the WebView bundles `public/` and calls the HTTPS API. Confirm Kroger’s registered redirect URI is still the Railway `https://…/api/kroger/oauth/callback`, not an app URL scheme.

### iOS, on a Mac

`codemagic.yaml` can archive and upload to TestFlight without a Mac on your desk. Those steps are in `docs/IOS_CLOUD_BUILD.md`. The list below is the same upload done from Xcode.

1. Join the Apple Developer Program.
2. In Certificates, Identifiers & Profiles, register an explicit App ID `app.grocerygitter`.
3. In App Store Connect, create the app. Name: Grocery Gitter. Bundle ID: `app.grocerygitter`. SKU: whatever you want to call it, for example `grocery-gitter`.
4. On the Mac, open the project: `npm run cap:open:ios`.
5. In Xcode, select the App target, Signing & Capabilities, your team, and Automatically manage signing. Xcode creates the distribution certificate and the App Store provisioning profile.
6. Choose Any iOS Device (arm64), then Product → Archive.
7. In the Organizer, Distribute App → App Store Connect → Upload.
8. In App Store Connect, attach the build, paste the privacy URL, add the screenshots above, and enter the nutrition labels from this file.
9. Submit for review when the privacy and terms pages are live and the `[BRACKET]` placeholders are filled in.

A paid developer account is not required to run the simulator. It is required for this upload.

### Android, Play Console

1. Create the app in Play Console. Package name `app.grocerygitter`. App name Grocery Gitter. Play App Signing: let Google hold the app signing key.
2. Create an upload keystore and do not commit it. `*.jks` and `*.keystore` are gitignored.

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

3. Put the keystore outside the repo, or at `android/app/upload-keystore.jks` (gitignored). Create `android/key.properties` (also gitignored):

```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=upload
storeFile=upload-keystore.jks
```

`android/app/build.gradle` resolves `storeFile` from the `android/app` directory, so `upload-keystore.jks` means `android/app/upload-keystore.jks`. An absolute path also works. Codemagic writes an absolute path to the keystore it unpacks under `android/app`. The file is used for the release build only. Debug builds do not need it.

4. Build the bundle:

```bash
cd android
./gradlew bundleRelease
```

The file to upload is `android/app/build/outputs/bundle/release/app-release.aab`.

5. In Play Console, create a release (internal testing first is the sensible first stop), upload the AAB, and finish Data safety, content rating, the privacy policy URL, the feature graphic, and the screenshots.

Enroll the upload key’s certificate in Play App Signing when the console asks. You keep the upload keystore. Google keeps the key shoppers’ devices actually verify. If you lose the upload keystore, you reset it with Play Console; you do not ship a new application id.
