// Tests for LIVE engagement: the cached chat read (api/live-chat.js) and the pure client helpers
// (live_chat.js). DB-enforced security (RLS, rate-limit trigger, length checks) lives in
// live_engagement.sql and is verified in Supabase/Preview, not here. Run: `node test/live-engagement.test.mjs`.

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon";

const { default: chatHandler } = await import("../api/live-chat.js");

// live_chat.js is a browser script (sets window.LiveChat). Shim window to import its pure helpers.
globalThis.window = globalThis.window || {};
await import("../live_chat.js");
const LC = globalThis.window.LiveChat;

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

// ================= api/live-chat.js (cached GET) =================
async function chatReadTests() {
  console.log("\napi/live-chat.js (cached read)");
  const REAL = global.fetch;

  // newest-first rows from Supabase must come back oldest→newest for the UI
  { let seenUrl = "";
    global.fetch = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => [
      { id: 5, name: "C", msg: "c", created_at: "t5" },
      { id: 4, name: "B", msg: "b", created_at: "t4" },
      { id: 3, name: "A", msg: "a", created_at: "t3" },
    ] }; };
    const res = mockRes();
    await chatHandler({ method: "GET", query: { live: "public" } }, res);
    ok("GET → ok", res._json && res._json.ok === true);
    ok("GET → chronological (oldest first)", res._json && res._json.messages.map(m => m.id).join(",") === "3,4,5");
    ok("GET → edge-cached (s-maxage)", /s-maxage=\d/.test(res.headers["Cache-Control"] || ""));
    ok("GET → queries non-hidden only", /hidden=is\.false/.test(seenUrl) && /order=id\.desc/.test(seenUrl) && /limit=60/.test(seenUrl));
  }

  // live_id slug is validated — a malicious value falls back to "public", never interpolated raw
  { let seenUrl = "";
    global.fetch = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => [] }; };
    const res = mockRes();
    await chatHandler({ method: "GET", query: { live: "public;drop table" } }, res);
    ok("bad live_id → falls back to 'public' (no injection)", /live_id=eq\.public(&|$)/.test(seenUrl) && !/drop/.test(seenUrl));
  }

  // non-GET is refused and never cached
  { const res = mockRes();
    await chatHandler({ method: "POST", query: {} }, res);
    eq("POST → 405", res.statusCode, 405);
    ok("405 → not cached", (res.headers["Cache-Control"] || "") === "no-store");
  }

  // upstream failure → ok:false with empty list (never throws)
  { global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const res = mockRes();
    await chatHandler({ method: "GET", query: {} }, res);
    ok("upstream 500 → ok:false + empty (no crash)", res._json && res._json.ok === false && Array.isArray(res._json.messages) && res._json.messages.length === 0);
  }

  global.fetch = REAL;
}

// ================= live_chat.js pure helpers =================
async function helperTests() {
  console.log("\nlive_chat.js pure helpers");
  eq("cleanMsg trims + collapses whitespace", LC.cleanMsg("  hi   there  "), "hi there");
  eq("cleanMsg strips control chars", LC.cleanMsg("a\u0000b\u0007c"), "abc");
  eq("cleanMsg caps at 280", LC.cleanMsg("x".repeat(500)).length, 280);
  eq("cleanMsg empty stays empty (rejected upstream)", LC.cleanMsg("   "), "");
  eq("cleanName falls back to אורח", LC.cleanName("  "), "אורח");
  eq("cleanName caps at 40", LC.cleanName("y".repeat(99)).length, 40);
  eq("displayName prefers full_name", LC.displayName({ user_metadata: { full_name: "Adi K" }, email: "a@b.c" }), "Adi K");
  eq("displayName falls back to email", LC.displayName({ user_metadata: {}, email: "a@b.c" }), "a@b.c");
  eq("esc neutralizes HTML", LC.esc('<img src=x onerror=1>'), "&lt;img src=x onerror=1&gt;");
  eq("countLabel pre-live → ממתינים", LC.countLabel("soon", 7), "👥 7 ממתינים ללייב");
  eq("countLabel live → צופים", LC.countLabel("live", 12), "👥 12 צופים עכשיו");
  eq("countLabel null count → 0", LC.countLabel("offline", undefined), "👥 0 ממתינים ללייב");
}

await chatReadTests();
await helperTests();
console.log("\n──────────────\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
