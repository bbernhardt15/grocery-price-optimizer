import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Live reload only. When unset, the native app loads the files `cap sync`
 * copied from public/. API calls then use CAPACITOR_API_URL (see
 * scripts/cap-sync.mjs), not this server URL.
 */
function devServerUrl(): string | undefined {
  const raw = process.env.CAPACITOR_SERVER_URL?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("CAPACITOR_SERVER_URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CAPACITOR_SERVER_URL must be http or https");
  }
  return raw.replace(/\/$/, "");
}

const serverUrl = devServerUrl();

const config: CapacitorConfig = {
  appId: "app.grocerygitter",
  appName: "Grocery Gitter",
  webDir: "public",
  server: {
    androidScheme: "https",
    hostname: "localhost",
    ...(serverUrl
      ? {
          url: serverUrl,
          cleartext: serverUrl.startsWith("http://"),
        }
      : {}),
  },
  ios: {
    // Edge-to-edge. public/styles.css pads with safe-area insets.
    contentInset: "never",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: "#1c221e",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    SystemBars: {
      // Injects --safe-area-inset-* for older Android WebViews. CSS uses
      // those variables, then env(safe-area-inset-*).
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "LIGHT",
      hidden: false,
    },
  },
};

export default config;
