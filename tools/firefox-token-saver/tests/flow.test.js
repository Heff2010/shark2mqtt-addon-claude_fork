// Runs background.js against a fake Firefox API and a fake Shark/Auth0 server.
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
// Usage: node tests/flow.test.js   (runs background.js against a fake Firefox + fake Shark)
const path = require("path");
const dir = process.argv[2] || path.resolve(__dirname, "..");
const plain = (x) => JSON.parse(JSON.stringify(x));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

function makeEnv({ tokenResponse = { status: 200, body: { id_token: "ID", access_token: "AT", refresh_token: "RT" } } } = {}) {
  const store = {};
  const listeners = { headers: [], sendHeaders: [], message: [], dlChanged: [] };
  const calls = { tabsCreate: [], tabsUpdate: [], fetches: [], downloads: [] };
  const browser = {
    storage: { local: {
      async get(k) { const keys = Array.isArray(k) ? k : [k]; const o = {}; for (const x of keys) if (x in store) o[x] = structuredClone(store[x]); return o; },
      async set(o) { Object.assign(store, structuredClone(o)); },
      async remove(k) { for (const x of (Array.isArray(k) ? k : [k])) delete store[x]; },
    } },
    tabs: {
      async create(o) { calls.tabsCreate.push(o.url); return { id: 7 }; },
      async update(id, o) { calls.tabsUpdate.push([id, o.url]); },
    },
    runtime: { getURL: (p) => `moz-extension://uuid/${p}`, onMessage: { addListener: (f) => listeners.message.push(f) } },
    webRequest: {
      onHeadersReceived: { addListener: (f, filter, extra) => listeners.headers.push({ f, filter, extra }) },
      onBeforeSendHeaders: { addListener: (f, filter, extra) => listeners.sendHeaders.push({ f, filter, extra }) },
    },
    downloads: {
      async download(o) { calls.downloads.push(o); return 1; },
      onChanged: { addListener: (f) => listeners.dlChanged.push(f), removeListener() {} },
    },
  };
  const fakeFetch = async (url, opts) => {
    calls.fetches.push({ url, opts });
    return { ok: tokenResponse.status === 200, status: tokenResponse.status, json: async () => tokenResponse.body };
  };
  const ctx = vm.createContext({
    browser, fetch: fakeFetch, crypto: globalThis.crypto, btoa, TextEncoder, URL, URLSearchParams,
    Blob, console, setTimeout,
  });
  for (const f of ["shared.js", "background.js"]) vm.runInContext(fs.readFileSync(`${dir}/${f}`, "utf8"), ctx, { filename: f });
  const send = (msg) => listeners.message[0](msg);
  const settle = () => new Promise((r) => setTimeout(r, 50));
  return { store, listeners, calls, send, settle };
}

