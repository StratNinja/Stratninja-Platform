// Automated tests for the PUBLIC LIVE server functions (api/live.js + api/live-webhook.js).
// Real handler code is imported and executed; only the external I/O (Supabase REST, the
// Cloudflare API, Supabase /auth/v1/user) is mocked via global.fetch. Run: `node test/live.test.mjs`.

// ---- env must be set BEFORE importing the handlers (they read process.env at import) ----
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-svc";
process.env.SUPABASE_ANON_KEY = "test-anon";
process.env.CF_WEBHOOK_SECRET = "secret-123";
process.env.CF_PUBLIC_INPUT_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
process.env.CF_ACCOUNT_ID = "ACC";
process.env.CF_STREAM_API_TOKEN = "cftok";
process.env.CF_CUSTOMER_CODE = "cust";
process.env.LIVE_MAX_HOURS = "12";

const { default: liveHandler } = await import("../api/live.js");
const { default: hookHandler } = await import("../api/live-webhook.js");
const REAL_FETCH = global.fetch;   // keep the real undici fetch (installFetch replaces global.fetch)

// ---- tiny test runner ----
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, a, b) { ok(name, a === b, "got " + JSON.stringify(a) + " want " + JSON.stringify(b)); }

// ---- mock res ----
function mockRes() {
  return { statusCode: 0, _json: null, headers: {}, ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this._json = o; return this; },
    end() { this.ended = true; return this; } };
}
function R(obj, ok = true, status = 200) { return { ok, status, json: async () => obj, text: async () => JSON.stringify(obj) }; }

// ---- mock fetch (routes by URL + method, records calls, simulates PostgREST + CF) ----
function installFetch(state) {
  state.calls = [];
  global.fetch = async (url, opts) => {
    opts = opts || {};
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    state.calls.push({ url, method, body });
    if (url.includes("/auth/v1/user")) {
      if (!state.authEmail) return R({}, false, 401);
      return R({ email: state.authEmail });
    }
    if (url.includes("api.cloudflare.com")) { if (state.cfThrow) throw new TypeError("simulated bad url/header"); return R(state.cf || { success: false }); }
    if (url.includes("/rest/v1/live_status")) {
      if (method === "PATCH") {
        // simulate the conditional UPDATE: ...&last_event_ts=lt.<ts>
        const m = url.match(/last_event_ts=lt\.(\d+)/);
        if (m) { const ts = Number(m[1]); if (!(Number(state.row.last_event_ts || 0) < ts)) return R([]); }  // not applied
        state.row = Object.assign({}, state.row, body);
        return R([state.row]);
      }
      return R([state.row]);   // select
    }
    return R({}, false, 404);
  };
}

const ISO = ms => new Date(Date.now() - ms).toISOString();

