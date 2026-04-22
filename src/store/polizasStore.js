import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initialPolizas } from "../mock/polizas.js";
import { decryptJson, encryptJson } from "../crypto/vault.js";
import { getPool } from "../db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const POLIZAS_FILE = path.join(DATA_DIR, "polizas.enc");

/** Pólizas demo retiradas: se eliminan al cargar si aún están en disco. */
const REMOVED_POLIZA_IDS = new Set(["pol-001", "pol-002", "pol-003"]);
const REMOVED_POLIZA_FOLIOS = new Set(["P-2026-0001", "P-2026-0002", "P-2026-0003"]);

/** @type {Buffer} */
let _key;

/** @type {Array<Record<string, unknown>>} */
let polizas = [];
let seq = 1;

function usePg() {
  return getPool() !== null;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { mode: 0o700 });
}

function loadFromDisk() {
  const raw = fs.readFileSync(POLIZAS_FILE, "utf8").trim();
  const data = decryptJson(raw, _key);
  polizas = data.polizas || [];
  seq = typeof data.seq === "number" ? data.seq : polizas.length + 1;
}

function persistFile() {
  ensureDir();
  const payload = encryptJson({ polizas, seq }, _key);
  fs.writeFileSync(POLIZAS_FILE, payload + "\n", { mode: 0o600 });
}

function maxFolioNumeric(folios) {
  let m = 0;
  for (const f of folios) {
    const match = /^P-\d{4}-(\d+)$/.exec(String(f));
    if (match) m = Math.max(m, parseInt(match[1], 10));
  }
  return m;
}

/**
 * Asegura que el contador en BD sea >= max(folios)+1.
 * @param {import("pg").PoolClient} client
 */
async function alignFolioCounter(client, folioStrings) {
  const maxN = maxFolioNumeric(folioStrings);
  await client.query(
    `UPDATE accounting.folio_counter
     SET next_seq = GREATEST(next_seq, $1)
     WHERE singleton = 1`,
    [maxN + 1]
  );
}