(async () => {
  // ---- Happy path ----
  let env = makeEnv();
  let res = await env.send({ type: "start", region: "us" });
  eq(res, { ok: true });
  const authUrl = new URL(env.calls.tabsCreate[0]);
  assert.strictEqual(authUrl.origin + authUrl.pathname, "https://login.sharkninja.com/authorize");
  const state = authUrl.searchParams.get("state");
  const pending = env.store.pending;
  assert.strictEqual(pending.state, state);

  // Listener filters/flags are what Firefox needs.
  eq(env.listeners.headers[0].extra, ["responseHeaders"]);
  eq(env.listeners.sendHeaders[0].extra, ["blocking", "requestHeaders"]);

  // Unrelated redirect is ignored.
  env.listeners.headers[0].f({ tabId: 7, responseHeaders: [{ name: "Location", value: "/u/login/password?state=abc" }] });
  await env.settle();
  assert.strictEqual(env.calls.fetches.length, 0);

  // Auth0 302 to the Shark app scheme.
  const cb = `com.sharkninja.shark://login.sharkninja.com/ios/com.sharkninja.shark/callback?code=CODE1&state=${state}`;
  env.listeners.headers[0].f({ tabId: 7, responseHeaders: [{ name: "location", value: cb }] });
  env.listeners.headers[0].f({ tabId: 7, responseHeaders: [{ name: "location", value: cb }] }); // duplicate
  await env.settle();
  assert.strictEqual(env.calls.fetches.length, 1, "exactly one exchange");
  const f = env.calls.fetches[0];
  assert.strictEqual(f.url, "https://login.sharkninja.com/oauth/token");
  const body = JSON.parse(f.opts.body);
  eq(Object.keys(body).sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri"]);
  assert.strictEqual(body.code, "CODE1");
  assert.strictEqual(body.code_verifier, pending.codeVerifier);
  assert.strictEqual(body.grant_type, "authorization_code");
  // Challenge sent at start = SHA256(verifier) sent at exchange.
  const crypto = require("crypto");
  const expectChallenge = crypto.createHash("sha256").update(body.code_verifier).digest("base64url");
  assert.strictEqual(authUrl.searchParams.get("code_challenge"), expectChallenge);

  assert.strictEqual(env.store.result.status, "ok");
  eq(env.store.result.tokenFile.auth0_refresh_token, "RT");
  assert.ok(!("pending" in env.store), "pending cleared");
  eq(env.calls.tabsUpdate[0], [7, "moz-extension://uuid/complete.html"]);
  assert.strictEqual(env.calls.downloads[0].filename, "shark2mqtt_tokens.json");
  assert.strictEqual(env.calls.downloads[0].saveAs, true);

  // Origin header stripped only for extension-originated token requests.
  const hdrs = [{ name: "Origin", value: "moz-extension://uuid" }, { name: "Content-Type", value: "application/json" }];
  const out = env.listeners.sendHeaders[0].f({ originUrl: "moz-extension://uuid/_generated_background_page.html", requestHeaders: hdrs });
  eq(out.requestHeaders.map((h) => h.name), ["Content-Type"]);
  const untouched = env.listeners.sendHeaders[0].f({ originUrl: "https://login.sharkninja.com/u/login", requestHeaders: hdrs });
  eq(untouched, {});

  // Clear wipes the token.
  await env.send({ type: "clear" });
  assert.ok(!("result" in env.store));

  // ---- State mismatch is rejected, no exchange ----
  env = makeEnv();
  await env.send({ type: "start", region: "eu" });
  assert.ok(env.calls.tabsCreate[0].startsWith("https://logineu.sharkninja.com/authorize?"));
  env.listeners.headers[0].f({ tabId: 3, responseHeaders: [{ name: "Location", value: "com.sharkninja.shark://x/callback?code=C&state=WRONG" }] });
  await env.settle();
  assert.strictEqual(env.calls.fetches.length, 0);
  assert.strictEqual(env.store.result.status, "error");

  // ---- Auth0 error redirect ----
  env = makeEnv();
  await env.send({ type: "start", region: "us" });
  env.listeners.headers[0].f({ tabId: 3, responseHeaders: [{ name: "Location", value: "com.sharkninja.shark://x/callback?error=access_denied&error_description=Nope" }] });
  await env.settle();
  assert.match(env.store.result.message, /access_denied Nope/);

  // ---- Token endpoint refuses ----
  env = makeEnv({ tokenResponse: { status: 403, body: { error: "invalid_grant", error_description: "bad code" } } });
  await env.send({ type: "start", region: "us" });
  const st = new URL(env.calls.tabsCreate[0]).searchParams.get("state");
  env.listeners.headers[0].f({ tabId: 3, responseHeaders: [{ name: "Location", value: `com.sharkninja.shark://x/callback?code=C&state=${st}` }] });
  await env.settle();
  assert.strictEqual(env.store.result.status, "error");
  assert.match(env.store.result.message, /HTTP 403.*invalid_grant bad code/);
  assert.strictEqual(env.calls.downloads.length, 0);

  // ---- Redirect with no pending flow is ignored ----
  env = makeEnv();
  env.listeners.headers[0].f({ tabId: 3, responseHeaders: [{ name: "Location", value: "com.sharkninja.shark://x/callback?code=C&state=S" }] });
  await env.settle();
  assert.strictEqual(env.calls.fetches.length, 0);
  assert.ok(!("result" in env.store));

  console.log("All flow checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
