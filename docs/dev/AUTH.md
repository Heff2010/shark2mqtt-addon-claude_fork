# Shark login: how it works, what fails, and the in-HA design

## How Shark's login works

Shark uses Auth0 with the login flow its phone app uses (authorization code + PKCE). The constants are in the bridge's `src/const.py` (`REGIONS`, `AUTH0_SCOPES`).

1. Open `https://login.sharkninja.com/authorize` (EU: `logineu.sharkninja.com`) with:
   - `response_type=code`, `code_challenge_method=S256`, `code_challenge=<S256 of verifier>`
   - `client_id=<region client id>`, `redirect_uri=com.sharkninja.shark://login.sharkninja.com/ios/com.sharkninja.shark/callback`
   - `scope=openid email profile offline_access`, `state=<random>`, `prompt=login`
2. The user enters their email, passes Cloudflare Turnstile ("verify you are human"), enters their password, and may be offered passkey enrollment (skip it).
3. Auth0's `/authorize/resume` answers with a **302 to the custom scheme**: `com.sharkninja.shark://…/callback?code=…&state=…`. Browsers can't open that scheme, and on a phone with the Shark app installed **the app takes it and uses up the code**.
4. Exchange the code with a JSON POST to `https://login.sharkninja.com/oauth/token`: `{grant_type: "authorization_code", client_id, code_verifier, code, redirect_uri}`. The response has `id_token`, `access_token` and `refresh_token`.
5. After that, the bridge renews with `grant_type=refresh_token` and saves any rotated refresh token it receives.

## Why the built-in browser login fails here

- The bridge drives a Patchright Chromium under Xvfb inside the container. For this user it failed at the email step with: *"We couldn't load the security challenge. Please try again."* That's the Cloudflare Turnstile widget failing to load for the automated browser. The project README describes the same class of failure on some hosts and networks.
- Retrying is risky: repeated automated logins can get the Shark account locked. The bridge has a circuit breaker (2 failures → 30-minute backoff; at most 3 browser launches a day), but every attempt still counts.

## What works: a manual login in a real browser

- `tools/firefox-token-saver/` is a temporary Firefox extension. It builds the authorize URL above, lets the user log in by hand (Turnstile passes for a real person), watches for the 302 `Location` header to the custom scheme, exchanges the code, and saves `shark2mqtt_tokens.json`.
- **Verified in production (2026-10-29):** with that file in the app's `/data`, the bridge logged `Loaded cached tokens…`, then `Ayla refresh failed, re-authenticating via Auth0` (expected, because the file has no Ayla tokens), `Ayla sign-in successful`, discovered the robot, loaded the rooms and published discovery. No browser login was needed.
- The extension's helpers are checked against the bridge's own Python by `tools/firefox-token-saver/tests/parity.test.js`. That covers the PKCE challenge, the authorize params for both regions, and loading the token file through `SharkAuth`.

### Token file (`shark2mqtt_tokens.json`, the `TokenData` model)
```json
{
  "auth0_refresh_token": "…",
  "auth0_id_token": "…",
  "auth0_access_token": "…",
  "ayla_access_token": null,
  "ayla_refresh_token": null,
  "ayla_token_expiry": null,
  "saved_at": "2026-10-29T20:37:00.000Z"
}
```

## Rules any token-seeding feature must follow

1. **Seed once per pasted value.** The bridge may rotate the refresh token and saves the new one to `/data`. If the wrapper rewrote the token file from the app option on every start, it would bring back an already-rotated token. That breaks the login, and under Auth0 reuse detection it can revoke the whole token family.
   - Store a SHA-256 of the seeded option value in `/data` (e.g. `/data/.seeded_token.sha256`). Seed only when the option is non-empty **and** its hash differs.
2. **Accept both forms:** the full token JSON (from the extension), or a bare refresh-token string. For a bare string, write `{"auth0_refresh_token": "<value>"}` with the other fields null; the bridge refreshes on start.
3. **One login per installed app.** The fork app has its own data folder. **Don't copy the original app's token file into it.** Generate a fresh token with its own login, so two apps never share one refresh-token family.
4. **Never log token values.** Not at DEBUG either. Log only "seeded new token" / "token unchanged".
5. Seeding a token isn't a reason to remove the option value. HA config is the user's to manage; the hash prevents re-seeding.

## In-HA login (Phase 3 design)

Goal: anyone can sign in to Shark from the app's own page in HA's sidebar (ingress), with no console, Samba or SSH.

### Flow
1. The user opens the **Claude Shark2MQTT** panel (ingress) and clicks **Log in to Shark**.
2. The app's small web server (aiohttp is already in the image) generates `code_verifier` and `state`, keeps them server-side with a short expiry (in memory or in `/data`, ~10 min), and returns the authorize URL.
3. The page opens that URL in a new tab. The user logs in in their own browser, so Turnstile passes.
4. The user brings back the final `com.sharkninja.shark://…?code=…&state=…` address, using one of the methods below, and pastes it, or just the code, into the panel.
5. The server checks `state`, exchanges the code, and writes the token file atomically. It then restarts the bridge process: either `run.sh` supervises the child process, or the server calls the Supervisor API to restart the app. Verify which `hassio_api` role allows this.
6. The panel shows success. Later, if the bridge reports an auth error, the panel shows "login needed" with the button again.

### Getting the code back into HA
- **Companion extension (recommended):** add a *capture-only* mode to `tools/firefox-token-saver/`. When it sees a custom-scheme redirect for a login it didn't start, it shows the full callback URL with a Copy button, with no exchange of its own. The app holds the PKCE secret, so the extension needs nothing else. A Chrome version is also worth building: Manifest V3 still allows non-blocking `webRequest.onHeadersReceived` observation with host permissions.
- **No extension (fallback):** open the browser's developer tools on the Network tab with "Preserve log" on before logging in, then copy the custom-scheme URL from the last redirect. **Open question:** what Chrome and Firefox actually show at the hand-off (a failed request entry? the `Location` header on `/authorize/resume`? an error page that shows the URL?). The user needs to test this before the panel's instructions are written.
- **Code lifetime:** believed to be short (around a minute). Verify, and make the panel tell the user to paste promptly. Exchange the code the moment it's pasted.
- **Phones:** not supported. The Shark app intercepts the redirect, and mobile browsers lack developer tools. The panel should say to use a computer.

### Security
- Ingress is only reachable through an authenticated HA session. Don't expose the web server on a host port.
- Never echo token values back to the page or the log.
- Keep the PKCE verifier server-side and single-use.

## Manual fallback that works today (no new code)

This is how the user installed the token on HA OS before any of this existed:
1. Put `shark2mqtt_tokens.json` in HA's `share` folder (Samba app: `\\homeassistant.local\share`).
2. On the HA OS console (VM console or keyboard), at the `ha >` prompt run `login`, then:
   - `find / -type d -name "*_<slug>" 2>/dev/null` finds the app's data folder, e.g. `/mnt/data/supervisor/apps/data/<hash>_<slug>`. Note `apps`, not `addons`, on current HA.
   - `cp /mnt/data/supervisor/share/shark2mqtt_tokens.json /mnt/data/supervisor/apps/data/<hash>_<slug>/`
   - Then delete the share copy and run `exit`.
3. Start the app and check for `Loaded cached tokens`.
4. Unraid's noVNC console can't paste into the text console. Shell wildcards keep the typing short.
