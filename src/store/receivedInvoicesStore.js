import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { getPool } from "../db/pool.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

function noDb() {
  return { ok: false, reason: "no_database" };
}

function attr(obj, key) {
  if (!obj || typeof obj !== "object") return "";
  if (obj[`@_${key}`] != null) return String(obj[`@_${key}`]);
  for (const k of Object.keys(obj)) {
    if (k.startsWith("@_") && k.endsWith(`:${key}`) && obj[k] != null) return String(obj[k]);
  }
  return "";
}

function firstByLocalName(obj, localName) {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (k === localName || k.endsWith(`:${localName}`)) return v;
  }
  return null;
}

function findNodeDeep(obj, localName) {
  if (!obj || typeof obj !== "object") return null;
  const direct = firstByLocalName(obj, localName);
  if (direct) return direct;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findNodeDeep(v, localName);
      if (found) return found;
    }
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normIsoDateTime(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normUuid(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return "";
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(s) ? s : "";
}

function parseCfdiXml(xmlText) {
  const root = parser.parse(xmlText);
  const comprobante = firstByLocalName(root, "Comprobante");
  if (!comprobante || typeof comprobante !== "object") {
    throw new Error("XML no contiene nodo Comprobante.");
  }
  const emisor = firstByLocalName(comprobante, "Emisor");
  const receptor = firstByLocalName(comprobante, "Receptor");
  const impuestos = firstByLocalName(comprobante, "Impuestos");
  const timbre = findNodeDeep(comprobante, "TimbreFiscalDigital");
  const conceptosNode = firstByLocalName(comprobante, "Conceptos");
  const conceptosRaw = firstByLocalName(conceptosNode, "Concepto");
  const conceptos = Array.isArray(conceptosRaw) ? conceptosRaw : conceptosRaw ? [conceptosRaw] : [];
  const conceptText = conceptos
    .map((c) => String(attr(c, "Descripcion") || "").trim())
    .filter(Boolean)
    .join(" | ");

  return {
    cfdiUuid: normUuid(attr(timbre, "UUID")),
    issuerRfc: String(attr(emisor, "Rfc") || "").toUpperCase(),
    receiverRfc: String(attr(receptor, "Rfc") || "").toUpperCase(),
    series: String(attr(comprobante, "Serie") || ""),
    folio: String(attr(comprobante, "Folio") || ""),
    issuedAt: normIsoDateTime(attr(comprobante, "Fecha")),
    subtotal: num(attr(comprobante, "SubTotal")),
    discounts: num(attr(comprobante, "Descuento")),
    taxesTransferred: num(attr(impuestos, "TotalImpuestosTrasladados")),
    taxesWithheld: num(attr(impuestos, "TotalImpuestosRetenidos")),
    total: num(attr(comprobante, "Total")),
    currency: String(attr(comprobante, "Moneda") || "MXN").toUpperCase(),
    cfdiType: String(attr(comprobante, "TipoDeComprobante") || "").toUpperCase(),
    concept: conceptText,
  };
}

function hashSha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * @param {Buffer} buffer
 * @param {{sourceName?: string, uploadedBy?: string}} opts
 */
export async function importReceivedInvoicesZip(buffer, opts = {}) {
  const pool = getPool();
  if (!pool) return noDb();

  const sourceName = String(opts.sourceName || "cfdi-import.zip");
  const uploadedBy = String(opts.uploadedBy || "");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const xmlEntries = entries.filter((e) => !e.isDirectory && String(e.entryName || "").toLowerCase().endsWith(".xml"));
  const omitted = entries
    .filter((e) => !e.isDirectory && !String(e.entryName || "").toLowerCase().endsWith(".xml"))
    .map((e) => String(e.entryName || ""));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: batchRows } = await client.query(
      `INSERT INTO invoicing.received_import_batches
         (source_name, source_size_bytes, total_entries, xml_entries, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, public_id`,
      [sourceName, buffer.length, entries.length, xmlEntries.length, uploadedBy || null]
    );
    const batch = batchRows[0];

    const inserted = [];
    const duplicates = [];
    const errors = [];

    for (const entry of xmlEntries) {
      const entryName = String(entry.entryName || "archivo.xml");
      try {
        const xmlRaw = entry.getData().toString("utf8");
        const xmlSha256 = hashSha256(xmlRaw);
        const parsed = parseCfdiXml(xmlRaw);

        const dedupe = await client.query(
          `SELECT id, public_id, cfdi_uuid, source_entry_name
             FROM invoicing.received_invoices
            WHERE ($1 <> '' AND upper(cfdi_uuid) = $1)
               OR ($2 <> '' AND xml_sha256 = $2)
            LIMIT 1`,
          [parsed.cfdiUuid, xmlSha256]
        );

        if (dedupe.rowCount) {
          duplicates.push({
            entryName,
            cfdiUuid: parsed.cfdiUuid || null,
            existing: dedupe.rows[0],
          });
          continue;
        }

        const { rows } = await client.query(
          `INSERT INTO invoicing.received_invoices (
             import_batch_id, cfdi_uuid, issuer_rfc, receiver_rfc, series, folio, issued_at,
             subtotal, taxes_transferred, taxes_withheld, total, currency, cfdi_type, status,
             xml_sha256, source_zip_name, source_entry_name, xml_raw, meta
           ) VALUES (
             $1, NULLIF($2,''), $3, $4, NULLIF($5,''), NULLIF($6,''), $7,
             $8, $9, $10, $11, $12, $13, 'pending',
             $14, $15, $16, $17, $18::jsonb
           )
           RETURNING id, public_id, cfdi_uuid, issuer_rfc, receiver_rfc, total, issued_at, status`,
          [
            batch.id,
            parsed.cfdiUuid,
            parsed.issuerRfc,
            parsed.receiverRfc,
            parsed.series,
            parsed.folio,
            parsed.issuedAt,
            parsed.subtotal,
            parsed.taxesTransferred,
            parsed.taxesWithheld,
            parsed.total,
            parsed.currency,
            parsed.cfdiType,
            xmlSha256,
            sourceName,
            entryName,
            xmlRaw,
            JSON.stringify({
              importedFrom: "zip",
              entryName,
              concept: parsed.concept,
              discounts: parsed.discounts,
            }),
          ]
        );
        inserted.push(rows[0]);
      } catch (e) {
        errors.push({ entryName, message: e instanceof Error ? e.message : String(e) });
      }
    }

    const summary = {
      totalEntries: entries.length,
      xmlEntries: xmlEntries.length,
      omittedEntries: omitted.length,
      inserted: inserted.length,
      duplicates: duplicates.length,
      errors: errors.length,
    };

    await client.query(
      `UPDATE invoicing.received_import_batches
          SET inserted_count = $2,
              duplicate_count = $3,
              error_count = $4,
              summary = $5::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [batch.id, inserted.length, duplicates.length, errors.length, JSON.stringify({ summary, omitted, errors })]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      batch: { id: batch.id, publicId: batch.public_id },
      summary,
      inserted,
      duplicates,
      omitted,
      errors,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    if (e && typeof e === "object" && "code" in e && e.code === "42P01") {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturas recibidas." };
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Importa XML CFDI emitidos desde ZIP hacia invoicing.invoices.
 * @param {Buffer} buffer
 * @param {{sourceName?: string, uploadedBy?: string}} opts
 */
export async function importIssuedInvoicesZip(buffer, opts = {}) {
  const pool = getPool();
  if (!pool) return noDb();
  const sourceName = String(opts.sourceName || "cfdi-emitidas.zip");
  const uploadedBy = String(opts.uploadedBy || "");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const xmlEntries = entries.filter((e) => !e.isDirectory && String(e.entryName || "").toLowerCase().endsWith(".xml"));
  const omitted = entries
    .filter((e) => !e.isDirectory && !String(e.entryName || "").toLowerCase().endsWith(".xml"))
    .map((e) => String(e.entryName || ""));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = [];
    const duplicates = [];
    const errors = [];
    for (const entry of xmlEntries) {
      const entryName = String(entry.entryName || "archivo.xml");
      try {
        const xmlRaw = entry.getData().toString("utf8");
        const xmlSha256 = hashSha256(xmlRaw);
        const parsed = parseCfdiXml(xmlRaw);
        const dedupe = await client.query(
          `SELECT id, public_id, cfdi_uuid
             FROM invoicing.invoices
            WHERE ($1 <> '' AND upper(cfdi_uuid) = $1)
               OR ($2 <> '' AND coalesce(meta->>'xmlSha256','') = $2)
            LIMIT 1`,
          [parsed.cfdiUuid, xmlSha256]
        );
        if (dedupe.rowCount) {
          duplicates.push({
            entryName,
            cfdiUuid: parsed.cfdiUuid || null,
            existing: dedupe.rows[0],
          });
          continue;
        }
        const { rows } = await client.query(
          `INSERT INTO invoicing.invoices
             (folio, series, cfdi_uuid, customer_rfc, issuer_rfc, total, currency, status, pdf_url, xml_url, meta, issued_at)
           VALUES ($1, $2, NULLIF($3,''), $4, $5, $6, $7, 'issued', '', '', $8::jsonb, $9::timestamptz)
           RETURNING id, public_id, cfdi_uuid, customer_rfc, issuer_rfc, total, issued_at, status`,
          [
            parsed.folio || "",
            parsed.series || "",
            parsed.cfdiUuid || "",
            parsed.receiverRfc || "",
            parsed.issuerRfc || "",
            parsed.total || 0,
            parsed.currency || "MXN",
            JSON.stringify({
              importedFrom: "zip",
              entryName,
              sourceZipName: sourceName,
              uploadedBy,
              xmlSha256,
              concept: parsed.concept || "",
              subtotal: parsed.subtotal || 0,
              taxesTransferred: parsed.taxesTransferred || 0,
              taxesWithheld: parsed.taxesWithheld || 0,
              discounts: parsed.discounts || 0,
            }),
            parsed.issuedAt || new Date().toISOString(),
          ]
        );
        inserted.push(rows[0]);
      } catch (e) {
        errors.push({ entryName, message: e instanceof Error ? e.message : String(e) });
      }
    }
    await client.query("COMMIT");
    return {
      ok: true,
      summary: {
        totalEntries: entries.length,
        xmlEntries: xmlEntries.length,
        omittedEntries: omitted.length,
        inserted: inserted.length,
        duplicates: duplicates.length,
        errors: errors.length,
      },
      inserted,
      duplicates,
      omitted,
      errors,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    if (e && typeof e === "object" && "code" in e && e.code === "42P01") {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturación emitida." };
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {{query?: string, issuerRfc?: string, status?: string, from?: string, to?: string, page?: number, limit?: number}} p
 */
export async function listReceivedInvoices(p = {}) {
  const pool = getPool();
  if (!pool) return noDb();
  const limit = Math.max(1, Math.min(200, Number(p.limit) || 50));
  const page = Math.max(1, Number(p.page) || 1);
  const offset = (page - 1) * limit;
  const q = String(p.query || "").trim();
  const issuer = String(p.issuerRfc || "").trim().toUpperCase();
  const status = String(p.status || "").trim().toLowerCase();
  const from = String(p.from || "").slice(0, 10);
  const to = String(p.to || "").slice(0, 10);

  const values = [];
  const where = [];
  const ri = "invoicing.received_invoices";
  if (q) {
    values.push(`%${q}%`);
    where.push(
      `(coalesce(${ri}.cfdi_uuid,'') ILIKE $${values.length} OR coalesce(${ri}.series,'') ILIKE $${values.length} OR coalesce(${ri}.folio,'') ILIKE $${values.length})`
    );
  }
  if (issuer) {
    values.push(issuer);
    where.push(`${ri}.issuer_rfc = $${values.length}`);
  }
  if (status && ["pending", "paid", "cancelled"].includes(status)) {
    values.push(status);
    where.push(`${ri}.status = $${values.length}`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    values.push(from);
    where.push(`${ri}.issued_at::date >= $${values.length}::date`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    values.push(to);
    where.push(`${ri}.issued_at::date <= $${values.length}::date`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  values.push(limit, offset);
  const dataSql = `
    SELECT ${ri}.id, ${ri}.public_id, ${ri}.cfdi_uuid, ${ri}.issuer_rfc, ${ri}.receiver_rfc, ${ri}.series, ${ri}.folio, ${ri}.issued_at,
           ${ri}.subtotal::float8, ${ri}.taxes_transferred::float8, ${ri}.taxes_withheld::float8, ${ri}.total::float8,
           COALESCE(NULLIF(${ri}.meta->>'discounts','')::float8, 0)::float8 AS discounts,
           COALESCE(${ri}.meta->>'concept','') AS concept,
           ${ri}.currency, ${ri}.cfdi_type, ${ri}.status, ${ri}.paid_at, ${ri}.payment_mode, ${ri}.poliza_id, p.folio AS poliza_folio, ${ri}.source_zip_name, ${ri}.source_entry_name,
           ${ri}.created_at, ${ri}.updated_at
      FROM invoicing.received_invoices
      LEFT JOIN accounting.polizas p ON p.id = invoicing.received_invoices.poliza_id
      ${whereSql}
     ORDER BY coalesce(invoicing.received_invoices.issued_at, invoicing.received_invoices.created_at) DESC, invoicing.received_invoices.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}
  `;

  const countValues = values.slice(0, values.length - 2);
  const countSql = `SELECT count(*)::int AS n FROM invoicing.received_invoices ${whereSql}`;

  try {
    const [dataRes, countRes] = await Promise.all([pool.query(dataSql, values), pool.query(countSql, countValues)]);
    return {
      ok: true,
      rows: dataRes.rows,
      page,
      limit,
      total: countRes.rows[0]?.n || 0,
    };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "42P01") {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturas recibidas." };
    }
    throw e;
  }
}

/** @param {string} idOrPublicId */
export async function getReceivedInvoiceById(idOrPublicId) {
  const pool = getPool();
  if (!pool) return noDb();
  const id = String(idOrPublicId || "").trim();
  if (!id) return { ok: false, reason: "validation", message: "ID requerido." };
  const isNumeric = /^\d+$/.test(id);
  const sql = `
    SELECT id, public_id, cfdi_uuid, issuer_rfc, receiver_rfc, series, folio, issued_at,
           subtotal::float8, taxes_transferred::float8, taxes_withheld::float8, total::float8,
           COALESCE(NULLIF(meta->>'discounts','')::float8, 0)::float8 AS discounts,
           COALESCE(meta->>'concept','') AS concept,
           currency, cfdi_type, status, paid_at, payment_mode, poliza_id, source_zip_name, source_entry_name,
           xml_raw, meta, created_at, updated_at
      FROM invoicing.received_invoices
     WHERE ${isNumeric ? "id = $1::bigint" : "public_id::text = $1"}
     LIMIT 1
  `;
  try {
    const { rows } = await pool.query(sql, [id]);
    if (!rows.length) return { ok: false, reason: "not_found", message: "Factura no encontrada." };
    return { ok: true, row: rows[0] };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "42P01") {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturas recibidas." };
    }
    throw e;
  }
}

/** @param {string} idOrPublicId @param {"pending"|"paid"|"cancelled"} status */
export async function updateReceivedInvoiceStatus(idOrPublicId, status) {
  const pool = getPool();
  if (!pool) return noDb();
  const st = String(status || "").toLowerCase();
  if (!["pending", "paid", "cancelled"].includes(st)) {
    return { ok: false, reason: "validation", message: "Estatus inválido." };
  }
  const id = String(idOrPublicId || "").trim();
  const isNumeric = /^\d+$/.test(id);
  const sql = `
    UPDATE invoicing.received_invoices
       SET status = $2,
           paid_at = CASE WHEN $2 = 'paid' THEN coalesce(paid_at, now()) ELSE NULL END,
           updated_at = now()
     WHERE ${isNumeric ? "id = $1::bigint" : "public_id::text = $1"}
     RETURNING id, public_id, status, paid_at, updated_at
  `;
  try {
    const { rows } = await pool.query(sql, [id, st]);
    if (!rows.length) return { ok: false, reason: "not_found", message: "Factura no encontrada." };
    return { ok: true, row: rows[0] };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "42P01") {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturas recibidas." };
    }
    throw e;
  }
}

/** @param {{page?: number, limit?: number}} p */
export async function listIssuedInvoicesBase(p = {}) {
  const pool = getPool();
  if (!pool) return noDb();
  const limit = Math.max(1, Math.min(200, Number(p.limit) || 50));
  const page = Math.max(1, Number(p.page) || 1);
  const offset = (page - 1) * limit;
  try {
    const sql = `
      WITH unioned AS (
        SELECT
          concat('inv-', i.id)::text AS id,
          i.public_id::text AS public_id,
          coalesce(i.cfdi_uuid, '') AS cfdi_uuid,
          coalesce(i.folio, '') AS folio,
          coalesce(i.series, '') AS series,
          coalesce(i.customer_rfc, '') AS customer_rfc,
          coalesce(i.issuer_rfc, '') AS issuer_rfc,
          i.total::float8 AS total,
          coalesce(i.currency, 'MXN') AS currency,
          coalesce(i.status, '') AS status,
          coalesce(i.pdf_url, '') AS pdf_url,
          coalesce(i.xml_url, '') AS xml_url,
          pol.folio AS poliza_folio,
          i.issued_at,
          i.created_at
        FROM invoicing.invoices i
        LEFT JOIN LATERAL (
          SELECT p.folio
          FROM accounting.polizas p
          WHERE p.source_ref->>'module' = 'invoicing-issued'
            AND (
              (jsonb_typeof(p.source_ref->'invoiceIds') = 'array' AND (p.source_ref->'invoiceIds') ? concat('inv-', i.id::text))
              OR p.source_ref->>'invoiceId' = concat('inv-', i.id::text)
            )
          ORDER BY p.created_at DESC
          LIMIT 1
        ) pol ON true

        UNION ALL

        SELECT
          concat('pos-', po.id)::text AS id,
          concat('pos-', po.id)::text AS public_id,
          coalesce(po.cfdi_uuid, '') AS cfdi_uuid,
          coalesce(po.external_id, '') AS folio,
          '' AS series,
          '' AS customer_rfc,
          '' AS issuer_rfc,
          po.total::float8 AS total,
          coalesce(po.currency, 'MXN') AS currency,
          'facturada' AS status,
          coalesce(po.invoice_pdf_url, '') AS pdf_url,
          coalesce(po.invoice_xml_url, '') AS xml_url,
          pol.folio AS poliza_folio,
          po.occurred_at AS issued_at,
          po.created_at
        FROM pos.purchase_orders po
        LEFT JOIN LATERAL (
          SELECT p.folio
          FROM accounting.polizas p
          WHERE p.source_ref->>'module' = 'invoicing-issued'
            AND (
              (jsonb_typeof(p.source_ref->'invoiceIds') = 'array' AND (p.source_ref->'invoiceIds') ? concat('pos-', po.id::text))
              OR p.source_ref->>'invoiceId' = concat('pos-', po.id::text)
            )
          ORDER BY p.created_at DESC
          LIMIT 1
        ) pol ON true
        WHERE length(trim(coalesce(po.cfdi_uuid, ''))) > 0
           OR length(trim(coalesce(po.invoice_pdf_url, ''))) > 0
           OR length(trim(coalesce(po.invoice_xml_url, ''))) > 0
      )
      SELECT *
      FROM unioned
      ORDER BY coalesce(issued_at, created_at) DESC, id DESC
      LIMIT $1 OFFSET $2
    `;

    const countSql = `
      SELECT (
        (SELECT count(*)::int FROM invoicing.invoices) +
        (
          SELECT count(*)::int
          FROM pos.purchase_orders po
          WHERE length(trim(coalesce(po.cfdi_uuid, ''))) > 0
             OR length(trim(coalesce(po.invoice_pdf_url, ''))) > 0
             OR length(trim(coalesce(po.invoice_xml_url, ''))) > 0
        )
      )::int AS n
    `;

    const [{ rows }, { rows: cRows }] = await Promise.all([pool.query(sql, [limit, offset]), pool.query(countSql)]);
    return { ok: true, rows, total: cRows[0]?.n || 0, page, limit };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e.code === "42P01" || e.code === "42703")) {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturación emitida." };
    }
    throw e;
  }
}

/** @param {string[]} ids IDs prefijados: inv-<id> o pos-<id> */
export async function getIssuedInvoicesByPrefixedIds(ids) {
  const pool = getPool();
  if (!pool) return noDb();
  const clean = [...new Set((ids || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!clean.length) return { ok: true, rows: [] };
  const invIds = clean
    .filter((x) => /^inv-\d+$/i.test(x))
    .map((x) => Number(String(x).slice(4)))
    .filter((n) => Number.isFinite(n));
  const posIds = clean
    .filter((x) => /^pos-\d+$/i.test(x))
    .map((x) => Number(String(x).slice(4)))
    .filter((n) => Number.isFinite(n));

  try {
    const out = [];
    if (invIds.length) {
      const { rows } = await pool.query(
        `
        SELECT
          concat('inv-', i.id)::text AS id,
          i.public_id::text AS public_id,
          coalesce(i.cfdi_uuid, '') AS cfdi_uuid,
          coalesce(i.folio, '') AS folio,
          coalesce(i.series, '') AS series,
          coalesce(i.customer_rfc, '') AS customer_rfc,
          coalesce(i.issuer_rfc, '') AS issuer_rfc,
          i.total::float8 AS total,
          coalesce(i.currency, 'MXN') AS currency,
          coalesce(i.status, '') AS status,
          coalesce(i.pdf_url, '') AS pdf_url,
          coalesce(i.xml_url, '') AS xml_url,
          pol.folio AS poliza_folio,
          i.issued_at,
          i.created_at
        FROM invoicing.invoices i
        LEFT JOIN LATERAL (
          SELECT p.folio
          FROM accounting.polizas p
          WHERE p.source_ref->>'module' = 'invoicing-issued'
            AND (
              (jsonb_typeof(p.source_ref->'invoiceIds') = 'array' AND (p.source_ref->'invoiceIds') ? concat('inv-', i.id::text))
              OR p.source_ref->>'invoiceId' = concat('inv-', i.id::text)
            )
          ORDER BY p.created_at DESC
          LIMIT 1
        ) pol ON true
        WHERE i.id = ANY($1::bigint[])
        `,
        [invIds]
      );
      out.push(...rows);
    }
    if (posIds.length) {
      const { rows } = await pool.query(
        `
        SELECT
          concat('pos-', po.id)::text AS id,
          concat('pos-', po.id)::text AS public_id,
          coalesce(po.cfdi_uuid, '') AS cfdi_uuid,
          coalesce(po.external_id, '') AS folio,
          '' AS series,
          '' AS customer_rfc,
          '' AS issuer_rfc,
          po.total::float8 AS total,
          coalesce(po.currency, 'MXN') AS currency,
          'facturada' AS status,
          coalesce(po.invoice_pdf_url, '') AS pdf_url,
          coalesce(po.invoice_xml_url, '') AS xml_url,
          pol.folio AS poliza_folio,
          po.occurred_at AS issued_at,
          po.created_at
        FROM pos.purchase_orders po
        LEFT JOIN LATERAL (
          SELECT p.folio
          FROM accounting.polizas p
          WHERE p.source_ref->>'module' = 'invoicing-issued'
            AND (
              (jsonb_typeof(p.source_ref->'invoiceIds') = 'array' AND (p.source_ref->'invoiceIds') ? concat('pos-', po.id::text))
              OR p.source_ref->>'invoiceId' = concat('pos-', po.id::text)
            )
          ORDER BY p.created_at DESC
          LIMIT 1
        ) pol ON true
        WHERE po.id = ANY($1::bigint[])
        `,
        [posIds]
      );
      out.push(...rows);
    }
    return { ok: true, rows: out };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e.code === "42P01" || e.code === "42703")) {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturación emitida." };
    }
    throw e;
  }
}

/** @param {string} prefixedId inv-<id> | pos-<id> */
export async function getIssuedInvoiceDetailByPrefixedId(prefixedId) {
  const pool = getPool();
  if (!pool) return noDb();
  const id = String(prefixedId || "").trim();
  if (!id) return { ok: false, reason: "validation", message: "ID requerido." };
  const m = id.match(/^(inv|pos)-(\d+)$/i);
  if (!m) return { ok: false, reason: "validation", message: "ID inválido." };
  const kind = m[1].toLowerCase();
  const numId = Number(m[2]);
  try {
    if (kind === "inv") {
      const { rows } = await pool.query(
        `
        SELECT
          concat('inv-', i.id)::text AS id,
          i.public_id::text AS public_id,
          coalesce(i.cfdi_uuid, '') AS cfdi_uuid,
          coalesce(i.folio, '') AS folio,
          coalesce(i.series, '') AS series,
          coalesce(i.customer_rfc, '') AS customer_rfc,
          coalesce(i.issuer_rfc, '') AS issuer_rfc,
          i.total::float8 AS total,
          COALESCE(NULLIF(i.meta->>'subtotal','')::float8, round((i.total::float8 / 1.16)::numeric, 2)::float8) AS subtotal,
          COALESCE(NULLIF(i.meta->>'taxesTransferred','')::float8, round((i.total::float8 - (i.total::float8 / 1.16))::numeric, 2)::float8) AS taxes_transferred,
          COALESCE(NULLIF(i.meta->>'taxesWithheld','')::float8, 0)::float8 AS taxes_withheld,
          COALESCE(NULLIF(i.meta->>'discounts','')::float8, 0)::float8 AS discounts,
          COALESCE(i.meta->>'concept','') AS concept,
          COALESCE(i.currency, 'MXN') AS currency,
          COALESCE(i.status, '') AS status,
          pol.folio AS poliza_folio,
          i.issued_at,
          i.created_at,
          COALESCE(i.pdf_url, '') AS pdf_url,
          COALESCE(i.xml_url, '') AS xml_url
        FROM invoicing.invoices i
        LEFT JOIN LATERAL (
          SELECT p.folio
          FROM accounting.polizas p
          WHERE p.source_ref->>'module' = 'invoicing-issued'
            AND (
              (jsonb_typeof(p.source_ref->'invoiceIds') = 'array' AND (p.source_ref->'invoiceIds') ? concat('inv-', i.id::text))
              OR p.source_ref->>'invoiceId' = concat('inv-', i.id::text)
            )
          ORDER BY p.created_at DESC
          LIMIT 1
        ) pol ON true
        WHERE i.id = $1::bigint
        LIMIT 1
        `,
        [numId]
      );
      if (!rows.length) return { ok: false, reason: "not_found", message: "Factura emitida no encontrada." };
      return { ok: true, row: rows[0] };
    }

    const { rows } = await pool.query(
      `
      SELECT
        concat('pos-', po.id)::text AS id,
        concat('pos-', po.id)::text AS public_id,
        coalesce(po.cfdi_uuid, '') AS cfdi_uuid,
        coalesce(po.external_id, '') AS folio,
        '' AS series,
        '' AS customer_rfc,
        '' AS issuer_rfc,
        po.total::float8 AS total,
        po.subtotal::float8 AS subtotal,
        po.tax::float8 AS taxes_transferred,
        0::float8 AS taxes_withheld,
        0::float8 AS discounts,
        'Factura de orden POS'::text AS concept,
        coalesce(po.currency, 'MXN') AS currency,
        'facturada'::text AS status,
        pol.folio AS poliza_folio,
        po.occurred_at AS issued_at,
        po.created_at,
        coalesce(po.invoice_pdf_url, '') AS pdf_url,
        coalesce(po.invoice_xml_url, '') AS xml_url
      FROM pos.purchase_orders po
      LEFT JOIN LATERAL (
        SELECT p.folio
        FROM accounting.polizas p
        WHERE p.source_ref->>'module' = 'invoicing-issued'
          AND (
            (jsonb_typeof(p.source_ref->'invoiceIds') = 'array' AND (p.source_ref->'invoiceIds') ? concat('pos-', po.id::text))
            OR p.source_ref->>'invoiceId' = concat('pos-', po.id::text)
          )
        ORDER BY p.created_at DESC
        LIMIT 1
      ) pol ON true
      WHERE po.id = $1::bigint
      LIMIT 1
      `,
      [numId]
    );
    if (!rows.length) return { ok: false, reason: "not_found", message: "Factura POS no encontrada." };
    return { ok: true, row: rows[0] };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e.code === "42P01" || e.code === "42703")) {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturación emitida." };
    }
    throw e;
  }
}

/** @param {string} idOrPublicId @param {string|null} polizaId @param {"automatic"|"suggested"} mode */
export async function linkPaidReceivedInvoice(idOrPublicId, polizaId, mode) {
  const pool = getPool();
  if (!pool) return noDb();
  const id = String(idOrPublicId || "").trim();
  const isNumeric = /^\d+$/.test(id);
  const sql = `
    UPDATE invoicing.received_invoices
       SET status = 'paid',
           poliza_id = $2,
           payment_mode = $3,
           paid_at = coalesce(paid_at, now()),
           updated_at = now()
     WHERE ${isNumeric ? "id = $1::bigint" : "public_id::text = $1"}
     RETURNING id, public_id, status, paid_at, poliza_id, payment_mode
  `;
  try {
    const { rows } = await pool.query(sql, [id, polizaId, mode]);
    if (!rows.length) return { ok: false, reason: "not_found", message: "Factura no encontrada." };
    return { ok: true, row: rows[0] };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "42P01") {
      return { ok: false, reason: "missing_table", message: "Falta migración de facturas recibidas." };
    }
    throw e;
  }
}
