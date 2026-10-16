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

There is no Grocery Gitter account, no analytics SDK, no advertising identifier, no crash-reporting SDK, and no GPS permission. The iOS app does not declare a location usage string. Android asks only for `INTERNET`.

What the app actually handles:

- **ZIP code.** Saved on the device. Also sent with browse, search, and trip planning. The 5-digit ZIP is stored in MongoDB (`ShopperZip`) with a hit count, last-seen time, and sometimes a Kroger location id. It is not tied to a name. The catalog job keeps a short list of recent shopper ZIPs.
- **My list.** Saved on the device as catalog id and quantity. It is **not** stored server-side as an account. Plan the trip sends name, brand, quantity, catalog id, UPC, and the substitute choice for that request only.
- **Kroger tokens.** After the shopper signs in on Kroger’s site, the access token (and refresh token, when Kroger sends one) is encrypted with AES-256-GCM and kept in an HttpOnly cookie named `kroger_shopper`. It is not written to the database. About 7 days with a refresh token, otherwise about 40 minutes.
- **Retailer handoffs.** Kroger, Walmart, Target, weekly-ad (Flipp), and Instacart, as spelled out on `/privacy`. Instacart runs only when the shopper taps it. Kroger and Instacart login pages open in the system browser.
- **Analytics.** None in the app. The host may keep ordinary request logs (IP address, time, path).
- **Sale of data.** No.

The shopper UI does not call the FatSecret catalog route. Do not list that as data the app collects.

### App Store privacy nutrition labels

Answer “No” to tracking for every type. Nothing here is linked to an identity, because there is no account and no device id in the app.

Data Not Linked to You:

| Data type | Collected? | Purpose |
| --- | --- | --- |
| Contact Info | No | |
| Health, Financial, Contacts, Sensitive Info | No | |
| Precise Location | No | Do not turn on Location Services |
| Coarse Location | Yes | The typed ZIP. App Functionality |
| User Content → Other User Content | Yes | The grocery list sent when planning a trip. App Functionality |
| Search History | Yes | Search words sent to price a shelf. App Functionality |
| Identifiers (User ID, Device ID) | No | The Kroger token stays in the cookie and is not an advertising id |
| Purchases | No | Retailers charge the shopper on their own sites |
| Usage Data → Product Interaction | Yes | Department and product requests. App Functionality |
| Diagnostics → Other Diagnostic Data | Yes | Host request logs (IP, time, path), if you can read them. App Functionality. Not a crash SDK |
| Advertising Data | No | |

Privacy Policy URL: the deployed `/privacy` link above. Support URL: the same site’s home page.

Age rating: no ads, no unrestricted web view of arbitrary sites beyond the store links, no user-to-user sharing, no gambling. You still click through Apple’s questionnaire. The app is a shopping tool for adults.

Export compliance: `Info.plist` sets `ITSAppUsesNonExemptEncryption` to false. The iOS binary only uses HTTPS. The Kroger cookie encryption runs on the server, not in the app.

### Google Play Data safety

- Collect or share user data: **Yes**
- All collected data encrypted in transit: **Yes** (HTTPS)
- Users can ask for deletion: **Yes.** They clear on-device data themselves. For the stored ZIP, they email [CONTACT EMAIL]. There is no account to delete
- Data sold: **No**
- Data shared for advertising: **No**

| Play data type | Collected | Shared | Why |
| --- | --- | --- | --- |
| Location → Approximate | Yes | Yes, with the retailer APIs that need a ZIP (Kroger, Walmart, Flipp, Instacart, and a Target feed if you configured one) | Typed ZIP, for prices and the catalog refresh. Also stored as `ShopperZip` |
| Location → Precise | No | No | |
| Personal info (name, email, address, phone, user id) | No | No | |
| Financial info | No | No | |
| App activity → In-app search history | Yes | Yes, the search is sent to the price source for that request | Not kept as a profile |
| App activity → Other user-generated content | Yes | Only if the shopper taps Instacart, or the UPC and quantity go to Kroger’s cart | The list itself is not stored on the server |
| App info → Diagnostics | Yes | No | Host request logs |
| Device or other IDs | No | No | |
| Photos, audio, files, contacts, calendar, messages | No | No | |

Content rating: walk through Play’s questionnaire the same way (shopping tool, no user-generated content shown to other people, no ads).

## Signing — what you do

### Before either store build

```bash
npm install
npm run cap:sync
```

Leave `CAPACITOR_SERVER_URL` unset so the WebView bundles `public/` and calls the HTTPS API. Confirm Kroger’s registered redirect URI is still the Railway `https://…/api/kroger/oauth/callback`, not an app URL scheme.

### iOS, on a Mac

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

3. Put the keystore somewhere outside the repo, or inside `android/` under a gitignored name. Create `android/key.properties` (also gitignored):

```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=upload
storeFile=upload-keystore.jks
```

`storeFile` is relative to the `android/` directory. `android/app/build.gradle` uses that file for the release build only. Debug builds do not need it.

4. Build the bundle:

```bash
cd android
./gradlew bundleRelease
```

The file to upload is `android/app/build/outputs/bundle/release/app-release.aab`.

5. In Play Console, create a release (internal testing first is the sensible first stop), upload the AAB, and finish Data safety, content rating, the privacy policy URL, the feature graphic, and the screenshots.

Enroll the upload key’s certificate in Play App Signing when the console asks. You keep the upload keystore. Google keeps the key shoppers’ devices actually verify. If you lose the upload keystore, you reset it with Play Console; you do not ship a new application id.
