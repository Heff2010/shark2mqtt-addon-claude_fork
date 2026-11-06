# Claude Shark2MQTT — Home Assistant App Repository

[![Open your Home Assistant instance and show the app store.](https://my.home-assistant.io/badges/supervisor_store.svg)](https://my.home-assistant.io/redirect/supervisor_store/)

This repository hosts **Claude Shark2MQTT**, a Home Assistant app (called an
add-on in older Home Assistant versions) that bridges SharkNinja robot vacuums
to Home Assistant through MQTT.

> **This is a fork.** It is based on
> [400HPMustang/shark2mqtt-addon](https://github.com/400HPMustang/shark2mqtt-addon),
> which wraps [CamSoper/shark2mqtt](https://github.com/CamSoper/shark2mqtt).
> This fork runs a modified bridge,
> [Heff2010/shark2mqtt-claude_fork](https://github.com/Heff2010/shark2mqtt-claude_fork),
> instead of the original one.

---

## What this fork is, and why

The original app works on many Shark models, but on a Shark **UR2850ZEUS**
(vacuum + mop with a self-empty, self-fill dock) several things were wrong, and
the built-in Shark login kept failing. This fork fixes those:

- **Pause works.** The UR2850 ignores the standard pause command. A
  **Pause command value** option lets you send `0` instead, which pauses it.
- **Correct status.** Paused, Returning and Docked now show correctly. While
  the robot empties its bin at the dock in the middle of a job it shows Docked,
  and runs started from the Shark app or a Shark schedule show as Cleaning.
- **Faster updates** as soon as a clean job starts, plus two new diagnostic
  entities, **System Status Code** and **Job Active**.
- **Token login.** You log in to Shark yourself in Firefox with the included
  [Shark Token Saver](tools/firefox-token-saver) extension and paste the token
  into the app. The app's automated browser login is off by default, because it
  fails on many setups and repeated failures can lock your Shark account.
- **Side by side mode**, so this app can run next to the original Shark2MQTT
  app while you try it, with its own entities.
- **Log saving.** The log is also written to one file per day in Home
  Assistant's `share` folder, so it is still there after a restart.

The status fixes only switch on for robots that report the data they rely on,
so other Shark models should behave as they do with the original app.

---

## Installation

1. In Home Assistant, go to **Settings → Apps → App store** (**Settings →
   Add-ons → Add-on Store** in older versions).
2. Click the three-dot menu (⋮) in the top-right and choose **Repositories**.
3. Add this repository URL:
   ```
   https://github.com/Heff2010/shark2mqtt-addon-claude_fork
   ```
4. Find **Claude Shark2MQTT** in the store, click **Install**, then follow
   [the app's documentation](shark2mqtt/DOCS.md) to set it up.

> **Prerequisites:** You need the **Mosquitto** MQTT broker app (or another
> MQTT broker) and the **MQTT integration** set up in Home Assistant first.

The app downloads its bridge from this fork's own image,
`ghcr.io/heff2010/shark2mqtt`, which is published in GitHub's container
registry. It never pulls the original image.

---

## Apps in this repository

### Claude Shark2MQTT

See [shark2mqtt/DOCS.md](shark2mqtt/DOCS.md) for setup and options, and
[shark2mqtt/CHANGELOG.md](shark2mqtt/CHANGELOG.md) for what changed in each
version.

---

## Problems and support

Report problems with this fork on
[this repository's issues](https://github.com/Heff2010/shark2mqtt-addon-claude_fork/issues),
not on the original projects, since they don't include these changes.

---

## Credits

Almost all of the work is by others:

- [Cam Soper](https://github.com/CamSoper) wrote
  [shark2mqtt](https://github.com/CamSoper/shark2mqtt), the bridge itself
  (MIT licence).
- [@400HPMustang](https://github.com/400HPMustang) wrote the original
  [Home Assistant add-on](https://github.com/400HPMustang/shark2mqtt-addon)
  that this repository is forked from.

This fork adds the UR2850ZEUS fixes, the token login and the app changes
listed above.
