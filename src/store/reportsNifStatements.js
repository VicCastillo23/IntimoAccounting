/**
 * Estados financieros NIF: flujo de efectivo (método indirecto) y variación en el capital contable.
 * Cifras derivadas de pólizas clasificadas por código agrupador SAT (Anexo 24).
 */

/**
 * @param {Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>} rows
 * @param {number} min
 * @param {number} max
 * @param {"debit"|"credit"} nature
 */
function sumNetInOrdenRange(rows, min, max, nature = "debit") {
  let t = 0;
  for (const r of rows) {
    const o = Number(r.sat_orden);
    if (!Number.isFinite(o) || o < min || o > max) continue;
    const d = Number(r.debit) || 0;
    const c = Number(r.credit) || 0;
    t += nature === "credit" ? c - d : d - c;
  }
  return t;
}

/**
 * @param {Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>} rows
 * @param {number} min
 * @param {number} max
 */
function assetNetInRange(rows, min, max) {
  return sumNetInOrdenRange(rows, min, max, "debit");
}

/**
 * @param {Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>} rows
 * @param {number} min
 * @param {number} max
 */
function liabilityNetInRange(rows, min, max) {
  return sumNetInOrdenRange(rows, min, max, "credit");
}

/**
 * @param {Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>} movRows
 * @param {number} min
 * @param {number} max
 * @param {"gasto"|"ingreso"} kind
 */
function periodMovInRange(movRows, min, max, kind) {
  return sumNetInOrdenRange(movRows, min, max, kind === "gasto" ? "debit" : "credit");
}

/**
 * Efecto en flujo por variación de saldo (activo: más saldo = menos efectivo).
 * @param {number} opening
 * @param {number} closing
 * @param {"activo"|"pasivo"} tipo
 */
function cashEffectFromBalanceChange(opening, closing, tipo) {
  const delta = closing - opening;
  if (tipo === "activo") return -delta;
  return delta;
}

/**
 * @param {Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>} rows
 */
export function foldCapitalColumns(rows) {
  let capitalSocial = 0;
  let utilidadesAcumuladas = 0;
  let ori = 0;

  for (const r of rows) {
    const o = Number(r.sat_orden);
    if (!Number.isFinite(o)) continue;
    const net = (Number(r.credit) || 0) - (Number(r.debit) || 0);
    if (o >= 170 && o <= 173) capitalSocial += net;
    else if ((o >= 174 && o <= 175) || (o >= 182 && o <= 183)) ori += net;
    else if (o >= 176 && o <= 181) utilidadesAcumuladas += net;
  }

  const totalControladora = capitalSocial + utilidadesAcumuladas + ori;
  return {
    capitalSocial,
    utilidadesAcumuladas,
    ori,
    totalControladora,
    participacionNoControladora: 0,
    totalCapital: totalControladora,
  };
}

/**
 * @param {{
 *   utilidadNeta: number,
 *   movRows: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>,
 *   rowsOpening: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>,
 *   rowsClosing: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>,
 * }} p
 */
