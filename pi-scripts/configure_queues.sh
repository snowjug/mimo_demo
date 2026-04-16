#!/usr/bin/env bash
set -euo pipefail

echo "Available CUPS printers:"
lpstat -p || true

if [ $# -eq 0 ]; then
  echo "Usage: ./configure_queues.sh QUEUE1 [QUEUE2 ...]"
  exit 1
fi

joined=$(printf "%s," "$@" | sed 's/,$//')
echo "Set PRINTER_QUEUES=${joined} in your environment"