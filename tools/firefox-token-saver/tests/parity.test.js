// Checks the extension's helpers against shark2mqtt's own Python code.
// Usage: SHARK2MQTT_SRC=/path/to/shark2mqtt node tests/parity.test.js
// Needs python3 with the bridge's requirements installed (pydantic, pydantic-settings, aiohttp, ...).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const s = require(path.resolve(__dirname, "..", "shared.js"));
const SRC = process.env.SHARK2MQTT_SRC;
if (!SRC || !fs.existsSync(path.join(SRC, "src", "shark_auth.py"))) {
  console.error("Set SHARK2MQTT_SRC to a checkout of the shark2mqtt bridge (the folder containing src/).");
  process.exit(2);
}
const TOKDIR = fs.mkdtempSync(path.join(os.tmpdir(), "s2m-tok-"));

(async () => {
  // 1. PKCE challenge matches Python's hashlib/base64 for the same verifier.
  const verifier = s.randomUrlSafe(32);
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const jsChallenge = await s.pkceChallenge(verifier);
  const pyChallenge = execFileSync("python3", ["-I", "-c",
    "import sys,hashlib,base64;v=sys.argv[1];print(base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b'=').decode())",
    verifier]).toString().trim();
  assert.strictEqual(jsChallenge, pyChallenge, "PKCE challenge mismatch");

  // 2. Authorize URL params equal shark2mqtt's build_authorize_url for both regions.
  for (const region of ["us", "eu"]) {
    const url = s.buildAuthorizeUrl(region, "STATE123", jsChallenge);
    const pyUrl = execFileSync("python3", ["-I", "-c", `
import sys
sys.path.insert(0, sys.argv[1])
from urllib.parse import urlencode
from src.const import REGIONS, AUTH0_SCOPES
r = REGIONS[sys.argv[2]]
params = {"response_type":"code","code_challenge_method":"S256","code_challenge":sys.argv[3],
 "client_id":r.auth0_client_id,"redirect_uri":r.auth0_redirect_uri,"scope":AUTH0_SCOPES,
 "state":"STATE123","prompt":"login"}
print(f"{r.auth0_url}/authorize?{urlencode(params)}")
`, SRC, region, jsChallenge]).toString().trim();
    const a = new URL(url), b = new URL(pyUrl);
    assert.strictEqual(a.origin + a.pathname, b.origin + b.pathname, `${region} base mismatch`);
    const pa = Object.fromEntries(a.searchParams), pb = Object.fromEntries(b.searchParams);
    assert.deepStrictEqual(pa, pb, `${region} params mismatch`);
    // token URL / client / redirect also match const.py
    const tok = execFileSync("python3", ["-I", "-c",
      "import sys;sys.path.insert(0,sys.argv[1]);from src.const import REGIONS;r=REGIONS[sys.argv[2]];print(r.auth0_token_url);print(r.auth0_client_id);print(r.auth0_redirect_uri)",
      SRC, region]).toString().trim().split("\n");
    assert.deepStrictEqual([s.SHARK_REGIONS[region].tokenUrl, s.SHARK_REGIONS[region].clientId, s.SHARK_REGIONS[region].redirectUri], tok);
  }

  // 3. Callback parsing.
  const cb = "com.sharkninja.shark://login.sharkninja.com/ios/com.sharkninja.shark/callback?code=abc%2D123&state=xyz";
  assert.strictEqual(s.getQueryParam(cb, "code"), "abc-123");
  assert.strictEqual(s.getQueryParam(cb, "state"), "xyz");
  assert.strictEqual(s.getQueryParam(cb, "error"), null);
  assert.ok(cb.toLowerCase().startsWith(s.SHARK_SCHEME));

  // 4. Token file loads with shark2mqtt's own TokenData model + _load_tokens path.
  const file = s.buildTokenFile({ id_token: "ID", access_token: "AT", refresh_token: "RT", expires_in: 86400 }, new Date().toISOString());
  fs.writeFileSync(path.join(TOKDIR, "shark2mqtt_tokens.json"), JSON.stringify(file, null, 2));
  const loaded = execFileSync("python3", ["-I", "-c", `
import sys, json, asyncio
sys.path.insert(0, sys.argv[1])
from src.config import Settings
from src.shark_auth import SharkAuth
cfg = Settings(shark_username="a@b.c", shark_password="x", mqtt_host="unused", token_dir=sys.argv[2])
auth = SharkAuth(cfg)
tok = asyncio.run(auth.ensure_authenticated())
print(json.dumps({"returned": tok, "refresh": auth._tokens.auth0_refresh_token}))
`, SRC, TOKDIR]).toString().trim().split("\n").pop();
  assert.deepStrictEqual(JSON.parse(loaded), { returned: "ID", refresh: "RT" });
  console.log("All parity checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
