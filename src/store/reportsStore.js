import { getPool } from "../db/pool.js";
import { sumPosPurchasesInRange } from "./posIngestStore.js";

/** @typedef {'ACTIVO'|'PASIVO'|'CAPITAL'|'INGRESOS'|'COSTOS'|'GASTOS'|'OTRO'} SatBucket */

/**
 * Clasificación por orden del catálogo SAT (Anexo 24) en este proyecto.
 * @param {number | null | undefined} orden
 * @returns {SatBucket}
 */
export function satBucketFromOrden(orden) {
  const o = Number(orden);
  if (!Number.isFinite(o)) return "OTRO";
  if (o < 104) return "ACTIVO";
  if (o < 169) return "PASIVO";
  if (o < 184) return "CAPITAL";
  if (o < 200) return "INGRESOS";
  if (o < 210) return "COSTOS";
  if (o < 276) return "GASTOS";
  return "OTRO";
}

function noDb() {
  return { ok: false, reason: "no_database" };
}

function splitDebitCreditFromNet(net) {
  return {
    deudor: net > 0 ? net : 0,
    acreedor: net < 0 ? -net : 0,
  };
}

/** @param {string} iso YYYY-MM-DD */
function dayBefore(iso) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Movimientos acumulados por cuenta hasta una fecha (inclusive).
 * @param {import("pg").PoolClient} client
 * @param {string} asOf
 */
async function cumulativeAccountRows(client, asOf) {
  const { rows } = await client.query(
    `
    SELECT
      pl.account_code,
      COALESCE(SUM(pl.debit), 0)::float8 AS debit,
      COALESCE(SUM(pl.credit), 0)::float8 AS credit,
      sat.orden AS sat_orden
    FROM accounting.poliza_lines pl
    INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
    LEFT JOIN accounting.chart_accounts c ON c.num_cta = pl.account_code
    LEFT JOIN accounting.sat_codigo_agrupador sat ON sat.id = c.sat_codigo_agrupador_id
    WHERE p.poliza_date <= $1::date
    GROUP BY pl.account_code, sat.orden
    `,
    [asOf]
  );
  return rows;
}

/**
 * @param {Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>} rows
 */
function foldBalanceSheet(rows) {
  let activo = 0;
  let pasivo = 0;
  let capital = 0;
  let ingresosAcum = 0;
  let costosAcum = 0;
  let gastosAcum = 0;

  for (const r of rows) {
    const d = Number(r.debit) || 0;
    const c = Number(r.credit) || 0;
    const net = d - c;
    const b = satBucketFromOrden(r.sat_orden);
    if (b === "ACTIVO") activo += Math.max(net, 0);
    else if (b === "PASIVO") pasivo += Math.max(-net, 0);
    else if (b === "CAPITAL") capital += Math.max(-net, 0);
    else if (b === "INGRESOS") ingresosAcum += c - d;
    else if (b === "COSTOS") costosAcum += d - c;
    else if (b === "GASTOS") gastosAcum += d - c;
  }

  const resultadoDelEjercicio = ingresosAcum - costosAcum - gastosAcum;
  const totalPasivoCapital = pasivo + capital + resultadoDelEjercicio;
  return {
    activo,
    pasivo,
    capital,
    ingresosAcum,
    costosAcum,
    gastosAcum,
    resultadoDelEjercicio,
    totalPasivoCapital,
    cuadre: Math.abs(activo - totalPasivoCapital),
  };
}

/**
 * Desglose de balance por bandas de orden SAT (Anexo 24) para presentación tipo NIF B-6.
 * Activo circulante: órdenes 3–61 · No circulante: 62–103 · Pasivo corto: 106–150 · largo: 151–168 · Capital (cuentas): 170–183.
 */
