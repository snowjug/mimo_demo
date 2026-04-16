#!/usr/bin/env bash
set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if [ -z "${TAILSCALE_AUTH_KEY:-}" ]; then
  echo "TAILSCALE_AUTH_KEY is not set. Log in manually with: sudo tailscale up"
  sudo tailscale up
  exit 0
fi

sudo tailscale up --authkey "$TAILSCALE_AUTH_KEY" --hostname "mimo-pi-printer"