/**
 * Presentación NIF: flujo de efectivo (indirecto) y variación en el capital contable.
 */
import { money, escapeHtml } from "./reports-core.js";
import { formatDateLongEs } from "./reports-nif-render.js";

/** @param {number} n */
function amtCf(n) {
  const x = Number(n) || 0;
  if (x === 0) return money(0);
  if (x < 0) return `(${money(Math.abs(x))})`;
  return money(x);
}

/**
 * @param {string} label
 * @param {number} amount
 * @param {{ indent?: boolean, strong?: boolean }} [opts]
 */
function cfRow(label, amount, opts = {}) {
  const cls = opts.indent ? "report-nif-cf-indent" : "";
  const lab = opts.strong ? `<strong>${escapeHtml(label)}</strong>` : escapeHtml(label);
  return `<tr class="${cls}"><td class="report-nif-col-concept${opts.indent ? " report-nif-cf-indent" : ""}">${lab}</td><td class="report-nif-amt">${amtCf(amount)}</td></tr>`;
}

/**
 * @param {object} d dashboard API
 */
export function renderFlujoEfectivoNif(d) {
  const el = document.getElementById("report-cf-formal");
  if (!el) return;

  const cf = d.estadoFlujoEfectivo;
  if (!cf?.operacion) {
    el.innerHTML = `<p class="report-muted">Sin datos de flujo de efectivo.</p>`;
    return;
  }

  const op = cf.operacion;
  const inv = cf.inversion;
  const fin = cf.financiamiento;
  const rec = cf.conciliacion;

  const periodo = `Del 1 de enero al 31 de diciembre de ${escapeHtml(d.range?.to?.slice(0, 4) || "—")}`;

  let html = `
    <div class="report-nif-doc" aria-label="Estado de flujos de efectivo">
      <p class="report-nif-doc__meta"><span class="report-nif-doc__note">(Cifras en pesos mexicanos) · Método indirecto</span></p>
      <p class="report-nif-doc__period">${periodo}</p>
      <div class="table-wrap report-nif-table-wrap">
      <table class="report-nif-table report-nif-table--cf">
        <thead>
          <tr>
            <th class="report-nif-col-concept" scope="col">Concepto</th>
            <th class="report-nif-amt" scope="col">Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr class="report-nif-tr report-nif-tr--major"><td colspan="2"><strong>Actividades de operación</strong></td></tr>
          ${cfRow("Utilidad antes de impuestos a la utilidad", op.utilidadAntesImpuestos, { strong: true })}
          <tr class="report-nif-tr report-nif-tr--sect"><td colspan="2"><em>Partidas relacionadas con actividades de inversión</em></td></tr>
          ${op.partidasInversion.map((p) => cfRow(p.label, p.amount, { indent: true })).join("")}
          <tr class="report-nif-tr report-nif-tr--sect"><td colspan="2"><em>Partidas relacionadas con actividades de financiamiento</em></td></tr>
          ${op.partidasFinanciamientoEnOperacion.map((p) => cfRow(p.label, p.amount, { indent: true })).join("")}
          ${cfRow("Suma", op.sumaAjustes, { strong: true })}
          ${op.cambiosCapitalTrabajo.map((p) => cfRow(p.label, p.amount, { indent: true })).join("")}
          <tr class="report-nif-tr report-nif-tr--subtotal"><td class="report-nif-col-concept"><strong>Flujos netos de efectivo de actividades de operación</strong></td><td class="report-nif-amt"><strong>${amtCf(op.flujosNetos)}</strong></td></tr>

          <tr class="report-nif-tr report-nif-tr--major"><td colspan="2"><strong>Actividades de inversión</strong></td></tr>
          ${inv.lineas.map((p) => cfRow(p.label, p.amount, { indent: true })).join("")}
          <tr class="report-nif-tr report-nif-tr--subtotal"><td class="report-nif-col-concept"><strong>Flujos netos de efectivo de actividades de inversión</strong></td><td class="report-nif-amt"><strong>${amtCf(inv.flujosNetos)}</strong></td></tr>

          <tr class="report-nif-tr report-nif-tr--sect"><td colspan="2">Efectivo excedente para aplicar en actividades de financiamiento</td></tr>
          <tr><td class="report-nif-col-concept report-nif-cf-indent"></td><td class="report-nif-amt">${amtCf(cf.excedenteParaFinanciamiento)}</td></tr>

          <tr class="report-nif-tr report-nif-tr--major"><td colspan="2"><strong>Actividades de financiamiento</strong></td></tr>
          ${fin.lineas.map((p) => cfRow(p.label, p.amount, { indent: true })).join("")}
          <tr class="report-nif-tr report-nif-tr--subtotal"><td class="report-nif-col-concept"><strong>Flujos netos de efectivo de actividades de financiamiento</strong></td><td class="report-nif-amt"><strong>${amtCf(fin.flujosNetos)}</strong></td></tr>

          <tr class="report-nif-tr report-nif-tr--grand"><td class="report-nif-col-concept"><strong>Incremento neto de efectivo y demás equivalentes de efectivo</strong></td><td class="report-nif-amt"><strong>${amtCf(rec.incrementoNeto)}</strong></td></tr>
          ${cfRow("Efectivo y equivalentes de efectivo al principio del periodo", rec.efectivoInicio)}
          <tr class="report-nif-tr report-nif-tr--grand"><td class="report-nif-col-concept"><strong>Efectivo y equivalentes de efectivo al final del periodo</strong></td><td class="report-nif-amt"><strong>${amtCf(rec.efectivoFin)}</strong></td></tr>
        </tbody>
      </table>
      </div>
      <p class="report-nif-foot report-muted">${escapeHtml(cf.notaMetodologia)}</p>
  `;

  if (Math.abs(rec.diferenciaConciliacion) > 0.01) {
    html += `<p class="report-muted">Nota de conciliación: incremento calculado ${amtCf(rec.efectivoFinCalculado)} vs. saldo en cuentas de efectivo (SAT 3–7) ${amtCf(rec.efectivoFin)} · diferencia ${amtCf(rec.diferenciaConciliacion)}.</p>`;
  }

  html += `</div>`;
  el.innerHTML = html;
}

