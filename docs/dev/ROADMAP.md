# Roadmap

Each phase ends at a gate. Propose the plan, wait for the user's "go", implement on a branch, open a PR, and stop. Anything that publishes (tags, releases, image pushes, making packages public) needs its own explicit OK.

## Phase 0: Orientation (read-only)

1. Read `CLAUDE.md` and everything in `docs/dev/`.
2. Check `CODE_MAP.md` against both forks' current `main`. Note anything that moved, changed or no longer applies, including whether upstream has commits after v1.5.5 / v1.0.8.
3. Check whether GitHub Actions is enabled on each fork, and what would run today if a `v*` tag were pushed to the bridge fork (the upstream `deploy` job).
4. Check the wrapper repo's licensing situation (no LICENSE file) and tell the user what it means for publishing a modified version.
5. **Report:** discrepancies, open questions, and a concrete Phase 1 plan: file-by-file changes, the tests to add, and the on-device test plan the user will run.

**Gate:** the user replies "go" to the Phase 1 plan.

## Phase 1: Bridge fork fixes (`shark2mqtt` fork)

Branch, one commit per item, one PR into the fork's `main`.

| # | Change | Notes |
|---|---|---|
| 1.1 | Fix `operating_mode` showing "unknown" for STOP | `is not None` in `to_attributes_payload()`. Affects every model. |
| 1.2 | Expose `sys_st`, `job_active`, `job_clean_type`, `job_trigger` | As vacuum attributes, plus diagnostic entities (sensor for `sys_st`, binary sensor for job active). Parse `Operating_Mode_Ex` and `AreasToClean_V3` defensively. |
| 1.3 | Job-aware state rules and polling | Only when both fields are present (see the table in `DEVICE_FINDINGS.md`). `poll_loop` counts `job_active` as active. |
| 1.4 | Configurable pause value | New setting `pause_operating_mode` (env `PAUSE_OPERATING_MODE`), default `1`, so today's behaviour is unchanged. |
| 1.5 | Optional browser login | New setting `browser_login` (env `BROWSER_LOGIN`), default `true`. When false, an expired token gives a clear error telling the user to log in again, instead of launching Chromium. |
| 1.6 | CI fit for a fork | Remove or disable the `deploy` job in `docker-publish.yml`. Keep the tests and the multi-arch GHCR publish on tags. |

**Acceptance**
- All existing tests pass.
- New tests for each item, using synthetic fixtures shaped like the user's sanitized "Shadow values" lines (ask for them, as listed in `DEVICE_FINDINGS.md`).
- A test proving a robot **without** `Operating_Mode_Ex` / `AreasToClean_V3` gets exactly today's states.
- A test proving discovery unique IDs and `object_id`s are unchanged.

**Gate:** the user merges the PR. Then, with explicit OK, tag `v1.5.5-claude.1` to publish `ghcr.io/<owner>/shark2mqtt:1.5.5-claude.1`. The user makes the package public in GitHub's package settings.

## Phase 2: Wrapper fork (this repo)

| # | Change | Notes |
|---|---|---|
| 2.1 | New identity | `slug: claude_shark2mqtt`, `name: Claude Shark2MQTT`, `url` and `repository.yaml` → this fork, `version: 1.0.8-claude.1`. Installs alongside the original. |
| 2.2 | Base image → bridge fork | `FROM ghcr.io/<owner>/shark2mqtt:${SHARK2MQTT_VERSION}` with the version from Phase 1. |
| 2.3 | New options | `shark_token` (password field, optional, seed-once as specified in `AUTH.md`), `pause_operating_mode` (`list(1\|0)`, default 1), `browser_login` (bool, default true). Map them to env vars in `run.sh`; update `translations/en.yaml` and `DOCS.md`. |
| 2.4 | Prebuilt images | A GitHub Actions workflow that builds amd64 and aarch64 images (e.g. with the Home Assistant builder action) and pushes `ghcr.io/<owner>/{arch}-addon-claude-shark2mqtt`. Add the `image:` key so HA pulls instead of building. |
| 2.5 | Extension in `tools/` | Already present. Keep its README's HA steps in line with the `apps/data` path. |

**Acceptance**
- The seed-once logic has tests covering first seed, unchanged value, new value, a bare refresh token, invalid JSON, and that no token value is ever logged.
- The app config passes a linter such as `frenck/action-addon-linter`.

**Gate:** the user installs the fork from HA's app store (see "Install and test" below) and runs the device test plan.

## Phase 3: In-HA login (ingress panel)

Design in `AUTH.md`. Includes the extension's capture-only mode and, optionally, a Chrome version.

**Depends on** the user testing what Chrome and Firefox show at the custom-scheme hand-off, which decides the no-extension instructions. Ask for that test at the start of this phase.

## Phase 4: Staying in sync with upstream

- A scheduled workflow in each fork (daily or weekly):
  - Fetch upstream.
  - If there are new commits, merge them into a `sync/upstream-<date>` branch and open a PR, so the tests run on it.
  - On a merge conflict, open an issue instead.
  - Wrapper: also flag when upstream bumps `SHARK2MQTT_VERSION`.
- Add a CI check that the extension's constants still match the bridge's `REGIONS` and `TokenData` (`tools/firefox-token-saver/tests/parity.test.js`).
- Note that GitHub disables scheduled workflows in forks until Actions is enabled, and pauses them after 60 days without repo activity.

## Phase 5: Research only, live updates instead of polling

The Shark app updates live, so the cloud likely has a push channel. The shadow's `reported`/`desired` structure suggests AWS IoT. Find out how the app subscribes, and what auth it needs, by reading-only research. Report feasibility, effort and risks. **No implementation without approval.** This is the only real fix for runs started from the app or schedule being picked up late (Issue 2).

## Later / optional

- A readable **Status** sensor (Cleaning, Paused, Returning, Filling/Washing, Docked, Error), built in the bridge once the `sys_st` mapping is complete.
- Schedule-aware polling: poll fast around the start times in `GET_Schedule`.
- A slim image without Chromium for users with `browser_login: false`.
- Offer the fixes upstream, to the wrapper author especially, whose own RV2820VEUS has the same pause problem.

## Install and test (the user's side)

1. HA → Settings → Apps → App store → ⋮ → Repositories → add this fork's URL.
2. Install **Claude Shark2MQTT**.
3. **Stop the original Shark2MQTT** app. Never run both: they share entity IDs and MQTT command topics.
4. Get a **fresh** token from a new extension login (never reuse the original app's token) and paste it into `shark_token`. Until Phase 2.3 exists, use the manual fallback in `AUTH.md`.
5. Start the app and check the log for `Loaded cached tokens` and device discovery.
6. Check that the entity IDs are unchanged: dashboards, scripts, Assist and HomeKit should work as before.
7. Run the phase's device test plan: one command per "go", confirm by eye, restore the pre-test state.
8. **Rollback:** stop the fork, start the original.
