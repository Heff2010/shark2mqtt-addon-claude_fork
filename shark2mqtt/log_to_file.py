"""Copy the app's log to one file per day, and pass it through unchanged.

run.sh sends its own output and the bridge's through this script. Every line
goes to stdout (so the Home Assistant log view keeps working) and is appended
to <log_dir>/YYYY-MM-DD.log, named by the local date. Files older than
<keep_days> days are deleted at start-up and whenever the date changes.

A problem with the log folder never stops the app: the line still reaches
stdout and the file copy is skipped, with one warning.

Usage: log_to_file.py <log_dir> <keep_days>
"""

from __future__ import annotations

import signal
import sys
import time
from pathlib import Path
from typing import BinaryIO, Callable

PREFIX = "[log_to_file]"


def _warn(out: BinaryIO, message: str) -> None:
    try:
        out.write(f"[WARN] {PREFIX} {message}\n".encode())
        out.flush()
    except OSError:
        pass


def prune(log_dir: Path, keep_days: int, today: time.struct_time) -> None:
    """Delete YYYY-MM-DD.log files dated more than keep_days days before today."""
    cutoff = time.mktime(
        (today.tm_year, today.tm_mon, today.tm_mday - keep_days, 0, 0, 0, 0, 0, -1)
    )
    for path in log_dir.glob("????-??-??.log"):
        try:
            day = time.mktime(time.strptime(path.stem, "%Y-%m-%d"))
        except ValueError:
            continue
        if day < cutoff:
            path.unlink(missing_ok=True)


def run(
    log_dir: Path,
    keep_days: int,
    src: BinaryIO,
    out: BinaryIO,
    now: Callable[[], time.struct_time] = time.localtime,
) -> None:
    current_day = ""
    handle = None
    file_ok = True
    while True:
        line = src.readline()
        if not line:
            break
        try:
            out.write(line)
            out.flush()
        except OSError:
            pass
        if not file_ok:
            continue
        try:
            stamp = now()
            day = time.strftime("%Y-%m-%d", stamp)
            if day != current_day:
                if handle is not None:
                    handle.close()
                log_dir.mkdir(parents=True, exist_ok=True)
                prune(log_dir, keep_days, stamp)
                handle = open(log_dir / f"{day}.log", "ab")
                current_day = day
            handle.write(line)
            handle.flush()
        except OSError as err:
            file_ok = False
            _warn(out, f"can't write to {log_dir} ({err.strerror}); log files are off until the app restarts.")
    if handle is not None:
        handle.close()


def main() -> int:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <log_dir> <keep_days>", file=sys.stderr)
        return 2
    # Keep copying until the app's output closes, so the last lines of a
    # shutdown still reach the file.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    log_dir = Path(sys.argv[1])
    keep_days = max(1, int(sys.argv[2]))
    run(log_dir, keep_days, sys.stdin.buffer, sys.stdout.buffer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
