#!/usr/bin/env bash
# Postgres nativo (Homebrew) en el proyecto: cluster en .pgdata/, puerto 5433, migraciones 00–07.
# Requisito: brew install postgresql@16 (o 15 / 14; el script prueba versiones).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PGPORT="${PGPORT:-5433}"
PGDATA="${PGDATA:-$ROOT/.pgdata}"
LOGFILE="$PGDATA/postgres.log"
DB_NAME="${DB_NAME:-intimo_loyalty}"
DB_USER="${DB_USER:-intimo_loyalty}"
DATABASE_URL="postgresql://${DB_USER}@127.0.0.1:${PGPORT}/${DB_NAME}"

die() { echo "Error: $*" >&2; exit 1; }

prepend_pg_bin() {
  local v p
  for v in 16 15 14; do
    for p in "/opt/homebrew/opt/postgresql@${v}/bin" "/usr/local/opt/postgresql@${v}/bin"; do
      if [[ -x "$p/pg_ctl" ]]; then
        export PATH="$p:$PATH"
        echo "Usando PostgreSQL ${v} en $p"
        return 0
      fi
    done
  done
  return 1
}

if ! prepend_pg_bin; then
  echo "No se encontró PostgreSQL (pg_ctl). Instálalo con Homebrew y vuelve a ejecutar:"
  echo "  brew install postgresql@16"
  echo "Luego (Apple Silicon):"
  echo "  echo 'export PATH=\"/opt/homebrew/opt/postgresql@16/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  echo "O en Intel:"
  echo "  echo 'export PATH=\"/usr/local/opt/postgresql@16/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  exit 1
fi

command -v initdb >/dev/null || die "initdb no está en PATH"
command -v pg_ctl >/dev/null || die "pg_ctl no está en PATH"
command -v psql >/dev/null || die "psql no está en PATH"
command -v node >/dev/null || die "Node.js no está en PATH"

if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  echo "Creando cluster en $PGDATA (solo la primera vez)…"
  mkdir -p "$PGDATA"
  initdb -D "$PGDATA" -U "$DB_USER" --locale=C --encoding=UTF8 -A trust
  # Conexiones TCP desde la app Node (127.0.0.1)
  if ! grep -q '127.0.0.1/32' "$PGDATA/pg_hba.conf" 2>/dev/null; then
    echo "host all all 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
  fi
  # Escucha TCP en localhost (por si el por defecto no aplica)
  if ! grep -qE '^listen_addresses\s*=' "$PGDATA/postgresql.conf" 2>/dev/null; then
    echo "listen_addresses = 'localhost'" >> "$PGDATA/postgresql.conf"
  fi
fi

if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  echo "Iniciando Postgres en el puerto ${PGPORT} ..."
  mkdir -p "$PGDATA"
  # Evita $PGPORT junto a caracteres Unicode (p. ej. …) que confunden a bash con set -u
  PG_EXTRA_OPTS="-p ${PGPORT}"
  pg_ctl -D "$PGDATA" -l "$LOGFILE" -o "$PG_EXTRA_OPTS" start
  sleep 2
else
  echo "Postgres ya estaba en marcha (PGDATA=$PGDATA)."
fi

# Comprobar que acepta conexiones
for _ in $(seq 1 30); do
  if psql -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! psql -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  die "No se pudo conectar a Postgres en 127.0.0.1:$PGPORT. Revisa $LOGFILE"
fi

EXISTS="$(psql -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" || true)"
if [[ "$EXISTS" != "1" ]]; then
  echo "Creando base de datos $DB_NAME…"
  psql -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";"
fi

export DATABASE_URL
echo "DATABASE_URL=$DATABASE_URL"
echo "Ejecutando migraciones SQL (00-07) ..."
node "$ROOT/scripts/run-sql-files.mjs" --all

# Añadir DATABASE_URL a .env si no existe (no sobreescribe una URL que ya tengas)
ENV_FILE="$ROOT/.env"
if [[ -f "$ENV_FILE" ]] && grep -q '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null; then
  echo "Ya existe DATABASE_URL en .env — no se modifica."
else
  if [[ ! -f "$ENV_FILE" ]] && [[ -f "$ROOT/.env.example" ]]; then
    echo "Creando .env desde .env.example (completa DATA_ENCRYPTION_KEY y SESSION_SECRET si faltan)…"
    cp "$ROOT/.env.example" "$ENV_FILE"
  fi
  if [[ -f "$ENV_FILE" ]]; then
    echo "" >> "$ENV_FILE"
    echo "# Postgres local nativo (scripts/setup-local-native.sh, puerto ${PGPORT})" >> "$ENV_FILE"
    echo "DATABASE_URL=$DATABASE_URL" >> "$ENV_FILE"
    echo "Se añadió DATABASE_URL a .env"
  else
    echo "Crea .env con al menos DATA_ENCRYPTION_KEY y SESSION_SECRET, y añade:"
    echo "DATABASE_URL=$DATABASE_URL"
  fi
fi

echo ""
echo "Listo. Reinicia el servidor si ya estaba corriendo: npm run dev"
echo "  · Pólizas + catálogo: http://localhost:3010/catalogo.html"
echo "Para detener Postgres local:  npm run pg:stop"
echo "Para volver a arrancarlo:     pg_ctl -D ${PGDATA} -o \"-p ${PGPORT}\" start"
