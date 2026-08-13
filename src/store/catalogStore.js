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
 * Busca una cuenta activa por patrones de descripción (prioridad: match más específico).
 * @param {string[]} patterns
 * @returns {Promise<{ ok: true, row: ChartRow | null } | { ok: false, reason: string }>}
 */
export async function findChartAccountByNamePatterns(patterns) {
  const pool = getPool();
  if (!pool) return noDb();
  const list = (Array.isArray(patterns) ? patterns : [])
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  if (!list.length) return { ok: true, row: null };

  try {
    // Prefer exact (case-insensitive) then prefix/contains; shorter codes (leaf) first within score.
    const { rows } = await pool.query(
      `
      WITH pats AS (
        SELECT * FROM unnest($1::text[]) WITH ORDINALITY AS t(pat, ord)
      )
      SELECT c.id, c.num_cta, c.descripcion, c.sub_cta_de, c.nivel, c.natur,
             c.sat_codigo_agrupador_id, c.activo,
             sat.codigo AS codigo_agrupador,
             sat.descripcion AS desc_agrupador,
             p.ord AS pattern_ord,
             CASE
               WHEN lower(c.descripcion) = lower(p.pat) THEN 0
               WHEN lower(c.descripcion) LIKE lower(p.pat) || '%' THEN 1
               ELSE 2
             END AS match_rank
      FROM accounting.chart_accounts c
      JOIN pats p ON lower(c.descripcion) LIKE '%' || lower(p.pat) || '%'
      LEFT JOIN accounting.sat_codigo_agrupador sat ON sat.id = c.sat_codigo_agrupador_id
      WHERE c.activo = true
      ORDER BY match_rank ASC, p.ord ASC, length(c.num_cta) DESC, c.num_cta ASC
      LIMIT 1
      `,
      [list]
    );
    return { ok: true, row: rows[0] || null };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "42P01") {
      return { ok: false, reason: "missing_table", message: "Falta el catálogo de cuentas." };
    }
    throw e;
  }
}

/**
 * Resuelve las 3 cuentas de póliza de ingreso por factura emitida.
 * Permite override por env POLIZA_ISSUED_*_ACCOUNT_CODE.
 * @returns {Promise<{
 *   ok: true,
 *   bank: { code: string, name: string },
 *   sales: { code: string, name: string },
 *   iva: { code: string, name: string },
 * } | {
 *   ok: false,
 *   reason: string,
 *   message: string,
 *   missing: string[],
 *   accounts: Record<string, { code: string, name: string } | null>,
 * }>}
 */
export async function resolveIssuedIncomePolizaAccounts() {
  const pool = getPool();
  if (!pool) return { ...noDb(), missing: ["Banamex", "Ventas al 16%", "IVA Causado"], accounts: {} };

  const envBank = String(process.env.POLIZA_ISSUED_BANK_ACCOUNT_CODE || "").trim();
  const envSales = String(process.env.POLIZA_ISSUED_SALES_ACCOUNT_CODE || "").trim();
  const envIva = String(process.env.POLIZA_ISSUED_IVA_ACCOUNT_CODE || "").trim();

  /** @param {string} code */
  async function byCode(code) {
    if (!code) return null;
    const { rows } = await pool.query(
      `SELECT num_cta, descripcion FROM accounting.chart_accounts WHERE activo = true AND num_cta = $1 LIMIT 1`,
      [code]
    );
    if (!rows.length) return null;
    return { code: String(rows[0].num_cta), name: String(rows[0].descripcion || code) };
  }

  const bank =
    (await byCode(envBank)) ||
    (await findChartAccountByNamePatterns(["Banamex cta", "Banamex"])).row;
  const sales =
    (await byCode(envSales)) ||
    (await findChartAccountByNamePatterns(["Ventas al 16%"])).row;
  const iva =
    (await byCode(envIva)) ||
    (await findChartAccountByNamePatterns(["IVA causado al 16%", "IVA Causado"])).row;

  const mapRow = (r) =>
    r
      ? {
          code: String(r.code || r.num_cta || "").trim(),
          name: String(r.name || r.descripcion || "").trim(),
        }
      : null;

  const accounts = {
    bank: mapRow(bank),
    sales: mapRow(sales),
    iva: mapRow(iva),
  };

  /** @type {string[]} */
  const missing = [];
  if (!accounts.bank) missing.push("Banamex");
  if (!accounts.sales) missing.push("Ventas al 16%");
  if (!accounts.iva) missing.push("IVA Causado (o IVA causado al 16%)");

  if (missing.length) {
    return {
      ok: false,
      reason: "missing_accounts",
      message:
        `No se puede crear la póliza de ingreso: faltan cuentas en el catálogo (${missing.join(", ")}). ` +
        `Créalas en Catálogo de cuentas y vuelve a intentar.`,
      missing,
      accounts,
    };
  }

  return {
    ok: true,
    bank: accounts.bank,
    sales: accounts.sales,
    iva: accounts.iva,
  };
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
