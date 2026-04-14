import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

/** Misma secuencia que `scripts/run-sql-files.mjs --all` */
const MIGRATIONS_ALL = [
  "00_extensions.sql",
  "01_schemas.sql",
  "02_pos.sql",
  "03_invoicing.sql",
  "04_accounting.sql",
  "05_accounting_folio_counter.sql",
  "06_accounting_catalog.sql",
  "07_sat_codigo_agrupador_seed.sql",
];

/**
 * En desarrollo, si el catálogo SAT está vacío o faltan tablas, aplica los SQL 06+07
 * (y 00+01 si hace falta). Evita la pantalla vacía cuando solo existía la BD creada al vuelo.
 * Producción: no hace nada. Desactivar: ACCOUNTING_NO_AUTO_CATALOG=1
 */
export async function ensureCatalogDevIfNeeded() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || process.env.NODE_ENV === "production") return;
  if (process.env.ACCOUNTING_NO_AUTO_CATALOG === "1") return;

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();

  const runFile = async (rel) => {
    const abs = path.join(root, "deploy/postgres", rel);
    const sql = fs.readFileSync(abs, "utf8");
    await client.query(sql);
  };

  try {
    let n = -1;
    try {
      const { rows } = await client.query(
        "SELECT COUNT(*)::int AS n FROM accounting.sat_codigo_agrupador"
      );
      n = rows[0]?.n ?? 0;
    } catch (e) {
      if (e && e.code === "42P01") {
        n = -1;
      } else {
        throw e;
      }
    }

    if (n > 0) return;

    if (n === 0) {
      console.warn(
        "[intimo-accounting] Catálogo SAT vacío: aplicando 07_sat_codigo_agrupador_seed.sql …"
      );
      await runFile("07_sat_codigo_agrupador_seed.sql");
      console.warn("[intimo-accounting] Código agrupador SAT cargado.");
      return;
    }

    console.warn(
      "[intimo-accounting] Faltan tablas (p. ej. catálogo SAT): aplicando migraciones 00–07 …"
    );
    for (const f of MIGRATIONS_ALL) {
      await runFile(f);
    }
    console.warn("[intimo-accounting] Migraciones locales aplicadas.");
  } finally {
    await client.end();
  }
}
