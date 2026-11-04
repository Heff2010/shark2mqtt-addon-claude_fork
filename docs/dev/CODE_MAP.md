# Code map

Snapshot of both codebases, with the place each planned change goes. Line numbers are as of the commits below. **Re-verify them in Phase 0**, because the forks may have moved on.

- Bridge: `CamSoper/shark2mqtt` v1.5.5, commit `c45fe74` (2026-08-03). Python 3.12, aiohttp, aiomqtt, pydantic-settings, patchright. MIT.
- Wrapper: `400HPMustang/shark2mqtt-addon` v1.0.8, commit `e347d9b` (2026-08-05). **No LICENSE file**, so check before redistributing changes. Open item for the user: ask the author to add one.

## Bridge (`shark2mqtt` fork)

### `src/config.py`: `Settings` (pydantic-settings, read from env vars / `.env`)
- Fields: `shark_username`, `shark_password`, `shark_region` (`us` | `eu`), `mqtt_host`/`port`/`username`/`password`/`prefix`, `shark_household_id`, `poll_interval` (300), `poll_interval_active` (20), `token_dir` (`/data`), `log_level`, `auth_once`, `offline`.
- **Add here:** new settings such as `pause_operating_mode` (default `1`) and `browser_login` (default `true`), so the wrapper can pass them as env vars.

### `src/const.py`
- `REGIONS` (l.23): per-region Auth0 URL, token URL, client ID, redirect URI (`com.sharkninja.shark://…/callback`), Ayla and Skegox endpoints. `AUTH0_SCOPES = "openid email profile offline_access"`.
- `OperatingMode` (l.54): STOP=0, PAUSE=1, START=2, RETURN=3, EXPLORE=4, ROOM_CLEAN=6, MOP=7, VACUUM_AND_MOP=8.
- `OPERATING_MODE_TO_HA_STATE` (l.77): STOP→idle, PAUSE→paused, START→cleaning, RETURN→returning, …
- `HA_COMMAND_TO_MODE` (l.97), `PROP_GET_*` / `PROP_SET_*` names, `ERROR_CODES`.

