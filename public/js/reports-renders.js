import { $, money, escapeHtml } from "./reports-core.js";
import { renderEsfNif, renderEriNif } from "./reports-nif-render.js";

/** @param {object} d respuesta de `/api/reports/dashboard` */
export function renderEsf(d) {
  renderEsfNif(d);
}

/** @param {object} d respuesta de `/api/reports/dashboard` */
export function renderEstadoResultadosFormal(d) {
  renderEriNif(d);
}

export function renderBalanza(d) {
  const tbody = $("#report-tbody-balanza");
  if (!tbody) return;
  const rows = d.trialBalance || [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="data-table__empty">Sin cuentas para el periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.accountCode)}</td>
      <td>${escapeHtml(r.accountName)}</td>
      <td class="report-num">${money(r.openingSaldoDeudor)}</td>
      <td class="report-num">${money(r.openingSaldoAcreedor)}</td>
      <td class="report-num">${money(r.debit)}</td>
      <td class="report-num">${money(r.credit)}</td>
      <td class="report-num">${money(r.saldoDeudor)}</td>
      <td class="report-num">${money(r.saldoAcreedor)}</td>
    </tr>`
    )
    .join("");
  tbody.insertAdjacentHTML(
    "beforeend",
    `<tr class="report-total-row">
      <td colspan="2"><strong>Total</strong></td>
      <td class="report-num"><strong>${money(d.totals.openingDeudor)}</strong></td>
      <td class="report-num"><strong>${money(d.totals.openingAcreedor)}</strong></td>
      <td class="report-num"><strong>${money(d.totals.debit)}</strong></td>
      <td class="report-num"><strong>${money(d.totals.credit)}</strong></td>
      <td class="report-num"><strong>${money(d.totals.closingDeudor)}</strong></td>
      <td class="report-num"><strong>${money(d.totals.closingAcreedor)}</strong></td>
    </tr>`
  );
}

export function renderOpeningBalances(d) {
  const main = document.querySelector(".main--report");
  if (!main) return;
  let host = document.getElementById("report-opening-balances");
  if (!host) {
    host = document.createElement("section");
    host.id = "report-opening-balances";
    host.className = "report-section panel";
    host.setAttribute("aria-label", "Saldos iniciales por cuenta");
    host.innerHTML = `
      <h2 class="report-section__title">Saldos iniciales por cuenta</h2>
      <div class="table-wrap table-wrap--sticky-head">
        <table class="data-table data-table--dense report-table">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Nombre</th>
              <th class="report-num">Saldo inicial D</th>
              <th class="report-num">Saldo inicial A</th>
            </tr>
          </thead>
          <tbody id="report-opening-tbody"></tbody>
        </table>
      </div>
    `;
    const alertSlot = document.getElementById("report-alert");
    if (alertSlot?.nextSibling) main.insertBefore(host, alertSlot.nextSibling);
    else main.appendChild(host);
  }
  const tbody = document.getElementById("report-opening-tbody");
  if (!tbody) return;
  const rows = d.openingBalances || [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="data-table__empty">Sin saldos iniciales.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.accountCode)}</td>
      <td>${escapeHtml(r.accountName)}</td>
      <td class="report-num">${money(r.saldoDeudor)}</td>
      <td class="report-num">${money(r.saldoAcreedor)}</td>
    </tr>`
    )
    .join("");
}

