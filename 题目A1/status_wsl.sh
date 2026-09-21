#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${ROOT}/a1-server.pid"
PORT="${PORT:-8080}"

if [[ -f "${PID_FILE}" ]]; then
  server_pid="$(cat "${PID_FILE}")"
  if kill -0 "${server_pid}" 2>/dev/null; then
    echo "A1 server is running. PID=${server_pid}, PORT=${PORT}"
    curl --silent "http://127.0.0.1:${PORT}/api/health"
    echo
    exit 0
  fi
fi

echo "A1 server is not running."
exit 1
