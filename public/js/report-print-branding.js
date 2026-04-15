/**
 * Encabezado de impresión: razón social, logo, dirección, RFC, periodo y fecha de emisión.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} iso YYYY-MM-DD */
function formatIsoToLongEs(iso) {
  const t = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  const d = new Date(`${t}T12:00:00`);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function emissionDateTimeEs() {
  const now = new Date();
  return now.toLocaleString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** @type {Record<string, unknown> | null} */
let brandingCache = null;

async function fetchBranding() {
  if (brandingCache) return brandingCache;
  const res = await fetch("/api/config/branding", { credentials: "include" });
  if (res.status === 401) return null;
  const j = await res.json();
  if (!j.success || !j.data) return null;
  brandingCache = j.data;
  return brandingCache;
}

/**
 * @typedef {{ companyName: string, logoUrl: string, addressLines: string[], rfc: string }} BrandingData
 * @param {BrandingData | null} b
 * @param {{ reportTitle: string, periodLabel: string, subtitle?: string, periodHeading?: string }} meta
 */
function renderPrintHeaderHtml(b, meta) {
  const name = b?.companyName || "Empresa";
  const logo = b?.logoUrl ? `<img class="report-print-header__logo" src="${escapeHtml(b.logoUrl)}" alt="" />` : "";
  const addr =
    (b?.addressLines || []).length > 0
      ? `<div class="report-print-header__addr">${(b.addressLines || []).map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>`
      : "";
  const rfc = b?.rfc ? `<div class="report-print-header__rfc"><strong>RFC</strong> ${escapeHtml(b.rfc)}</div>` : "";
  const periodH = meta.periodHeading || "Periodo del reporte";

  return `
    <div class="report-print-header__grid">
      <div class="report-print-header__brand">${logo}</div>
      <div class="report-print-header__company">
        <div class="report-print-header__name">${escapeHtml(name)}</div>
        ${addr}
        ${rfc}
      </div>
      <div class="report-print-header__meta">
        <div class="report-print-header__doc-title">${escapeHtml(meta.reportTitle)}</div>
        ${meta.subtitle ? `<div class="report-print-header__subtitle">${escapeHtml(meta.subtitle)}</div>` : ""}
        <div class="report-print-header__period"><strong>${escapeHtml(periodH)}</strong> · ${escapeHtml(meta.periodLabel)}</div>
        <div class="report-print-header__emission"><strong>Fecha y hora de emisión</strong> · ${escapeHtml(emissionDateTimeEs())}</div>
      </div>
    </div>
    <hr class="report-print-header__rule" />
  `;
}

/**
 * Reportería: periodo desde #report-from / #report-to.
 * @param {() => { from: string, to: string }} getDateRange
 */
export async function initReportPrintBranding(getDateRange) {
  const el = document.getElementById("report-print-header");
  if (!el) return;

  const render = async () => {
    const b = await fetchBranding();
    const { from, to } = getDateRange();
    const periodLabel =
      from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
        ? `del ${formatIsoToLongEs(from)} al ${formatIsoToLongEs(to)}`
        : "—";
    const title = document.querySelector(".main--report .main__h1")?.textContent?.trim() || "Reporte";
    el.innerHTML = renderPrintHeaderHtml(b, { reportTitle: title, periodLabel });
  };

  await render();
  window.addEventListener("beforeprint", () => {
    void render();
  });
}

/** @type {null | (() => Promise<void>)} */
let polizaPrintHeaderRender = null;

/**
 * Pólizas: una fecha contable o periodo corto.
 * @param {() => { reportTitle?: string, periodLabel: string, subtitle?: string } | null} getContext
 */
export async function initPolizaPrintBranding(getContext) {
  const el = document.getElementById("poliza-print-header");
  if (!el) return;

  const render = async () => {
    const ctx = getContext();
    const b = await fetchBranding();
    if (!ctx) {
      el.innerHTML = "";
      return;
    }
    const title = ctx.reportTitle || "Póliza contable";
    el.innerHTML = renderPrintHeaderHtml(b, {
      reportTitle: title,
      periodLabel: ctx.periodLabel,
      subtitle: ctx.subtitle,
      periodHeading: "Fecha contable",
    });
  };

  polizaPrintHeaderRender = render;
  await render();
  window.addEventListener("beforeprint", () => {
    void render();
  });
}

/** Sincroniza el encabezado de impresión al cambiar de póliza (no solo al imprimir). */
export function refreshPolizaPrintHeader() {
  if (polizaPrintHeaderRender) void polizaPrintHeaderRender();
}
