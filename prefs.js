/* StratNinja Platform — user preferences (favorites + alerts).
 * Stored in localStorage under one key; cloud-synced per user via cloudsync.js
 * (table user_prefs). Emits change events so pages can re-render live.
 */
window.Prefs = (function () {
  "use strict";
  const KEY = "stratninja_prefs_v1";
  const listeners = [];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { favorites: [], alerts: [] }; }
    catch (e) { return { favorites: [], alerts: [] }; }
  }
  function write(d) {
    localStorage.setItem(KEY, JSON.stringify(d));
    listeners.forEach(f => { try { f(); } catch (e) {} });
  }
  function uid() { return "a" + Date.now() + Math.floor(Math.random() * 1000); }

  return {
    KEY: KEY,
    favorites() { return read().favorites || []; },
    isFav(sym) { return this.favorites().indexOf(sym) >= 0; },
    toggleFav(sym) {
      const d = read(); d.favorites = d.favorites || [];
      const i = d.favorites.indexOf(sym);
      if (i >= 0) d.favorites.splice(i, 1); else d.favorites.push(sym);
      write(d);
    },
    alerts() { return read().alerts || []; },
    addAlert(a) {
      const d = read(); d.alerts = d.alerts || [];
      a.id = uid(); a.created = new Date().toISOString();
      d.alerts.push(a); write(d); return a;
    },
    deleteAlert(id) { const d = read(); d.alerts = (d.alerts || []).filter(x => x.id !== id); write(d); },
    onChange(f) { listeners.push(f); },
    notify() { listeners.forEach(f => { try { f(); } catch (e) {} }); },  // used by cloudsync after a pull
  };
})();
