"""Tests for shark2mqtt/seed_token.py (the shark_token option)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "shark2mqtt" / "seed_token.py"
sys.path.insert(0, str(SCRIPT.parent))

import seed_token  # noqa: E402

REFRESH = "v1.MRrSYNTHETICrefreshTOKENvalue0123456789abcdef"
EXTENSION_JSON = json.dumps(
    {
        "auth0_refresh_token": REFRESH,
        "auth0_id_token": "eyJSYNTHETIC.id.token",
        "auth0_access_token": "eyJSYNTHETIC.access.token",
        "ayla_access_token": None,
        "ayla_refresh_token": None,
        "ayla_token_expiry": None,
        "saved_at": "2026-10-29T20:37:00.000Z",
    },
    indent=2,
)
SECRETS = (REFRESH, "eyJSYNTHETIC")


def run(data_dir: Path, value: str | None) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != seed_token.ENV_VAR}
    if value is not None:
        env[seed_token.ENV_VAR] = value
    return subprocess.run(
        [sys.executable, "-I", str(SCRIPT), str(data_dir)],
        env=env, capture_output=True, text=True,
    )


def token_file(data_dir: Path) -> dict:
    return json.loads((data_dir / seed_token.TOKEN_FILENAME).read_text())


def assert_no_secret_in(output: str) -> None:
    for secret in SECRETS:
        assert secret not in output


def test_first_seed_from_extension_json(tmp_path):
    result = run(tmp_path, EXTENSION_JSON)
    assert result.returncode == 0
    assert "Seeded a new Shark token" in result.stdout
    data = token_file(tmp_path)
    assert data["auth0_refresh_token"] == REFRESH
    assert data["auth0_id_token"] == "eyJSYNTHETIC.id.token"
    assert data["saved_at"] == "2026-10-29T20:37:00.000Z"
    assert set(data) == set(seed_token.TOKEN_FIELDS)
    assert (tmp_path / seed_token.TOKEN_FILENAME).stat().st_mode & 0o777 == 0o600


def test_json_pasted_on_one_line(tmp_path):
    # HA's password field drops line breaks.
    result = run(tmp_path, EXTENSION_JSON.replace("\n", ""))
    assert result.returncode == 0
    assert token_file(tmp_path)["auth0_refresh_token"] == REFRESH


def test_unchanged_value_does_not_overwrite_rotated_token(tmp_path):
    run(tmp_path, EXTENSION_JSON)
    # The bridge rotates the refresh token and saves it.
    rotated = token_file(tmp_path)
    rotated["auth0_refresh_token"] = "v1.ROTATEDsyntheticTOKEN0123456789"
    (tmp_path / seed_token.TOKEN_FILENAME).write_text(json.dumps(rotated))

    result = run(tmp_path, EXTENSION_JSON)
    assert result.returncode == 0
    assert "unchanged" in result.stdout
    assert token_file(tmp_path)["auth0_refresh_token"] == "v1.ROTATEDsyntheticTOKEN0123456789"


def test_same_token_reformatted_counts_as_unchanged(tmp_path):
    run(tmp_path, EXTENSION_JSON)
    result = run(tmp_path, "  " + EXTENSION_JSON.replace("\n", "") + "  ")
    assert "unchanged" in result.stdout


def test_new_value_is_seeded(tmp_path):
    run(tmp_path, EXTENSION_JSON)
    new_json = EXTENSION_JSON.replace(REFRESH, "v1.NEWsyntheticREFRESHtoken987654321")
    result = run(tmp_path, new_json)
    assert "Seeded a new Shark token" in result.stdout
    assert token_file(tmp_path)["auth0_refresh_token"] == "v1.NEWsyntheticREFRESHtoken987654321"


def test_bare_refresh_token(tmp_path):
    result = run(tmp_path, REFRESH)
    assert result.returncode == 0
    data = token_file(tmp_path)
    assert data["auth0_refresh_token"] == REFRESH
    for field in seed_token.TOKEN_FIELDS:
        if field not in ("auth0_refresh_token", "saved_at"):
            assert data[field] is None
    assert data["saved_at"]


@pytest.mark.parametrize(
    "bad",
    [
        '{"auth0_refresh_token": "' + REFRESH + '"',  # truncated JSON
        "[1, 2, 3]",
        '{"auth0_id_token": "eyJSYNTHETIC.id.token"}',  # no refresh token
        '{"auth0_refresh_token": ""}',
        "short",
        "two words " + REFRESH,
    ],
)
def test_invalid_value_keeps_existing_file(tmp_path, bad):
    run(tmp_path, EXTENSION_JSON)
    before = (tmp_path / seed_token.TOKEN_FILENAME).read_text()
    result = run(tmp_path, bad)
    assert result.returncode == 1
    assert "[WARN]" in result.stdout
    assert (tmp_path / seed_token.TOKEN_FILENAME).read_text() == before
    assert_no_secret_in(result.stdout + result.stderr)


def test_empty_option_does_nothing(tmp_path):
    for value in (None, "", "   "):
        result = run(tmp_path, value)
        assert result.returncode == 0
        assert "not set" in result.stdout
    assert not (tmp_path / seed_token.TOKEN_FILENAME).exists()


def test_no_token_value_is_ever_printed(tmp_path):
    outputs = [
        run(tmp_path, EXTENSION_JSON),
        run(tmp_path, EXTENSION_JSON),
        run(tmp_path, REFRESH),
        run(tmp_path, "{broken " + REFRESH),
    ]
    for result in outputs:
        assert_no_secret_in(result.stdout + result.stderr)


def test_token_file_loads_in_bridge_model(tmp_path):
    """Same field set as the bridge's TokenData, all strings or null."""
    run(tmp_path, EXTENSION_JSON)
    data = token_file(tmp_path)
    assert all(v is None or isinstance(v, str) for v in data.values())