// ========================= WEBHOOK TESTS =========================
async function webhookTests() {
  console.log("\nWEBHOOK (api/live-webhook.js)");

  // bad shared secret → 401, no DB call
  { const st = { row: { last_event_ts: 0 } }; installFetch(st);
    const res = mockRes();
    await hookHandler({ method: "POST", headers: { "cf-webhook-auth": "WRONG" }, body: { data: { event_type: "live_input.connected", input_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90" }, ts: 100 } }, res);
    eq("bad cf-webhook-auth → 401", res.statusCode, 401);
    ok("bad auth → no DB write", st.calls.length === 0); }

  // wrong input_id → ignored, no write
  { const st = { row: { last_event_ts: 0 } }; installFetch(st);
    const res = mockRes();
    await hookHandler({ method: "POST", headers: { "cf-webhook-auth": "secret-123" }, body: { data: { event_type: "live_input.connected", input_id: "OTHER" }, ts: 100 } }, res);
    eq("wrong input_id → 200 ignored", res.statusCode, 200);
    ok("wrong input_id → ignored", res._json && res._json.ignored === "other_input");
    ok("wrong input_id → no PATCH", !st.calls.some(c => c.method === "PATCH")); }

  // connected (fresh ts) → is_live true via atomic conditional PATCH
  { const st = { row: { last_event_ts: 50 } }; installFetch(st);
    const res = mockRes();
    await hookHandler({ method: "POST", headers: { "cf-webhook-auth": "secret-123" }, body: { data: { event_type: "live_input.connected", input_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90" }, ts: 100 } }, res);
    const patch = st.calls.find(c => c.method === "PATCH");
    ok("connected → 200 ok", res._json && res._json.ok === true);
    ok("connected → PATCH uses conditional filter last_event_ts=lt.100", patch && patch.url.includes("last_event_ts=lt.100"));
    ok("connected → is_live:true in body", patch && patch.body.is_live === true);
    ok("connected → started_at set", patch && !!patch.body.started_at);
    eq("connected → last_event_ts advanced", st.row.last_event_ts, 100); }

  // stale/duplicate ts (<= current) → conditional PATCH matches 0 rows → ignored
  { const st = { row: { last_event_ts: 100 } }; installFetch(st);
    const res = mockRes();
    await hookHandler({ method: "POST", headers: { "cf-webhook-auth": "secret-123" }, body: { data: { event_type: "live_input.disconnected", input_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90" }, ts: 80 } }, res);
    ok("stale ts → ignored (atomic 0-row update)", res._json && res._json.ignored === "stale_or_norow");
    eq("stale ts → row unchanged", st.row.last_event_ts, 100); }

  // disconnected → is_live false
  { const st = { row: { last_event_ts: 50, is_live: true } }; installFetch(st);
    const res = mockRes();
    await hookHandler({ method: "POST", headers: { "cf-webhook-auth": "secret-123" }, body: { data: { event_type: "live_input.disconnected", input_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90" }, ts: 120 } }, res);
    ok("disconnected → is_live:false", st.row.is_live === false); }

  // errored → is_live false (treated as offline) + cf_status recorded
  { const st = { row: { last_event_ts: 50, is_live: true } }; installFetch(st);
    const res = mockRes();
    await hookHandler({ method: "POST", headers: { "cf-webhook-auth": "secret-123" }, body: { data: { event_type: "live_input.errored", input_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90" }, ts: 130 } }, res);
    ok("errored → is_live:false", st.row.is_live === false);
    ok("errored → cf_status records the event", st.row.cf_status === "live_input.errored"); }
}

// ========================= GET (public + reconcile + cap) =========================
async function getTests() {
  console.log("\nGET /api/live (reconcile + safety cap)");

  // CF says disconnected while row says live → reconcile flips is_live false (missed-webhook catch)
  // Uses the REAL nested shape: result.status.current.state.
  { const st = { row: { id: "public", is_live: true, verified_at: ISO(5 * 60000), started_at: ISO(60000), last_event_ts: 5 },
      cf: { success: true, result: { status: { current: { state: "disconnected", reason: "client_disconnect" } } } } }; installFetch(st);
    const res = mockRes();
    await liveHandler({ method: "GET", headers: {}, query: {} }, res);
    ok("reconcile: CF state=disconnected → is_live false", res._json && res._json.is_live === false); }

  // CF confirms connected → stays live
  { const st = { row: { id: "public", is_live: false, verified_at: ISO(5 * 60000), started_at: null, last_event_ts: 5 },
      cf: { success: true, result: { status: { current: { state: "connected", reason: "connected" } } } } }; installFetch(st);
    const res = mockRes();
    await liveHandler({ method: "GET", headers: {}, query: {} }, res);
    ok("reconcile: CF state=connected → is_live true", res._json && res._json.is_live === true); }

  // req #1: CF CONFIGURED but temporarily unreachable → a genuine long stream is NOT force-capped.
  { const st = { row: { id: "public", is_live: true, verified_at: ISO(5 * 60000), started_at: ISO(13 * 3600000), last_event_ts: 5 },
      cf: { success: false } }; installFetch(st);
    const res = mockRes();
    await liveHandler({ method: "GET", headers: {}, query: {} }, res);
    ok("req#1: CF configured → verified/long stream NOT force-capped (stays live)", res._json && res._json.is_live === true);
    ok("req#1: cf_status NOT max_duration_guard while CF configured", st.row.cf_status !== "max_duration_guard"); }

  // playback URL is built from the LIVE INPUT uid (not a recording id)
  { const st = { row: { id: "public", is_live: true, verified_at: new Date().toISOString(), started_at: ISO(60000), last_event_ts: 5 } }; installFetch(st);
    const res = mockRes();
    await liveHandler({ method: "GET", headers: {}, query: {} }, res);
    const pb = res._json && res._json.playback;
    ok("playback uid === CF_PUBLIC_INPUT_ID", pb && pb.uid === "a1b2c3d4e5f60718293a4b5c6d7e8f90");
    ok("playback iframe uses the input uid", pb && pb.iframe === "https://customer-cust.cloudflarestream.com/a1b2c3d4e5f60718293a4b5c6d7e8f90/iframe"); }
}

// ========================= POST (admin-only) =========================
async function postTests() {
  console.log("\nPOST /api/live (admin auth, cannot set is_live)");

  // non-admin → 403, no write
  { const st = { row: { id: "public" }, authEmail: "random@user.com" }; installFetch(st);
    const res = mockRes();
    await liveHandler({ method: "POST", headers: { authorization: "Bearer x" }, body: { title: "hack", is_live: true } }, res);
    eq("non-admin → 403", res.statusCode, 403);
    ok("non-admin → no PATCH", !st.calls.some(c => c.method === "PATCH")); }

  // admin → allowed fields saved; is_live is NOT accepted from the client
  { const st = { row: { id: "public", is_live: false }, authEmail: "koriatmanagement@gmail.com" }; installFetch(st);
    const res = mockRes();
    await liveHandler({ method: "POST", headers: { authorization: "Bearer x" }, body: { title: "פתיחת שוק", mode: "soon", is_live: true } }, res);
    const patch = st.calls.find(c => c.method === "PATCH");
    ok("admin → PATCH sent", !!patch);
    ok("admin → title saved", patch && patch.body.title === "פתיחת שוק");
    ok("admin → mode saved", patch && patch.body.mode === "soon");
    ok("admin → is_live NOT settable from client", patch && !("is_live" in patch.body));
    ok("admin → row.is_live unchanged (still false)", st.row.is_live === false); }

  // admin → invalid mode rejected (not written)
  { const st = { row: { id: "public" }, authEmail: "koriatmanagement@gmail.com" }; installFetch(st);
    const res = mockRes();
    await liveHandler({ method: "POST", headers: { authorization: "Bearer x" }, body: { mode: "evil" } }, res);
    const patch = st.calls.find(c => c.method === "PATCH");
    ok("admin → invalid mode ignored", patch && !("mode" in patch.body)); }
}

// ========= Safety cap in a WEBHOOK-ONLY deployment (CF reconcile not configured) =========
async function capNoCfTest() {
  console.log("\nSafety cap — webhook-only deployment (no CF reconcile)");
  const saved = { a: process.env.CF_ACCOUNT_ID, t: process.env.CF_STREAM_API_TOKEN, i: process.env.CF_PUBLIC_INPUT_ID };
  delete process.env.CF_ACCOUNT_ID; delete process.env.CF_STREAM_API_TOKEN; delete process.env.CF_PUBLIC_INPUT_ID;
  const { default: liveNoCf } = await import("../api/live.js?nocf");   // fresh module eval without CF env
  const st = { row: { id: "public", is_live: true, verified_at: ISO(5 * 60000), started_at: ISO(13 * 3600000), last_event_ts: 5 } };
  installFetch(st);
  const res = mockRes();
  await liveNoCf({ method: "GET", headers: {}, query: {} }, res);
  ok("req#2: no-CF + LIVE > 12h → forced offline (safety)", res._json && res._json.is_live === false);
  ok("req#2: cf_status marked max_duration_guard", st.row.cf_status === "max_duration_guard");
  // genuine shorter stream (no CF) is NOT capped
  const st2 = { row: { id: "public", is_live: true, verified_at: ISO(5 * 60000), started_at: ISO(2 * 3600000), last_event_ts: 5 } };
  installFetch(st2);
  const res2 = mockRes();
  await liveNoCf({ method: "GET", headers: {}, query: {} }, res2);
  ok("req#2: no-CF + LIVE 2h → NOT capped (stays live)", res2._json && res2._json.is_live === true);
  process.env.CF_ACCOUNT_ID = saved.a; process.env.CF_STREAM_API_TOKEN = saved.t; process.env.CF_PUBLIC_INPUT_ID = saved.i;
}

// ========= PREVIEW TEST MODE (VERCEL_ENV=preview, no service key) =========
async function previewTests() {
  console.log("\nPREVIEW TEST MODE (VERCEL_ENV=preview, no service-role key)");
  const savedEnv = process.env.VERCEL_ENV, savedSvc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.VERCEL_ENV = "preview";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;         // Preview does NOT get the Production service key
  const { default: livePrev } = await import("../api/live.js?preview");
  // GET → live/offline straight from Cloudflare, ZERO Supabase I/O (real nested status shape)
  { const st = { cf: { success: true, result: { status: { current: { state: "connected", reason: "connected" } } } } }; installFetch(st);
    const res = mockRes();
    await livePrev({ method: "GET", headers: {}, query: {} }, res);
    ok("preview GET → preview:true", res._json && res._json.preview === true);
    ok("preview GET → is_live from Cloudflare API (state=connected)", res._json && res._json.is_live === true);
    ok("preview GET → ZERO Supabase calls", !st.calls.some(c => c.url.includes("/rest/v1/")));
    ok("preview GET → public playback present", res._json && res._json.playback && res._json.playback.uid === "a1b2c3d4e5f60718293a4b5c6d7e8f90");
    ok("preview GET → playback.iframe is a real cloudflarestream URL (req #7)", res._json && res._json.playback && res._json.playback.iframe === "https://customer-cust.cloudflarestream.com/a1b2c3d4e5f60718293a4b5c6d7e8f90/iframe"); }
  // CF_CUSTOMER_CODE missing → playback is NULL → the client would show the "player not configured"
  // fallback with NO iframe (reproduces "LIVE badge but black area, no cloudflarestream request").
  { const savedCode = process.env.CF_CUSTOMER_CODE; delete process.env.CF_CUSTOMER_CODE;
    const { default: liveNoCode } = await import("../api/live.js?nocode");
    installFetch({ cf: { success: true, result: { status: { current: { state: "connected" } } } } });
    const res = mockRes();
    await liveNoCode({ method: "GET", headers: {}, query: {} }, res);
    ok("missing CF_CUSTOMER_CODE → is_live true BUT playback null (no iframe → black)", res._json && res._json.is_live === true && res._json.playback === null);
    if (savedCode !== undefined) process.env.CF_CUSTOMER_CODE = savedCode; }
  // CF_CUSTOMER_CODE with Hebrew / non-alphanumeric text (pasted by mistake) → playback null, NOT a broken iframe URL
  { const savedCode = process.env.CF_CUSTOMER_CODE; process.env.CF_CUSTOMER_CODE = "קוד-לקוח בטעות";
    const { default: liveBadCode } = await import("../api/live.js?badcode");
    installFetch({ cf: { success: true, result: { status: { current: { state: "connected" } } } } });
    const res = mockRes();
    await liveBadCode({ method: "GET", headers: {}, query: {} }, res);
    ok("Hebrew/invalid CF_CUSTOMER_CODE → playback null (no broken iframe)", res._json && res._json.playback === null);
    ok("Hebrew/invalid CF_CUSTOMER_CODE → playback_err 'bad_customer_code'", res._json && res._json.playback_err === "bad_customer_code");
    if (savedCode !== undefined) process.env.CF_CUSTOMER_CODE = savedCode; }
  // CF_PUBLIC_INPUT_ID that is NOT a 32-hex id → playback null + clear bad_input_id reason
  { const savedInp = process.env.CF_PUBLIC_INPUT_ID; process.env.CF_PUBLIC_INPUT_ID = "not-a-hex-id";
    const { default: liveBadInp } = await import("../api/live.js?badinput");
    installFetch({ cf: { success: true, result: { status: { current: { state: "connected" } } } } });
    const res = mockRes();
    await liveBadInp({ method: "GET", headers: {}, query: {} }, res);
    ok("non-hex CF_PUBLIC_INPUT_ID → playback null + playback_err 'bad_input_id'", res._json && res._json.playback === null && res._json.playback_err === "bad_input_id");
    if (savedInp !== undefined) process.env.CF_PUBLIC_INPUT_ID = savedInp; }
  // GET when Cloudflare API is DOWN → UNKNOWN, not a false OFFLINE (req #3)
  { const st = { cf: { success: false } }; installFetch(st);
    const res = mockRes();
    await livePrev({ method: "GET", headers: {}, query: {} }, res);
    ok("preview GET (CF down) → unknown:true (not false OFFLINE)", res._json && res._json.unknown === true);
    ok("preview GET (CF down) → is_live false + unknown flag", res._json && res._json.is_live === false && res._json.unknown === true);
    ok("preview GET (CF down) → cf_status is DIAGNOSABLE (not generic)", res._json && /^cf_error:/.test(res._json.cf_status || "")); }
  // GET when the CF fetch THROWS → classified fetch_threw, with the error name surfaced (req Task B)
  { const st = { cfThrow: true }; installFetch(st);
    const res = mockRes();
    await livePrev({ method: "GET", headers: {}, query: {} }, res);
    ok("preview GET (CF fetch threw) → unknown + cf_error:fetch_threw:<name>", res._json && res._json.unknown === true && /^cf_error:fetch_threw:/.test(res._json.cf_status || "")); }
  // POST (admin write) → refused, no write
  { const st = {}; installFetch(st);
    const res = mockRes();
    await livePrev({ method: "POST", headers: { authorization: "Bearer x" }, body: { title: "x", mode: "offline" } }, res);
    ok("preview POST → 403 disabled_in_preview", res.statusCode === 403 && res._json && res._json.error === "disabled_in_preview");
    ok("preview POST → NO Supabase write", !st.calls.some(c => c.method === "PATCH")); }
  process.env.VERCEL_ENV = savedEnv; if (savedSvc !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedSvc;
}

// ========= PRODUCTION SAFETY: test mode can NEVER activate in Production =========
async function prodSafetyTest() {
  console.log("\nPRODUCTION SAFETY (VERCEL_ENV=production → test mode never activates)");
  const savedEnv = process.env.VERCEL_ENV, savedSvc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.VERCEL_ENV = "production";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { default: liveProd } = await import("../api/live.js?prodnosvc");
  { const st = { cf: { success: true, result: { status: "connected" } } }; installFetch(st);
    const res = mockRes();
    await liveProd({ method: "GET", headers: {}, query: {} }, res);
    ok("prod + no SVC → 500 missing_service_key (NOT preview mode)", res.statusCode === 500 && res._json && res._json.error === "missing_service_key");
    ok("prod → no preview flag leaked", !(res._json && res._json.preview)); }
  process.env.VERCEL_ENV = savedEnv; if (savedSvc !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedSvc;
}

// ========= CF ENV diagnosis: internal invalid-char detection + the fetch TypeError mechanism =========
async function envDiagTests() {
  console.log("\nCF ENV DIAGNOSIS (invalid-char detection + fetch TypeError mechanism)");
  // (1) a newline INSIDE the token → pinpointed as invalid_env:token, with NO network call
  const savedEnv = process.env.VERCEL_ENV, savedTok = process.env.CF_STREAM_API_TOKEN;
  process.env.VERCEL_ENV = "preview";
  process.env.CF_STREAM_API_TOKEN = "cf-token-with\ninternal-newline";
  const { default: liveBad } = await import("../api/live.js?badtok");
  { const st = {}; installFetch(st);
    const res = mockRes();
    await liveBad({ method: "GET", headers: {}, query: {} }, res);
    ok("newline inside token → cf_error:invalid_env:token", res._json && res._json.cf_status === "cf_error:invalid_env:token");
    ok("newline inside token → unknown:true + NO Cloudflare network call", res._json && res._json.unknown === true && !st.calls.some(c => c.url.includes("api.cloudflare.com"))); }
  process.env.VERCEL_ENV = savedEnv; if (savedTok !== undefined) process.env.CF_STREAM_API_TOKEN = savedTok;
  // (2) mechanism proof (REAL fetch): a newline in the header value throws a synchronous TypeError,
  //     exactly matching the Vercel log {"type":"TypeError","reason":"fetch_threw","ms":0}
  { let name = null; try { await REAL_FETCH("https://api.cloudflare.com/client/v4/x", { headers: { Authorization: "Bearer a\nb" } }); } catch (e) { name = e && e.name; }
    ok("Node fetch THROWS TypeError for newline-in-header (reproduces the Vercel symptom)", name === "TypeError"); }
}

// ========= REAL Cloudflare status shape (result.status.current.state) =========
async function realShapeTests() {
  console.log("\nREAL Cloudflare status shape (result.status.current.state)");
  const savedEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  const { default: liveRS } = await import("../api/live.js?realshape");
  // the EXACT JSON returned by Cloudflare (from the live /api/live response)
  const REAL_DISCONNECTED = { success: true, result: { status: {
    current: { ingestProtocol: "rtmp", reason: "client_disconnect", state: "disconnected", statusEnteredAt: "2026-10-15T21:09:30.211Z", statusLastSeen: "2026-10-15T21:09:30.211Z" },
    history: [{ ingestProtocol: "rtmp", reason: "connected", state: "connected", statusEnteredAt: "2026-10-15T21:07:22.028Z" }],
  } } };
  { installFetch({ cf: REAL_DISCONNECTED }); const res = mockRes();
    await liveRS({ method: "GET", headers: {}, query: {} }, res);
    ok("real JSON state=disconnected → OFFLINE (is_live false, not unknown)", res._json && res._json.is_live === false && res._json.unknown === false);
    ok("real JSON → cf_status === 'disconnected'", res._json && res._json.cf_status === "disconnected"); }
  // the EXACT connected JSON from the live preview while OBS was streaming (history: [])
  { installFetch({ cf: { success: true, result: { status: {
      current: { ingestProtocol: "rtmp", reason: "connected", state: "connected", statusEnteredAt: "2026-10-16T06:24:48.218Z", statusLastSeen: "2026-10-16T06:26:18.016Z" },
      history: [] } } } }); const res = mockRes();
    await liveRS({ method: "GET", headers: {}, query: {} }, res);
    ok("real connected JSON (history:[]) → is_live TRUE (req #6)", res._json && res._json.is_live === true && res._json.unknown === false && res._json.cf_status === "connected"); }
  { installFetch({ cf: { success: true, result: { status: { current: { state: "connected", reason: "connected" } } } } }); const res = mockRes();
    await liveRS({ method: "GET", headers: {}, query: {} }, res);
    ok("state=connected → LIVE → player shows (is_live true, unknown false)", res._json && res._json.is_live === true && res._json.unknown === false); }
  { installFetch({ cf: { success: true, result: { status: { current: { state: "reconnected" } } } } }); const res = mockRes();
    await liveRS({ method: "GET", headers: {}, query: {} }, res);
    ok("state=reconnected → LIVE", res._json && res._json.is_live === true); }
  { installFetch({ cf: { success: true, result: { status: { current: { state: "some_future_state" } } } } }); const res = mockRes();
    await liveRS({ method: "GET", headers: {}, query: {} }, res);
    ok("unrecognized state → UNKNOWN (not false OFFLINE)", res._json && res._json.unknown === true && /^unknown:/.test(res._json.cf_status || "")); }
  { installFetch({ cf: { success: true, result: { status: null } } }); const res = mockRes();   // input never streamed
    await liveRS({ method: "GET", headers: {}, query: {} }, res);
    ok("status=null (never streamed) → OFFLINE idle", res._json && res._json.is_live === false && res._json.unknown === false && res._json.cf_status === "idle"); }
  process.env.VERCEL_ENV = savedEnv;
}

await webhookTests();
await getTests();
await capNoCfTest();
await previewTests();
await prodSafetyTest();
await envDiagTests();
await realShapeTests();
await postTests();
console.log("\n──────────────\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
