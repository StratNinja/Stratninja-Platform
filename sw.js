/* StratNinja service worker — installability + Web Push notifications.
 * Kept intentionally minimal: no offline caching (the app needs live data),
 * only the push + notification plumbing so alerts can reach the phone. */

// Precache the notification icons so they're available from local cache when a push arrives while the
// device is dozing (no network fetch needed) — otherwise Chrome falls back to a letter avatar + bell.
const ICON_CACHE = "sn-icons-v3";
const ICON_URLS = ["/icon-192.png", "/badge-96.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(ICON_CACHE).then((c) => c.addAll(ICON_URLS)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("sn-icons-") && k !== ICON_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));
// serve the notification icons from cache first (works offline / in Doze)
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin && ICON_URLS.indexOf(url.pathname) >= 0) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      const copy = resp.clone(); caches.open(ICON_CACHE).then((c) => c.put(e.request, copy)); return resp;
    })));
  }
});

// Server-sent Web Push → show a notification (works even when the app is closed)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  const title = d.title || "🔔 התראת StratNinja";
  const opts = {
    body: d.body || "מניה מהמועדפים שלך נכנסה לסריקה",
    icon: "/icon-192.png",     // large logo (candlestick) — PNG renders reliably on Android
    badge: "/badge-96.png",    // monochrome candle silhouette for the status bar (Android tints it white)
    tag: d.tag || "sn-alert",
    dir: "rtl",
    lang: "he",
    data: { url: d.url || "/" },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
