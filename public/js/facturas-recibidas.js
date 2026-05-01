import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);
const fmtMoney = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(
    Number(n || 0)
  );

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDate(s) {
  const t = String(s || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  const d = new Date(`${t}T12:00:00`);
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

function setAlert(message, ok = true) {
  const box = $("#fr-alert");
  if (!box) return;
  box.className = `alert ${ok ? "alert--success" : "alert--error"}`;
  box.textContent = message;
  box.hidden = false;
}

function clearAlert() {
  const box = $("#fr-alert");
  if (!box) return;
  box.hidden = true;
}

async function api(url, options = {}) {
  const r = await fetch(url, { credentials: "include", ...options });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || `Error HTTP ${r.status}`);
  return j.data;
}

function currentFilters() {
  const p = new URLSearchParams();
  const query = $("#fr-query")?.value?.trim() || "";
  const issuerRfc = $("#fr-issuer")?.value?.trim() || "";
  const status = $("#fr-status")?.value?.trim() || "";
  const from = $("#fr-from")?.value?.trim() || "";
  const to = $("#fr-to")?.value?.trim() || "";
  if (query) p.set("query", query);
  if (issuerRfc) p.set("issuerRfc", issuerRfc);
  if (status) p.set("status", status);
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  p.set("limit", "100");
  return p.toString();
}

async function loadReceivedInvoices() {
  const tbody = $("#fr-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7">Cargando...</td></tr>`;
  try {
    const data = await api(`/api/invoices/received?${currentFilters()}`);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7">Sin resultados.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr data-id="${escapeHtml(r.public_id)}">
        <td>${escapeHtml(r.cfdi_uuid || "—")}</td>
        <td>${escapeHtml(r.issuer_rfc || "—")}</td>
        <td>${escapeHtml(r.series || "")}${r.folio ? `-${escapeHtml(r.folio)}` : ""}</td>
        <td>${fmtDate(r.issued_at)}</td>
        <td class="data-table__num">${fmtMoney(r.total)}</td>
        <td>${escapeHtml((r.status || "").toUpperCase())}</td>
        <td>${escapeHtml(r.source_entry_name || "—")}</td>
      </tr>
    `
      )
      .join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7">No se pudo cargar (${escapeHtml(e.message)}).</td></tr>`;
  }
}

async function importZip() {
  const fileEl = $("#fr-zip");
  const f = fileEl?.files?.[0];
  if (!f) {
    setAlert("Selecciona un ZIP del SAT.", false);
    return;
  }
  clearAlert();
  const fd = new FormData();
  fd.append("file", f);
  try {
    const data = await api("/api/invoices/received/import-zip", { method: "POST", body: fd });
    setAlert(
      `Importación completa: ${data.summary?.inserted || 0} insertadas, ${data.summary?.duplicates || 0} duplicadas, ${data.summary?.errors || 0} con error.`
    );
    await loadReceivedInvoices();
    if (fileEl) fileEl.value = "";
  } catch (e) {
    setAlert(e.message, false);
  }
}

async function showDetail(id) {
  const box = $("#fr-detail");
  if (!box) return;
  box.innerHTML = "Cargando detalle...";
  try {
    const row = await api(`/api/invoices/received/${encodeURIComponent(id)}`);
    box.innerHTML = `
      <h3>Detalle de factura</h3>
      <p><strong>UUID:</strong> ${escapeHtml(row.cfdi_uuid || "—")}</p>
      <p><strong>Emisor:</strong> ${escapeHtml(row.issuer_rfc || "—")} &nbsp; | &nbsp; <strong>Receptor:</strong> ${escapeHtml(
      row.receiver_rfc || "—"
    )}</p>
      <p><strong>Fecha:</strong> ${fmtDate(row.issued_at)} &nbsp; | &nbsp; <strong>Total:</strong> ${fmtMoney(row.total)}</p>
      <p><strong>Estatus:</strong> ${escapeHtml(row.status || "—")} &nbsp; | &nbsp; <strong>Modo pago:</strong> ${escapeHtml(
      row.payment_mode || "—"
    )}</p>
      <details>
        <summary>Ver XML</summary>
        <pre class="fr-xml">${escapeHtml(row.xml_raw || "")}</pre>
      </details>
    `;
  } catch (e) {
    box.innerHTML = `<p>No se pudo obtener detalle: ${escapeHtml(e.message)}</p>`;
  }
}

function wireTableActions() {
  $("#fr-tbody")?.addEventListener("click", async (ev) => {
    const row = ev.target instanceof HTMLElement ? ev.target.closest("tr[data-id]") : null;
    const id = row?.getAttribute("data-id");
    if (!id) return;
    await showDetail(id);
  });
}

async function init() {
  const session = await initAuthShell();
  if (!session) return;
  wireTableActions();
  $("#fr-import-btn")?.addEventListener("click", importZip);
  $("#fr-filter-btn")?.addEventListener("click", loadReceivedInvoices);
  $("#fr-clear-btn")?.addEventListener("click", () => {
    ["#fr-query", "#fr-issuer", "#fr-status", "#fr-from", "#fr-to"].forEach((sel) => {
      const el = $(sel);
      if (el) el.value = "";
    });
    loadReceivedInvoices();
  });
  await loadReceivedInvoices();
}

init().catch((e) => {
  setAlert(e instanceof Error ? e.message : "No se pudo iniciar Facturas recibidas.", false);
});
