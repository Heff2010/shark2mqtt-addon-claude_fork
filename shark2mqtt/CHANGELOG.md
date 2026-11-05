# Changelog

## 1.0.8-claude.3

- **Save log to files** (new, on by default): the log is also written to one
  file per day in `share/claude_shark2mqtt/logs`, so it outlives the Home
  Assistant log view. Files older than **Days of log files to keep** (14 by
  default) are deleted automatically.
- Corrected the example entity IDs in the docs and the log: side by side
  entities are named like `vacuum.sharkvac_claude`.

## 1.0.8-claude.2

Bridge image: `ghcr.io/heff2010/shark2mqtt:1.5.5-claude.3`

- Shows **Docked** instead of Cleaning while the robot empties its bin at the
  dock in the middle of a job. The job stays active, so fast polling continues.

## 1.0.8-claude.1

First release of Claude Shark2MQTT. Bridge image:
`ghcr.io/heff2010/shark2mqtt:1.5.5-claude.2`

- **Own app identity**, so it installs alongside the original Shark2MQTT app.
- **Side by side mode** (on by default): separate MQTT topics and entity IDs
  prefixed with `claude`, so both apps can run at once without clashing.
- **Shark token option**: paste a token from the Firefox token saver instead of
  using the browser login. The browser login is off by default.
- **Pause command value** option (1 or 0). The UR2850 needs 0 to pause.
- **More accurate status** on robots that report a system status code and a
  cleaning job (such as the UR2850): Paused, Returning and Docked are shown
  correctly, and a scheduled run that the cloud reports as docked shows as
  Cleaning.
- New **System Status Code** and **Job Active** entities on those robots.
- **Stop** no longer crashes when the robot's mode is unknown.
