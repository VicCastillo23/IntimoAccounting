import { initAuthShell } from "./auth-shell.js";
import {
  applyReportFiscalRange,
  escapeHtml,
  getDateRange,
  money,
  showAlert,
  wireToolbar,
} from "./reports-core.js";

const $ = (sel, root = document) => root.querySelector(sel);

function setMeta(d) {
  const meta = $("#report-meta");
  if (!meta || !d) return;
  const t = d.totals || {};
  const bal =
    t.diff != null && Number(t.diff) > 0.005
      ? ` · Atención: diferencia Debe−Haber ${money(t.diff)} (revisar pólizas).`
      : "";
  meta.textContent = `Ejercicio ${d.fiscalYear} · Periodo ${d.range.from} → ${d.range.to} · ${t.polizaCount ?? 0} póliza(s) · Cargos ${money(t.debit)} · Abonos ${money(t.credit)}${bal}`;
}

function renderLibro(data) {
  const root = $("#libro-root");
  if (!root) return;

  if (!data.entries.length) {
    root.innerHTML = `<section class="panel"><p class="data-table__empty">No hay pólizas con fecha en este periodo (dentro del ejercicio fiscal activo).</p></section>`;
    $("#libro-totals-wrap").hidden = true;
    return;
  }

  root.innerHTML = data.entries
    .map((e) => {
      const lineRows = e.lines
        .map(
          (l) => `
        <tr>
          <td>${escapeHtml(l.accountCode)}</td>
          <td>${escapeHtml(l.accountName || "—")}</td>
          <td class="libro-cell-concept">${escapeHtml(l.lineConcept || "—")}</td>
          <td class="report-num">${money(l.debit)}</td>
          <td class="report-num">${money(l.credit)}</td>
        </tr>`
        )
        .join("");
      return `
      <article class="libro-entry panel" data-poliza-id="${escapeHtml(e.id)}">
        <header class="libro-entry__head">
          <div class="libro-entry__meta">
            <span class="libro-entry__date">${escapeHtml(e.date)}</span>
            <span class="libro-entry__folio">${escapeHtml(e.folio)}</span>
            <span class="libro-entry__type">${escapeHtml(e.type)}</span>
          </div>
          <p class="libro-entry__concept">${escapeHtml(e.concept)}</p>
        </header>
        <div class="table-wrap table-wrap--sticky-head">
          <table class="data-table data-table--dense libro-lines-table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Nombre</th>
                <th>Concepto línea</th>
                <th class="report-num">Debe</th>
                <th class="report-num">Haber</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
            <tfoot>
              <tr class="libro-entry__foot">
                <td colspan="3" class="libro-entry__foot-label">Total asiento</td>
                <td class="report-num"><strong>${money(e.totalDebit)}</strong></td>
                <td class="report-num"><strong>${money(e.totalCredit)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>`;
    })
    .join("");

  const tw = $("#libro-totals-wrap");
  const t = data.totals || {};
  if (tw) tw.hidden = false;
  const elN = $("#libro-total-count");
  const elD = $("#libro-total-debit");
  const elC = $("#libro-total-credit");
  const elDiff = $("#libro-total-diff");
  const elDiffRow = $("#libro-total-diff-row");
  if (elN) elN.textContent = String(t.polizaCount ?? 0);
  if (elD) elD.textContent = money(t.debit);
  if (elC) elC.textContent = money(t.credit);
  const diff = Number(t.diff) || 0;
  if (elDiffRow && elDiff) {
    if (diff > 0.005) {
      elDiffRow.hidden = false;
      elDiff.textContent = money(diff);
    } else {
      elDiffRow.hidden = true;
    }
  }
}

async function loadLibro() {
  const { from, to } = getDateRange();
  const qs = new URLSearchParams({ from, to });
  const res = await fetch(`/api/reports/libro-diario?${qs}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  const j = await res.json();
  if (!res.ok || !j.success) {
    showAlert(j.message || "No se pudo cargar el libro diario.");
    const root = $("#libro-root");
    if (root) root.innerHTML = "";
    const tw = $("#libro-totals-wrap");
    if (tw) tw.hidden = true;
    return;
  }
  showAlert("");
  setMeta(j.data);
  renderLibro(j.data);
  const url = new URL(window.location.href);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  window.history.replaceState({}, "", url);
}

async function boot() {
  const session = await initAuthShell({
    onFiscalChange: async () => {
      const y = Number(document.getElementById("sidebar-fiscal-year")?.value);
      if (Number.isFinite(y)) applyReportFiscalRange(y);
      await loadLibro();
    },
  });
  if (!session) return;
  applyReportFiscalRange(session.fiscalYear);
  const params = new URLSearchParams(window.location.search);
  const pf = params.get("from");
  const pt = params.get("to");
  if (pf && /^\d{4}-\d{2}-\d{2}$/.test(pf)) $("#report-from").value = pf;
  if (pt && /^\d{4}-\d{2}-\d{2}$/.test(pt)) $("#report-to").value = pt;
  wireToolbar(async () => {
    await loadLibro();
  });
  await loadLibro();
}

boot();
