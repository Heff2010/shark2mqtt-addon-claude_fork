# Claude Shark2MQTT — notes for Claude Code sessions

This fork turns the Shark2MQTT Home Assistant app into **"Claude Shark2MQTT"**. It fixes problems found on a SharkNinja **UR2850ZEUS** (vacuum + mop, self-empty / self-fill dock) and adds a Shark login that works from inside Home Assistant.

Two repositories are involved, both forks:

| Fork of | Role |
|---|---|
| `CamSoper/shark2mqtt` | The bridge itself (Python). State logic, polling, commands, auth. Upstream is MIT-licensed. |
| `400HPMustang/shark2mqtt-addon` (this repo) | The HA app wrapper: `config.yaml`, `Dockerfile`, `run.sh`. Builds on the bridge's Docker image. |

## Read these first

| Doc | What's in it |
|---|---|
| `docs/dev/ROADMAP.md` | Phases, tasks, acceptance criteria, approval gates. **Start here.** |
| `docs/dev/DEVICE_FINDINGS.md` | What's been observed on the UR2850: the five issues, the `sys_st` table, the proposed state rules, data still needed. |
| `docs/dev/CODE_MAP.md` | Where everything lives in both codebases (as of bridge v1.5.5 / wrapper v1.0.8), and where each fix goes. |
| `docs/dev/AUTH.md` | How the Shark login works, why the built-in browser login fails, the token file, the in-HA login design. |
| `tools/firefox-token-saver/` | Working Firefox extension that produces a token file by a manual login. Has its own README and tests. |

## Ground rules

1. **These repos are public.** Never commit tokens, passwords, serial numbers, Shark user / household / floor IDs, IP addresses or personal room names. Test fixtures must be synthetic or sanitized.
2. **Plan, then wait for "go".** Propose the plan for a phase (files, tests, device test plan) and wait for explicit approval before implementing it.
3. **Branches and PRs only.** Never push to `main`. Never create tags or releases, or anything else that publishes an image, without an explicit OK in the conversation.
4. **Keep entity IDs stable.** Discovery unique IDs are `shark2mqtt_{dsn}` and `object_id`s come from the device name. The user's dashboards, scripts, Assist and HomeKit depend on entity IDs such as `vacuum.sharkvac`, `select.sharkvac_clean_mode`, `select.sharkvac_water_flow_level` and `sensor.sharkvac_battery`. Don't change the uid or object_id scheme. New entities are fine.
5. **Upstream-friendly changes.** Small, isolated commits, one fix per commit, each with tests. Gate model-specific behaviour on the presence of the fields it relies on, so other Shark models keep today's behaviour. That keeps syncs with upstream conflict-light and makes the fixes offerable upstream.
6. **This cloud session can't reach the user's home.** There's no access to Home Assistant, the vacuum or the LAN, and no Shark credentials. Don't try to log in to Shark from here. Device testing is done by the user from a test plan you write: **one command per "go"**, the user confirms by eye, and the pre-test state is restored at the end.
7. **When device behaviour is uncertain, ask** for a sanitized log excerpt (the bridge's DEBUG "Shadow values" lines) rather than guessing.
8. **Never run the original app and the fork at the same time.** Both would publish the same entities and double the cloud polling. The original stays installed but stopped, as the fallback.
9. **Leave DEBUG logging alone.** The user keeps the app's `log_level` at DEBUG while testing. Don't propose turning it off unless they bring it up.

## Quick facts

| Item | Value |
|---|---|
| Robot | UR2850ZEUS, US region, Skegox cloud backend (Ayla data is stale) |
| Robot firmware | `V3.0.5-3d-20250710V6.6.10-P12.N1126.18.1-Sep_22_2025Lidar2_0M1.1.20Lidar2_0B1.3.0USB2.6.069.ccm18` (an update is downloaded but not yet installed) |
| Local control | None. Full TCP scan (1–65535): every port silently dropped. Cloud is the only route. |
| Home Assistant | HA OS 18.4 (VM on Unraid), Core 2026.10.4, Mosquitto broker app |
| HA naming | HA now calls add-ons **"apps"**. App data lives under `/mnt/data/supervisor/apps/data/<repo-hash>_<slug>/` on the host. |
| Bridge versions | Wrapper v1.0.8 (commit `e347d9b`) → bridge image `ghcr.io/camsoper/shark2mqtt:1.5.5` (commit `c45fe74`). The bridge maintainer has indicated change requests are likely closed. |
