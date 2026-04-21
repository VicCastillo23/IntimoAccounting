import { randomUUID } from "node:crypto";
import XLSX from "xlsx";
import { getPool } from "../db/pool.js";

function noDb() {
  return { ok: false, reason: "no_database" };
}

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** @param {string} h */
function mapHeaderToField(h) {
  const n = norm(h);
  if (!n) return null;
  /** @type {Array<[string, string[]]>} */
  const rules = [
    ["category", ["categoria", "tipo", "familia", "grupo", "clasificacion"]],
    ["name", ["nombre", "descripcion", "concepto", "articulo", "item"]],
    ["sku", ["codigo", "sku", "clave", "referencia"]],
    ["quantity", ["cantidad", "qty", "piezas", "existencia", "stock"]],
    ["unit", ["unidad", "udm", "medida"]],
    ["location", ["ubicacion", "lugar", "almacen", "zona", "sala"]],
    ["stateCondition", ["estado", "condicion", "status"]],
    ["acquisitionDate", ["fecha", "fecha adquisicion", "fecha compra", "adquisicion", "fecha de compra"]],
    ["costEstimate", ["costo", "valor", "precio", "importe", "costo estimado"]],
    ["notes", ["notas", "observaciones", "comentarios"]],
  ];
  for (const [field, keys] of rules) {
    if (keys.includes(n)) return field;
  }
  return null;
}

/**
 * @param {unknown[]} headerRow
 * @returns {Record<number, string>}
 */
function buildColumnMap(headerRow) {
  /** @type {Record<number, string>} */
  const map = {};
  if (!Array.isArray(headerRow)) return map;
  headerRow.forEach((cell, i) => {
    const f = mapHeaderToField(cell);
    if (f) map[i] = f;
  });
  const used = new Set(Object.values(map));
  if (used.size === 0 && headerRow.filter((c) => String(c).trim()).length >= 1) {
    map[0] = "category";
    map[1] = "name";
    map[2] = "quantity";
    map[3] = "unit";
    map[4] = "location";
    map[5] = "notes";
  }
  return map;
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
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    const utc = Math.floor((v - 25569) * 86400 * 1000);
    const d = new Date(utc);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yy = m[3];
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

/**
 * @param {Record<number, string>} colMap
 * @param {unknown[]} row
 * @param {number} rowNum
 */
function rowToRecord(colMap, row, rowNum) {
  const out = {
    rowNum,
    category: "",
    name: "",
    sku: "",
    quantity: 1,
    unit: "",
    location: "",
    stateCondition: "",
    acquisitionDate: /** @type {string | null} */ (null),
    costEstimate: /** @type {number | null} */ (null),
    notes: "",
  };
  const arr = Array.isArray(row) ? row : [];
  for (let i = 0; i < arr.length; i++) {
    const field = colMap[i];
    if (!field) continue;
    const raw = arr[i];
    switch (field) {
      case "category":
        out.category = String(raw ?? "").trim();
        break;
      case "name":
        out.name = String(raw ?? "").trim();
        break;
      case "sku":
        out.sku = String(raw ?? "").trim();
        break;
      case "quantity": {
        const n = parseNumber(raw);
        if (n != null && n >= 0) out.quantity = n;
        break;
      }
      case "unit":
        out.unit = String(raw ?? "").trim();
        break;
      case "location":
        out.location = String(raw ?? "").trim();
        break;
      case "stateCondition":
        out.stateCondition = String(raw ?? "").trim();
        break;
      case "acquisitionDate":
        out.acquisitionDate = parseDateCell(raw);
        break;
      case "costEstimate": {
        const n = parseNumber(raw);
        out.costEstimate = n;
        break;
      }
      case "notes":
        out.notes = String(raw ?? "").trim();
        break;
      default:
        break;
    }
  }
  return out;
}

function isRowEmpty(rec) {
  return (
    !rec.category &&
    !rec.name &&
    !rec.sku &&
    (rec.quantity === 1 || rec.quantity === 0) &&
    !rec.unit &&
    !rec.location &&
    !rec.stateCondition &&
    !rec.acquisitionDate &&
    (rec.costEstimate == null || rec.costEstimate === 0) &&
    !rec.notes
  );
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 */
export function parseActivosExcelToRecords(buffer, filename) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { ok: false, message: "El archivo no tiene hojas." };
  }
  const sheet = wb.Sheets[sheetName];
  /** @type {unknown[][]} */
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  if (!aoa.length) {
    return { ok: false, message: "La primera hoja está vacía." };
  }

  let headerRow = aoa[0];
  let dataRows = aoa.slice(1);
  const nonEmptyHeader = (headerRow || []).filter((c) => String(c).trim()).length;
  if (nonEmptyHeader === 0) {
    return { ok: false, message: "No se detectó fila de encabezados." };
  }

  let colMap = buildColumnMap(/** @type {unknown[]} */ (headerRow));
  if (Object.keys(colMap).length === 0) {
    headerRow = ["Categoría", "Nombre", "Cantidad", "Unidad", "Ubicación", "Notas"];
    colMap = buildColumnMap(headerRow);
    dataRows = aoa;
  }

  const records = [];
  let excelRow = 1;
  for (const row of dataRows) {
    excelRow += 1;
    if (!Array.isArray(row)) continue;
    const rec = rowToRecord(colMap, row, excelRow);
    if (isRowEmpty(rec)) continue;
    if (!rec.name && !rec.category && !rec.sku) continue;
    records.push(rec);
  }

  if (!records.length) {
    return { ok: false, message: "No hay filas de datos válidas (se requiere al menos categoría, nombre o código)." };
  }

  return { ok: true, records, sheetName, filename: String(filename || "import.xlsx") };
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 */
export async function importActivosFromExcelBuffer(buffer, filename) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const parsed = parseActivosExcelToRecords(buffer, filename);
  if (!parsed.ok) return { ok: false, reason: "parse_error", message: parsed.message };

  const batchId = randomUUID();
  const fname = parsed.filename;
  const { records } = parsed;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const r of records) {
      await client.query(
        `
        INSERT INTO accounting.asset_inventory (
          import_batch_id, import_filename, row_num,
          category, name, sku, quantity, unit, location, state_condition,
          acquisition_date, cost_estimate, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13)
        `,
        [
          batchId,
          fname,
          r.rowNum,
          r.category,
          r.name || "—",
          r.sku,
          r.quantity,
          r.unit,
          r.location,
          r.stateCondition,
          r.acquisitionDate,
          r.costEstimate,
          r.notes,
        ]
      );
      inserted += 1;
    }
    await client.query("COMMIT");
    return {
      ok: true,
      importBatchId: batchId,
      importFilename: fname,
      inserted,
      sheetName: parsed.sheetName,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = e instanceof Error ? e.message : String(e);
    if (/relation.*asset_inventory|does not exist/i.test(msg)) {
      return {
        ok: false,
        reason: "missing_table",
        message:
          "La tabla de activos no existe. Ejecuta en el servidor: npm run db:migrate-all (o aplica deploy/postgres/08_asset_inventory.sql).",
      };
    }
    return { ok: false, reason: "db_error", message: msg };
  } finally {
    client.release();
  }
}

