/**
 * Presentación tipo NIF B-6 (situación financiera) y B-3 (resultado integral),
 * con columnas comparativas cuando el API envía `nif`.
 */
import { money, escapeHtml } from "./reports-core.js";

/** @param {string} iso */
export function formatColHeader(iso) {
  const t = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  const d = new Date(`${t}T12:00:00`);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

/** @param {string} iso */
function formatDateLongEs(iso) {
  const t = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  const d = new Date(`${t}T12:00:00`);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function amt(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return money(n);
}

/** Negativos entre paréntesis (estilo estado de resultados). */
function amtPar(n) {
  const x = Number(n) || 0;
  if (x === 0) return money(0);
  if (x < 0) return `(${money(Math.abs(x))})`;
  return `(${money(x)})`;
}

/** @param {number|null|undefined} cur @param {number|null|undefined} cmp @param {(v:number)=>string} [fn] */
function amtPair(cur, cmp, fn = amt) {
  const a = cur === null || cur === undefined ? "—" : fn(cur);
  const b = cmp === null || cmp === undefined ? "—" : fn(cmp);
  return `<td class="report-nif-amt">${a}</td><td class="report-nif-amt">${b}</td>`;
}

function fmtCostPositive(v) {
  if (v === null || v === undefined) return "—";
  return amtPar(-Math.abs(Number(v)));
}

/**
 * @param {object} d dashboard API
 */
export function renderEsfNif(d) {
  const el = document.getElementById("report-esf-formal");
  if (!el) return;

  const nif = d.nif?.estadoSituacionFinanciera;
  const cur = nif?.current;
  const cmp = nif?.compare;
  const asOfCur = d.range?.asOf;
  const asOfCmp = d.range?.compareAsOf;

  const h1 = formatColHeader(asOfCur);
  const h2 = asOfCmp ? formatColHeader(asOfCmp) : "Comparativo";

  const pasivoTotalCur = cur ? cur.pasivoCirculante + cur.pasivoNoCirculante : 0;
  const pasivoTotalCmp = cmp ? cmp.pasivoCirculante + cmp.pasivoNoCirculante : null;

  const capitalTotalCur = cur ? cur.capital + cur.resultadoDelEjercicio : 0;
  const capitalTotalCmp = cmp ? cmp.capital + cmp.resultadoDelEjercicio : null;

  el.innerHTML = `
    <div class="report-nif-doc" aria-label="Estado de situación financiera">
      <p class="report-nif-doc__meta">
        <span class="report-nif-doc__note">(Cifras en pesos mexicanos)</span>
      </p>
      <p class="report-nif-doc__period">
        ${
          asOfCmp
            ? `Posición al <strong>${escapeHtml(formatDateLongEs(asOfCur))}</strong> y al <strong>${escapeHtml(formatDateLongEs(asOfCmp))}</strong>`
            : `Posición al <strong>${escapeHtml(formatDateLongEs(asOfCur))}</strong>. Use “Cierre comparativo” en la barra superior para mostrar la segunda columna.`
        }
      </p>
      <div class="table-wrap report-nif-table-wrap">
      <table class="report-nif-table">
        <thead>
          <tr>
            <th class="report-nif-col-ref" scope="col">NIF</th>
            <th class="report-nif-col-concept" scope="col">Concepto</th>
            <th class="report-nif-amt" scope="col">${escapeHtml(h1)}</th>
            <th class="report-nif-amt" scope="col">${escapeHtml(h2)}</th>
          </tr>
        </thead>
        <tbody>
          <tr class="report-nif-tr report-nif-tr--major"><td colspan="4"><strong>ACTIVO</strong></td></tr>
          <tr class="report-nif-tr report-nif-tr--sect"><td>B-6</td><td colspan="3"><em>Activo a corto plazo</em></td></tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Efectivo y equivalentes de efectivo</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Instrumentos financieros de negociación</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Cuentas por cobrar a clientes</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Cuentas por cobrar a partes relacionadas</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Impuestos por recuperar</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Inventarios</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Pagos anticipados</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Otros activos circulantes</td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal">
            <td></td>
            <td><strong>Total de activo a corto plazo</strong></td>
            ${amtPair(cur?.activoCirculante, cmp?.activoCirculante)}
          </tr>

          <tr class="report-nif-tr report-nif-tr--sect"><td>B-6</td><td colspan="3"><em>Activo a largo plazo</em></td></tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Propiedades, planta y equipo (neto)</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Crédito mercantil</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Otros activos intangibles</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Inversiones en asociadas</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Instrumentos financieros por cobrar a largo plazo</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Otros activos no circulantes</td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal">
            <td></td>
            <td><strong>Total de activo a largo plazo</strong></td>
            ${amtPair(cur?.activoNoCirculante, cmp?.activoNoCirculante)}
          </tr>
          <tr class="report-nif-tr report-nif-tr--grand">
            <td></td>
            <td><strong>Total de activo</strong></td>
            ${amtPair(cur?.activo, cmp?.activo)}
          </tr>

          <tr class="report-nif-tr report-nif-tr--major"><td colspan="4"><strong>PASIVO Y CAPITAL CONTABLE</strong></td></tr>
          <tr class="report-nif-tr report-nif-tr--sect"><td>B-6</td><td colspan="3"><em>Pasivo a corto plazo</em></td></tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Préstamos bancarios</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Porción a corto plazo de deuda financiera</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Cuentas por pagar a proveedores</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Impuestos a la utilidad por pagar</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Provisiones</td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal">
            <td></td>
            <td><strong>Total de pasivo a corto plazo</strong></td>
            ${amtPair(cur?.pasivoCirculante, cmp?.pasivoCirculante)}
          </tr>

          <tr class="report-nif-tr report-nif-tr--sect"><td>B-6</td><td colspan="3"><em>Pasivo a largo plazo</em></td></tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Deuda financiera</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Porción de pasivo convertible en capital</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Impuesto a la utilidad diferido por pagar</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Beneficio a empleados</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Provisiones a largo plazo</td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal">
            <td></td>
            <td><strong>Total de pasivo a largo plazo</strong></td>
            ${amtPair(cur?.pasivoNoCirculante, cmp?.pasivoNoCirculante)}
          </tr>
          <tr class="report-nif-tr report-nif-tr--subtotal">
            <td></td>
            <td><strong>Total de pasivo</strong></td>
            ${amtPair(pasivoTotalCur, pasivoTotalCmp)}
          </tr>

          <tr class="report-nif-tr report-nif-tr--sect"><td>B-6</td><td colspan="3"><em>Capital contable</em></td></tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Capital social</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Utilidades acumuladas</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Otros resultados integrales</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Participación controladora</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Participación no controladora</td>${amtPair(null, null)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Cuentas de capital (SAT, agrupador)</td>${amtPair(cur?.capital, cmp?.capital)}</tr>
          <tr><td>C-1</td><td class="report-nif-ind1">Resultado del ejercicio (acumulado a la fecha)</td>${amtPair(cur?.resultadoDelEjercicio, cmp?.resultadoDelEjercicio)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal">
            <td></td>
            <td><strong>Total de capital contable</strong></td>
            ${amtPair(capitalTotalCur, capitalTotalCmp)}
          </tr>
          <tr class="report-nif-tr report-nif-tr--grand">
            <td></td>
            <td><strong>Total de pasivo y capital contable</strong></td>
            ${amtPair(cur?.totalPasivoCapital, cmp?.totalPasivoCapital)}
          </tr>
        </tbody>
      </table>
      </div>
      <p class="report-nif-foot">
        Subtotales de circulante / no circulante según orden del código agrupador SAT (Anexo 24).
        Las partidas detalladas sin saldo asignado en catálogo muestran “—”. Cuadre activo − pasivo y capital:
        <strong>${amt(cur?.cuadre)}</strong> (periodo actual).
      </p>
    </div>
  `;
}

/**
 * Estado de resultado integral (NIF B-3, ejemplo A.1).
 * @param {object} d dashboard API
 */
export function renderEriNif(d) {
  const el = document.getElementById("report-er-formal");
  if (!el) return;

  const nif = d.nif?.estadoResultadoIntegral;
  const cur = nif?.current || d.incomeStatement;
  const cmp = nif?.compare;

  const utilOpCur = cur?.utilidadNeta ?? 0;
  const utilOpCmp = cmp?.utilidadNeta;

  const ingCur = cur?.ingresos ?? 0;
  const ingCmp = cmp?.ingresos;
  const cCur = cur?.costos ?? 0;
  const cCmp = cmp?.costos;
  const gCur = cur?.gastos ?? 0;
  const gCmp = cmp?.gastos;
  const ubCur = cur?.utilidadBruta ?? 0;
  const ubCmp = cmp?.utilidadBruta;
  const unCur = cur?.utilidadNeta ?? 0;
  const unCmp = cmp?.utilidadNeta;

  const h1 = `Periodo ${formatColHeader(d.range?.from)} – ${formatColHeader(d.range?.to)}`;
  const h2 =
    d.range?.compareFrom && d.range?.compareTo
      ? `${formatColHeader(d.range.compareFrom)} – ${formatColHeader(d.range.compareTo)}`
      : "Comparativo";

  el.innerHTML = `
    <div class="report-nif-doc" aria-label="Estado de resultado integral">
      <p class="report-nif-doc__meta"><span class="report-nif-doc__note">(Cifras en pesos mexicanos)</span></p>
      <p class="report-nif-doc__period">
        Por los periodos comprendidos entre las fechas indicadas en cada columna (movimiento en pólizas).
      </p>
      <div class="table-wrap report-nif-table-wrap">
      <table class="report-nif-table">
        <thead>
          <tr>
            <th class="report-nif-col-ref" scope="col">NIF</th>
            <th class="report-nif-col-concept" scope="col">Concepto</th>
            <th class="report-nif-amt" scope="col">${escapeHtml(h1)}</th>
            <th class="report-nif-amt" scope="col">${escapeHtml(h2)}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>B-3</td><td>Ingresos netos</td>${amtPair(ingCur, ingCmp)}</tr>
          <tr><td>B-3</td><td>Costo de ventas</td>${amtPair(cCur, cCmp, fmtCostPositive)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal"><td></td><td><strong>Utilidad bruta</strong></td>${amtPair(ubCur, ubCmp)}</tr>
          <tr><td>B-3</td><td>Gastos generales</td>${amtPair(gCur, gCmp, fmtCostPositive)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal"><td></td><td><strong>Utilidad de operación</strong></td>${amtPair(utilOpCur, utilOpCmp)}</tr>
          <tr><td>B-3</td><td>Resultado integral de financiamiento</td>${amtPair(null, null)}</tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Participación en asociadas</td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal"><td></td><td><strong>Utilidad antes de impuestos a la utilidad</strong></td>${amtPair(unCur, unCmp)}</tr>
          <tr><td>B-3</td><td>Impuestos a la utilidad</td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal"><td></td><td><strong>Utilidad de operaciones continuas</strong></td>${amtPair(unCur, unCmp)}</tr>
          <tr><td>B-3</td><td>Operaciones discontinuadas (neto) <span class="report-nif-fn">(a)</span></td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--grand"><td></td><td><strong>Utilidad neta</strong></td>${amtPair(unCur, unCmp)}</tr>

          <tr class="report-nif-tr report-nif-tr--sect"><td>B-3</td><td colspan="3"><em>Otros resultados integrales</em></td></tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Resultado por conversión de operaciones extranjeras</td>${amtPair(null, null)}</tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Valuación de coberturas de flujo de efectivo</td>${amtPair(null, null)}</tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Participación en los ORI de asociadas</td>${amtPair(null, null)}</tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Impuestos a la utilidad de los ORI <span class="report-nif-fn">(a)</span></td>${amtPair(null, null)}</tr>
          <tr class="report-nif-tr report-nif-tr--subtotal"><td></td><td><strong>Suma</strong></td>${amtPair(0, 0)}</tr>
          <tr class="report-nif-tr report-nif-tr--grand"><td></td><td><strong>Resultado integral</strong></td>${amtPair(unCur, unCmp)}</tr>

          <tr class="report-nif-tr report-nif-tr--sect"><td>B-3</td><td colspan="3"><strong>Utilidad neta atribuible a:</strong></td></tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Participación controladora</td>${amtPair(unCur, unCmp)}</tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Participación no controladora</td>${amtPair(null, null)}</tr>

          <tr class="report-nif-tr report-nif-tr--sect"><td>B-3</td><td colspan="3"><strong>Resultado integral atribuible a:</strong></td></tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Participación controladora</td>${amtPair(unCur, unCmp)}</tr>
          <tr><td>B-3</td><td class="report-nif-ind1">Participación no controladora</td>${amtPair(null, null)}</tr>

          <tr class="report-nif-tr report-nif-tr--grand"><td></td><td><strong>Utilidad básica por acción ordinaria</strong></td>${amtPair(null, null)}</tr>
        </tbody>
      </table>
      </div>
      <p class="report-nif-foot">
        <span class="report-nif-fn">(a)</span> Cuando aplique. Los importes provienen del agrupador SAT en el catálogo de cuentas.
        La utilidad de operación coincide aquí con la utilidad neta por no haber capturado por separado financiamiento ni impuestos en esta vista.
      </p>
    </div>
  `;
}
