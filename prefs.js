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
    // scanner panel visibility (null = default: all panels shown)
    scanPanels() { return read().scanPanels || null; },
    setScanPanels(obj) { const d = read(); d.scanPanels = obj; write(d); },
    // saved scan presets ("must-have scans") — [{id,name,cfg}]
    scanPresets() { return read().scanPresets || []; },
    saveScanPreset(name, cfg) {
      const d = read(); d.scanPresets = d.scanPresets || [];
      const i = d.scanPresets.findIndex(p => p.name === name);
      if (i >= 0) { d.scanPresets[i].cfg = cfg; write(d); return d.scanPresets[i]; }
      const rec = { id: uid(), name: name, cfg: cfg }; d.scanPresets.push(rec); write(d); return rec;
    },
    deleteScanPreset(id) { const d = read(); d.scanPresets = (d.scanPresets || []).filter(p => p.id !== id); write(d); },
    togglePresetAlert(id) { const d = read(); const p = (d.scanPresets || []).find(x => x.id === id); if (p) { p.alert = !p.alert; write(d); } return p ? p.alert : false; },
    // alert feed — fired (preset × favorite) matches
    alertFeed() { return read().alertFeed || []; },
    feedHas(pid, sym, date) { return (read().alertFeed || []).some(e => e.pid === pid && e.sym === sym && e.date === date); },
    feedAdd(entry) { const d = read(); d.alertFeed = d.alertFeed || []; d.alertFeed.unshift(entry); if (d.alertFeed.length > 200) d.alertFeed = d.alertFeed.slice(0, 200); write(d); },
    feedUnread() { return (read().alertFeed || []).filter(e => !e.read).length; },
    feedMarkRead() { const d = read(); (d.alertFeed || []).forEach(e => e.read = true); write(d); },
    feedClear() { const d = read(); d.alertFeed = []; write(d); },
    onChange(f) { listeners.push(f); },
    notify() { listeners.forEach(f => { try { f(); } catch (e) {} }); },  // used by cloudsync after a pull
  };
})();
