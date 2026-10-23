const CACHE = "grocery-gitter-shell-v7";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok && response.type === "basic" && url.pathname !== "/sw.js") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      } catch {
        const cached = (await caches.match(request)) || (await caches.match("/"));
        if (cached) return cached;
        return new Response("Grocery Gitter is offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })()
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Price drop", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Price drop";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "A saved item is cheaper.",
      icon: payload.icon || "/icons/icon-192.png",
      data: { url: payload.url || "/?alerts=1" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/?alerts=1", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.postMessage({ type: "price-alerts" });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});
