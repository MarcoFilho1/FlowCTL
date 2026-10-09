#!/usr/bin/env bash
# Sends N snapshots (default 200) with growing seq and a moving "running"
# node, ~20 per second, then prints the overlay's latency stats.
set -euo pipefail
SOCK="$HOME/.flowctl/overlay.sock"
N="${1:-200}"
STATUSES=(pending running needs_you error done)
for ((seq = 1000; seq < 1000 + N; seq++)); do
  nodes=""
  for i in $(seq 1 20); do
    status=${STATUSES[$(( (i + seq) % 5 ))]}
    nodes+="{\"id\":\"t$i\",\"title\":\"Task $i\",\"status\":\"$status\"},"
  done
  body="{\"schema\":1,\"seq\":$seq,\"sessionId\":\"bench\",\"nodes\":[${nodes%,}]}"
  curl -s -o /dev/null --unix-socket "$SOCK" -X POST http://overlay/snapshot --data-binary "$body"
  sleep 0.05
done
sleep 0.5
curl -s --unix-socket "$SOCK" http://overlay/stats