/**
 * @param {{ limit?: number, batchId?: string, q?: string }} opts
 */
const MANUAL_IMPORT_FILENAME = "Captura manual";

/**
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, fields: Record<string, unknown> } | { ok: false, reason: string, message: string }}
 */
function normalizeActivosWriteBody(body) {
  const b = body && typeof body === "object" ? body : {};
  const category = String(b.category ?? "").trim();
  const nameRaw = String(b.name ?? "").trim();
  const sku = String(b.sku ?? "").trim();
  if (!category && !nameRaw && !sku) {
    return {
      ok: false,
      reason: "validation",
      message: "Indica al menos categoría, nombre o código.",
    };
  }
  const name = nameRaw || "—";
  const qtyRaw = parseNumber(b.quantity);
  const quantity =
    qtyRaw != null && qtyRaw >= 0 ? qtyRaw : 1;
  const costRaw = parseNumber(b.cost_estimate ?? b.costEstimate);
  const cost_estimate = costRaw != null && Number.isFinite(costRaw) ? costRaw : null;
  const acquisition_date = parseDateCell(b.acquisition_date ?? b.acquisitionDate);
  return {
    ok: true,
    fields: {
      category,
      name,
      sku,
      quantity,
      unit: String(b.unit ?? "").trim(),
      location: String(b.location ?? "").trim(),
      state_condition: String(b.state_condition ?? b.stateCondition ?? "").trim(),
      acquisition_date,
      cost_estimate,
      notes: String(b.notes ?? "").trim(),
    },
  };
}

/**
 * @param {Record<string, unknown>} body
 */
