import { getPool } from "../db/pool.js";

function noDb() {
  return { ok: false, reason: "no_database" };
}

/** @param {unknown} v */
function parseNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} v */
function parseDateCell(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/**
 * @param {number | undefined} fyAnchor
 * @returns {number[]}
 */
export function yearColumnsForFiscalAnchor(fyAnchor) {
  const y = Math.floor(Number(fyAnchor)) || new Date().getFullYear();
  return [y - 3, y - 2, y - 1, y];
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Record<string, number>}
 */
function parseIpcFactorsByYear(body) {
  const raw = body?.ipc_factors_by_year ?? body?.ipcFactorsByYear;
  if (raw == null || raw === "") return {};
  let o = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d{4}$/.test(k)) continue;
    const n = parseNumber(v);
    if (n != null && n > 0) out[k] = n;
  }
  return out;
}

/**
 * @param {Record<string, unknown>} body
 * @returns
 *   | { ok: true, fields: Record<string, unknown> }
 *   | { ok: false, reason: string, message: string }
 */
function normalizeScheduleBody(body) {
  const b = body && typeof body === "object" ? body : {};
  const tipoRaw = String(b.tipo ?? "depreciacion").trim().toLowerCase();
  const tipo = tipoRaw === "amortizacion" ? "amortizacion" : "depreciacion";

  let asset_inventory_id = null;
  const aid = b.asset_inventory_id ?? b.assetInventoryId;
  if (aid != null && aid !== "") {
    const n = Number(aid);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return { ok: false, reason: "validation", message: "El activo vinculado no es válido." };
    }
    asset_inventory_id = n;
  }

  const name = String(b.name ?? "").trim();
  if (!name) {
    return { ok: false, reason: "validation", message: "El nombre o concepto es obligatorio." };
  }

  const cost_original = parseNumber(b.cost_original ?? b.costOriginal);
  const cost = cost_original != null && cost_original >= 0 ? cost_original : null;
  if (cost == null) {
    return { ok: false, reason: "validation", message: "Indica un costo original válido (≥ 0)." };
  }

  const residualRaw = parseNumber(b.residual_value ?? b.residualValue);
  const residual_value = residualRaw != null && residualRaw >= 0 ? residualRaw : 0;

  if (residual_value > cost) {
    return {
      ok: false,
      reason: "validation",
      message: "El valor residual no puede ser mayor que el costo original.",
    };
  }

  const pctRaw = parseNumber(b.annual_depreciation_pct ?? b.annualDepreciationPct);
  const hasPct = pctRaw != null && pctRaw > 0;
  if (hasPct && (pctRaw > 100 || pctRaw < 0)) {
    return { ok: false, reason: "validation", message: "El % anual debe estar entre 0 y 100." };
  }

  const monthsRaw = Number(b.useful_life_months ?? b.usefulLifeMonths);
  const useful_life_months =
    monthsRaw === "" || monthsRaw == null || !Number.isFinite(monthsRaw)
      ? null
      : Math.floor(monthsRaw) >= 1
        ? Math.floor(monthsRaw)
        : null;

  if (!hasPct && useful_life_months == null) {
    return {
      ok: false,
      reason: "validation",
      message: "Indica % de depreciación anual o vida útil en meses (al menos uno).",
    };
  }

  const accRaw = parseNumber(b.accumulated_booked ?? b.accumulatedBooked);
  const accumulated_booked = accRaw != null && accRaw >= 0 ? accRaw : 0;

  const ipc_factors_by_year = parseIpcFactorsByYear(b);

  return {
    ok: true,
    fields: {
      tipo,
      asset_inventory_id,
      name,
      category: String(b.category ?? "").trim(),
      sku: String(b.sku ?? "").trim(),
      acquisition_date: parseDateCell(b.acquisition_date ?? b.acquisitionDate),
      cost_original: cost,
      residual_value,
      useful_life_months,
      accumulated_booked,
      notes: String(b.notes ?? "").trim(),
      annual_depreciation_pct: hasPct ? pctRaw : null,
      ipc_factors_by_year,
    },
  };
}

/**
 * Base depreciable y depreciación anual teórica (sin IPC).
 * @param {Record<string, unknown>} row
 */
