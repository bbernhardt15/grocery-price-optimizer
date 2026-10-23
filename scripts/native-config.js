/**
 * Text written into the iOS/Android copies of public/native-config.js.
 * The website copy stays an empty origin and is restored after `cap sync`.
 */

function nativeSentryFields(env, release) {
  const source = env || {};
  return {
    dsn: String(source.SENTRY_DSN || "").trim(),
    release: String(release || "").trim(),
    environment: String(source.SENTRY_ENVIRONMENT || "").trim() || "production",
  };
}

function nativeConfigSource(origin, sentry) {
  const lines = [
    "// Written by npm run cap:sync into the native project copies only.",
    "// The website copy of this file stays an empty origin.",
    `window.GROCERY_GITTER_API_ORIGIN = ${JSON.stringify(origin)};`,
  ];
  if (sentry) {
    lines.push(`window.GROCERY_GITTER_SENTRY = ${JSON.stringify(sentry)};`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  nativeSentryFields,
  nativeConfigSource,
};