export function buildEstadoFlujoEfectivoNif(p) {
  const { utilidadNeta, movRows, rowsOpening, rowsClosing } = p;

  const depreciacion = periodMovInRange(movRows, 267, 275, "gasto");
  const amortizacion = periodMovInRange(movRows, 274, 275, "gasto");
  const perdidaVentaActivo = periodMovInRange(movRows, 254, 262, "gasto");
  const utilidadVentaActivo = periodMovInRange(movRows, 198, 199, "ingreso");
  const ajusteVentaActivos = -(utilidadVentaActivo - perdidaVentaActivo);

  const interesesFavor = periodMovInRange(movRows, 18, 18, "ingreso") + periodMovInRange(movRows, 164, 164, "ingreso");
  const dividendosCobradosInv = periodMovInRange(movRows, 113, 113, "ingreso");
  const interesesCargo = periodMovInRange(movRows, 115, 115, "gasto") + periodMovInRange(movRows, 161, 161, "gasto");

  const partidasInversion = [
    { label: "Depreciación", amount: depreciacion + amortizacion },
    { label: "Utilidad por venta de propiedades, planta y equipo", amount: ajusteVentaActivos },
    { label: "Intereses a favor", amount: -interesesFavor },
    { label: "Dividendos cobrados (clasificación operativa)", amount: -dividendosCobradosInv },
  ];

  const partidasFinanciamientoEnOperacion = [{ label: "Intereses a cargo", amount: interesesCargo }];

  const sumaAjustes =
    utilidadNeta +
    partidasInversion.reduce((s, x) => s + x.amount, 0) +
    partidasFinanciamientoEnOperacion.reduce((s, x) => s + x.amount, 0);

  const cxcOpen = assetNetInRange(rowsOpening, 4, 18);
  const cxcClose = assetNetInRange(rowsClosing, 4, 18);
  const invOpen = assetNetInRange(rowsOpening, 44, 47);
  const invClose = assetNetInRange(rowsClosing, 44, 47);
  const provOpen = liabilityNetInRange(rowsOpening, 106, 108);
  const provClose = liabilityNetInRange(rowsClosing, 106, 108);
  const isrPagado = periodMovInRange(movRows, 37, 41, "debit") + periodMovInRange(movRows, 142, 142, "debit");

  const cambiosCapitalTrabajo = [
    {
      label: "Incremento en cuentas por cobrar y otros",
      amount: cashEffectFromBalanceChange(cxcOpen, cxcClose, "activo"),
    },
    {
      label: "Disminución (incremento) en inventarios",
      amount: cashEffectFromBalanceChange(invOpen, invClose, "activo"),
    },
    {
      label: "Disminución en proveedores",
      amount: cashEffectFromBalanceChange(provOpen, provClose, "pasivo"),
    },
    { label: "Impuestos a la utilidad pagados", amount: -Math.abs(isrPagado) },
  ];

  const flujosOperacion =
    sumaAjustes + cambiosCapitalTrabajo.reduce((s, x) => s + x.amount, 0);

  const adquisicionPpe = -periodMovInRange(movRows, 63, 74, "debit");
  const ventaPpe = periodMovInRange(movRows, 63, 74, "credit");
  const negocioAdquirido = -periodMovInRange(movRows, 86, 103, "debit");

  const actividadesInversion = [
    { label: "Negocio adquirido", amount: negocioAdquirido },
    { label: "Intereses cobrados", amount: interesesFavor },
    { label: "Dividendos cobrados", amount: dividendosCobradosInv },
    { label: "Adquisición de propiedades, planta y equipo", amount: adquisicionPpe },
    { label: "Cobros por venta de propiedades, planta y equipo", amount: ventaPpe },
  ];
  const flujosInversion = actividadesInversion.reduce((s, x) => s + x.amount, 0);

  const capitalEmitido = periodMovInRange(movRows, 170, 173, "credit");
  const prestamosLp = periodMovInRange(movRows, 151, 168, "credit") - periodMovInRange(movRows, 151, 168, "debit");
  const arrendamiento = -periodMovInRange(movRows, 149, 150, "debit");
  const interesesPagados = -Math.abs(interesesCargo);
  const dividendosPagados = -periodMovInRange(movRows, 113, 113, "debit");

  const actividadesFinanciamiento = [
    { label: "Entrada de efectivo por emisión de capital", amount: capitalEmitido },
    { label: "Obtención de préstamos a largo plazo", amount: prestamosLp },
    { label: "Pago de pasivos derivados de arrendamientos financieros", amount: arrendamiento },
    { label: "Intereses pagados", amount: interesesPagados },
    { label: "Dividendos pagados", amount: dividendosPagados },
  ];
  const flujosFinanciamiento = actividadesFinanciamiento.reduce((s, x) => s + x.amount, 0);

  const incrementoNeto = flujosOperacion + flujosInversion + flujosFinanciamiento;

  const efectivoInicio = assetNetInRange(rowsOpening, 3, 7);
  const efectivoFin = assetNetInRange(rowsClosing, 3, 7);

  return {
    metodo: "indirecto",
    notaMetodologia:
      "Elaborado por el método indirecto con base en movimientos del periodo y variaciones de saldo por código agrupador SAT. Sin pólizas, las cifras serán cero.",
    operacion: {
      utilidadAntesImpuestos: utilidadNeta,
      partidasInversion,
      partidasFinanciamientoEnOperacion,
      sumaAjustes,
      cambiosCapitalTrabajo,
      flujosNetos: flujosOperacion,
    },
    inversion: {
      lineas: actividadesInversion,
      flujosNetos: flujosInversion,
    },
    financiamiento: {
      lineas: actividadesFinanciamiento,
      flujosNetos: flujosFinanciamiento,
    },
    conciliacion: {
      incrementoNeto,
      efectivoInicio,
      efectivoFin,
      efectivoFinCalculado: efectivoInicio + incrementoNeto,
      diferenciaConciliacion: efectivoFin - (efectivoInicio + incrementoNeto),
    },
    excedenteParaFinanciamiento: flujosOperacion + flujosInversion,
  };
}

