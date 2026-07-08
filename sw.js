/* StratNinja service worker — installability + Web Push notifications.
 * Kept intentionally minimal: no offline caching (the app needs live data),
 * only the push + notification plumbing so alerts can reach the phone. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Server-sent Web Push → show a notification (works even when the app is closed)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  const title = d.title || "🔔 התראת StratNinja";
  const opts = {
    body: d.body || "מניה מהמועדפים שלך נכנסה לסריקה",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
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