### `src/shark_device.py`: `SharkVacuum`
- `from_skegox()` (l.74): copies `telemetry` and `shadow.properties.reported` into `_properties` as `GET_<name>`. So `Operating_Mode_Ex` becomes `GET_Operating_Mode_Ex`, and `AreasToClean_V3` becomes `GET_AreasToClean_V3` (the value may be a JSON string). It also sets `has_areas_v3`, `rooms` and `floor_id`, and dumps "Shadow values" at DEBUG.
- `operating_mode` (l.213): `OperatingMode | None`, and warns on out-of-enum values.
- `is_docked` (l.239): `DockedStatus == 1 or is_charging` (issue #29 workaround).
- `ha_state` (l.257): error → `error`; mode None → `idle`; docked and mode in (STOP, RETURN) → `docked`; else the table.
  - **Change:** add the job-aware rules from `DEVICE_FINDINGS.md`, gated on the fields being present.
- `to_attributes_payload()` (l.397). **Bug at l.405:** `if self.operating_mode` is false for STOP (0), so the attribute shows "unknown". Use `is not None`.
- **Add:** properties `sys_st` (parse `GET_Operating_Mode_Ex` defensively, since it may be a dict or a JSON string), `job_active`, `job_clean_type`, `job_trigger` (from `GET_AreasToClean_V3`), and `uses_job_state` (both fields present). Publish them as attributes.

### `src/main.py`
- `poll_loop()` (l.113): per device, `publish_discovery` then `publish_state`; `any_active = True` when `ha_state != "docked"` (l.202 Skegox, l.232 Ayla).
  - **Change:** also active when `device.job_active`.
- l.246: `interval = poll_interval_active if any_active else poll_interval`. Then it waits on `command_event` (set by the MQTT command listener) with that timeout, which gives the early poll after HA commands.
- `run()` (l.256): `--auth-once` mode (l.262) authenticates, lists devices and exits.

### `src/mqtt_client.py`
- `publish_discovery()` (l.69): `uid = f"shark2mqtt_{dsn}"` (l.72), `slug` from the product name (l.73). Entities: vacuum, water flow select, battery, rssi, charging, error, error text, evacuating, warning, dock error, per-room buttons, clean-mode select. **Don't change the uid/object_id scheme.**
  - **Add:** diagnostic `sensor` for sys_st and `binary_sensor` for job active, following the existing patterns and `_discovery_sigs` dedup.
- Command topics: `{prefix}/{dsn}/command` (plain commands) and `{prefix}/{dsn}/send_command` (JSON).
- `_handle_send_command()`: `clean_room`, `matrix_clean` and `clean_rooms` accept `clean_type` (`dry` | `wet`); anything else is forwarded as a generic command.

### `src/skegox_api.py`
- `set_desired_property()` (l.284): PATCH `/devicesEndUserController/{household}/devices/{snd}` with `{"shadow":{"properties":{"desired":{name: value}}}}`.
- `send_command()` (l.295): start→Operating_Mode 2, stop→0, **pause→1**, return_to_base→3, locate→Find_Device 1, mop→7, vacuum_and_mop→8.
  - **Change:** take the pause value from config (`pause_operating_mode`). Default 1, so other models are unchanged.
- `clean_rooms()` (l.336): V3 payload `{"areas_to_clean": {mode: rooms}, "clean_count", "floor_id", "cleantype"}` → `AreasToClean_V3`.

### `src/shark_auth.py`
- `TOKEN_FILENAME = "shark2mqtt_tokens.json"` (l.33); `MAX_BROWSER_LAUNCHES_PER_DAY = 3` (l.38); `TokenData` (l.41): `auth0_refresh_token`, `auth0_id_token`, `auth0_access_token`, `ayla_access_token`, `ayla_refresh_token`, `ayla_token_expiry`, `saved_at`.
- `ensure_authenticated()` (l.95), in order: cached tokens from `token_dir` → refresh_token grant → browser login. There's a circuit breaker with a 30-minute backoff after 2 failures.
  - **Change:** if `browser_login` is false, skip the browser step and raise a clear `SharkAuthError` that says a new token is needed and how to get one.
- `_refresh_auth0_token()` (l.152): JSON POST `grant_type=refresh_token`, saves a rotated `refresh_token` if one is returned, then `_save_tokens()` (atomic write).
- `_browser_authenticate()` (l.187): Patchright Chromium (headed if `DISPLAY` is set), captures the custom-scheme redirect via CDP, then `exchange_code_for_tokens()` (l.460). `build_authorize_url()` (l.446) holds the authorize params.

### Tests and CI
- `tests/`: pytest + pytest-asyncio. `test_shark_device.py` has 23 tests and is the place for the state-rule tests. The other suites are `test_poll_loop`, `test_command_event_integration`, `test_shark_auth`, `test_diagnostics` and `test_water_flow_api`.
- `.github/workflows/tests.yml`: runs pytest on push / PR to `main`.
- `.github/workflows/docker-publish.yml`: builds multi-arch (amd64, arm64) and pushes `ghcr.io/${{ github.repository }}` on `v*.*.*` tags. **Its `deploy` job uses the upstream author's Pulumi secrets and home-lab deploy**, so it would fail in the fork. Remove or disable it before any tag is pushed.
- In a fork, GitHub Actions is disabled until the owner enables it in the Actions tab. GHCR packages are created **private** by default, so the user must make the package public for HA to pull it.

## Wrapper (this repo)

- `repository.yaml`: store name, url, maintainer.
- `shark2mqtt/config.yaml`: `slug: shark2mqtt`, `version: "1.0.8"`, `arch: [amd64, aarch64]`, `services: [mqtt:need]`, `hassio_api: true`, `boot: auto`. **No `image:` key, so HA builds the Dockerfile on the user's machine, which is slow.** Options: `shark_username`, `shark_password`, `shark_region`, `shark_household_id`, `use_supervisor_mqtt_service`, `mqtt_*`, `mqtt_prefix`, `poll_interval`, `poll_interval_active`, `log_level`.
- `shark2mqtt/Dockerfile`: `FROM ghcr.io/camsoper/shark2mqtt:${SHARK2MQTT_VERSION}` (1.5.5), runs as root, adds jq/curl, and its entrypoint is `run.sh`.
- `shark2mqtt/run.sh`: reads `/data/options.json`, gets MQTT details from the Supervisor (`http://supervisor/services/mqtt`), exports env vars, sets `TOKEN_DIR=/data`, starts Xvfb `:99`, then runs `python -m src.main`.
- `shark2mqtt/DOCS.md`, `translations/en.yaml`, icons.

### Planned wrapper changes (details in ROADMAP)
- New identity so it installs alongside the original: `slug: claude_shark2mqtt`, `name: Claude Shark2MQTT`, repository url → fork. A new slug means a **new data folder**, so it starts with no token.
- Base image → the bridge fork's published image.
- New options: `shark_token` (seed-once, see AUTH.md), `pause_operating_mode`, `browser_login`.
- Prebuilt multi-arch images via GitHub Actions plus an `image:` key, so installs pull instead of build.
- Later: ingress login page (AUTH.md).
