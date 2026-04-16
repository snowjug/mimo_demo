#!/usr/bin/env bash
set -euo pipefail

export PI_BIND_HOST="${PI_BIND_HOST:-0.0.0.0}"
export PI_BIND_PORT="${PI_BIND_PORT:-8000}"

uvicorn printer_server:app --host "$PI_BIND_HOST" --port "$PI_BIND_PORT"
