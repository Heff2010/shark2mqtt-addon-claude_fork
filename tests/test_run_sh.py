"""Run shark2mqtt/run.sh with stubs to check how options become settings.

The real script reads /data/options.json and starts Xvfb and the bridge.
Here /data points at a temp folder, Xvfb is a no-op and the bridge start is
replaced by a dump of its environment.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent / "shark2mqtt"
REFRESH = "v1.SYNTHETICrunShTestRefreshToken0123456789"

BASE_OPTIONS = {
    "shark_token": "",
    "browser_login": False,
    "shark_username": "",
    "shark_password": "",
    "shark_region": "us",
    "shark_household_id": "",
    "use_supervisor_mqtt_service": False,
    "mqtt_host": "core-mosquitto",
    "mqtt_port": 1883,
    "mqtt_username": "",
    "mqtt_password": "",
    "mqtt_prefix": "shark2mqtt",
    "run_side_by_side": True,
    "poll_interval": 300,
    "poll_interval_active": 20,
    "pause_operating_mode": "1",
    "log_level": "DEBUG",
}

pytestmark = pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")


def run_wrapper(tmp_path: Path, **overrides) -> tuple[subprocess.CompletedProcess, dict]:
    data = tmp_path / "data"
    data.mkdir(exist_ok=True)
    (data / "options.json").write_text(json.dumps({**BASE_OPTIONS, **overrides}))
    env_dump = tmp_path / "bridge_env.txt"
    script = (ROOT / "run.sh").read_text()
    script = (
        script.replace('"/data', f'"{data}')
        .replace("/seed_token.py", str(ROOT / "seed_token.py"))
        .replace("Xvfb :99", "true :99")
        .replace("/tmp/.X11-unix", str(tmp_path / "x11"))
        .replace("/tmp/.X99-lock", str(tmp_path / "x99-lock"))
        .replace('python -m src.main "$@"', f'env > "{env_dump}"')
    )
    stub = tmp_path / "run.sh"
    stub.write_text(script)
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
    result = subprocess.run(["bash", str(stub)], env=env, capture_output=True, text=True)
    bridge_env = {}
    if env_dump.exists():
        for line in env_dump.read_text().splitlines():
            key, _, value = line.partition("=")
            bridge_env[key] = value
    return result, bridge_env


def test_defaults_side_by_side_token_only(tmp_path):
    result, env = run_wrapper(tmp_path, shark_token=REFRESH)
    assert result.returncode == 0, result.stdout + result.stderr
    assert env["MQTT_PREFIX"] == "claude_shark2mqtt"
    assert env["ENTITY_ID_PREFIX"] == "claude"
    assert env["BROWSER_LOGIN"] == "false"
    assert env["PAUSE_OPERATING_MODE"] == "1"
    assert env["TOKEN_DIR"] == str(tmp_path / "data")
    # Blank credentials are fine without browser login.
    assert env["SHARK_USERNAME"] and env["SHARK_PASSWORD"]
    saved = json.loads((tmp_path / "data" / "shark2mqtt_tokens.json").read_text())
    assert saved["auth0_refresh_token"] == REFRESH
    assert REFRESH not in result.stdout + result.stderr


def test_side_by_side_off_uses_original_ids(tmp_path):
    result, env = run_wrapper(tmp_path, run_side_by_side=False, mqtt_prefix="shark2mqtt")
    assert result.returncode == 0, result.stdout + result.stderr
    assert env["MQTT_PREFIX"] == "shark2mqtt"
    assert "ENTITY_ID_PREFIX" not in env


def test_pause_zero_passed_through(tmp_path):
    _, env = run_wrapper(tmp_path, pause_operating_mode="0")
    assert env["PAUSE_OPERATING_MODE"] == "0"


def test_browser_login_needs_credentials(tmp_path):
    result, env = run_wrapper(tmp_path, browser_login=True)
    assert result.returncode != 0
    assert "shark_username is required when browser_login is on" in result.stderr
    assert env == {}


def test_browser_login_with_credentials(tmp_path):
    result, env = run_wrapper(
        tmp_path, browser_login=True,
        shark_username="user@example.com", shark_password="synthetic-pass",
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert env["BROWSER_LOGIN"] == "true"
    assert env["SHARK_USERNAME"] == "user@example.com"
    assert "synthetic-pass" not in result.stdout + result.stderr


def test_missing_token_warns_but_starts(tmp_path):
    result, env = run_wrapper(tmp_path)
    assert result.returncode == 0
    assert "No Shark token yet" in result.stderr
    assert env


def test_bad_token_warns_and_keeps_existing_file(tmp_path):
    run_wrapper(tmp_path, shark_token=REFRESH)
    before = (tmp_path / "data" / "shark2mqtt_tokens.json").read_text()
    result, env = run_wrapper(tmp_path, shark_token="{not json")
    assert result.returncode == 0
    assert "shark_token could not be used" in result.stderr
    assert (tmp_path / "data" / "shark2mqtt_tokens.json").read_text() == before
    assert env
