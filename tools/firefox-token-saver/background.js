"use strict";

/* global SHARK_REGIONS, SHARK_SCHEME, TOKEN_FILENAME, randomUrlSafe, pkceChallenge,
   buildAuthorizeUrl, getQueryParam, buildTokenFile */

// The login runs in a normal Firefox tab that you drive yourself, so Cloudflare's
// "verify you are human" check sees a real person in a real browser. When Auth0
// finishes, it redirects to the Shark app's custom scheme
// (com.sharkninja.shark://...?code=...). Firefox can't open that, but this
// extension sees the redirect's Location header, takes the one-time code, and
// trades it for tokens using the PKCE secret it generated at the start.

const AUTH_HOST_PATTERNS = ["https://login.sharkninja.com/*", "https://logineu.sharkninja.com/*"];
const TOKEN_URL_PATTERNS = Object.values(SHARK_REGIONS).map((r) => r.tokenUrl);

let handledStates = new Set();

async function setResult(result) {
  await browser.storage.local.set({ result: { ...result, at: new Date().toISOString() } });
}

async function startLogin(region) {
  if (!SHARK_REGIONS[region]) throw new Error(`Unknown region: ${region}`);
  // Start clean: drop any tokens left from a previous run.
  await browser.storage.local.remove(["result", "pending"]);

  const codeVerifier = randomUrlSafe(32);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const state = randomUrlSafe(16);

  await browser.storage.local.set({ pending: { region, codeVerifier, state } });
  await browser.tabs.create({ url: buildAuthorizeUrl(region, state, codeChallenge) });
}

async function showResultPage(tabId) {
  const url = browser.runtime.getURL("complete.html");
  if (tabId != null && tabId >= 0) {
    try {
      await browser.tabs.update(tabId, { url });
      return;
    } catch (e) {
      // Tab may be gone; fall through and open a new one.
    }
  }
  await browser.tabs.create({ url });
}

function downloadTokenFile(tokenFile) {
  const blob = new Blob([JSON.stringify(tokenFile, null, 2)], { type: "application/json" });
  const blobUrl = URL.createObjectURL(blob);
  return browser.downloads
    .download({ url: blobUrl, filename: TOKEN_FILENAME, saveAs: true })
    .then((id) => {
      const onChanged = (delta) => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === "complete" || delta.state.current === "interrupted") {
          URL.revokeObjectURL(blobUrl);
          browser.downloads.onChanged.removeListener(onChanged);
        }
      };
      browser.downloads.onChanged.addListener(onChanged);
    })
    .catch((err) => {
      URL.revokeObjectURL(blobUrl);
      throw err;
    });
}

async function handleCallback(callbackUrl, tabId) {
  const state = getQueryParam(callbackUrl, "state");
  if (state && handledStates.has(state)) return; // same redirect seen twice
  if (state) handledStates.add(state);

  const { pending } = await browser.storage.local.get("pending");
  if (!pending) {
    // A Shark redirect we didn't start (e.g. an old tab). Ignore it.
    return;
  }

  const error = getQueryParam(callbackUrl, "error");
  if (error) {
    await browser.storage.local.remove("pending");
    await setResult({
      status: "error",
      message: `Shark's login returned an error: ${error} ${getQueryParam(callbackUrl, "error_description") || ""}`.trim(),
    });
    await showResultPage(tabId);
    return;
  }

  if (state !== pending.state) {
    await setResult({
      status: "error",
      message: "The login finished, but it doesn't match the login this extension started. Click Start again.",
    });
    await showResultPage(tabId);
    return;
  }

  const code = getQueryParam(callbackUrl, "code");
  if (!code) {
    await setResult({ status: "error", message: "The login finished but Shark didn't send a code. Click Start again." });
    await showResultPage(tabId);
    return;
  }

  await browser.storage.local.remove("pending");
  const region = SHARK_REGIONS[pending.region];

  let resp;
  let data;
  try {
    // Same request shark2mqtt's exchange_code_for_tokens() sends.
    resp = await fetch(region.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: region.clientId,
        code_verifier: pending.codeVerifier,
        code,
        redirect_uri: region.redirectUri,
      }),
    });
    data = await resp.json().catch(() => ({}));
  } catch (e) {
    await setResult({ status: "error", message: `Couldn't reach Shark to finish the login: ${e.message || e}` });
    await showResultPage(tabId);
    return;
  }

  if (!resp.ok || !data.id_token) {
    await setResult({
      status: "error",
      message: `Shark refused the token exchange (HTTP ${resp.status}): ${data.error || ""} ${data.error_description || ""}`.trim(),
    });
    await showResultPage(tabId);
    return;
  }

  const tokenFile = buildTokenFile(data, new Date().toISOString());
  await setResult({
    status: "ok",
    region: pending.region,
    hasRefreshToken: Boolean(tokenFile.auth0_refresh_token),
    tokenFile,
  });
  await showResultPage(tabId);
  downloadTokenFile(tokenFile).catch((e) => console.error("[Shark Token Saver] Download failed:", e));
}

// Catch Auth0's 302 to com.sharkninja.shark://... before Firefox tries (and fails)
// to open it.
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const loc = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === "location");
    if (loc && loc.value && loc.value.toLowerCase().startsWith(SHARK_SCHEME)) {
      handleCallback(loc.value, details.tabId).catch(async (e) => {
        console.error("[Shark Token Saver]", e);
        await setResult({ status: "error", message: String(e.message || e) });
        await showResultPage(details.tabId);
      });
    }
  },
  { urls: AUTH_HOST_PATTERNS },
  ["responseHeaders"],
);

// The token exchange is sent from this extension, so Firefox would label it with a
// moz-extension:// Origin. The real Shark app sends no Origin at all, so drop it to
// look like the app.
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const fromExtension = (details.originUrl || "").startsWith("moz-extension://");
    if (!fromExtension) return {};
    return {
      requestHeaders: details.requestHeaders.filter((h) => h.name.toLowerCase() !== "origin"),
    };
  },
  { urls: TOKEN_URL_PATTERNS },
  ["blocking", "requestHeaders"],
);

browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === "start") {
    return startLogin(message.region || "us").then(
      () => ({ ok: true }),
      (e) => ({ ok: false, error: String(e.message || e) }),
    );
  }
  if (message && message.type === "save") {
    return browser.storage.local.get("result").then(({ result }) => {
      if (!result || !result.tokenFile) return { ok: false, error: "No token to save." };
      return downloadTokenFile(result.tokenFile).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: String(e.message || e) }),
      );
    });
  }
  if (message && message.type === "clear") {
    handledStates = new Set();
    return browser.storage.local.remove(["result", "pending"]).then(() => ({ ok: true }));
  }
  return undefined;
});