/**
 * @param {object} d dashboard API
 */
export function renderVariacionCapitalNif(d) {
  const el = document.getElementById("report-capital-formal");
  if (!el) return;

  const v = d.variacionCapitalContable;
  if (!v?.bloques?.length) {
    el.innerHTML = `<p class="report-muted">Sin datos de capital contable.</p>`;
    return;
  }

  const cols = v.columnas;
  const headCols = cols
    .map((c) => `<th class="report-nif-amt" scope="col">${escapeHtml(c.label)}</th>`)
    .join("");

  let body = "";
  for (const bloque of v.bloques) {
    body += `<tr class="report-nif-tr report-nif-tr--major"><td colspan="${cols.length + 1}"><strong>Cambios en el capital contable · ${escapeHtml(bloque.year)}</strong></td></tr>`;
    for (const fila of bloque.filas) {
      const cells = cols
        .map((c) => {
          const val = fila[c.key];
          return `<td class="report-nif-amt">${amtCf(val)}</td>`;
        })
        .join("");
      const trClass = fila.esTotal ? "report-nif-tr report-nif-tr--subtotal" : "";
      const lab = fila.esTotal ? `<strong>${escapeHtml(fila.label)}</strong>` : escapeHtml(fila.label);
      body += `<tr class="${trClass}"><td class="report-nif-col-concept">${lab}</td>${cells}</tr>`;
    }
  }

  const desde = d.range?.from ? formatDateLongEs(d.range.from) : "—";
  const hasta = d.range?.to ? formatDateLongEs(d.range.to) : "—";

  el.innerHTML = `
    <div class="report-nif-doc" aria-label="Estado de variaciones en el capital contable">
      <p class="report-nif-doc__meta"><span class="report-nif-doc__note">(Cifras en pesos mexicanos) · Agrupando los ORI</span></p>
      <p class="report-nif-doc__period">Periodo del <strong>${escapeHtml(desde)}</strong> al <strong>${escapeHtml(hasta)}</strong></p>
      <div class="table-wrap report-nif-table-wrap report-nif-table-wrap--scroll">
      <table class="report-nif-table report-nif-table--capital">
        <thead>
          <tr>
            <th class="report-nif-col-concept report-nif-col-concept--wide" scope="col">Concepto</th>
            ${headCols}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      </div>
      <p class="report-nif-foot report-muted">${escapeHtml(v.nota)}</p>
    </div>
  `;
}
