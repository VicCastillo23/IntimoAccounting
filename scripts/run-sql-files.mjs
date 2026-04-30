#!/usr/bin/env node
/**
 * Ejecuta archivos .sql contra DATABASE_URL (sin necesidad de psql).
 * Uso:
 *   node scripts/run-sql-files.mjs --all
 *   node scripts/run-sql-files.mjs [ruta1.sql ruta2.sql ...]
 * Por defecto (sin args): migraciones 06 y 07 del catálogo contable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import "../src/loadEnv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const defaultFiles = [
  "deploy/postgres/06_accounting_catalog.sql",
  "deploy/postgres/07_sat_codigo_agrupador_seed.sql",
];

/** Orden completo para entorno local (mismos archivos que deploy/postgres). */
const ALL_MIGRATIONS = [
  "deploy/postgres/00_extensions.sql",
  "deploy/postgres/01_schemas.sql",
  "deploy/postgres/02_pos.sql",
  "deploy/postgres/03_invoicing.sql",
  "deploy/postgres/04_accounting.sql",
  "deploy/postgres/05_accounting_folio_counter.sql",
  "deploy/postgres/06_accounting_catalog.sql",
  "deploy/postgres/07_sat_codigo_agrupador_seed.sql",
  "deploy/postgres/08_asset_inventory.sql",
  "deploy/postgres/09_depreciation_amortization.sql",
  "deploy/postgres/10_depreciation_pct_ipc.sql",
  "deploy/postgres/11_pos_invoice_and_poliza_xml.sql",
  "deploy/postgres/12_purchase_order_public_token.sql",
  "deploy/postgres/13_auth_app_users.sql",
  "deploy/postgres/14_invoicing_received.sql",
];

const argv = process.argv.slice(2);
const useAll = argv.includes("--all");
const pathArgs = argv.filter((a) => a !== "--all");

const url = String(process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL no está definida. Añádela en .env (misma BD que en AWS o Postgres local).");
  process.exit(1);
}

const files = useAll ? ALL_MIGRATIONS : pathArgs.length ? pathArgs : defaultFiles;

const pool = new pg.Pool({ connectionString: url, max: 1 });

async function main() {
  const client = await pool.connect();
  try {
    for (const rel of files) {
      const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
      if (!fs.existsSync(abs)) {
        throw new Error(`No existe el archivo: ${abs}`);
      }
      const sql = fs.readFileSync(abs, "utf8");
      console.error(`→ ${rel}`);
      await client.query(sql);
    }
    console.error("Listo.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
