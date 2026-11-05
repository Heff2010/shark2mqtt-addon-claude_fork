"""Seed the bridge's token file from the app's shark_token option, once.

Run by run.sh before the bridge starts:

    SHARK_TOKEN_OPTION="<option value>" python3 -I /seed_token.py /data

The option value is read from the environment, never from the command line,
so it doesn't show up in process listings.

Rules (see docs/dev/AUTH.md):
- Seed only when the option is set AND differs from what was last seeded.
  The bridge rotates the refresh token and saves the new one; rewriting the
  file from the option on every start would bring back a dead token.
- Accept the token saver extension's JSON, or a bare refresh token.
- Never print a token value. Only "seeded" / "unchanged" style messages.

Exit codes: 0 = nothing to do, seeded, or unchanged; 1 = option is unusable
(the existing token file, if any, is left alone).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

TOKEN_FILENAME = "shark2mqtt_tokens.json"
HASH_FILENAME = ".seeded_token.sha256"
ENV_VAR = "SHARK_TOKEN_OPTION"

# Must match the bridge's TokenData model (src/shark_auth.py).
TOKEN_FIELDS = (
    "auth0_refresh_token",
    "auth0_id_token",
    "auth0_access_token",
    "ayla_access_token",
    "ayla_refresh_token",
    "ayla_token_expiry",
    "saved_at",
)


class TokenOptionError(ValueError):
    """The option value can't be turned into a token file."""


def log(level: str, message: str) -> None:
    print(f"[{level}] {message}", flush=True)


def parse_option(raw: str) -> dict[str, str | None]:
    """Turn the option value into a TokenData-shaped dict.

    Error messages never include the value itself.
    """
    value = raw.strip()
    if value.startswith("{"):
        try:
            data = json.loads(value)
        except ValueError:
            raise TokenOptionError(
                "shark_token looks like JSON but isn't valid. Copy it again "
                "with the token saver's Copy token button."
            ) from None
        if not isinstance(data, dict):
            raise TokenOptionError("shark_token JSON must be an object.")
        refresh = data.get("auth0_refresh_token")
        if not isinstance(refresh, str) or not refresh.strip():
            raise TokenOptionError(
                "shark_token JSON has no auth0_refresh_token."
            )
        tokens: dict[str, str | None] = {}
        for field in TOKEN_FIELDS:
            v = data.get(field)
            tokens[field] = v if isinstance(v, str) else None
        tokens["auth0_refresh_token"] = refresh.strip()
        return tokens

    if not value or any(c.isspace() for c in value) or len(value) < 20:
        raise TokenOptionError(
            "shark_token is neither the token saver's JSON nor a refresh "
            "token (expected one unbroken string of at least 20 characters)."
        )
    tokens = {field: None for field in TOKEN_FIELDS}
    tokens["auth0_refresh_token"] = value
    return tokens


def fingerprint(tokens: dict[str, str | None]) -> str:
    """Hash of the refresh token: same token re-pasted counts as unchanged."""
    refresh = tokens["auth0_refresh_token"] or ""
    return hashlib.sha256(refresh.encode()).hexdigest()


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def seed(raw: str | None, data_dir: Path) -> str:
    """Seed if needed. Returns "none", "unchanged" or "seeded"."""
    if raw is None or not raw.strip():
        return "none"
    tokens = parse_option(raw)
    digest = fingerprint(tokens)
    hash_path = data_dir / HASH_FILENAME
    try:
        if hash_path.read_text().strip() == digest:
            return "unchanged"
    except FileNotFoundError:
        pass

    if not tokens["saved_at"]:
        tokens["saved_at"] = datetime.now(timezone.utc).isoformat()
    data_dir.mkdir(parents=True, exist_ok=True)
    _atomic_write(data_dir / TOKEN_FILENAME, json.dumps(tokens, indent=2))
    # Record the fingerprint only after the token file is in place, so a
    # failed write is retried on the next start.
    _atomic_write(hash_path, digest + "\n")
    return "seeded"


def main(argv: list[str]) -> int:
    data_dir = Path(argv[1]) if len(argv) > 1 else Path("/data")
    try:
        result = seed(os.environ.get(ENV_VAR), data_dir)
    except TokenOptionError as e:
        log("WARN", f"{e} Keeping the existing token file, if any.")
        return 1
    if result == "none":
        log("INFO", "shark_token not set; using the saved token file, if any.")
    elif result == "unchanged":
        log("INFO", "shark_token unchanged since it was last seeded; not touching the token file.")
    else:
        log("INFO", "Seeded a new Shark token from the shark_token option.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