export function renderActividadBars(d) {
  const el = $("#report-pl");
  if (!el) return;
  const is = d.incomeStatement;
  const max = Math.max(is.ingresos, is.costos, is.gastos, 1);
  const bar = (label, val, cls) => {
    const pct = Math.min(100, (Math.abs(val) / max) * 100);
    return `
      <div class="report-pl-row">
        <div class="report-pl-row__head">
          <span>${label}</span>
          <strong>${money(val)}</strong>
        </div>
        <div class="report-pl-bar"><span class="report-pl-bar__fill ${cls}" style="width:${pct}%"></span></div>
      </div>`;
  };
  el.innerHTML = `
    ${bar("Ingresos", is.ingresos, "report-pl-bar__fill--in")}
    ${bar("Costos", is.costos, "report-pl-bar__fill--cost")}
    ${bar("Gastos", is.gastos, "report-pl-bar__fill--exp")}
    <div class="report-pl-summary">
      <span>Utilidad bruta</span><strong>${money(is.utilidadBruta)}</strong>
    </div>
    <div class="report-pl-summary report-pl-summary--net">
      <span>Utilidad neta</span><strong>${money(is.utilidadNeta)}</strong>
    </div>
  `;
}

/** @param {object} d respuesta de `/api/reports/dashboard` */
export function renderActividad(d) {
  renderEstadoResultadosFormal(d);
  renderActividadBars(d);
}

export function renderPosSales(d) {
  const el = document.getElementById("report-pos-body");
  if (!el) return;
  const ps = d.posSales;
  if (!ps) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <p class="report-pos-sales__line">
      <strong>${Number(ps.ticketCount) || 0}</strong> ticket(s) en el periodo ·
      Total registrado en POS: <strong>${money(ps.totalMxn)}</strong>
    </p>
    <p class="report-pos-sales__note">${escapeHtml(ps.note || "")}</p>
  `;
}

export function renderCambiosSituacion(d) {
  const tbody = $("#report-tbody-cambios");
  if (!tbody) return;
  const c = d.cambiosSituacionFinanciera;
  const rows = [
    ["Activo", c.activo.inicial, c.activo.final, c.activo.variacion],
    ["Pasivo", c.pasivo.inicial, c.pasivo.final, c.pasivo.variacion],
    ["Patrimonio (capital + resultado acum.)", c.capitalContable.inicial, c.capitalContable.final, c.capitalContable.variacion],
  ];
  tbody.innerHTML = rows
    .map(
      ([lab, ini, fin, varia]) => `
    <tr>
      <td>${escapeHtml(lab)}</td>
      <td class="report-num">${money(ini)}</td>
      <td class="report-num">${money(fin)}</td>
      <td class="report-num">${money(varia)}</td>
    </tr>`
    )
    .join("");
}

export function renderVariacionCapital(d) {
  const el = $("#report-capital");
  if (!el) return;
  const v = d.variacionCapitalContable;
  el.innerHTML = `
    <ul class="report-capital-list">
      <li><span>Capital al inicio del periodo</span><strong>${money(v.capitalAlInicio)}</strong></li>
      <li><span>Resultado del periodo (estado de resultados)</span><strong>${money(v.resultadoDelPeriodo)}</strong></li>
      <li><span>Capital al cierre</span><strong>${money(v.capitalAlCierre)}</strong></li>
      <li class="report-capital-list__note"><span>${escapeHtml(v.nota)}</span></li>
    </ul>
  `;
}

export function renderFlujoEfectivo(d) {
  const el = $("#report-cf");
  if (!el) return;
  const cf = d.estadoFlujoEfectivo;
  const ind = cf.indirectoSimplificado;
  const ce = cf.cuentasEfectivoSat;
  el.innerHTML = `
    <div class="report-cf-block">
      <h3 class="report-cf-block__title">Indirecto (referencia)</h3>
      <p>Utilidad neta: <strong>${money(ind.utilidadNeta)}</strong></p>
      <p>Variación capital de trabajo (aprox.): <strong>${money(ind.variacionCapitalTrabajoAprox)}</strong></p>
      <p class="report-muted">${escapeHtml(ind.nota)}</p>
    </div>
    <div class="report-cf-block report-cf-block--highlight">
      <h3 class="report-cf-block__title">Efectivo y equivalentes (SAT 3–7)</h3>
      <p class="report-cf-big">${money(ce.netoIncrementoEfectivo)}</p>
      <p class="report-muted">${escapeHtml(ce.criterio)}</p>
    </div>
  `;
}