function foldBalanceSheetBands(rows) {
  const full = foldBalanceSheet(rows);
  let activoCirculante = 0;
  let activoNoCirculante = 0;
  let pasivoCirculante = 0;
  let pasivoNoCirculante = 0;
  let capitalCuentas = 0;

  for (const r of rows) {
    const d = Number(r.debit) || 0;
    const c = Number(r.credit) || 0;
    const net = d - c;
    const o = Number(r.sat_orden);
    if (!Number.isFinite(o)) continue;
    if (o >= 3 && o <= 61) activoCirculante += Math.max(net, 0);
    else if (o >= 62 && o <= 103) activoNoCirculante += Math.max(net, 0);
    else if (o >= 106 && o <= 150) pasivoCirculante += Math.max(-net, 0);
    else if (o >= 151 && o <= 168) pasivoNoCirculante += Math.max(-net, 0);
    else if (o >= 170 && o <= 183) capitalCuentas += Math.max(-net, 0);
  }

  return {
    activoCirculante,
    activoNoCirculante,
    pasivoCirculante,
    pasivoNoCirculante,
    capitalCuentas,
    activo: full.activo,
    pasivo: full.pasivo,
    capital: full.capital,
    resultadoDelEjercicio: full.resultadoDelEjercicio,
    totalPasivoCapital: full.totalPasivoCapital,
    cuadre: full.cuadre,
  };
}

/**
 * @param {Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>} movRows
 */
function aggregateIncomeStatementFromMovRows(movRows) {
  let ingresos = 0;
  let costos = 0;
  let gastos = 0;
  for (const r of movRows) {
    const d = Number(r.debit) || 0;
    const c = Number(r.credit) || 0;
    const b = satBucketFromOrden(r.sat_orden);
    if (b === "INGRESOS") ingresos += c - d;
    else if (b === "COSTOS") costos += d - c;
    else if (b === "GASTOS") gastos += d - c;
  }
  const utilidadBruta = ingresos - costos;
  const utilidadNeta = utilidadBruta - gastos;
  return { ingresos, costos, gastos, utilidadBruta, utilidadNeta };
}

/**
 * @param {{ from: string, to: string, asOf?: string, compareAsOf?: string, compareFrom?: string, compareTo?: string }} range ISO dates YYYY-MM-DD
 */
