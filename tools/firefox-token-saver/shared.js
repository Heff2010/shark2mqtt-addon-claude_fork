"use strict";

// Values mirror shark2mqtt's src/const.py (RegionConfig + AUTH0_SCOPES), so the
// tokens this extension produces are the same ones shark2mqtt's own browser
// login would have produced.
const SHARK_REGIONS = {
  us: {
    authBase: "https://login.sharkninja.com",
    tokenUrl: "https://login.sharkninja.com/oauth/token",
    clientId: "wsguxrqm77mq4LtrTrwg8ZJUxmSrexGi",
    redirectUri: "com.sharkninja.shark://login.sharkninja.com/ios/com.sharkninja.shark/callback",
  },
  eu: {
    authBase: "https://logineu.sharkninja.com",
    tokenUrl: "https://logineu.sharkninja.com/oauth/token",
    clientId: "rKDx9O18dBrY3eoJMTkRiBZHDvd9Mx1I",
    redirectUri: "com.sharkninja.shark://logineu.sharkninja.com/ios/com.sharkninja.shark/callback",
  },
};

const SHARK_SCOPE = "openid email profile offline_access";
const SHARK_SCHEME = "com.sharkninja.shark://";
const TOKEN_FILENAME = "shark2mqtt_tokens.json";

function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteCount) {
  const buf = new Uint8Array(byteCount);
  crypto.getRandomValues(buf);
  return base64urlEncode(buf);
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64urlEncode(digest);
}

// Same parameters as shark2mqtt's SharkAuth.build_authorize_url().
function buildAuthorizeUrl(region, state, codeChallenge) {
  const r = SHARK_REGIONS[region];
  const params = new URLSearchParams({
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    client_id: r.clientId,
    redirect_uri: r.redirectUri,
    scope: SHARK_SCOPE,
    state,
    prompt: "login",
  });
  return `${r.authBase}/authorize?${params.toString()}`;
}

function getQueryParam(url, name) {
  const q = url.indexOf("?");
  if (q === -1) return null;
  const hash = url.indexOf("#", q);
  const query = url.slice(q + 1, hash === -1 ? undefined : hash);
  return new URLSearchParams(query).get(name);
}

// Shape matches shark2mqtt's TokenData pydantic model, field for field.
function buildTokenFile(tokenResponse, savedAt) {
  return {
    auth0_refresh_token: tokenResponse.refresh_token ?? null,
    auth0_id_token: tokenResponse.id_token ?? null,
    auth0_access_token: tokenResponse.access_token ?? null,
    ayla_access_token: null,
    ayla_refresh_token: null,
    ayla_token_expiry: null,
    saved_at: savedAt,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    SHARK_REGIONS,
    SHARK_SCOPE,
    SHARK_SCHEME,
    TOKEN_FILENAME,
    base64urlEncode,
    randomUrlSafe,
    pkceChallenge,
    buildAuthorizeUrl,
    getQueryParam,
    buildTokenFile,
  };
}
