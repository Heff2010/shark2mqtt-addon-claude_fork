"""Tests for shark2mqtt/log_to_file.py (daily log files with retention)."""

from __future__ import annotations

import importlib.util
import io
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "shark2mqtt"
spec = importlib.util.spec_from_file_location("log_to_file", ROOT / "log_to_file.py")
log_to_file = importlib.util.module_from_spec(spec)
spec.loader.exec_module(log_to_file)


def day(text: str) -> time.struct_time:
    return time.strptime(text + " 12:00", "%Y-%m-%d %H:%M")


def clock(*days: str):
    stamps = iter(day(d) for d in days)
    return lambda: next(stamps)


def test_lines_pass_through_and_land_in_dated_files(tmp_path):
    src = io.BytesIO(b"one\ntwo\nthree\n")
    out = io.BytesIO()
    log_to_file.run(tmp_path, 14, src, out, now=clock("2026-11-05", "2026-11-05", "2026-11-06"))
    assert out.getvalue() == b"one\ntwo\nthree\n"
    assert (tmp_path / "2026-11-05.log").read_bytes() == b"one\ntwo\n"
    assert (tmp_path / "2026-11-06.log").read_bytes() == b"three\n"


def test_appends_to_an_existing_file(tmp_path):
    (tmp_path / "2026-11-05.log").write_bytes(b"before restart\n")
    log_to_file.run(tmp_path, 14, io.BytesIO(b"after\n"), io.BytesIO(), now=clock("2026-11-05"))
    assert (tmp_path / "2026-11-05.log").read_bytes() == b"before restart\nafter\n"


def test_old_files_are_pruned_and_others_left_alone(tmp_path):
    for name in ("2026-10-20.log", "2026-10-22.log", "2026-10-23.log", "notes.txt", "bad-name.log"):
        (tmp_path / name).write_text("x")
    log_to_file.run(tmp_path, 14, io.BytesIO(b"line\n"), io.BytesIO(), now=clock("2026-11-05"))
    left = sorted(p.name for p in tmp_path.iterdir())
    # 14 days before 2026-11-05 is 2026-10-22: that day is kept, older ones go.
    assert left == ["2026-10-22.log", "2026-10-23.log", "2026-11-05.log", "bad-name.log", "notes.txt"]


def test_prune_runs_again_when_the_day_changes(tmp_path):
    (tmp_path / "2026-11-01.log").write_text("x")
    log_to_file.run(tmp_path, 3, io.BytesIO(b"a\nb\n"), io.BytesIO(), now=clock("2026-11-04", "2026-11-05"))
    assert not (tmp_path / "2026-11-01.log").exists()
    assert (tmp_path / "2026-11-04.log").exists()


def test_unwritable_folder_never_blocks_the_log(tmp_path):
    blocker = tmp_path / "logs"
    blocker.write_text("a file where the folder should be")
    out = io.BytesIO()
    log_to_file.run(blocker, 14, io.BytesIO(b"one\ntwo\n"), out, now=clock("2026-11-05", "2026-11-05"))
    text = out.getvalue().decode()
    assert "one\n" in text and "two\n" in text
    assert text.count("[WARN] [log_to_file]") == 1