export async function getReportsDashboard(range) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const from = String(range.from || "").slice(0, 10);
  const to = String(range.to || "").slice(0, 10);
  const asOf = String(range.asOf || range.to || "").slice(0, 10);
  const compareAsOf = String(range.compareAsOf || "").slice(0, 10);
  const compareFrom = String(range.compareFrom || "").slice(0, 10);
  const compareTo = String(range.compareTo || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ok: false, reason: "invalid_range" };
  }

  const client = await pool.connect();
  try {
    const openingDate = dayBefore(from);

    const { rows: openingTbRows } = await client.query(
      `
      SELECT
        pl.account_code AS account_code,
        MAX(pl.account_name) AS account_name,
        COALESCE(SUM(pl.debit), 0)::float8 AS debit,
        COALESCE(SUM(pl.credit), 0)::float8 AS credit
      FROM accounting.poliza_lines pl
      INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
      WHERE p.poliza_date < $1::date
      GROUP BY pl.account_code
      ORDER BY pl.account_code
      `,
      [from]
    );

    const { rows: tbMovRows } = await client.query(
      `
      SELECT
        pl.account_code AS account_code,
        MAX(pl.account_name) AS account_name,
        COALESCE(SUM(pl.debit), 0)::float8 AS debit,
        COALESCE(SUM(pl.credit), 0)::float8 AS credit
      FROM accounting.poliza_lines pl
      INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
      WHERE p.poliza_date >= $1::date AND p.poliza_date <= $2::date
      GROUP BY pl.account_code
      ORDER BY pl.account_code
      `,
      [from, to]
    );

    const byCode = new Map();
    for (const r of openingTbRows) {
      const code = String(r.account_code || "").trim();
      if (!code) continue;
      byCode.set(code, {
        accountCode: code,
        accountName: String(r.account_name || "").trim(),
        openingDebit: Number(r.debit) || 0,
        openingCredit: Number(r.credit) || 0,
        periodDebit: 0,
        periodCredit: 0,
      });
    }
    for (const r of tbMovRows) {
      const code = String(r.account_code || "").trim();
      if (!code) continue;
      const cur = byCode.get(code) || {
        accountCode: code,
        accountName: String(r.account_name || "").trim(),
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 0,
        periodCredit: 0,
      };
      if (!cur.accountName) cur.accountName = String(r.account_name || "").trim();
      cur.periodDebit = Number(r.debit) || 0;
      cur.periodCredit = Number(r.credit) || 0;
      byCode.set(code, cur);
    }

    let totalOpeningDeudor = 0;
    let totalOpeningAcreedor = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    let totalClosingDeudor = 0;
    let totalClosingAcreedor = 0;
    const trialBalance = [...byCode.values()]
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode, "es-MX"))
      .map((r) => {
      const openingNet = r.openingDebit - r.openingCredit;
      const openingSplit = splitDebitCreditFromNet(openingNet);
      const d = r.periodDebit;
      const c = r.periodCredit;
      const closingNet = openingNet + (d - c);
      const closingSplit = splitDebitCreditFromNet(closingNet);
      totalOpeningDeudor += openingSplit.deudor;
      totalOpeningAcreedor += openingSplit.acreedor;
      totalDebit += d;
      totalCredit += c;
      totalClosingDeudor += closingSplit.deudor;
      totalClosingAcreedor += closingSplit.acreedor;
      return {
        accountCode: r.accountCode,
        accountName: r.accountName,
        openingSaldoDeudor: openingSplit.deudor,
        openingSaldoAcreedor: openingSplit.acreedor,
        debit: d,
        credit: c,
        saldoDeudor: closingSplit.deudor,
        saldoAcreedor: closingSplit.acreedor,
      };
    });

    const { rows: movRows } = await client.query(
      `
      SELECT
        pl.account_code,
        COALESCE(SUM(pl.debit), 0)::float8 AS debit,
        COALESCE(SUM(pl.credit), 0)::float8 AS credit,
        sat.orden AS sat_orden
      FROM accounting.poliza_lines pl
      INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
      LEFT JOIN accounting.chart_accounts c ON c.num_cta = pl.account_code
      LEFT JOIN accounting.sat_codigo_agrupador sat ON sat.id = c.sat_codigo_agrupador_id
      WHERE p.poliza_date >= $1::date AND p.poliza_date <= $2::date
      GROUP BY pl.account_code, sat.orden
      `,
      [from, to]
    );

    const incCurrent = aggregateIncomeStatementFromMovRows(movRows);
    const ingresos = incCurrent.ingresos;
    const costos = incCurrent.costos;
    const gastos = incCurrent.gastos;
    const utilidadBruta = incCurrent.utilidadBruta;
    const utilidadNeta = incCurrent.utilidadNeta;

    const rowsOpening = await cumulativeAccountRows(client, openingDate);
    const rowsClosing = await cumulativeAccountRows(client, asOf);
    const balanceOpening = foldBalanceSheet(rowsOpening);
    const balanceClosing = foldBalanceSheet(rowsClosing);
    const bandsClosing = foldBalanceSheetBands(rowsClosing);

    let bandsCompare = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(compareAsOf)) {
      const rowsCmp = await cumulativeAccountRows(client, compareAsOf);
      bandsCompare = foldBalanceSheetBands(rowsCmp);
    }

    let incomeCompare = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(compareFrom) && /^\d{4}-\d{2}-\d{2}$/.test(compareTo)) {
      const { rows: movCmp } = await client.query(
        `
      SELECT
        pl.account_code,
        COALESCE(SUM(pl.debit), 0)::float8 AS debit,
        COALESCE(SUM(pl.credit), 0)::float8 AS credit,
        sat.orden AS sat_orden
      FROM accounting.poliza_lines pl
      INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
      LEFT JOIN accounting.chart_accounts c ON c.num_cta = pl.account_code
      LEFT JOIN accounting.sat_codigo_agrupador sat ON sat.id = c.sat_codigo_agrupador_id
      WHERE p.poliza_date >= $1::date AND p.poliza_date <= $2::date
      GROUP BY pl.account_code, sat.orden
      `,
        [compareFrom, compareTo]
      );
      incomeCompare = aggregateIncomeStatementFromMovRows(movCmp);
    }

    const cambiosSituacionFinanciera = {
      fechaInicial: openingDate,
      fechaFinal: asOf,
      activo: {
        inicial: balanceOpening.activo,
        final: balanceClosing.activo,
        variacion: balanceClosing.activo - balanceOpening.activo,
      },
      pasivo: {
        inicial: balanceOpening.pasivo,
        final: balanceClosing.pasivo,
        variacion: balanceClosing.pasivo - balanceOpening.pasivo,
      },
      capitalContable: {
        inicial: balanceOpening.capital + balanceOpening.resultadoDelEjercicio,
        final: balanceClosing.capital + balanceClosing.resultadoDelEjercicio,
        variacion:
          balanceClosing.capital +
          balanceClosing.resultadoDelEjercicio -
          (balanceOpening.capital + balanceOpening.resultadoDelEjercicio),
      },
    };

    const variacionCapitalContable = {
      capitalAlInicio: balanceOpening.capital,
      resultadoDelPeriodo: utilidadNeta,
      capitalAlCierre: balanceClosing.capital,
      utilidadAcumuladaCierre:
        balanceClosing.resultadoDelEjercicio - balanceOpening.resultadoDelEjercicio,
      nota:
        "Capital contable según código agrupador SAT (grupo Capital). La utilidad acumulada refleja el cambio en resultado entre fechas.",
    };

    /** Efectivo e inversiones inmediatas: SAT órdenes 3–7 (Caja, Bancos…). */
    const { rows: cashRows } = await client.query(
      `
      SELECT
        COALESCE(SUM(pl.credit) - SUM(pl.debit), 0)::float8 AS neto
      FROM accounting.poliza_lines pl
      INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
      LEFT JOIN accounting.chart_accounts c ON c.num_cta = pl.account_code
      LEFT JOIN accounting.sat_codigo_agrupador sat ON sat.id = c.sat_codigo_agrupador_id
      WHERE p.poliza_date >= $1::date AND p.poliza_date <= $2::date
        AND sat.orden IS NOT NULL AND sat.orden >= 3 AND sat.orden <= 7
      `,
      [from, to]
    );
    const netoEfectivoPeriodo = Number(cashRows[0]?.neto) || 0;

    const estadoFlujoEfectivo = {
      indirectoSimplificado: {
        utilidadNeta,
        variacionCapitalTrabajoAprox: cambiosSituacionFinanciera.activo.variacion - cambiosSituacionFinanciera.pasivo.variacion,
        nota: "Aproximación demo: no sustituye el método directo/indirecto NIF completo.",
      },
      cuentasEfectivoSat: {
        netoIncrementoEfectivo: netoEfectivoPeriodo,
        criterio: "Movimiento neto (abonos − cargos) en cuentas SAT órdenes 3–7 (Caja y bancos).",
      },
    };

    const { rows: cnt } = await client.query(
      `SELECT COUNT(*)::int AS n FROM accounting.polizas WHERE poliza_date >= $1::date AND poliza_date <= $2::date`,
      [from, to]
    );

    const posSales = await sumPosPurchasesInRange({ from, to });

    return {
      ok: true,
      range: {
        from,
        to,
        asOf,
        openingDate,
        compareAsOf: /^\d{4}-\d{2}-\d{2}$/.test(compareAsOf) ? compareAsOf : null,
        compareFrom: /^\d{4}-\d{2}-\d{2}$/.test(compareFrom) ? compareFrom : null,
        compareTo: /^\d{4}-\d{2}-\d{2}$/.test(compareTo) ? compareTo : null,
      },
      polizasEnPeriodo: cnt[0]?.n ?? 0,
      trialBalance,
      totals: {
        openingDeudor: totalOpeningDeudor,
        openingAcreedor: totalOpeningAcreedor,
        debit: totalDebit,
        credit: totalCredit,
        diff: Math.abs(totalDebit - totalCredit),
        closingDeudor: totalClosingDeudor,
        closingAcreedor: totalClosingAcreedor,
      },
      openingBalances: trialBalance.map((r) => ({
        accountCode: r.accountCode,
        accountName: r.accountName,
        saldoDeudor: r.openingSaldoDeudor,
        saldoAcreedor: r.openingSaldoAcreedor,
      })),
      incomeStatement: {
        ingresos,
        costos,
        gastos,
        utilidadBruta,
        utilidadNeta,
      },
      balanceSheet: {
        activo: balanceClosing.activo,
        pasivo: balanceClosing.pasivo,
        capital: balanceClosing.capital,
        resultadoDelEjercicio: balanceClosing.resultadoDelEjercicio,
        totalPasivoCapital: balanceClosing.totalPasivoCapital,
        cuadre: balanceClosing.cuadre,
      },
      /** Presentación NIF: bandas SAT + columnas comparativas opcionales */
      nif: {
        estadoSituacionFinanciera: {
          current: bandsClosing,
          compare: bandsCompare,
        },
        estadoResultadoIntegral: {
          current: incCurrent,
          compare: incomeCompare,
        },
      },
      cambiosSituacionFinanciera,
      variacionCapitalContable,
      estadoFlujoEfectivo,
      posSales:
        posSales.ok === true
          ? {
              ticketCount: posSales.ticketCount,
              totalMxn: posSales.totalMxn,
              note:
                "Ventas capturadas desde IntimoCoffeeApp al cobrar (tabla pos.purchase_orders). Distinto de ingresos por pólizas contables.",
            }
          : {
              ticketCount: 0,
              totalMxn: 0,
              note:
                posSales.reason === "no_database"
                  ? "Sin PostgreSQL: no hay acumulado de tickets POS."
                  : "Rango no válido para tickets POS.",
            },
    };
  } finally {
    client.release();
  }
}

