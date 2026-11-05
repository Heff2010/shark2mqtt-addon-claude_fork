# Claude Shark2MQTT

A modified version of the Shark2MQTT app. It bridges SharkNinja robot vacuums to Home Assistant through MQTT, using a modified [shark2mqtt bridge](https://github.com/Heff2010/shark2mqtt-claude_fork) with:

- Correct **paused**, **docked** and **cleaning** states on models that report a clean job (tested on a UR2850ZEUS), including runs started from the Shark app or a Shark schedule.
- Faster status updates as soon as a clean job exists.
- New diagnostic entities: **System Status Code** and **Job Active**.
- A **Shark token** option, so you can log in to Shark in your own browser instead of the app's automated login.
- A configurable **pause** value for models that ignore the standard one.
- A **Run side by side** mode, so it can run at the same time as the original Shark2MQTT app.

## First-time setup

1. Install the **Shark Token Saver** Firefox extension from this repository's `tools/firefox-token-saver` folder (see its README) and log in to Shark with it. Click **Copy token** on the result page.
   - Do a **fresh login** for this app. Don't reuse the original app's token file.
2. In this app's **Configuration** tab, paste the token into **Shark token** and click **Save**.
3. Leave **Run side by side** on if the original Shark2MQTT app is still running.
4. Start the app and open the **Log** tab. Look for `Seeded a new Shark token`, then `Loaded cached tokens` and the robot being discovered.

## Running beside the original app

With **Run side by side** on, this app:

- uses MQTT topics under `claude_shark2mqtt/` (the original uses `shark2mqtt/`), so commands never reach both apps;
- creates its own device, **SharkVac (claude)**, with entities such as `vacuum.claude_sharkvac` and `select.claude_sharkvac_clean_mode`.

Your dashboards, scripts, Assist and HomeKit keep using the original entities. Both apps control the same robot, so a command from either one moves it.

### Switching over for good

1. Stop the original Shark2MQTT app (and disable its **Start on boot**).
2. In this app, turn **Run side by side** off, save and restart.
3. This app now uses the original entity IDs (`vacuum.sharkvac` and so on), so nothing else needs changing.

**Going back:** stop this app and start the original.

## When the token stops working

If the log says `Shark login needed`, do a new login with the Token Saver extension, paste the new token into **Shark token**, save and restart. The app only writes a token when it differs from the last one you pasted, so leaving the old value in place is harmless.

## Other options

- **Automated browser login**: off by default. When on, the app may try its own browser login with your Shark email and password. That fails on many setups, and repeated failures can lock your Shark account.
- **Pause command value**: `1` (default) or `0`. Some models ignore `1` for pause. `0` may work instead, but on some models it means stop, so test it while watching the robot.
- **MQTT**: by default the app gets the broker details from Home Assistant (recommended with the Mosquitto app). Turn off **Use Home Assistant's MQTT service** to enter them yourself.
- **Poll interval / Active poll interval**: how often the Shark cloud is asked for status, idle (300 s) and while cleaning or a job exists (20 s).
- **Log level**: `DEBUG` shows the robot's raw values each poll, which helps when reporting a problem.
