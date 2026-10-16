// Tests for the giveaway "live alert": the cached read (api/live-alert.js) and the pure helpers
// (live_alert.js). The admin SET path (giveaway.js _patch) + RLS are verified in Supabase/Preview.
// Run: `node test/live-alert.test.mjs`.

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon";

const { default: alertHandler } = await import("../api/live-alert.js");

globalThis.window = globalThis.window || {};   // shim so live_alert.js imports without a DOM
await import("../live_alert.js");
const LA = globalThis.window.LiveAlert;

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, a, b) { ok(name, a === b, "got " + JSON.stringify(a) + " want " + JSON.stringify(b)); }

function mockRes() {
  return { statusCode: 0, _json: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this._json = o; return this; },
    end() { return this; } };
}
const FUTURE = new Date(Date.now() + 10 * 60000).toISOString();
const PAST = new Date(Date.now() - 60000).toISOString();

async function apiTests() {
  console.log("\napi/live-alert.js (cached read)");
  const REAL = global.fetch;

  { global.fetch = async () => ({ ok: true, status: 200, json: async () => [{ announce_until: FUTURE, title: "הגרלה", status: "open" }] });
    const res = mockRes(); await alertHandler({ method: "GET", query: {} }, res);
    ok("future announce_until → active:true", res._json && res._json.ok === true && res._json.active === true);
    ok("active → href /live", res._json && res._json.href === "/live");
    ok("active → edge-cached", /s-maxage=\d/.test(res.headers["Cache-Control"] || "")); }

  { global.fetch = async () => ({ ok: true, status: 200, json: async () => [{ announce_until: PAST, title: "x", status: "open" }] });
    const res = mockRes(); await alertHandler({ method: "GET", query: {} }, res);
    ok("past announce_until → active:false", res._json && res._json.ok === true && res._json.active === false); }

  { global.fetch = async () => ({ ok: true, status: 200, json: async () => [{ announce_until: FUTURE, announce_test: true, title: "x", status: "open" }] });
    const res = mockRes(); await alertHandler({ method: "GET", query: {} }, res);
    ok("test announce → active:true + test:true", res._json && res._json.active === true && res._json.test === true); }

  { global.fetch = async () => ({ ok: true, status: 200, json: async () => [{ announce_until: null, title: "x", status: "idle" }] });
    const res = mockRes(); await alertHandler({ method: "GET", query: {} }, res);
    ok("null announce_until → active:false", res._json && res._json.active === false); }

  { const res = mockRes(); await alertHandler({ method: "POST", query: {} }, res);
    eq("POST → 405", res.statusCode, 405);
    ok("405 → not cached", (res.headers["Cache-Control"] || "") === "no-store"); }

  { global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const res = mockRes(); await alertHandler({ method: "GET", query: {} }, res);
    ok("upstream 500 → ok:false, active:false (no crash)", res._json && res._json.ok === false && res._json.active === false); }

  global.fetch = REAL;
}

async function helperTests() {
  console.log("\nlive_alert.js pure helpers");
  ok("isActive: future → true", LA.isActive({ active: true, until: FUTURE }, Date.now()) === true);
  ok("isActive: past → false", LA.isActive({ active: true, until: PAST }, Date.now()) === false);
  ok("isActive: active:false → false", LA.isActive({ active: false, until: FUTURE }, Date.now()) === false);
  ok("isActive: no until → false", LA.isActive({ active: true }, Date.now()) === false);
  ok("isActive: null payload → false", LA.isActive(null, Date.now()) === false);
  eq("dismissKey is per-announcement", LA.dismissKey("2026-10-16T20:00:00Z"), "sn_gvwalert_x_2026-10-16T20:00:00Z");
  // test-mode visibility: normal → everyone; test → admin only
  ok("shouldShow: normal + guest → true", LA.shouldShow({ active: true, until: FUTURE, test: false }, false, Date.now()) === true);
  ok("shouldShow: test + admin → true", LA.shouldShow({ active: true, until: FUTURE, test: true }, true, Date.now()) === true);
  ok("shouldShow: test + non-admin → false", LA.shouldShow({ active: true, until: FUTURE, test: true }, false, Date.now()) === false);
  ok("shouldShow: inactive (past) → false even for admin", LA.shouldShow({ active: true, until: PAST, test: false }, true, Date.now()) === false);
}

await apiTests();
await helperTests();
console.log("\n──────────────\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