async function loadFromPg() {
  const pool = getPool();
  if (!pool) throw new Error("Pool PostgreSQL no disponible");

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO accounting.folio_counter (singleton, next_seq) VALUES (1, 1)
       ON CONFLICT (singleton) DO NOTHING`
    );

    const { rows: pRows } = await client.query(`
      SELECT id, folio, poliza_date::text AS d, type, concept, source_ref, accounting_batch_date::text AS abd
      FROM accounting.polizas
      ORDER BY poliza_date DESC, created_at DESC
    `);

    if (pRows.length === 0) {
      polizas = [];
      return;
    }

    const ids = pRows.map((r) => r.id);
    const { rows: lRows } = await client.query(
      `
      SELECT poliza_id, line_index, ticket_id, account_code, account_name, debit::float8, credit::float8,
             line_concept, invoice_url, fx_currency, depto
      FROM accounting.poliza_lines
      WHERE poliza_id = ANY($1::varchar[])
      ORDER BY poliza_id, line_index
    `,
      [ids]
    );

    const linesBy = new Map();
    for (const l of lRows) {
      if (!linesBy.has(l.poliza_id)) linesBy.set(l.poliza_id, []);
      linesBy.get(l.poliza_id).push({
        ticketId: l.ticket_id ?? "",
        accountCode: l.account_code ?? "",
        accountName: l.account_name ?? "",
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        lineConcept: l.line_concept ?? "",
        invoiceUrl: l.invoice_url ?? "",
        fxCurrency: l.fx_currency ?? "MX",
        depto: l.depto ?? "ADMINISTRACION",
      });
    }

    polizas = pRows.map((p) => ({
      id: p.id,
      folio: p.folio,
      date: p.d,
      type: p.type,
      concept: p.concept,
      sourceRef: p.source_ref && typeof p.source_ref === "object" ? p.source_ref : {},
      accountingBatchDate: p.abd || null,
      lines: linesBy.get(p.id) || [],
    }));

    await alignFolioCounter(
      client,
      polizas.map((p) => p.folio)
    );
  } finally {
    client.release();
  }
}

/**
 * @param {Buffer} key32
 */
export async function initPolizasStore(key32) {
  _key = key32;
  ensureDir();

  if (usePg()) {
    await loadFromPg();
    return;
  }

  if (!fs.existsSync(POLIZAS_FILE)) {
    polizas = structuredClone(initialPolizas);
    seq = polizas.length + 1;
    persistFile();
    return;
  }

  try {
    loadFromDisk();
    const n0 = polizas.length;
    polizas = polizas.filter(
      (p) =>
        !REMOVED_POLIZA_IDS.has(String(p.id)) &&
        !REMOVED_POLIZA_FOLIOS.has(String(p.folio))
    );
    if (polizas.length !== n0) {
      persistFile();
    }
  } catch (e) {
    throw new Error(
      `No se pudo descifrar ${POLIZAS_FILE}. Verifica DATA_ENCRYPTION_KEY. ${e.message}`
    );
  }
}

export function getPolizas() {
  return polizas;
}

/**
 * @param {number} year
 */
export function filterPolizasByYear(year) {
  const y = String(year);
  return getPolizas().filter((p) => String(p.date || "").startsWith(y));
}

/**
 * Libro diario: pólizas del ejercicio fiscal dentro del rango de fechas, orden cronológico ascendente.
 * Usa el mismo conjunto en memoria que `/api/polizas` (año fiscal activo).
 *
 * @param {{ from: string, to: string, fiscalYear: number }} p
 */
export function getLibroDiarioEntries(p) {
  const fy = Number(p.fiscalYear);
  if (!Number.isFinite(fy)) return { ok: false, reason: "no_fiscal_year" };
  const fromD = String(p.from || "").slice(0, 10);
  const toD = String(p.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromD) || !/^\d{4}-\d{2}-\d{2}$/.test(toD)) {
    return { ok: false, reason: "invalid_range" };
  }

  const entries = filterPolizasByYear(fy)
    .filter((pol) => {
      const d = String(pol.date || "").slice(0, 10);
      return d >= fromD && d <= toD;
    })
    .sort((a, b) => {
      const c = String(a.date).localeCompare(String(b.date));
      if (c !== 0) return c;
      return String(a.folio).localeCompare(String(b.folio), "es", { numeric: true });
    })
    .map((pol) => {
      const lines = Array.isArray(pol.lines) ? pol.lines : [];
      let totalDebit = 0;
      let totalCredit = 0;
      const lineRows = lines.map((l) => {
        const deb = Number(l.debit) || 0;
        const cred = Number(l.credit) || 0;
        totalDebit += deb;
        totalCredit += cred;
        return {
          ticketId: String(l.ticketId || ""),
          accountCode: String(l.accountCode || ""),
          accountName: String(l.accountName || ""),
          lineConcept: String(l.lineConcept || ""),
          debit: deb,
          credit: cred,
          fxCurrency: String(l.fxCurrency || "MX"),
          depto: String(l.depto || ""),
        };
      });
      return {
        id: pol.id,
        folio: pol.folio,
        date: pol.date,
        type: pol.type,
        concept: pol.concept,
        totalDebit,
        totalCredit,
        lines: lineRows,
      };
    });

  let periodDebit = 0;
  let periodCredit = 0;
  for (const e of entries) {
    periodDebit += e.totalDebit;
    periodCredit += e.totalCredit;
  }

  return {
    ok: true,
    range: { from: fromD, to: toD },
    fiscalYear: fy,
    entries,
    totals: {
      debit: periodDebit,
      credit: periodCredit,
      polizaCount: entries.length,
      diff: Math.abs(periodDebit - periodCredit),
    },
  };
}

/**
 * @param {string} id
 */
export function getPolizaById(id) {
  return getPolizas().find((p) => p.id === id) || null;
}

export function getSeqState() {
  return { seq, count: polizas.length };
}

/**
 * Vista previa del siguiente folio para el año indicado (ejercicio fiscal).
 * @param {number} [fiscalYear]
 */
export async function peekNextFolio(fiscalYear) {
  const y =
    typeof fiscalYear === "number" && fiscalYear >= 1900 && fiscalYear <= 2100
      ? fiscalYear
      : new Date().getFullYear();
  if (!usePg()) {
    const n = String(seq).padStart(4, "0");
    return `P-${y}-${n}`;
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT next_seq FROM accounting.folio_counter WHERE singleton = 1`
  );
  const nextSeq = rows[0]?.next_seq ?? 1;
  const n = String(nextSeq).padStart(4, "0");
  return `P-${y}-${n}`;
}

