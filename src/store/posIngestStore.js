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
      RETURNING id
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
    return { id: orderId, externalId, source };
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
