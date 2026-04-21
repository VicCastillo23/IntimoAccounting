#!/usr/bin/env node
/**
 * Inserta cuentas de ejemplo y pólizas equilibradas para probar reportería en local.
 * Requiere DATABASE_URL y migraciones 04–07 aplicadas.
 *
 *   npm run db:seed-reporting
 *   npm run db:seed-reporting -- --force   # aunque ya haya pólizas
 */
import "../src/loadEnv.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import pg from "pg";

const __root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildSatDisplayById } = await import(
  pathToFileURL(path.join(__root, "public", "js", "intimo-account-code.js")).href
);

const url = String(process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL no definida.");
  process.exit(1);
}

const force = process.argv.includes("--force");

async function main() {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const { rows: cnt } = await client.query(`SELECT COUNT(*)::int AS n FROM accounting.polizas`);
    if ((cnt[0]?.n ?? 0) >= 6 && !force) {
      console.error("Ya hay pólizas en la base. Usa --force para insertar de todos modos.");
      process.exit(0);
    }

    const { rows: allSat } = await client.query(
      `SELECT id, codigo, descripcion, orden, es_seccion FROM accounting.sat_codigo_agrupador ORDER BY orden ASC`
    );
    const displayById = buildSatDisplayById(allSat);
    const satAtOrden = (orden) => allSat.find((r) => r.orden === orden);
    const numCtaForOrden = (orden) => {
      const sat = satAtOrden(orden);
      if (!sat) throw new Error(`Falta renglón SAT orden ${orden} (ejecuta npm run db:migrate-catalog).`);
      const d = displayById.get(Number(sat.id));
      if (!d?.code) throw new Error(`Sin código Íntimo para SAT orden ${orden}.`);
      return d.code;
    };
    for (const o of [3, 5, 11, 107, 170, 186, 202, 248]) {
      if (!satAtOrden(o)) {
        throw new Error(`Falta renglón SAT orden ${o} (ejecuta npm run db:migrate-catalog).`);
      }
    }

    const cuentas = [
      { desc: "Caja general", natur: "D", orden: 3 },
      { desc: "Bancos MX", natur: "D", orden: 5 },
      { desc: "Clientes", natur: "D", orden: 11 },
      { desc: "Proveedores", natur: "A", orden: 107 },
      { desc: "Capital social", natur: "A", orden: 170 },
      { desc: "Ventas gravadas", natur: "A", orden: 186 },
      { desc: "Costo de ventas", natur: "D", orden: 202 },
      { desc: "Gastos de venta", natur: "D", orden: 248 },
    ];

    const N = {
      caja: numCtaForOrden(3),
      bancos: numCtaForOrden(5),
      clientes: numCtaForOrden(11),
      proveedores: numCtaForOrden(107),
      capital: numCtaForOrden(170),
      ventas: numCtaForOrden(186),
      costoVentas: numCtaForOrden(202),
      gastosVenta: numCtaForOrden(248),
    };

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO accounting.folio_counter (singleton, next_seq) VALUES (1, 1) ON CONFLICT (singleton) DO NOTHING`
    );

    for (const c of cuentas) {
      const sat = satAtOrden(c.orden);
      if (!sat) continue;
      const num = numCtaForOrden(c.orden);
      await client.query(
        `INSERT INTO accounting.chart_accounts (num_cta, descripcion, sub_cta_de, nivel, natur, sat_codigo_agrupador_id, activo)
         VALUES ($1, $2, NULL, 1, $3, $4, true)
         ON CONFLICT (num_cta) DO NOTHING`,
        [num, c.desc, c.natur, sat.id]
      );
    }

    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const templates = [
      () => {
        const m = rnd(2000, 45000) + Math.random();
        return {
          concept: "Venta de contado",
          lines: [
            { code: N.caja, name: "Caja general", d: m, c: 0 },
            { code: N.ventas, name: "Ventas gravadas", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(3000, 60000) + Math.random();
        return {
          concept: "Venta a crédito",
          lines: [
            { code: N.clientes, name: "Clientes", d: m, c: 0 },
            { code: N.ventas, name: "Ventas gravadas", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(1500, 25000) + Math.random();
        return {
          concept: "Compra de mercancía",
          lines: [
            { code: N.costoVentas, name: "Costo de ventas", d: m, c: 0 },
            { code: N.proveedores, name: "Proveedores", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(800, 12000) + Math.random();
        return {
          concept: "Pago a proveedores",
          lines: [
            { code: N.proveedores, name: "Proveedores", d: m, c: 0 },
            { code: N.bancos, name: "Bancos MX", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(500, 8000) + Math.random();
        return {
          concept: "Gastos de operación",
          lines: [
            { code: N.gastosVenta, name: "Gastos de venta", d: m, c: 0 },
            { code: N.bancos, name: "Bancos MX", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(10000, 80000) + Math.random();
        return {
          concept: "Aportación de capital",
          lines: [
            { code: N.bancos, name: "Bancos MX", d: m, c: 0 },
            { code: N.capital, name: "Capital social", d: 0, c: m },
          ],
        };
      },
    ];

    const { rows: cRows } = await client.query(
      `SELECT next_seq FROM accounting.folio_counter WHERE singleton = 1 FOR UPDATE`
    );
    let nextSeq = cRows[0]?.next_seq ?? 1;
    const year = new Date().getFullYear();

    for (let i = 0; i < 42; i++) {
      const tpl = templates[rnd(0, templates.length - 1)]();
      const id = `pol-demo-${Date.now()}-${i}`;
      const folio = `P-${year}-${String(nextSeq).padStart(4, "0")}`;
      nextSeq += 1;
      const dayOff = rnd(0, 120);
      const d = new Date();
      d.setDate(d.getDate() - dayOff);
      const polizaDate = d.toISOString().slice(0, 10);

      await client.query(
        `INSERT INTO accounting.polizas (id, folio, poliza_date, type, concept, source_ref, accounting_batch_date)
         VALUES ($1, $2, $3::date, 'DIARIO', $4, '{}'::jsonb, NULL)`,
        [id, folio, polizaDate, tpl.concept]
      );

      let idx = 0;
      for (const ln of tpl.lines) {
        await client.query(
          `INSERT INTO accounting.poliza_lines
           (poliza_id, line_index, ticket_id, account_code, account_name, debit, credit, line_concept, invoice_url, fx_currency, depto)
           VALUES ($1, $2, '', $3, $4, $5, $6, $7, '', 'MX', 'ADMINISTRACION')`,
          [id, idx, ln.code, ln.name, ln.d, ln.c, tpl.concept]
        );
        idx++;
      }
    }

    await client.query(`UPDATE accounting.folio_counter SET next_seq = $1 WHERE singleton = 1`, [nextSeq]);

    await client.query("COMMIT");
    console.error("Listo: cuentas demo y ~42 pólizas insertadas.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