/**
 * @param {{
 *   from: string,
 *   to: string,
 *   openingDate: string,
 *   utilidadNeta: number,
 *   rowsOpening: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>,
 *   rowsClosing: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>,
 *   movRows: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }>,
 *   rowsCompareOpening?: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }> | null,
 *   rowsCompareClosing?: Array<{ debit: unknown, credit: unknown, sat_orden: unknown }> | null,
 *   utilidadCompare?: number | null,
 * }} p
 */
export function buildVariacionCapitalContableNif(p) {
  const openCols = foldCapitalColumns(p.rowsOpening);
  const closeCols = foldCapitalColumns(p.rowsClosing);

  const movCapitalSocial = periodMovInRange(p.movRows, 170, 173, "credit") - periodMovInRange(p.movRows, 170, 173, "debit");
  const movDividendos =
    -periodMovInRange(p.movRows, 113, 113, "debit") -
    periodMovInRange(p.movRows, 179, 181, "debit");

  const resultadoIntegral = {
    capitalSocial: 0,
    utilidadesAcumuladas: p.utilidadNeta,
    ori: 0,
    totalControladora: p.utilidadNeta,
    participacionNoControladora: 0,
    totalCapital: p.utilidadNeta,
  };

  const filas = [
    {
      id: "saldo-inicio",
      label: `Saldos al 1 de enero de ${p.from.slice(0, 4)}`,
      ...openCols,
      esTotal: true,
    },
    {
      id: "ajustes",
      label: "Ajustes retrospectivos por corrección de errores",
      capitalSocial: 0,
      utilidadesAcumuladas: 0,
      ori: 0,
      totalControladora: 0,
      participacionNoControladora: 0,
      totalCapital: 0,
    },
    {
      id: "saldo-ajustado",
      label: `Saldos al 1 de enero de ${p.from.slice(0, 4)}, ajustados`,
      ...openCols,
      esTotal: true,
    },
    {
      id: "capital-emitido",
      label: "Capital emitido",
      capitalSocial: movCapitalSocial,
      utilidadesAcumuladas: 0,
      ori: 0,
      totalControladora: movCapitalSocial,
      participacionNoControladora: 0,
      totalCapital: movCapitalSocial,
    },
    {
      id: "dividendos",
      label: "Dividendos decretados",
      capitalSocial: 0,
      utilidadesAcumuladas: movDividendos,
      ori: 0,
      totalControladora: movDividendos,
      participacionNoControladora: 0,
      totalCapital: movDividendos,
    },
    {
      id: "resultado-integral",
      label: "Resultado integral",
      ...resultadoIntegral,
    },
    {
      id: "saldo-cierre",
      label: `Saldos al 31 de diciembre de ${p.to.slice(0, 4)}`,
      ...closeCols,
      esTotal: true,
    },
  ];

  const bloques = [{ year: p.to.slice(0, 4), filas }];

  if (p.rowsCompareOpening && p.rowsCompareClosing) {
    const cmpOpen = foldCapitalColumns(p.rowsCompareOpening);
    const cmpClose = foldCapitalColumns(p.rowsCompareClosing);
    bloques.unshift({
      year: p.openingDate.slice(0, 4),
      filas: [
        {
          id: "cmp-saldo-cierre",
          label: `Saldos al 31 de diciembre de ${p.openingDate.slice(0, 4)} (periodo anterior)`,
          ...cmpOpen,
          esTotal: true,
        },
        {
          id: "cmp-resultado",
          label: "Resultado integral (periodo comparativo)",
          capitalSocial: 0,
          utilidadesAcumuladas: Number(p.utilidadCompare) || 0,
          ori: 0,
          totalControladora: Number(p.utilidadCompare) || 0,
          participacionNoControladora: 0,
          totalCapital: Number(p.utilidadCompare) || 0,
        },
        {
          id: "cmp-cierre",
          label: `Saldos al cierre comparativo`,
          ...cmpClose,
          esTotal: true,
        },
      ],
    });
  }

  return {
    columnas: [
      { key: "capitalSocial", label: "Capital social" },
      { key: "utilidadesAcumuladas", label: "Utilidades acumuladas" },
      { key: "ori", label: "Otros resultados integrales" },
      { key: "totalControladora", label: "Total participación de la controladora" },
      { key: "participacionNoControladora", label: "Participación de la no controladora" },
      { key: "totalCapital", label: "Total capital contable" },
    ],
    bloques,
    nota:
      "Agrupación ORI según reservas y otras cuentas de capital (órdenes SAT 174–175 y 182–183). Participación no controladora en cero cuando no hay consolidación.",
  };
}
