# Build the iPhone app without a Mac

Codemagic builds Grocery Gitter on a Mac in the cloud and sends the finished app to TestFlight. You install it with the TestFlight app on an iPhone. You do not need Xcode.

The workflow lives in `codemagic.yaml` at the root of this repo. The iOS workflow is named **iOS TestFlight**. It installs dependencies, compiles the API, copies the shopper site into the iOS project with the production API address, runs `pod install`, sets the build number to the latest TestFlight build plus one, signs the app, and uploads it.

## What it costs

- **Apple Developer Program:** $99 per year. Apple charges this before you can create the app, sign it, or use TestFlight.
- **Codemagic:** a personal account includes **500 free minutes per month** on Mac mini M2 machines. The minutes reset on the 1st. Minutes past 500 cost **$0.095 per minute** on M2. The free minutes are for a personal account. A Codemagic team does not get them. Linux and Windows machines are not part of the free minutes.
- Both workflows in `codemagic.yaml` use `mac_mini_m2`, so iOS and Android both draw from those 500 minutes.

## Checklist

1. **Enroll in the Apple Developer Program.** Go to [developer.apple.com/programs](https://developer.apple.com/programs/) and enroll for $99 per year. Wait until the membership shows as active. The later steps fail until it is.

2. **Create the App ID.** On [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list), open Certificates, Identifiers & Profiles, then Identifiers, then the add button. Choose App IDs, then App. Set the description to Grocery Gitter. Choose an explicit Bundle ID and enter `app.grocerygitter`. That is the `appId` in `capacitor.config.ts`. Register it.

3. **Create the app in App Store Connect.** On [appstoreconnect.apple.com](https://appstoreconnect.apple.com/), open Apps, then the add button, then New App. Choose iOS. Name it Grocery Gitter. Pick the bundle ID `app.grocerygitter`. Use a SKU such as `grocery-gitter`. After the app exists, open it, go to General, then App Information, and copy the numeric **Apple ID**. That number is not the bundle id. You will put it in Codemagic as `APP_STORE_APPLE_ID`.

4. **Create an App Store Connect API key.** In App Store Connect, open Users and Access, then Integrations, then App Store Connect API.
   - Copy the **Issuer ID** shown above the key list.
   - Add a key. Name it something you will recognize, such as Codemagic. Set the access to **App Manager**. That role is what Apple requires for uploading a build.
   - Copy the **Key ID** from the table.
   - Download the **.p8** file. Apple lets you download it once. Keep the Issuer ID, the Key ID, and the .p8 together. Do not commit the .p8 file to this repo.

5. **Sign up for Codemagic with GitHub.** Go to [codemagic.io/signup](https://codemagic.io/signup) and sign up with the GitHub account that can see this repository. Use a **personal** Codemagic account so the 500 free M2 minutes apply.

6. **Add the repo.** In Codemagic, open Applications, then Add application. Connect GitHub if it asks, and select `grocery-price-optimizer`. Finish adding it. When this configuration is on the branch you want to build, open the app in Codemagic and use **Check for configuration file** on that branch so it reads `codemagic.yaml`.

7. **Add the API key integration with the name `app_store_connect`.** In Codemagic, open Team settings, then Team integrations, then Developer Portal, then Manage keys, then Add key.
   - App Store Connect API key name: `app_store_connect`
   - That name has to match `integrations.app_store_connect` in `codemagic.yaml`. A different name will not be picked up.
   - Paste the Issuer ID and the Key ID, upload the .p8, and save.
   - Still in Team settings, open codemagic.yaml settings, then Code signing identities.
   - On the iOS certificates tab, generate a certificate. Choose **Apple Distribution**, select the `app_store_connect` key, and save it. Download the certificate when Codemagic offers it, and keep that copy. Codemagic will not offer the download again.
   - On [developer.apple.com](https://developer.apple.com/account/resources/profiles/list), add a profile. Choose **App Store Connect** (distribution), select the App ID `app.grocerygitter`, select the distribution certificate you just generated, and generate the profile.
   - Back in Codemagic, open the iOS provisioning profiles tab and fetch that App Store profile (or upload the `.mobileprovision` file). The iOS workflow asks for `distribution_type: app_store` and `bundle_identifier: app.grocerygitter`. The build can sign only when that certificate and that profile are in Code signing identities.

8. **Create the environment group `grocery_gitter`.** In the Codemagic app, open Environment variables (or Team settings, then Global variables and secrets). Create a group named exactly `grocery_gitter`. Add:
   - `CAPACITOR_API_URL` = `https://grocery-price-optimizer-production.up.railway.app`
   - `APP_STORE_APPLE_ID` = the numeric Apple ID from step 3
   - Leave both of those as plain variables. Do not put the Issuer ID, the Key ID, or the .p8 in this group. Those stay in the `app_store_connect` integration from step 7.
   - The iOS workflow reads this group before it syncs the app, so the phone build calls that Railway URL.

9. **Start a build.** In Codemagic, choose Start new build, pick the branch that contains `codemagic.yaml`, and choose the workflow **iOS TestFlight**. You can also start it by pushing a git tag whose name starts with `v`, such as `v1.0.0`. A normal push or a pull request does not start the build. The version people see is **1.0** until `MARKETING_VERSION` in the Xcode project changes. The build number is one higher than the newest TestFlight build. The first time TestFlight has no build yet, the build number is 1.

10. **Install it with TestFlight.** When the Codemagic build is green, it uploads the IPA and submits it to TestFlight. In App Store Connect, open TestFlight and wait until Apple finishes processing the build. Add yourself under Internal Testing. Install Apple's TestFlight app on the iPhone, accept the invite, and install Grocery Gitter. Internal testers are people on your App Store Connect team. They do not need a public App Store review.

Screenshots, a support URL, and the privacy labels are still the checklist in the README. You can put a build on TestFlight before those are done. The public App Store listing needs them later.

## Android, if you want it

The same tag, or a manual start, also runs **Android App Bundle**. That workflow builds a signed `.aab` and stops. It does not upload to Google Play.

Add these to the same `grocery_gitter` group. Mark the passwords and the keystore as secret.

- `CM_KEYSTORE` — the upload keystore, base64-encoded, on one line
- `CM_KEYSTORE_PASSWORD`
- `CM_KEY_ALIAS`
- `CM_KEY_PASSWORD`

Create the keystore once on any computer that has Java. You do not need a Mac:

```bash
keytool -genkeypair -v -keystore grocery-gitter-upload.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias grocery-gitter
base64 -w 0 grocery-gitter-upload.keystore
```

Paste the base64 text into `CM_KEYSTORE`. Keep the `.keystore` file somewhere private. Do not commit it. Every later Play upload has to use this same file.

Play publishing stays off. To turn it on later, uncomment the `google_play` block at the bottom of the Android workflow in `codemagic.yaml`, and add `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS` (the Play service-account JSON) to `grocery_gitter`. Upload the first AAB to Play yourself. After that, Codemagic can upload later ones.
