#!/usr/bin/env node
/**
 * Limpia datos operativos y de prueba conservando únicamente compras POS:
 * - Conserva: pos.purchase_orders, pos.purchase_lines
 * - Conserva: catálogos base y usuarios auth
 * - Elimina: pólizas, facturación emitida/recibida, activos/depreciaciones
 */
import pg from "pg";
import "../src/loadEnv.js";

const url = String(process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL no está definida.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });

async function tableExists(client, tableName) {
  const { rows } = await client.query("SELECT to_regclass($1) AS t", [tableName]);
  return Boolean(rows[0]?.t);
}

async function truncateIfExists(client, tableName) {
  if (!(await tableExists(client, tableName))) return false;
  await client.query(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`);
  return true;
}

async function run() {
  const client = await pool.connect();
  const touched = [];
  try {
    await client.query("BEGIN");

    for (const t of [
      "accounting.poliza_lines",
      "accounting.polizas",
      "invoicing.received_invoices",
      "invoicing.received_import_batches",
      "invoicing.invoices",
      "accounting.asset_depreciation_schedule",
      "accounting.asset_inventory",
    ]) {
      const ok = await truncateIfExists(client, t);
      if (ok) touched.push(t);
    }

    if (await tableExists(client, "accounting.folio_counter")) {
      await client.query(
        `INSERT INTO accounting.folio_counter (singleton, next_seq)
         VALUES (1, 1)
         ON CONFLICT (singleton) DO UPDATE SET next_seq = 1`
      );
      touched.push("accounting.folio_counter(reset=1)");
    }

    await client.query("COMMIT");
    console.log("Limpieza completada. Tablas limpiadas:");
    for (const t of touched) console.log(`- ${t}`);
    console.log("Conservado: pos.purchase_orders, pos.purchase_lines.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