export async function createAssetInventoryItem(body) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const norm = normalizeActivosWriteBody(body);
  if (!norm.ok) return { ok: false, reason: norm.reason, message: norm.message };

  const f = norm.fields;
  const batchId = randomUUID();

  const sql = `
    INSERT INTO accounting.asset_inventory (
      import_batch_id, import_filename, row_num,
      category, name, sku, quantity, unit, location, state_condition,
      acquisition_date, cost_estimate, notes
    ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13)
    RETURNING id, import_batch_id::text AS import_batch_id, import_filename, row_num,
      category, name, sku, quantity::float8 AS quantity, unit, location, state_condition,
      acquisition_date::text AS acquisition_date, cost_estimate::float8 AS cost_estimate, notes,
      created_at::text AS created_at
  `;
  const params = [
    batchId,
    MANUAL_IMPORT_FILENAME,
    0,
    f.category,
    f.name,
    f.sku,
    f.quantity,
    f.unit,
    f.location,
    f.state_condition,
    f.acquisition_date,
    f.cost_estimate,
    f.notes,
  ];

  try {
    const { rows } = await pool.query(sql, params);
    return { ok: true, row: rows[0] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/relation.*asset_inventory|does not exist/i.test(msg)) {
      return {
        ok: false,
        reason: "missing_table",
        message:
          "La tabla de activos no existe. Ejecuta en el servidor: npm run db:migrate-all (o aplica deploy/postgres/08_asset_inventory.sql).",
      };
    }
    return { ok: false, reason: "db_error", message: msg };
  }
}

/**
 * @param {string | number} id
 * @param {Record<string, unknown>} body
 */
export async function updateAssetInventoryItem(id, body) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0 || !Number.isInteger(idNum)) {
    return { ok: false, reason: "validation", message: "Id inválido." };
  }

  const norm = normalizeActivosWriteBody(body);
  if (!norm.ok) return { ok: false, reason: norm.reason, message: norm.message };

  const f = norm.fields;

  const sql = `
    UPDATE accounting.asset_inventory SET
      category = $1,
      name = $2,
      sku = $3,
      quantity = $4,
      unit = $5,
      location = $6,
      state_condition = $7,
      acquisition_date = $8::date,
      cost_estimate = $9,
      notes = $10,
      updated_at = now()
    WHERE id = $11
    RETURNING id, import_batch_id::text AS import_batch_id, import_filename, row_num,
      category, name, sku, quantity::float8 AS quantity, unit, location, state_condition,
      acquisition_date::text AS acquisition_date, cost_estimate::float8 AS cost_estimate, notes,
      created_at::text AS created_at
  `;
  const params = [
    f.category,
    f.name,
    f.sku,
    f.quantity,
    f.unit,
    f.location,
    f.state_condition,
    f.acquisition_date,
    f.cost_estimate,
    f.notes,
    idNum,
  ];

  try {
    const { rows, rowCount } = await pool.query(sql, params);
    if (!rowCount) {
      return { ok: false, reason: "not_found", message: "No se encontró el registro." };
    }
    return { ok: true, row: rows[0] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist/i.test(msg)) {
      return { ok: false, reason: "missing_table", message: msg };
    }
    return { ok: false, reason: "db_error", message: msg };
  }
}

export async function listAssetInventory(opts = {}) {
  const pool = getPool();
  if (!pool) return { ...noDb(), rows: [] };

  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000);
  const batchId = typeof opts.batchId === "string" ? opts.batchId.trim() : "";
  const q = typeof opts.q === "string" ? opts.q.trim() : "";

  const params = [];
  let where = "WHERE 1=1";
  if (batchId && /^[0-9a-f-]{36}$/i.test(batchId)) {
    params.push(batchId);
    where += ` AND import_batch_id = $${params.length}::uuid`;
  }
  if (q) {
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    where += ` AND (
      category ILIKE $${params.length - 2}
      OR name ILIKE $${params.length - 1}
      OR sku ILIKE $${params.length}
    )`;
  }
  params.push(limit);

  const sql = `
    SELECT id, import_batch_id::text AS import_batch_id, import_filename, row_num,
           category, name, sku, quantity::float8 AS quantity, unit, location, state_condition,
           acquisition_date::text AS acquisition_date, cost_estimate::float8 AS cost_estimate, notes,
           created_at::text AS created_at
    FROM accounting.asset_inventory
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT $${params.length}
  `;

  try {
    const { rows } = await pool.query(sql, params);
    return { ok: true, rows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist/i.test(msg)) {
      return { ok: false, reason: "missing_table", rows: [], message: msg };
    }
    throw e;
  }
}

export function buildActivosTemplateXlsx() {
  const header = [
    "Categoría",
    "Nombre",
    "Código",
    "Cantidad",
    "Unidad",
    "Ubicación",
    "Estado",
    "Fecha adquisición",
    "Costo estimado",
    "Notas",
  ];
  const example = [
    "Silla",
    "Silla barra alto",
    "SILLA-01",
    4,
    "pz",
    "Cafetería",
    "Bueno",
    "2025-06-01",
    1200,
    "Ejemplo de fila; borrar o sustituir.",
  ];
  const ws = XLSX.utils.aoa_to_sheet([header, example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Activos");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
