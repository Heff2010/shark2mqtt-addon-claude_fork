# Device findings: UR2850ZEUS on Shark2MQTT

Observations from testing on 2026-10-29 → 2026-11-04 with the bridge at DEBUG logging. Every finding comes from the bridge's per-poll "Shadow values" dump (the cloud shadow's `reported` properties) plus what the user saw the robot do.

Sanitized: no serials, account/household/floor IDs, IPs or personal room names.

## Setup

- Robot: UR2850ZEUS (vacuum + mop, self-empty / self-fill dock), US region.
- Backend: Skegox ("Using skegox API, skipping Ayla"). Ayla data for this robot is stale (all zeros), so falling back to Ayla wouldn't help.
- Polling: 300 s while HA shows "docked", 20 s otherwise. Any command sent from HA forces an early poll, and changes show up within ~5 s.
- Six rooms on the map. Shark-app schedules: a daily dry clean of all rooms, and twice-weekly wet cleans.

## The issues

### 1. Stale data during a scheduled run (seen once)
- During one scheduled dry run the cloud reported, the whole time the robot was out: `DockedStatus=true`, `Charging_Status=true`, `Operating_Mode=3` (RETURN), `MissionComplete=true`.
- The bridge computes `is_docked = DockedStatus or is_charging`, then docked + mode in (STOP, RETURN) → `"docked"`. So HA showed "docked" for the entire run.
- Fields that **did** change correctly during that run: `AreasToClean_V3` (job set with `"trigger":"schedule"`, cleared to `"*"` after docking), `sys_st`, `CleanStage`, `LocalizationStatus`.
- Runs started from HA and from the Shark app reported live, correct data.
- Still unknown: whether every scheduled run goes stale, or this was a one-off. The robot's Wi-Fi is weak at the dock (≈ -74 dBm), which may contribute.

### 2. Slow polling misses run starts (main day-to-day problem)
- Fast polling starts only when `ha_state != "docked"`.
- Starts from the Shark app or Shark schedule send nothing to the bridge, so HA notices them 0–5 min late (≈ 2.5 min on average). One scheduled wet clean was missed entirely: the user cancelled it before the next poll.
- An HA-started mop run was also missed: the early poll caught the robot still filling its tank on the dock (reported docked), so polling fell back to 300 s.

### 3. Pause from HA is ignored
- `vacuum.pause` → bridge sends `Operating_Mode=1` via Skegox, with no error returned. The robot ignored it and stayed in mode 7 (MOP), `sys_st` 6.
- A robot paused from the Shark app, or by being lifted, reports `Operating_Mode=0`, `sys_st=4`, with the job kept. So 0 *may* be this model's pause value. **Unconfirmed:** 0 is STOP on other models and might cancel the run. Test only with the user's explicit OK, mid-run.
- Working today: pause in the Shark app (or lift the robot), then HA `vacuum.start` resumes **the same job**. Confirmed for a dry job. **Untested for a wet job:** HA start sends mode 2 (dry start), so a paused mop job might resume as a vacuum.
- Same symptom upstream: shark2mqtt's CONFIRMED_MODELS lists RV2820VEUS with "Pause command not honored by vacuum".

### 4. Paused shows as "idle"
- While paused (app pause or lifted), the cloud reports `Operating_Mode=0`, `sys_st=4` and keeps the job. HA shows `idle`, with attribute `operating_mode: unknown`.
- Two causes:
  - **"unknown" (code bug, affects every model):** `to_attributes_payload()` uses `self.operating_mode.name if self.operating_mode else "unknown"`. `OperatingMode.STOP == 0` is falsy, so STOP always shows "unknown". Fix: `is not None`. CONFIRMED_MODELS also lists RV2910XEUS with "State stays Idle / operating_mode: unknown during active cleaning", which may be related.
  - **"idle":** STOP while not docked maps to `idle` in `OPERATING_MODE_TO_HA_STATE`.

