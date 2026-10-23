/**
 * Loads the Sentry browser bundle only when a DSN is available.
 * No DSN: listeners are removed and nothing is downloaded or sent.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof document !== "undefined" && !root.__ggSentryLoaderStarted) {
    root.__ggSentryLoaderStarted = true;
    api.start(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function nonempty(value) {
    return String(value || "").trim();
  }

  /**
   * Baked native release wins over the server's current sha so symbolication
   * matches the WebView bundle. An empty baked DSN falls through to the API.
   * A remote payload with enabled:false contributes no DSN.
   */
  function resolveLoaderConfig(input) {
    const baked = input && input.baked && typeof input.baked === "object" ? input.baked : {};
    const remote = input && input.remote && typeof input.remote === "object" ? input.remote : null;
    const bakedDsn = nonempty(baked.dsn);
    const remoteDsn = remote && remote.enabled !== false ? nonempty(remote.dsn) : "";
    const dsn = bakedDsn || remoteDsn;
    if (!dsn) return null;
    const release = nonempty(baked.release) || (remote ? nonempty(remote.release) : "");
    const environment = nonempty(baked.environment) || (remote ? nonempty(remote.environment) : "");
    return { dsn, release, environment };
  }

  function observabilityUrl(apiOrigin) {
    const origin = String(apiOrigin || "").replace(/\/$/, "");
    return `${origin}/api/observability`;
  }

  function apiOrigin(root) {
    const native = root.GroceryGitterNative;
    if (!native || typeof native.resolveApiOrigin !== "function") return "";
    const capacitor = root.Capacitor;
    const isNative = Boolean(
      capacitor && typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform()
    );
    return native.resolveApiOrigin({
      native: isNative,
      location: root.location,
      configured: root.GROCERY_GITTER_API_ORIGIN,
    });
  }

  function installQueue(root) {
    const queued = [];
    function onError(event) {
      queued.push(event.error || event.message);
    }
    function onRejection(event) {
      queued.push(event.reason);
    }
    root.addEventListener("error", onError);
    root.addEventListener("unhandledrejection", onRejection);
    return {
      queued,
      stop() {
        root.removeEventListener("error", onError);
        root.removeEventListener("unhandledrejection", onRejection);
        queued.length = 0;
      },
    };
  }

  function loadSdk(root, config, queue) {
    const script = document.createElement("script");
    script.src = "/sentry.js";
    script.onload = function () {
      const client = root.GroceryGitterSentry;
      if (!client || typeof client.init !== "function") {
        queue.stop();
        return;
      }
      client.init(config);
      const pending = queue.queued.slice();
      queue.stop();
      if (typeof client.capture === "function") {
        pending.forEach(function (error) {
          client.capture(error);
        });
      }
    };
    script.onerror = function () {
      queue.stop();
    };
    document.head.appendChild(script);
  }

  function apply(root, remote, queue) {
    const config = resolveLoaderConfig({ baked: root.GROCERY_GITTER_SENTRY, remote: remote });
    if (!config) {
      queue.stop();
      return;
    }
    loadSdk(root, config, queue);
  }

  function start(root) {
    const queue = installQueue(root);
    const baked = root.GROCERY_GITTER_SENTRY;
    if (baked && nonempty(baked.dsn)) {
      apply(root, null, queue);
      return;
    }
    const url = observabilityUrl(apiOrigin(root));
    fetch(url)
      .then(function (response) {
        if (!response.ok) return { enabled: false };
        return response.json();
      })
      .then(function (remote) {
        apply(root, remote, queue);
      })
      .catch(function () {
        apply(root, { enabled: false }, queue);
      });
  }

  return {
    resolveLoaderConfig,
    observabilityUrl,
    start,
  };
});
