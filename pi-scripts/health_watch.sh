#!/usr/bin/env bash
set -euo pipefail

HOST="${PI_BIND_HOST:-127.0.0.1}"
PORT="${PI_BIND_PORT:-8000}"
URL="http://${HOST}:${PORT}/health"

if curl -fsS "$URL" >/dev/null; then
  echo "Printer service healthy"
  exit 0
fi

echo "Printer service unhealthy, restarting"
systemctl restart mimo-printer.service