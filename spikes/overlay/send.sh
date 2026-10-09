#!/usr/bin/env bash
# Posts a snapshot to the running spike. Usage: ./send.sh [file.json]
set -euo pipefail
cd "$(dirname "$0")"
SOCK="$HOME/.flowctl/overlay.sock"
curl --silent --show-error --fail --unix-socket "$SOCK" \
  -X POST http://overlay/snapshot \
  -H 'Content-Type: application/json' \
  --data-binary @"${1:-sample.json}" \
  -w 'HTTP %{http_code} in %{time_total}s\n'