/**
 * Auxiliar de mayor: movimientos de una cuenta (NumCta) en un rango, con saldo acumulado.
 * Saldo inicial = movimientos con fecha estrictamente anterior a `from` (Debe − Haber).
 *
 * @param {{ from: string, to: string, accountCode: string }} p fechas ISO YYYY-MM-DD
 */
export async function getLedgerAuxiliarMayor(p) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const from = String(p.from || "").slice(0, 10);
  const to = String(p.to || "").slice(0, 10);
  const accountCode = String(p.accountCode || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ok: false, reason: "invalid_range" };
  }
  if (!accountCode) {
    return { ok: false, reason: "missing_account" };
  }

  const client = await pool.connect();
  try {
    const { rows: openRows } = await client.query(
      `
      SELECT
        COALESCE(SUM(pl.debit), 0)::float8 AS debit,
        COALESCE(SUM(pl.credit), 0)::float8 AS credit
      FROM accounting.poliza_lines pl
      INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
      WHERE pl.account_code = $1 AND p.poliza_date < $2::date
      `,
      [accountCode, from]
    );
    const d0 = Number(openRows[0]?.debit) || 0;
    const c0 = Number(openRows[0]?.credit) || 0;
    const openingBalance = d0 - c0;

    const { rows: metaRows } = await client.query(
      `SELECT descripcion, natur FROM accounting.chart_accounts WHERE num_cta = $1 LIMIT 1`,
      [accountCode]
    );
    const accountName = String(metaRows[0]?.descripcion || "").trim();
    const natur = metaRows[0]?.natur != null ? String(metaRows[0].natur).trim() : null;

    const { rows: movRows } = await client.query(
      `
      SELECT
        p.poliza_date::text AS poliza_date,
        p.folio,
        p.type AS poliza_type,
        p.concept AS poliza_concept,
        p.id AS poliza_id,
        pl.line_index,
        pl.line_concept,
        pl.debit::float8 AS debit,
        pl.credit::float8 AS credit
      FROM accounting.poliza_lines pl
      INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
      WHERE pl.account_code = $1
        AND p.poliza_date >= $2::date
        AND p.poliza_date <= $3::date
      ORDER BY p.poliza_date ASC, p.folio ASC, pl.line_index ASC
      `,
      [accountCode, from, to]
    );

    let running = openingBalance;
    const movements = movRows.map((r) => {
      const deb = Number(r.debit) || 0;
      const cred = Number(r.credit) || 0;
      running += deb - cred;
      return {
        polizaDate: r.poliza_date,
        folio: r.folio,
        polizaType: r.poliza_type,
        polizaConcept: r.poliza_concept,
        polizaId: r.poliza_id,
        lineIndex: r.line_index,
        lineConcept: r.line_concept,
        debit: deb,
        credit: cred,
        balance: running,
      };
    });

    const closingBalance = running;

    return {
      ok: true,
      range: { from, to },
      accountCode,
      accountName,
      natur,
      openingBalance,
      closingBalance,
      movements,
    };
  } finally {
    client.release();
  }
}