function annualDepreciationBase(row) {
  const cost = Number(row.cost_original) || 0;
  const res = Number(row.residual_value) || 0;
  const base = Math.max(0, cost - res);
  const pct = row.annual_depreciation_pct != null && row.annual_depreciation_pct !== ""
    ? Number(row.annual_depreciation_pct)
    : null;
  if (pct != null && Number.isFinite(pct) && pct > 0) {
    return base * (pct / 100);
  }
  const months = row.useful_life_months != null ? Number(row.useful_life_months) : 0;
  if (months > 0 && Number.isFinite(months)) {
    return base * (12 / months);
  }
  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {number[]} yearCols
 */
function enrichDepreciationRow(row, yearCols) {
  const annual = annualDepreciationBase(row);
  const monthly = annual != null && Number.isFinite(annual) ? annual / 12 : null;
  let factors = row.ipc_factors_by_year;
  if (typeof factors === "string") {
    try {
      factors = JSON.parse(factors);
    } catch {
      factors = {};
    }
  }
  if (!factors || typeof factors !== "object") factors = {};

  /** @type {Record<string, number | null>} */
  const depreciation_by_year = {};
  for (const y of yearCols) {
    const key = String(y);
    const fRaw = factors[key];
    const f = fRaw != null && fRaw !== "" ? Number(fRaw) : 1;
    const factor = Number.isFinite(f) && f > 0 ? f : 1;
    depreciation_by_year[key] = annual != null && Number.isFinite(annual) ? annual * factor : null;
  }

  const cost = Number(row.cost_original) || 0;
  const accum = Number(row.accumulated_booked) || 0;
  const net_book_value = cost - accum;

  return {
    ...row,
    annual_depreciation: annual,
    monthly_charge: monthly,
    depreciation_by_year,
    net_book_value,
  };
}

/**
 * @param {import("pg").Pool} pool
 * @param {number} id
 * @param {number[]} yearCols
 */
async function fetchOneRow(pool, id, yearCols) {
  const { rows } = await pool.query(
    `
    SELECT
      d.id,
      d.tipo,
      d.asset_inventory_id,
      d.name,
      d.category,
      d.sku,
      d.acquisition_date::text AS acquisition_date,
      d.cost_original::float8 AS cost_original,
      d.residual_value::float8 AS residual_value,
      d.useful_life_months,
      d.accumulated_booked::float8 AS accumulated_booked,
      d.notes,
      d.created_at::text AS created_at,
      d.annual_depreciation_pct::float8 AS annual_depreciation_pct,
      d.ipc_factors_by_year
    FROM accounting.asset_depreciation_schedule d
    WHERE d.id = $1
    `,
    [id]
  );
  const raw = rows[0];
  if (!raw) return undefined;
  return enrichDepreciationRow(raw, yearCols);
}

/**
 * @param {{ limit?: number, q?: string, fy?: number }} opts
 */
export async function listDepreciationSchedules(opts = {}) {
  const pool = getPool();
  if (!pool) return { ...noDb(), rows: [], yearColumns: [] };

  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000);
  const q = typeof opts.q === "string" ? opts.q.trim() : "";
  const yearColumns = yearColumnsForFiscalAnchor(opts.fy);

  const params = [];
  let where = "WHERE 1=1";
  if (q) {
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    where += ` AND (
      d.name ILIKE $${params.length - 2}
      OR d.category ILIKE $${params.length - 1}
      OR d.sku ILIKE $${params.length}
    )`;
  }
  params.push(limit);

  const sql = `
    SELECT
      d.id,
      d.tipo,
      d.asset_inventory_id,
      d.name,
      d.category,
      d.sku,
      d.acquisition_date::text AS acquisition_date,
      d.cost_original::float8 AS cost_original,
      d.residual_value::float8 AS residual_value,
      d.useful_life_months,
      d.accumulated_booked::float8 AS accumulated_booked,
      d.notes,
      d.created_at::text AS created_at,
      d.annual_depreciation_pct::float8 AS annual_depreciation_pct,
      d.ipc_factors_by_year
    FROM accounting.asset_depreciation_schedule d
    ${where}
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT $${params.length}
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const enriched = rows.map((r) => enrichDepreciationRow(r, yearColumns));
    return { ok: true, rows: enriched, yearColumns };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist|column.*does not exist/i.test(msg)) {
      return { ok: false, reason: "missing_table", rows: [], yearColumns, message: msg };
    }
    throw e;
  }
}

/**
 * @param {Record<string, unknown>} body
 */
export async function createDepreciationSchedule(body) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const norm = normalizeScheduleBody(body);
  if (!norm.ok) return { ok: false, reason: norm.reason, message: norm.message };

  const f = norm.fields;
  const yearCols = yearColumnsForFiscalAnchor(undefined);

  const sql = `
    INSERT INTO accounting.asset_depreciation_schedule (
      tipo, asset_inventory_id, name, category, sku, acquisition_date,
      cost_original, residual_value, useful_life_months, accumulated_booked, notes,
      annual_depreciation_pct, ipc_factors_by_year
    ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13::jsonb)
    RETURNING id
  `;
  const params = [
    f.tipo,
    f.asset_inventory_id,
    f.name,
    f.category,
    f.sku,
    f.acquisition_date,
    f.cost_original,
    f.residual_value,
    f.useful_life_months,
    f.accumulated_booked,
    f.notes,
    f.annual_depreciation_pct,
    JSON.stringify(f.ipc_factors_by_year || {}),
  ];

  try {
    const { rows } = await pool.query(sql, params);
    const id = rows[0]?.id;
    if (id == null) {
      return { ok: false, reason: "db_error", message: "No se obtuvo el id del nuevo registro." };
    }
    const row = await fetchOneRow(pool, Number(id), yearCols);
    return { ok: true, row };
  } catch (e) {
    return mapScheduleDbError(e);
  }
}

/** @param {unknown} e */
function mapScheduleDbError(e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/relation.*asset_depreciation_schedule|does not exist|column.*does not exist/i.test(msg)) {
    return {
      ok: false,
      reason: "missing_table",
      message:
        "Falta migración de depreciaciones. Ejecuta npm run db:migrate-all (incluye 09 y 10).",
    };
  }
  if (/foreign key|violates foreign key/i.test(msg)) {
    return {
      ok: false,
      reason: "validation",
      message: "El activo del inventario seleccionado no existe o fue eliminado.",
    };
  }
  return { ok: false, reason: "db_error", message: msg };
}

/**
 * @param {string | number} id
 * @param {Record<string, unknown>} body
 */
export async function updateDepreciationSchedule(id, body) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0 || !Number.isInteger(idNum)) {
    return { ok: false, reason: "validation", message: "Id inválido." };
  }

  const norm = normalizeScheduleBody(body);
  if (!norm.ok) return { ok: false, reason: norm.reason, message: norm.message };

  const f = norm.fields;
  const yearCols = yearColumnsForFiscalAnchor(undefined);

  const sql = `
    UPDATE accounting.asset_depreciation_schedule SET
      tipo = $1,
      asset_inventory_id = $2,
      name = $3,
      category = $4,
      sku = $5,
      acquisition_date = $6::date,
      cost_original = $7,
      residual_value = $8,
      useful_life_months = $9,
      accumulated_booked = $10,
      notes = $11,
      annual_depreciation_pct = $12,
      ipc_factors_by_year = $13::jsonb,
      updated_at = now()
    WHERE id = $14
    RETURNING id
  `;
  const params = [
    f.tipo,
    f.asset_inventory_id,
    f.name,
    f.category,
    f.sku,
    f.acquisition_date,
    f.cost_original,
    f.residual_value,
    f.useful_life_months,
    f.accumulated_booked,
    f.notes,
    f.annual_depreciation_pct,
    JSON.stringify(f.ipc_factors_by_year || {}),
    idNum,
  ];

  try {
    const { rowCount } = await pool.query(sql, params);
    if (!rowCount) {
      return { ok: false, reason: "not_found", message: "No se encontró el registro." };
    }
    const row = await fetchOneRow(pool, idNum, yearCols);
    return { ok: true, row };
  } catch (e) {
    const out = mapScheduleDbError(e);
    if (out.ok === false) return out;
    throw e;
  }
}

/**
 * Crea un renglón de depreciación por cada activo del inventario que aún no tenga vínculo.
 */
export async function syncDepreciationFromActivos() {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "no_database", inserted: 0 };

  const sql = `
    INSERT INTO accounting.asset_depreciation_schedule (
      tipo, asset_inventory_id, name, category, sku, acquisition_date,
      cost_original, residual_value, useful_life_months, accumulated_booked, notes,
      annual_depreciation_pct, ipc_factors_by_year
    )
    SELECT
      'depreciacion',
      ai.id,
      COALESCE(NULLIF(trim(ai.name), ''), '—'),
      COALESCE(trim(ai.category), ''),
      COALESCE(trim(ai.sku), ''),
      ai.acquisition_date,
      COALESCE(ai.cost_estimate, 0)::numeric,
      0::numeric,
      NULL,
      0::numeric,
      '',
      10::numeric,
      '{}'::jsonb
    FROM accounting.asset_inventory ai
    WHERE NOT EXISTS (
      SELECT 1 FROM accounting.asset_depreciation_schedule s
      WHERE s.asset_inventory_id IS NOT NULL AND s.asset_inventory_id = ai.id
    )
    AND COALESCE(ai.cost_estimate, 0) > 0
  `;

  try {
    const r = await pool.query(sql);
    return { ok: true, inserted: r.rowCount ?? 0 };
  } catch (e) {
    const out = mapScheduleDbError(e);
    if (out.ok === false) return { ...out, inserted: 0 };
    throw e;
  }
}
