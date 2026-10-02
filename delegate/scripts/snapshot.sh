#!/usr/bin/env bash
# Delegate — snapshot the seeded ERPNext database (handoff §3.4)
# Usage: scripts/snapshot.sh harbor-lane-v1
set -euo pipefail

SNAPSHOT_NAME="${1:?Usage: snapshot.sh <name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAP_DIR="${SCRIPT_DIR}/../snapshots"
mkdir -p "${SNAP_DIR}"

echo "Dumping erpnext-db to snapshots/${SNAPSHOT_NAME}.sql ..."
docker exec erpnext-db pg_dump -U postgres erpnext > "${SNAP_DIR}/${SNAPSHOT_NAME}.sql"
echo "Snapshot written (${SNAPSHOT_NAME})."
