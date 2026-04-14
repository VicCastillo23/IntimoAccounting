#!/usr/bin/env node
/**
 * Inserta cuentas de ejemplo y pólizas equilibradas para probar reportería en local.
 * Requiere DATABASE_URL y migraciones 04–07 aplicadas.
 *
 *   npm run db:seed-reporting
 *   npm run db:seed-reporting -- --force   # aunque ya haya pólizas
 */
import "../src/loadEnv.js";
import pg from "pg";

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

    const { rows: satRows } = await client.query(
      `SELECT id, codigo, descripcion, orden FROM accounting.sat_codigo_agrupador
       WHERE orden IN (3, 5, 11, 107, 170, 186, 202, 248)
       ORDER BY orden`
    );
    if (satRows.length < 6) {
      throw new Error("Faltan renglones SAT (ejecuta npm run db:migrate-catalog).");
    }

    const satByOrden = Object.fromEntries(satRows.map((r) => [r.orden, r]));

    const cuentas = [
      { num: "1010-001", desc: "Caja general", natur: "D", orden: 3 },
      { num: "1020-001", desc: "Bancos MX", natur: "D", orden: 5 },
      { num: "1030-001", desc: "Clientes", natur: "D", orden: 11 },
      { num: "2010-001", desc: "Proveedores", natur: "A", orden: 107 },
      { num: "3010-001", desc: "Capital social", natur: "A", orden: 170 },
      { num: "4010-001", desc: "Ventas gravadas", natur: "A", orden: 186 },
      { num: "5010-001", desc: "Costo de ventas", natur: "D", orden: 202 },
      { num: "6010-001", desc: "Gastos de venta", natur: "D", orden: 248 },
    ];

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO accounting.folio_counter (singleton, next_seq) VALUES (1, 1) ON CONFLICT (singleton) DO NOTHING`
    );

    for (const c of cuentas) {
      const sat = satByOrden[c.orden];
      if (!sat) continue;
      await client.query(
        `INSERT INTO accounting.chart_accounts (num_cta, descripcion, sub_cta_de, nivel, natur, sat_codigo_agrupador_id, activo)
         VALUES ($1, $2, NULL, 1, $3, $4, true)
         ON CONFLICT (num_cta) DO NOTHING`,
        [c.num, c.desc, c.natur, sat.id]
      );
    }

    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const templates = [
      () => {
        const m = rnd(2000, 45000) + Math.random();
        return {
          concept: "Venta de contado",
          lines: [
            { code: "1010-001", name: "Caja general", d: m, c: 0 },
            { code: "4010-001", name: "Ventas gravadas", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(3000, 60000) + Math.random();
        return {
          concept: "Venta a crédito",
          lines: [
            { code: "1030-001", name: "Clientes", d: m, c: 0 },
            { code: "4010-001", name: "Ventas gravadas", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(1500, 25000) + Math.random();
        return {
          concept: "Compra de mercancía",
          lines: [
            { code: "5010-001", name: "Costo de ventas", d: m, c: 0 },
            { code: "2010-001", name: "Proveedores", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(800, 12000) + Math.random();
        return {
          concept: "Pago a proveedores",
          lines: [
            { code: "2010-001", name: "Proveedores", d: m, c: 0 },
            { code: "1020-001", name: "Bancos MX", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(500, 8000) + Math.random();
        return {
          concept: "Gastos de operación",
          lines: [
            { code: "6010-001", name: "Gastos de venta", d: m, c: 0 },
            { code: "1020-001", name: "Bancos MX", d: 0, c: m },
          ],
        };
      },
      () => {
        const m = rnd(10000, 80000) + Math.random();
        return {
          concept: "Aportación de capital",
          lines: [
            { code: "1020-001", name: "Bancos MX", d: m, c: 0 },
            { code: "3010-001", name: "Capital social", d: 0, c: m },
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