### 5. Reliable fields aren't exposed
- `AreasToClean_V3`: set while a job exists (including while paused), and reset to `"*"` when the job ends (normal finish, cancel or error). It includes the clean type (dry/wet) and the trigger (e.g. schedule). **This is the most reliable "active job" signal found.**
- `sys_st` (inside `Operating_Mode_Ex`): tracks the robot well. See the table below.

## sys_st values observed

| sys_st | Meaning |
|---|---|
| 4 | Paused (app pause, or robot lifted) |
| 5 | Stopped by error (seen with error 9 "No dustbin") |
| 6 | Cleaning (dry and wet) |
| 7 | Returning to dock (after a finish, and after HA `return_to_base`) |
| 13 | Docked, no job |
| 32 | Dock activity: filling before a run, washing / emptying after a mop run. **Not** "job assigned" (also seen with no job). |

Still needed: mid-job recharge, bin emptying mid-job, and `sys_st` during a stale scheduled run (the one stale run showed 32 while out; re-check).

## Other fields

- **DockedStatus is unreliable in both directions:** true while out cleaning on the stale run; false while sitting on the dock after a mop run.
- **Warning_Code** (meanings undocumented): 67 is normal (docked and cleaning); 43 and 8 were seen out on or after runs; 29 only while the robot was lifted (probably "lifted / wheels off floor", inferred).
- Error 9 "No dustbin" was genuine (bin not seated).

## Behaviour confirmed working

- HA `vacuum.start` resumes a paused (dry) job.
- HA `return_to_base` works and cancels the current job (sys_st 7, then the job resets to `"*"`).
- `send_command` `clean_rooms` with `params: {rooms: [...], clean_type: wet}` starts a mop run (the dock says the water tank is being filled). `clean_type` is undocumented upstream but works.
- An early poll after any HA command.

## Proposed state rules (for robots that report both `Operating_Mode_Ex.sys_st` and `AreasToClean_V3`)

| Job active (`AreasToClean_V3` ≠ `"*"`) | sys_st | HA state |
|---|---|---|
| any | error code ≠ 0 (sys_st 5) | `error` |
| yes | 4 | `paused` |
| yes | 7 | `returning` |
| yes | 6, 32 or anything else | `cleaning` |
| no | 7 | `returning` |
| no | 13 or 32 | `docked` |
| no | anything else | fall back to today's logic |

- These rules ignore `DockedStatus`, `Charging_Status` and `Operating_Mode` for the state.
- They would have shown the stale scheduled run as `cleaning`, because the job field was live.
- Dock activity during a job shows as `cleaning`, since HA has no state for it. A separate readable Status sensor (later) can show "Filling" or "Washing".
- **Polling:** count `job active` as active, so 20 s polling starts as soon as a job exists, including while the robot prepares on the dock.
- **Gate:** use these rules only when both fields are present. Robots without them keep today's behaviour.
- **Still to confirm:** whether `AreasToClean_V3` stays set while returning after a *normal* finish. That decides whether the "returning" row needs the job check.

## How the user's HA uses the vacuum (compatibility constraints)

- Scripts:
  - Whole-house vacuum: set `select.sharkvac_clean_mode` = Normal, then `vacuum.start`.
  - Whole-house mop: set Normal, then `vacuum.send_command` `clean_rooms` with `clean_type: wet` and five of the six rooms.
- Wall display: one tile when docked (no start button); another when `state_not: docked`, which adds start_pause. Working pause and correct `paused` / `docked` states matter here.
- `vacuum.sharkvac` is exposed to Assist; HomeKit also uses it.
- Per-room buttons exist but aren't used on cards.

## Data the session should ask the user for

- Sanitized "Shadow values" DEBUG lines in these states: docked idle, cleaning (dry), cleaning (wet), paused, returning, dock activity, error. These give the exact formats of `Operating_Mode_Ex` and `AreasToClean_V3` for fixtures. Ask the user to remove serials, IDs, URLs and room names, or replace them with placeholders.
