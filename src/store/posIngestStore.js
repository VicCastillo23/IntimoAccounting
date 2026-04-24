import { getPool } from "../db/pool.js";

/**
 * Registra o actualiza un ticket de venta POS en pos.purchase_orders (reportería / contabilidad).
 * Idempotente por (source, external_id).
 *
 * @param {{
 *   externalId: string,
 *   source?: string,
 *   occurredAt: string,
 *   currency?: string,
 *   subtotal: number,
 *   tax: number,
 *   total: number,
 *   loyaltyCustomerId?: number | null,
 *   lines: Array<{
 *     lineNo: number,
 *     skuOrCode?: string | null,
 *     description?: string | null,
 *     qty: number,
 *     unitPrice: number,
 *     lineTotal: number,
 *     meta?: unknown,
 *   }>,
 *   rawPayload?: unknown,
 * }} body
 */
export async function upsertPosPurchaseOrder(body) {
  const pool = getPool();
  if (!pool) {
    const err = new Error("PostgreSQL (DATABASE_URL) requerido para ingesta POS.");
    err.code = "NO_DATABASE";
    throw err;
  }

  const externalId = String(body.externalId || "").trim();
  if (!externalId) {
    const err = new Error("externalId es obligatorio.");
    err.code = "BAD_REQUEST";
    throw err;
  }
  const source = String(body.source || "intimo_pos").trim() || "intimo_pos";
  const occurredAt = String(body.occurredAt || "").trim();
  if (!occurredAt) {
    const err = new Error("occurredAt es obligatorio (ISO-8601).");
    err.code = "BAD_REQUEST";
    throw err;
  }
  const currency = String(body.currency || "MXN").trim() || "MXN";
  const subtotal = Number(body.subtotal) || 0;
  const tax = Number(body.tax) || 0;
  const total = Number(body.total) || 0;
  const loyaltyCustomerId =
    body.loyaltyCustomerId == null || body.loyaltyCustomerId === ""
      ? null
      : Number(body.loyaltyCustomerId);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  const rawPayload = body.rawPayload != null ? JSON.stringify(body.rawPayload) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ins = await client.query(
      `
      INSERT INTO pos.purchase_orders (
        external_id, source, status, occurred_at, currency,
        subtotal, tax, total, loyalty_customer_id, raw_payload
      )
      VALUES ($1, $2, 'completed', $3::timestamptz, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (source, external_id) DO UPDATE SET
        occurred_at = EXCLUDED.occurred_at,
        currency = EXCLUDED.currency,
        subtotal = EXCLUDED.subtotal,
        tax = EXCLUDED.tax,
        total = EXCLUDED.total,
        loyalty_customer_id = EXCLUDED.loyalty_customer_id,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING id, public_invoice_token
      `,
      [
        externalId,
        source,
        occurredAt,
        currency,
        subtotal,
        tax,
        total,
        Number.isFinite(loyaltyCustomerId) ? loyaltyCustomerId : null,
        rawPayload,
      ]
    );

    const orderId = ins.rows[0]?.id;
    const publicInvoiceToken = ins.rows[0]?.public_invoice_token;
    if (!orderId) {
      throw new Error("No se pudo obtener id de purchase_orders.");
    }

    await client.query(`DELETE FROM pos.purchase_lines WHERE order_id = $1`, [orderId]);

    let lineNo = 0;
    for (const line of lines) {
      lineNo += 1;
      const no = Number(line.lineNo) > 0 ? Number(line.lineNo) : lineNo;
      const qty = Number(line.qty) || 0;
      const unitPrice = Number(line.unitPrice) || 0;
      const lineTotal = Number(line.lineTotal) || 0;
      const meta = line.meta != null ? JSON.stringify(line.meta) : null;
      await client.query(
        `
        INSERT INTO pos.purchase_lines (
          order_id, line_no, sku_or_code, description, qty, unit_price, line_total, meta
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        `,
        [
          orderId,
          no,
          line.skuOrCode != null ? String(line.skuOrCode) : null,
          line.description != null ? String(line.description) : null,
          qty,
          unitPrice,
          lineTotal,
          meta,
        ]
      );
    }

    await client.query("COMMIT");
    return {
      id: orderId,
      externalId,
      source,
      publicInvoiceToken:
        publicInvoiceToken != null ? String(publicInvoiceToken).trim() : "",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Resumen de tickets POS en un rango de fechas (día calendario en zona del servidor).
 * @param {{ from: string, to: string }} range ISO YYYY-MM-DD
 */
export async function sumPosPurchasesInRange(range) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "no_database" };

  const from = String(range.from || "").slice(0, 10);
  const to = String(range.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ok: false, reason: "invalid_range" };
  }

  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*)::int AS ticket_count,
      COALESCE(SUM(total), 0)::float8 AS total_mxn
    FROM pos.purchase_orders
    WHERE source = ANY($3::text[])
      AND occurred_at::date >= $1::date
      AND occurred_at::date <= $2::date
    `,
    [from, to, ["intimo_pos", "intimo_pos_split"]]
  );

  return {
    ok: true,
    ticketCount: rows[0]?.ticket_count ?? 0,
    totalMxn: rows[0]?.total_mxn ?? 0,
  };
}

const POS_POLIZA_SOURCES = ["intimo_pos", "intimo_pos_split"];

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/**
 * Borrador de póliza INGRESOS desde tickets POS del día (pos.purchase_orders).
 * Un cargo por ticket (efectivo/ventas) y abonos consolidados a ventas + IVA.
 *
 * Cuentas por defecto configurables vía .env (ver .env.example).
 *
 * @param {string} dateStr YYYY-MM-DD (día calendario según servidor)
 * @returns {Promise<{ ok: true, date: string, ticketCount: number, subtotal: number, tax: number, total: number, type: string, concept: string, lines: Array<Record<string, unknown>>, sourceRef: { kind: string, date: string, ticketCount: number } } | { ok: false, reason: string }>}
 */
export async function buildPosDayPolizaDraft(dateStr) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "no_database" };

  const date = String(dateStr || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: "invalid_date" };
  }

  const cashCode = String(process.env.POLIZA_POS_CASH_ACCOUNT_CODE || "101-01").trim() || "101-01";
  const cashName = String(
    process.env.POLIZA_POS_CASH_ACCOUNT_NAME || "Caja / efectivo ventas"
  ).trim();
  const salesCode = String(process.env.POLIZA_POS_SALES_ACCOUNT_CODE || "401-01").trim() || "401-01";
  const salesName = String(process.env.POLIZA_POS_SALES_ACCOUNT_NAME || "Ventas").trim();
  const ivaCode = String(process.env.POLIZA_POS_IVA_ACCOUNT_CODE || "208-01").trim() || "208-01";
  const ivaName = String(process.env.POLIZA_POS_IVA_ACCOUNT_NAME || "IVA trasladado").trim();

  const { rows: dayCountRow } = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM pos.purchase_orders
    WHERE source = ANY($1::text[])
      AND occurred_at::date = $2::date
    `,
    [POS_POLIZA_SOURCES, date]
  );
  const ticketsInPosDay = dayCountRow[0]?.c ?? 0;

  const { rows: detail } = await pool.query(
    `
    SELECT
      po.external_id,
      po.subtotal::float8 AS subtotal,
      po.tax::float8 AS tax,
      po.total::float8 AS total,
      COALESCE(NULLIF(btrim(po.invoice_pdf_url), ''), '') AS invoice_pdf_url,
      COALESCE(NULLIF(btrim(po.invoice_xml_url), ''), '') AS invoice_xml_url
    FROM pos.purchase_orders po
    WHERE po.source = ANY($1::text[])
      AND po.occurred_at::date = $2::date
      AND NOT EXISTS (
        SELECT 1
        FROM accounting.poliza_lines pl
        WHERE btrim(pl.ticket_id) <> ''
          AND pl.ticket_id = po.external_id::text
      )
    ORDER BY po.occurred_at ASC, po.id ASC
    `,
    [POS_POLIZA_SOURCES, date]
  );

  const ticketCount = detail.length;
  const skippedAlreadyInPoliza = Math.max(0, ticketsInPosDay - ticketCount);

  if (ticketCount === 0) {
    const concept =
      skippedAlreadyInPoliza > 0
        ? `Todos los tickets del ${date} ya están en alguna póliza (${skippedAlreadyInPoliza} omitidos).`
        : "";
    return {
      ok: true,
      date,
      ticketCount: 0,
      ticketsInPosDay,
      skippedAlreadyInPoliza,
      subtotal: 0,
      tax: 0,
      total: 0,
      type: "INGRESOS",
      concept,
      lines: [],
      sourceRef: { kind: "pos_day", date, ticketCount: 0 },
    };
  }

  let subtotalSum = 0;
  let taxSum = 0;
  let totalSum = 0;
  /** @type {Array<Record<string, unknown>>} */
  const lines = [];
  for (const r of detail) {
    const st = roundMoney(r.subtotal);
    const tx = roundMoney(r.tax);
    const tot = roundMoney(r.total);
    subtotalSum += st;
    taxSum += tx;
    totalSum += tot;
    const pdf = String(r.invoice_pdf_url || "").trim();
    const xml = String(r.invoice_xml_url || "").trim();
    lines.push({
      ticketId: String(r.external_id || "").trim(),
      accountCode: cashCode,
      accountName: cashName,
      lineConcept: "Venta POS (ticket)",
      invoiceUrl: pdf,
      invoiceXmlUrl: xml,
      fxCurrency: "MX",
      depto: "ADMINISTRACION",
      debit: tot,
      credit: 0,
    });
  }
  subtotalSum = roundMoney(subtotalSum);
  taxSum = roundMoney(taxSum);
  totalSum = roundMoney(totalSum);

  lines.push({
    ticketId: "",
    accountCode: salesCode,
    accountName: salesName,
    lineConcept: "Ventas del día (consolidado POS)",
    invoiceUrl: "",
    fxCurrency: "MX",
    depto: "ADMINISTRACION",
    debit: 0,
    credit: subtotalSum,
  });

  if (taxSum > 0.005) {
    lines.push({
      ticketId: "",
      accountCode: ivaCode,
      accountName: ivaName,
      lineConcept: "IVA trasladado (POS)",
      invoiceUrl: "",
      fxCurrency: "MX",
      depto: "ADMINISTRACION",
      debit: 0,
      credit: taxSum,
    });
  }

  const sumD = roundMoney(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const sumC = roundMoney(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  const imbalance = roundMoney(sumD - sumC);
  if (Math.abs(imbalance) > 0.005) {
    const salesLine = lines.find((l) => String(l.accountCode) === salesCode && Number(l.credit) > 0);
    if (salesLine) {
      salesLine.credit = roundMoney(Number(salesLine.credit) + imbalance);
    }
  }

  const concept = `Cierre ventas del día ${date} — ${ticketCount} ticket(s) POS no registrados aún en pólizas (total $${totalSum.toFixed(2)} MXN)${
    skippedAlreadyInPoliza > 0 ? ` · ${skippedAlreadyInPoliza} ticket(s) ya en pólizas omitidos` : ""
  }`;

  return {
    ok: true,
    date,
    ticketCount,
    ticketsInPosDay,
    skippedAlreadyInPoliza,
    subtotal: subtotalSum,
    tax: taxSum,
    total: totalSum,
    type: "INGRESOS",
    concept,
    lines,
    sourceRef: { kind: "pos_day", date, ticketCount },
  };
}
