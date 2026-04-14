import { getPool } from "../db/pool.js";

/**
 * @typedef {{ id: number, codigo: string | null, descripcion: string, orden: number, es_seccion: boolean }} SatRow
 * @typedef {{ id: number, num_cta: string, descripcion: string, sub_cta_de: string | null, nivel: number, natur: string, sat_codigo_agrupador_id: number | null, codigo_agrupador: string | null, desc_agrupador: string | null, activo: boolean }} ChartRow
 */

function noDb() {
  return { ok: false, reason: "no_database" };
}

/**
 * @param {string} [q]
 */
export async function listSatCodigoAgrupador(q) {
  const pool = getPool();
  if (!pool) return { ...noDb(), rows: [] };

  const term = String(q || "").trim();
  const params = [];
  let where = "";
  if (term) {
    params.push(`%${term}%`, `%${term}%`);
    where = `WHERE (codigo ILIKE $1 OR descripcion ILIKE $2)`;
  }
  const sql = `
    SELECT id, codigo, descripcion, orden, es_seccion
    FROM accounting.sat_codigo_agrupador
    ${where}
    ORDER BY orden ASC
  `;
  const { rows } = params.length
    ? await pool.query(sql, params)
    : await pool.query(sql);
  return { ok: true, rows };
}

/**
 * @param {string} [q]
 */
export async function listChartAccounts(q) {
  const pool = getPool();
  if (!pool) return { ...noDb(), rows: [] };

  const term = String(q || "").trim();
  const params = [];
  let where = "WHERE c.activo = true";
  if (term) {
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
    where += ` AND (c.num_cta ILIKE $1 OR c.descripcion ILIKE $2 OR sat.codigo ILIKE $3)`;
  }
  const sql = `
    SELECT c.id, c.num_cta, c.descripcion, c.sub_cta_de, c.nivel, c.natur,
           c.sat_codigo_agrupador_id, c.activo,
           sat.codigo AS codigo_agrupador,
           sat.descripcion AS desc_agrupador
    FROM accounting.chart_accounts c
    LEFT JOIN accounting.sat_codigo_agrupador sat ON sat.id = c.sat_codigo_agrupador_id
    ${where}
    ORDER BY c.num_cta ASC
  `;
  const { rows } = params.length
    ? await pool.query(sql, params)
    : await pool.query(sql);
  return { ok: true, rows };
}

/**
 * @param {{
 *   num_cta: string,
 *   descripcion: string,
 *   sub_cta_de?: string | null,
 *   nivel?: number,
 *   natur: string,
 *   sat_codigo_agrupador_id?: number | null,
 * }} body
 */
export async function createChartAccount(body) {
  const pool = getPool();
  if (!pool) throw new Error("Base de datos no configurada");

  const num_cta = String(body.num_cta || "").trim();
  const descripcion = String(body.descripcion || "").trim();
  if (!num_cta || !descripcion) throw new Error("Número de cuenta y descripción son obligatorios.");

  const natur = String(body.natur || "").toUpperCase();
  if (natur !== "D" && natur !== "A") throw new Error('Naturaleza debe ser "D" o "A".');

  const sub = body.sub_cta_de != null && String(body.sub_cta_de).trim() !== ""
    ? String(body.sub_cta_de).trim()
    : null;
  const nivel = Number(body.nivel) || 1;
  if (nivel !== 1 && nivel !== 2) throw new Error("Nivel debe ser 1 o 2 (SAT).");
  const satId =
    body.sat_codigo_agrupador_id != null && body.sat_codigo_agrupador_id !== ""
      ? Number(body.sat_codigo_agrupador_id)
      : null;

  const { rows } = await pool.query(
    `
    INSERT INTO accounting.chart_accounts (num_cta, descripcion, sub_cta_de, nivel, natur, sat_codigo_agrupador_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, num_cta, descripcion, sub_cta_de, nivel, natur, sat_codigo_agrupador_id, activo
    `,
    [num_cta, descripcion, sub, nivel, natur, Number.isFinite(satId) ? satId : null]
  );
  return rows[0];
}

/**
 * @param {number} id
 * @param {Partial<{ descripcion: string, sub_cta_de: string | null, nivel: number, natur: string, sat_codigo_agrupador_id: number | null, activo: boolean }>} patch
 */
export async function updateChartAccount(id, patch) {
  const pool = getPool();
  if (!pool) throw new Error("Base de datos no configurada");

  const { rows: cur } = await pool.query(
    `SELECT id, num_cta, descripcion, sub_cta_de, nivel, natur, sat_codigo_agrupador_id, activo
     FROM accounting.chart_accounts WHERE id = $1`,
    [id]
  );
  if (!cur.length) throw new Error("Cuenta no encontrada.");

  const r = cur[0];
  const descripcion = patch.descripcion != null ? String(patch.descripcion).trim() : r.descripcion;
  const sub =
    patch.sub_cta_de !== undefined
      ? patch.sub_cta_de != null && String(patch.sub_cta_de).trim() !== ""
        ? String(patch.sub_cta_de).trim()
        : null
      : r.sub_cta_de;
  let nivel = r.nivel;
  if (patch.nivel != null) {
    const n = Number(patch.nivel);
    if (n !== 1 && n !== 2) throw new Error("Nivel debe ser 1 o 2 (SAT).");
    nivel = n;
  }
  let natur = r.natur;
  if (patch.natur != null) {
    const n = String(patch.natur).toUpperCase();
    if (n !== "D" && n !== "A") throw new Error('Naturaleza debe ser "D" o "A".');
    natur = n;
  }
  let satId = r.sat_codigo_agrupador_id;
  if (patch.sat_codigo_agrupador_id !== undefined) {
    satId =
      patch.sat_codigo_agrupador_id != null && patch.sat_codigo_agrupador_id !== ""
        ? Number(patch.sat_codigo_agrupador_id)
        : null;
  }
  const activo = patch.activo != null ? Boolean(patch.activo) : r.activo;

  if (!descripcion) throw new Error("La descripción no puede quedar vacía.");

  const { rows } = await pool.query(
    `
    UPDATE accounting.chart_accounts
    SET descripcion = $2, sub_cta_de = $3, nivel = $4, natur = $5,
        sat_codigo_agrupador_id = $6, activo = $7, updated_at = now()
    WHERE id = $1
    RETURNING id, num_cta, descripcion, sub_cta_de, nivel, natur, sat_codigo_agrupador_id, activo
    `,
    [id, descripcion, sub, nivel, natur, Number.isFinite(satId) ? satId : null, activo]
  );
  return rows[0];
}