function isoDateOrToday(raw) {
  const s = String(raw || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

function yearFromIsoDate(iso) {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return parseInt(s.slice(0, 4), 10);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function normalizeNewPolizaSourceRef(raw) {
  const fallback = { kind: "manual", label: null, tabletSync: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (o.kind === "pos_day") {
    const d = String(o.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return fallback;
    const ticketCount = Number(o.ticketCount);
    return {
      kind: "pos_day",
      date: d,
      ticketCount: Number.isFinite(ticketCount) ? ticketCount : 0,
    };
  }
  return fallback;
}

/**
 * Evita el mismo ticket (ticket_id) en más de una póliza y duplicados en la misma captura.
 * @param {Array<Record<string, unknown>>} lines
 * @param {string | null} excludePolizaId póliza en edición (no cuenta como conflicto)
 * @param {import("pg").PoolClient | null} client transacción abierta, o null en modo archivo
 */
async function assertTicketIdsForPolizaSave(lines, excludePolizaId, client) {
  const ids = [];
  const seen = new Set();
  for (const l of lines) {
    const t = String(l.ticketId || "").trim();
    if (!t) continue;
    if (seen.has(t)) {
      const e = new Error(`El ticket "${t}" aparece más de una vez en esta póliza.`);
      e.code = "TICKET_DUP_LINE";
      throw e;
    }
    seen.add(t);
    ids.push(t);
  }
  if (ids.length === 0) return;

  if (!usePg() || !client) {
    for (const p of polizas) {
      if (excludePolizaId && p.id === excludePolizaId) continue;
      for (const l of p.lines || []) {
        const tid = String(l.ticketId || "").trim();
        if (tid && seen.has(tid)) {
          const e = new Error(
            `El ticket "${tid}" ya está en la póliza ${String(p.folio || p.id)}. Elimínalo de la otra póliza o quita esta línea.`
          );
          e.code = "TICKET_IN_USE";
          throw e;
        }
      }
    }
    return;
  }

  const { rows } = await client.query(
    `
    SELECT pl.ticket_id, p.folio
    FROM accounting.poliza_lines pl
    INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
    WHERE pl.ticket_id = ANY($1::text[])
      AND ($2::varchar IS NULL OR pl.poliza_id <> $2::varchar)
    `,
    [ids, excludePolizaId]
  );
  if (rows.length > 0) {
    const r = rows[0];
    const e = new Error(
      `El ticket "${r.ticket_id}" ya está registrado en la póliza ${r.folio || "existente"}. No se puede duplicar.`
    );
    e.code = "TICKET_IN_USE";
    throw e;
  }
}

/**
 * Crea una póliza nueva (archivo local o PostgreSQL).
 * @param {{ type: string, concept: string, polizaDate?: string, lines: Array<Record<string, unknown>>, sourceRef?: unknown }} input
 */
export async function saveNewPoliza(input) {
  const type = String(input.type || "").toUpperCase();
  const concept = String(input.concept || "").trim();
  const lines = input.lines || [];
  const id = `pol-${Date.now()}`;
  const date = isoDateOrToday(input.polizaDate);
  const sourceRef = normalizeNewPolizaSourceRef(input.sourceRef);
  const y = yearFromIsoDate(date) ?? new Date().getFullYear();

  if (!usePg()) {
    await assertTicketIdsForPolizaSave(lines, null, null);
    const n = String(seq++).padStart(4, "0");
    const folio = `P-${y}-${n}`;
    const row = {
      id,
      folio,
      date,
      type,
      concept,
      sourceRef,
      accountingBatchDate: null,
      lines,
    };
    polizas = [row, ...polizas];
    persistFile();
    return row;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await assertTicketIdsForPolizaSave(lines, null, client);

    const { rows: cRows } = await client.query(
      `SELECT next_seq FROM accounting.folio_counter WHERE singleton = 1 FOR UPDATE`
    );
    const nextSeq = cRows[0]?.next_seq ?? 1;
    const folio = `P-${y}-${String(nextSeq).padStart(4, "0")}`;

    await client.query(
      `UPDATE accounting.folio_counter SET next_seq = next_seq + 1 WHERE singleton = 1`
    );

    await client.query(
      `INSERT INTO accounting.polizas (id, folio, poliza_date, type, concept, source_ref, accounting_batch_date)
       VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, $7::date)`,
      [id, folio, date, type, concept, sourceRef, null]
    );

    let idx = 0;
    for (const l of lines) {
      await client.query(
        `INSERT INTO accounting.poliza_lines
         (poliza_id, line_index, ticket_id, account_code, account_name, debit, credit, line_concept, invoice_url, fx_currency, depto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          idx,
          String(l.ticketId || "").trim(),
          String(l.accountCode || "").trim(),
          String(l.accountName || "").trim(),
          Number(l.debit) || 0,
          Number(l.credit) || 0,
          String(l.lineConcept || "").trim(),
          String(l.invoiceUrl || "").trim(),
          String(l.fxCurrency || "MX").toUpperCase(),
          String(l.depto || "ADMINISTRACION").toUpperCase(),
        ]
      );
      idx++;
    }

    await client.query("COMMIT");

    const row = {
      id,
      folio,
      date,
      type,
      concept,
      sourceRef,
      accountingBatchDate: null,
      lines,
    };
    polizas = [row, ...polizas];
    return row;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {string} id
 * @param {{ type: string, concept: string, polizaDate?: string, lines: Array<Record<string, unknown>> }} input
 */
export async function updatePoliza(id, input) {
  const pid = String(id || "").trim();
  if (!pid) throw new Error("Id de póliza inválido.");

  const type = String(input.type || "").toUpperCase();
  const concept = String(input.concept || "").trim();
  const lines = input.lines || [];
  const date = isoDateOrToday(input.polizaDate);

  const existing = getPolizaById(pid);
  if (!existing) throw new Error("Póliza no encontrada.");

  if (!usePg()) {
    await assertTicketIdsForPolizaSave(lines, pid, null);
    const idx = polizas.findIndex((p) => p.id === pid);
    if (idx === -1) throw new Error("Póliza no encontrada.");
    const folio = existing.folio;
    const row = {
      ...existing,
      date,
      type,
      concept,
      lines,
      folio,
    };
    polizas[idx] = row;
    polizas = [polizas[idx], ...polizas.filter((_, i) => i !== idx)];
    persistFile();
    return row;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await assertTicketIdsForPolizaSave(lines, pid, client);

    await client.query(
      `UPDATE accounting.polizas
       SET poliza_date = $2::date, type = $3, concept = $4
       WHERE id = $1`,
      [pid, date, type, concept]
    );

    await client.query(`DELETE FROM accounting.poliza_lines WHERE poliza_id = $1`, [pid]);

    let idx = 0;
    for (const l of lines) {
      await client.query(
        `INSERT INTO accounting.poliza_lines
         (poliza_id, line_index, ticket_id, account_code, account_name, debit, credit, line_concept, invoice_url, fx_currency, depto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          pid,
          idx,
          String(l.ticketId || "").trim(),
          String(l.accountCode || "").trim(),
          String(l.accountName || "").trim(),
          Number(l.debit) || 0,
          Number(l.credit) || 0,
          String(l.lineConcept || "").trim(),
          String(l.invoiceUrl || "").trim(),
          String(l.fxCurrency || "MX").toUpperCase(),
          String(l.depto || "ADMINISTRACION").toUpperCase(),
        ]
      );
      idx++;
    }

    await client.query("COMMIT");

    const row = {
      ...existing,
      date,
      type,
      concept,
      lines,
    };
    const memIdx = polizas.findIndex((p) => p.id === pid);
    if (memIdx !== -1) polizas[memIdx] = row;
    return row;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {string} id
 */
export async function deletePoliza(id) {
  const pid = String(id || "").trim();
  if (!pid) throw new Error("Id de póliza inválido.");

  const existing = getPolizaById(pid);
  if (!existing) throw new Error("Póliza no encontrada.");

  if (!usePg()) {
    polizas = polizas.filter((p) => p.id !== pid);
    persistFile();
    return true;
  }

  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM accounting.polizas WHERE id = $1`, [pid]);
  if (!rowCount) throw new Error("Póliza no encontrada.");
  polizas = polizas.filter((p) => p.id !== pid);
  return true;
}
