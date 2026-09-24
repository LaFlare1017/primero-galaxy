#!/usr/bin/env bash
# Delegate — reset the ERPNext database from a snapshot (handoff §3.4)
# Target: under 15 seconds end-to-end. Test this in week 1.
# Usage: scripts/reset.sh harbor-lane-v1
set -euo pipefail

SNAPSHOT_NAME="${1:?Usage: reset.sh <name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAP_FILE="${SCRIPT_DIR}/../snapshots/${SNAPSHOT_NAME}.sql"

if [[ ! -f "${SNAP_FILE}" ]]; then
  echo "Snapshot not found: ${SNAP_FILE}" >&2
  exit 1
fi

START=$SECONDS

docker exec -i erpnext-db psql -U postgres -c "DROP DATABASE IF EXISTS erpnext;" > /dev/null
docker exec -i erpnext-db psql -U postgres -c "CREATE DATABASE erpnext;" > /dev/null
docker exec -i erpnext-db psql -U postgres -d erpnext < "${SNAP_FILE}" > /dev/null

ELAPSED=$((SECONDS - START))
echo "Reset complete in ${ELAPSED}s (target: <15s)."
if (( ELAPSED >= 15 )); then
  echo "WARNING: reset exceeded the 15s workshop budget." >&2
  exit 2
fi
