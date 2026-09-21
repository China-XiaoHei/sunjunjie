#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${ROOT}/a1-server.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "A1 server is not running according to ${PID_FILE}."
  exit 0
fi

server_pid="$(cat "${PID_FILE}")"
if kill -0 "${server_pid}" 2>/dev/null; then
  kill "${server_pid}"
  for _ in {1..20}; do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  echo "Stopped A1 server PID ${server_pid}."
else
  echo "A1 server PID ${server_pid} was not active."
fi
rm -f "${PID_FILE}"
