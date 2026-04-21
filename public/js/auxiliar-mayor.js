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

async function loadAccounts() {
  const sel = $("#aux-account");
  if (!sel) return;
  const prev = sel.value;
  const res = await fetch("/api/catalog/accounts", { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  const j = await res.json();
  if (!res.ok || !j.success) {
    showAlert(j.message || "No se pudo cargar el catálogo de cuentas.");
    return;
  }
  const rows = Array.isArray(j.data) ? j.data : [];
  sel.innerHTML =
    `<option value="">— Elegir cuenta —</option>` +
    rows
      .map((r) => {
        const num = escapeHtml(r.num_cta);
        const d = escapeHtml(r.descripcion || "");
        return `<option value="${escapeHtml(r.num_cta)}">${num} — ${d}</option>`;
      })
      .join("");
  if (prev && rows.some((r) => r.num_cta === prev)) sel.value = prev;
  else {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("account");
    if (q && rows.some((r) => r.num_cta === q)) sel.value = q;
  }
}

function setMeta(data) {
  const meta = $("#report-meta");
  if (!meta || !data) return;
  const name = data.accountName ? ` — ${data.accountName}` : "";
  const nat = data.natur ? ` · Natur ${data.natur}` : "";
  meta.textContent = `${data.accountCode}${name} · Periodo ${data.range.from} → ${data.range.to}${nat} · ${data.movements.length} movimiento(s)`;
}

function renderAuxiliar(data) {
  const tbody = $("#aux-tbody");
  if (!tbody) return;
  const opening = Number(data.openingBalance) || 0;
  const parts = [];
  parts.push(`<tr class="auxiliar-row auxiliar-row--opening">
    <td></td>
    <td>—</td>
    <td>—</td>
    <td><em>Saldo inicial</em> <span class="auxiliar-note">(&lt; ${escapeHtml(data.range.from)})</span></td>
    <td>—</td>
    <td class="report-num">${money(0)}</td>
    <td class="report-num">${money(0)}</td>
    <td class="report-num"><strong>${money(opening)}</strong></td>
  </tr>`);

  for (const m of data.movements) {
    parts.push(`<tr>
      <td>${escapeHtml(m.polizaDate)}</td>
      <td>${escapeHtml(m.folio)}</td>
      <td>${escapeHtml(m.polizaType)}</td>
      <td>${escapeHtml(m.polizaConcept || "—")}</td>
      <td>${escapeHtml(m.lineConcept || "—")}</td>
      <td class="report-num">${money(m.debit)}</td>
      <td class="report-num">${money(m.credit)}</td>
      <td class="report-num">${money(m.balance)}</td>
    </tr>`);
  }

  if (!data.movements.length) {
    parts.push(`<tr><td colspan="8" class="data-table__empty">Sin movimientos en el periodo (el saldo inicial sigue siendo válido).</td></tr>`);
  }

  const close = Number(data.closingBalance) || 0;
  parts.push(`<tr class="auxiliar-row auxiliar-row--total">
    <td colspan="5"><strong>Saldo al cierre del periodo</strong></td>
    <td class="report-num">—</td>
    <td class="report-num">—</td>
    <td class="report-num"><strong>${money(close)}</strong></td>
  </tr>`);

  tbody.innerHTML = parts.join("");
}

async function loadAuxiliar() {
  const account = $("#aux-account")?.value?.trim() || "";
  if (!account) {
    showAlert("Selecciona una cuenta del catálogo.");
    $("#aux-tbody").innerHTML =
      `<tr><td colspan="8" class="data-table__empty">Elige una cuenta y pulsa Actualizar.</td></tr>`;
    $("#report-meta").textContent = "";
    return;
  }
  const { from, to } = getDateRange();
  const qs = new URLSearchParams({ from, to, account });
  const res = await fetch(`/api/reports/auxiliar-mayor?${qs}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  const j = await res.json();
  if (!res.ok || !j.success) {
    showAlert(j.message || "No se pudo cargar el auxiliar.");
    $("#aux-tbody").innerHTML = `<tr><td colspan="8" class="data-table__empty">—</td></tr>`;
    return;
  }
  showAlert("");
  setMeta(j.data);
  renderAuxiliar(j.data);
  const url = new URL(window.location.href);
  url.searchParams.set("account", account);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  window.history.replaceState({}, "", url);
}

async function boot() {
  const session = await initAuthShell({
    onFiscalChange: async () => {
      const y = Number(document.getElementById("sidebar-fiscal-year")?.value);
      if (Number.isFinite(y)) applyReportFiscalRange(y);
      await loadAccounts();
      await loadAuxiliar();
    },
  });
  if (!session) return;
  applyReportFiscalRange(session.fiscalYear);
  wireToolbar(async () => {
    await loadAuxiliar();
  });
  await loadAccounts();
  await loadAuxiliar();
}

boot();
