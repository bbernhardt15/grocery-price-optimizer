const CACHE = "grocery-gitter-shell-v15";
const SHARE_CACHE = "gg-import-share";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== SHARE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function receiveSharedList(request) {
  const home = new URL("/", self.location.origin).href;
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.map((key) => cache.delete(key)));
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const files = [];
    let index = 0;
    for (const entry of form.getAll("media")) {
      if (!entry || typeof entry === "string" || !entry.size || entry.size > 8_000_000) continue;
      const id = `${stamp}-${index}`;
      index += 1;
      const headers = new Headers();
      if (entry.type) headers.set("content-type", entry.type);
      headers.set("x-filename", encodeURIComponent(entry.name || "list"));
      await cache.put(new Request(`/import-share-cache/${id}`), new Response(entry, { headers }));
      files.push({ id, name: entry.name || "list", type: entry.type || "" });
    }
    const manifest = {
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      url: String(form.get("url") || ""),
      files,
    };
    await cache.put(
      new Request("/import-share-cache/manifest"),
      new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } })
    );
    return Response.redirect(new URL("/?import=shared", self.location.origin).href, 303);
  } catch {
    return Response.redirect(home, 303);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/import-share") {
    event.respondWith(receiveSharedList(request));
    return;
  }
  if (request.method !== "GET") {
    return;
  }
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
