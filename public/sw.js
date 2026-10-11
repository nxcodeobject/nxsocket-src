/* NxSocket PWA — network-first + Web Push untuk panggilan */
const CACHE = "nxsocket-shell-v1";
const SHELL = ["./manifest.webmanifest", "./icons/nxsocket.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.includes("/ws")) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && (url.pathname.endsWith(".svg") || url.pathname.endsWith(".webmanifest"))) {
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || new Response("Offline", { status: 503 }))),
  );
});

self.addEventListener("push", (event) => {
  let data = {
    title: "NxSocket",
    body: "Panggilan masuk",
    url: "./demo2",
    tag: "nxsocket-call",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch {
    try {
      if (event.data) data.body = event.data.text();
    } catch { /* */ }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "NxSocket", {
      body: data.body || "Panggilan masuk",
      tag: data.tag || "nxsocket-call",
      renotify: true,
      data: { url: data.url || "./demo2" },
      vibrate: [400, 120, 400, 120, 600],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "./demo2";
  const target = new URL(raw, self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          if (client.url.startsWith(target.split("?")[0])) return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
