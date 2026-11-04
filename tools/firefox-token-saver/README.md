# Shark Token Saver (for shark2mqtt)

A small Firefox extension that lets you do the SharkNinja login yourself, in your normal browser, and saves the `shark2mqtt_tokens.json` file that [shark2mqtt](https://github.com/CamSoper/shark2mqtt) uses.

Use it when shark2mqtt's automatic login fails with Cloudflare's "verify you are human" check (for example *"We couldn't load the security challenge"*). Because you're a person in a real browser, the check passes. With this file in place, shark2mqtt uses the saved token and skips its own browser login.

The idea comes from the OnStar Firefox token tool (metheos/onstar_firefox). The login settings (client ID, redirect address, scopes and token format) are copied exactly from shark2mqtt's own code.

## Install (one-time, temporary)

1. Unzip this folder somewhere.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder.

The extension stays loaded until you close Firefox, which is all you need.

## Use

1. Click the puzzle-piece (Extensions) button in the toolbar, then **Shark Token Saver**.
2. Pick your region (US or EU) and click **Start Shark login**.
3. Sign in on the SharkNinja page that opens: email, the "verify you are human" box, then password. If it offers to set up a passkey, skip it.
4. When the login finishes, the tab switches to a result page and Firefox asks where to save `shark2mqtt_tokens.json`. The page also has a **Copy token** button.

If Firefox briefly asks which app should open a `com.sharkninja.shark` link, cancel it. The extension has already captured what it needs.

## Put the token into the Home Assistant app

Use a **fresh login for each app**. Don't copy one app's token file into another app, because the two would then share a refresh token that Shark may rotate.

### If your app has a `shark_token` option (Claude Shark2MQTT)
Click **Copy token** on the result page, paste it into the app's `shark_token` option, save, and start the app.

### Otherwise: copy the file into the app's data folder (HA OS)
HA now calls add-ons **apps**, and their data lives under `/mnt/data/supervisor/apps/data/` on the host (older installs used `addons/data`).

1. Put `shark2mqtt_tokens.json` in HA's `share` folder, e.g. with the Samba app (`\\homeassistant.local\share`).
2. Open the HA OS console (VM console or a keyboard on the machine). At the `ha >` prompt, type `login`.
3. Find the app's data folder and copy the file in. `<slug>` is `shark2mqtt` for the original app:
   ```
   find / -type d -name "*_<slug>" 2>/dev/null
   cp /mnt/data/supervisor/share/shark2mqtt_tokens.json /mnt/data/supervisor/apps/data/<hash>_<slug>/
   ls -l /mnt/data/supervisor/apps/data/<hash>_<slug>/
   ```
   Some VM consoles (e.g. Unraid's noVNC) can't paste into a text console. Shell wildcards save typing, e.g. `/mnt/d*/su*/apps/data/<first letters of hash>*/`.
4. Delete the share copy with `rm /mnt/data/supervisor/share/shark2mqtt_tokens.json`, then type `exit`.
5. Start the app. Its log should say `Loaded cached tokens from /data/shark2mqtt_tokens.json`.

## Clean up

The token works like a password for your Shark account.

- On the result page, click **Clear from this browser**, and delete any saved copy of the file.
- Make sure no copy is left in HA's `share` folder.

## Troubleshooting

- **"Shark refused the token exchange":** the one-time code expired or was already used. Click **Start Shark login** again.
- **"Your account has been locked":** stop and wait a few hours. Repeated tries make it worse.
- **The result page never appears:** make sure you clicked **Start Shark login** in the extension, rather than opening the Shark site on your own. The extension only accepts logins it started.

## What it does and doesn't do

- It only has access to `login.sharkninja.com` and `logineu.sharkninja.com`.
- It never sees your password field contents or injects anything into web pages. It only reads the final redirect that carries the one-time login code.
- Your token is sent only to SharkNinja's own token endpoint. The result is kept in the extension's local storage until you click **Clear**.

## Development

- `shared.js`: constants copied from the bridge's `src/const.py` (`REGIONS`, `AUTH0_SCOPES`) and the token-file shape (`TokenData` in `src/shark_auth.py`). If upstream changes those, update this file.
- `background.js`: starts the login (PKCE), catches the `com.sharkninja.shark://` redirect, exchanges the code and saves the file.
- Tests (Node 18+):
  - `node tests/flow.test.js` runs `background.js` against a fake Firefox API and a fake Shark server: happy path, duplicate redirects, state mismatch, Auth0 error redirect, refused exchange, and stray redirects.
  - `SHARK2MQTT_SRC=/path/to/shark2mqtt node tests/parity.test.js` compares the PKCE challenge, the authorize URL (both regions) and the token file against the bridge's own Python, by loading the file through `SharkAuth`. Needs `python3` with the bridge's requirements installed.
- Lint: `npx web-ext lint --source-dir .` (0 errors, 0 warnings as of 1.0.0).
- Planned (`docs/dev/AUTH.md`): a capture-only mode for the in-HA login panel, and a Chrome (MV3) version.
