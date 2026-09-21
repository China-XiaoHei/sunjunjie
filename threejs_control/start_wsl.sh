#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8080}"
PID_FILE="${ROOT}/a1-server.pid"
LOG_FILE="${ROOT}/a1-server.log"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it in WSL before starting A1." >&2
  exit 1
fi

if [[ ! -f "${ROOT}/node_modules/three/build/three.module.js" ]]; then
  echo "Three.js dependency is missing. Run 'npm install' in ${ROOT} first." >&2
  exit 1
fi

if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(cat "${PID_FILE}")"
  if kill -0 "${existing_pid}" 2>/dev/null; then
    echo "A1 server is already running with PID ${existing_pid}."
    echo "Open http://localhost:${PORT}/"
    exit 0
  fi
  rm -f "${PID_FILE}"
fi

if command -v ss >/dev/null 2>&1 \
  && ss -ltnH "sport = :${PORT}" 2>/dev/null | grep -q .; then
  echo "Port ${PORT} is already in use by another process." >&2
  echo "Run: ss -ltnp | grep ':${PORT}'" >&2
  echo "Stop that process or start with another port, for example PORT=8090 ./start_wsl.sh" >&2
  exit 1
fi

nohup node "${ROOT}/server.js" --host "${HOST}" --port "${PORT}" \
  >"${LOG_FILE}" 2>&1 &
server_pid=$!
echo "${server_pid}" >"${PID_FILE}"

for _ in {1..30}; do
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    rm -f "${PID_FILE}"
    echo "A1 server exited during startup. Check ${LOG_FILE}." >&2
    tail -n 20 "${LOG_FILE}" >&2 || true
    exit 1
  fi
  if curl --silent --fail "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "A1 server started with PID ${server_pid}."
    echo "Open http://localhost:${PORT}/"
    echo "Log: ${LOG_FILE}"
    exit 0
  fi
  sleep 0.2
done

kill "${server_pid}" 2>/dev/null || true
rm -f "${PID_FILE}"
echo "A1 server did not become ready. Check ${LOG_FILE}." >&2
exit 1
