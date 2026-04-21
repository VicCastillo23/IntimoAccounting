#!/usr/bin/env node
/**
 * Actualiza accounting.chart_accounts.num_cta (y poliza_lines.account_code / sub_cta_de)
 * al formato Íntimo XXX-XXX-XXX-XXX alineado al código agrupador SAT vía sat_codigo_agrupador_id.
 *
 *   npm run db:migrate-intimo-codes
 *
 * Requiere DATABASE_URL. Idempotente si num_cta ya coincide.
 */
import "../src/loadEnv.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildSatDisplayById } = await import(
  pathToFileURL(path.join(root, "public", "js", "intimo-account-code.js")).href
);

const url = String(process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL no definida.");
  process.exit(1);
}

async function main() {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const { rows: satRows } = await client.query(
      `SELECT id, codigo, descripcion, orden, es_seccion
       FROM accounting.sat_codigo_agrupador
       ORDER BY orden ASC`
    );
    const byId = buildSatDisplayById(satRows);

    const { rows: charts } = await client.query(
      `SELECT id, num_cta, sub_cta_de, sat_codigo_agrupador_id
       FROM accounting.chart_accounts
       WHERE activo = true`
    );

    /** @type {{ id: number, oldNum: string, canonical: string }[]} */
    const candidates = [];
    for (const c of charts) {
      const sid = c.sat_codigo_agrupador_id;
      if (sid == null) continue;
      const disp = byId.get(Number(sid));
      if (!disp?.code) continue;
      if (disp.code === c.num_cta) continue;
      candidates.push({ id: c.id, oldNum: c.num_cta, canonical: disp.code });
    }

    if (!candidates.length) {
      console.log("Nada que migrar: num_cta ya coincide con el formato Íntimo o no hay cuentas enlazadas al SAT.");
      return;
    }

    const candidateIds = new Set(candidates.map((c) => c.id));
    /** @type {Set<string>} num_cta que seguirán ocupando cuentas que no entran en esta migración */
    const taken = new Set();
    for (const c of charts) {
      if (!candidateIds.has(c.id)) taken.add(c.num_cta);
    }

    /** @type {Map<string, typeof candidates>} */
    const byCanon = new Map();
    for (const c of candidates) {
      if (!byCanon.has(c.canonical)) byCanon.set(c.canonical, []);
      byCanon.get(c.canonical).push(c);
    }

    /** @type {{ id: number, oldNum: string, newNum: string }[]} */
    const updates = [];
    const canonKeys = [...byCanon.keys()].sort();
    for (const canon of canonKeys) {
      const group = byCanon.get(canon);
      group.sort((a, b) => a.id - b.id);
      for (const c of group) {
        let final = canon;
        if (taken.has(final)) {
          final = `${canon}-C${c.id}`;
          if (final.length > 64) final = final.slice(0, 64);
        }
        let tries = 0;
        while (taken.has(final)) {
          tries += 1;
          final = `${canon}-C${c.id}-${tries}`;
          if (final.length > 64) final = final.slice(0, 64);
          if (tries > 50) throw new Error(`No se pudo resolver colisión para cuenta id ${c.id} / ${canon}`);
        }
        taken.add(final);
        if (final !== canon) {
          console.warn(`  Aviso: cuenta id ${c.id} → ${final} (canónico ${canon} ya ocupado o duplicado por SAT).`);
        }
        updates.push({ id: c.id, oldNum: c.oldNum, newNum: final });
      }
    }

    console.log(`Migrando ${updates.length} cuenta(s)…`);
    await client.query("BEGIN");

    await client.query(`ALTER TABLE accounting.chart_accounts DROP CONSTRAINT IF EXISTS fk_chart_sub_cta_de`);

    for (const u of updates) {
      await client.query(`UPDATE accounting.chart_accounts SET num_cta = $1 WHERE id = $2`, [`__migr_${u.id}__`, u.id]);
    }

    for (const u of updates) {
      const r = await client.query(
        `UPDATE accounting.poliza_lines SET account_code = $1 WHERE account_code = $2`,
        [u.newNum, u.oldNum]
      );
      if (r.rowCount > 0) {
        console.log(`  poliza_lines: ${u.oldNum} → ${u.newNum} (${r.rowCount} renglón(es))`);
      }
    }

    for (const u of updates) {
      await client.query(`UPDATE accounting.chart_accounts SET sub_cta_de = $1 WHERE sub_cta_de = $2`, [
        u.newNum,
        u.oldNum,
      ]);
    }

    for (const u of updates) {
      await client.query(`UPDATE accounting.chart_accounts SET num_cta = $1, updated_at = now() WHERE id = $2`, [
        u.newNum,
        u.id,
      ]);
    }

    await client.query(`
      ALTER TABLE accounting.chart_accounts
        ADD CONSTRAINT fk_chart_sub_cta_de
        FOREIGN KEY (sub_cta_de) REFERENCES accounting.chart_accounts (num_cta) ON DELETE SET NULL
    `);

    await client.query("COMMIT");
    console.log("Listo: cuentas y movimientos alineados al formato Íntimo.");
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
