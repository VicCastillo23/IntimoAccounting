import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);

function money(v) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(v || 0));
}

function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fmtDate(v) {
  const t = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  const d = new Date(`${t}T12:00:00`);
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

async function api(url) {
  const r = await fetch(url, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || `Error HTTP ${r.status}`);
  return j.data;
}

function render(rows) {
  const tbody = $("#fe-tbody");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">Sin facturas emitidas disponibles.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${esc(r.cfdi_uuid || "—")}</td>
      <td>${esc(r.series || "")}${r.folio ? `-${esc(r.folio)}` : ""}</td>
      <td>${fmtDate(r.issued_at)}</td>
      <td>${esc(r.customer_rfc || "—")}</td>
      <td class="data-table__num">${money(r.total)}</td>
      <td>${esc((r.status || "").toUpperCase())}</td>
      <td>${r.xml_url ? `<a href="${esc(r.xml_url)}" target="_blank" rel="noopener">XML</a>` : "—"}</td>
      <td>${r.pdf_url ? `<a href="${esc(r.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : "—"}</td>
    </tr>
  `
    )
    .join("");
}

async function init() {
  const session = await initAuthShell();
  if (!session) return;
  const tbody = $("#fe-tbody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="8">Cargando...</td></tr>`;
  try {
    const data = await api("/api/invoices/issued?limit=100");
    render(Array.isArray(data.rows) ? data.rows : []);
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8">No se pudo cargar: ${esc(e.message)}</td></tr>`;
  }
}

init();
