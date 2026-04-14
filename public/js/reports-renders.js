import { $, money, escapeHtml } from "./reports-core.js";

export function renderBalanza(d) {
  const tbody = $("#report-tbody-balanza");
  if (!tbody) return;
  const rows = d.trialBalance || [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="data-table__empty">Sin movimientos en el periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.accountCode)}</td>
      <td>${escapeHtml(r.accountName)}</td>
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
      <td class="report-num"><strong>${money(d.totals.debit)}</strong></td>
      <td class="report-num"><strong>${money(d.totals.credit)}</strong></td>
      <td colspan="2" class="report-num report-num--muted">Δ ${money(d.totals.diff)}</td>
    </tr>`
  );
}

export function renderEsf(d) {
  const el = $("#report-esf-cards");
  if (!el) return;
  const bs = d.balanceSheet;
  el.innerHTML = `
    <div class="report-esf-card">
      <h3 class="report-esf-card__title">Activo</h3>
      <p class="report-esf-card__amount">${money(bs.activo)}</p>
    </div>
    <div class="report-esf-card">
      <h3 class="report-esf-card__title">Pasivo</h3>
      <p class="report-esf-card__amount">${money(bs.pasivo)}</p>
    </div>
    <div class="report-esf-card">
      <h3 class="report-esf-card__title">Capital contable</h3>
      <p class="report-esf-card__amount">${money(bs.capital)}</p>
    </div>
    <div class="report-esf-card report-esf-card--wide">
      <h3 class="report-esf-card__title">Resultado (acumulado a la fecha)</h3>
      <p class="report-esf-card__amount">${money(bs.resultadoDelEjercicio)}</p>
      <p class="report-esf-card__foot">Pasivo + capital + resultado = ${money(bs.totalPasivoCapital)} · Cuadre vs activo: ${money(bs.cuadre)}</p>
    </div>
  `;
}

export function renderActividad(d) {
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
      <li><span>Resultado del periodo (estado de actividad)</span><strong>${money(v.resultadoDelPeriodo)}</strong></li>
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
