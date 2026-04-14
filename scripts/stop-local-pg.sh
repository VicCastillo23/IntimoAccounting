#!/usr/bin/env bash
# Detiene el Postgres nativo del proyecto (.pgdata).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT/.pgdata}"

if ! command -v pg_ctl >/dev/null 2>&1; then
  for v in 16 15 14; do
    for p in "/opt/homebrew/opt/postgresql@${v}/bin" "/usr/local/opt/postgresql@${v}/bin"; do
      if [[ -x "$p/pg_ctl" ]]; then export PATH="$p:$PATH"; break 2; fi
    done
  done
fi

if [[ ! -d "$PGDATA" ]]; then
  echo "No hay cluster en $PGDATA"
  exit 0
fi

pg_ctl -D "$PGDATA" stop || true
echo "Postgres detenido (PGDATA=$PGDATA)."
