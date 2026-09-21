#!/usr/bin/env python3
"""Send the A1 waypoint route to the Node control service over HTTP."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parent
PATH_FILE = ROOT / "path.json"


def request_json(url: str, method: str = "GET", payload: Optional[dict] = None) -> dict:
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_service(base_url: str, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            result = request_json(f"{base_url}/api/health")
            if result.get("ok"):
                return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.2)
    raise RuntimeError(f"Service was not ready within {timeout_seconds:.1f} seconds: {base_url}")


def wait_until_reached(base_url: str, path_index: int, timeout_seconds: float) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        state_payload = request_json(f"{base_url}/api/state")
        state = state_payload["state"]
        if (
            not state["moving"]
            and state["currentPathIndex"] == path_index
        ):
            return state
        time.sleep(0.05)
    raise RuntimeError(f"Timed out while waiting for waypoint P{path_index}.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Drive the Three.js cube through the configured path.")
    parser.add_argument("--host", default="127.0.0.1", help="A1 server host. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8080, help="A1 server port. Default: 8080")
    parser.add_argument("--speed", type=float, default=0.35, help="Movement speed in m/s.")
    parser.add_argument("--repeat", type=int, default=1, help="Number of route repetitions.")
    parser.add_argument("--timeout", type=float, default=30.0, help="Timeout per waypoint in seconds.")
    args = parser.parse_args()

    if args.speed <= 0:
        parser.error("--speed must be greater than zero.")
    if args.repeat <= 0:
        parser.error("--repeat must be greater than zero.")

    with PATH_FILE.open("r", encoding="utf-8") as path_file:
        path_definition = json.load(path_file)
    points = path_definition["points"]
    if len(points) < 2:
        raise RuntimeError("path.json must contain at least two points.")

    base_url = f"http://{args.host}:{args.port}"
    wait_for_service(base_url, args.timeout)
    request_json(f"{base_url}/api/reset", method="POST", payload={})
    print(f"Connected to {base_url}. Starting route at P0.")

    for round_number in range(1, args.repeat + 1):
        for point in points[1:]:
            path_index = int(point["index"])
            command_id = f"controller-r{round_number}-p{path_index}"
            command = {
                "type": "move",
                "pathIndex": path_index,
                "target": {
                    "x": point["x"],
                    "y": point["y"],
                    "z": point["z"],
                },
                "speed": args.speed,
                "commandId": command_id,
            }
            request_json(f"{base_url}/api/control", method="POST", payload=command)
            final_state = wait_until_reached(base_url, path_index, args.timeout)
            print(
                f"Reached {point['name']} at "
                f"({final_state['position']['x']:.6f}, "
                f"{final_state['position']['y']:.6f}, "
                f"{final_state['position']['z']:.6f})"
            )

        if args.repeat > 1:
            command_id = f"controller-r{round_number}-p0"
            request_json(
                f"{base_url}/api/control",
                method="POST",
                payload={
                    "type": "move",
                    "pathIndex": 0,
                    "target": {
                        "x": points[0]["x"],
                        "y": points[0]["y"],
                        "z": points[0]["z"],
                    },
                    "speed": args.speed,
                    "commandId": command_id,
                },
            )
            final_state = wait_until_reached(base_url, 0, args.timeout)
            print(
                f"Reached P0 at "
                f"({final_state['position']['x']:.6f}, "
                f"{final_state['position']['y']:.6f}, "
                f"{final_state['position']['z']:.6f})"
            )

    print("Route completed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, urllib.error.URLError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
