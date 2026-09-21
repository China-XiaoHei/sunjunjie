#!/usr/bin/env python3
"""Run only question B3 from the shared robot transform implementation."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "公共"))

import robot_b_questions as robot  # noqa: E402


if __name__ == "__main__":
    print(robot.run_b3())
