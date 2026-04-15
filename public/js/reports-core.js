import { initReportPrintBranding } from "./report-print-branding.js";

const $ = (sel, root = document) => root.querySelector(sel);

export { $ };

const fmt = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(n) {
  return fmt.format(Number(n) || 0);
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 3);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

/** Valores por defecto del ejercicio (1 ene – 31 dic); el usuario puede cambiar el rango libremente. */
export function applyReportFiscalRange(fiscalYear) {
  const fromEl = $("#report-from");
  const toEl = $("#report-to");
  if (!fromEl || !toEl) return;
  const y = Number(fiscalYear);
  if (!Number.isFinite(y)) return;
  fromEl.value = `${y}-01-01`;
  toEl.value = `${y}-12-31`;
}

export function showAlert(msg, kind = "error") {
  const el = $("#report-alert");
  if (!el) return;
  el.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

export function getDateRange() {
  const fromEl = $("#report-from");
  const toEl = $("#report-to");
  const r = defaultRange();
  if (fromEl && !fromEl.value) fromEl.value = r.from;
  if (toEl && !toEl.value) toEl.value = r.to;
  return { from: fromEl?.value || r.from, to: toEl?.value || r.to };
}

export function setMeta(d) {
  const meta = $("#report-meta");
  if (meta && d?.range) {
    meta.textContent = `Periodo ${d.range.from} → ${d.range.to} · ${d.polizasEnPeriodo} pólizas · Cierre ${d.range.asOf}`;
  }
}

export async function loadDashboard() {
  const { from, to } = getDateRange();
  const qs = new URLSearchParams({ from, to, asOf: to });
  const res = await fetch(`/api/reports/dashboard?${qs}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login.html";
    return null;
  }
  const j = await res.json();
  if (!res.ok || !j.success) {
    showAlert(j.message || "No se pudieron cargar los reportes.");
    return null;
  }
  showAlert("");
  return j.data;
}

export function wireToolbar(onApply) {
  $("#btn-report-apply")?.addEventListener("click", () => void onApply());
  $("#btn-report-print")?.addEventListener("click", () => {
    window.print();
  });
  void initReportPrintBranding(getDateRange);
}

/** Animacion uniforme para las graficas de reporteria. */
export function reportChartAnimation() {
  return {
    animation: {
      duration: 1400,
      easing: "easeOutQuart",
    },
    transitions: {
      active: {
        animation: {
          duration: 280,
        },
      },
    },
  };
}

const chartTimers = new Map();

/**
 * Efecto escalonado: primero texto/tablas, luego gráfica.
 * @param {string} canvasId
 * @param {() => void} renderFn
 * @param {number} [delayMs]
 */
export function runChartWithStagger(canvasId, renderFn, delayMs = 220) {
  const canvas = document.getElementById(canvasId);
  const wrap = canvas?.closest(".report-chart-wrap");
  if (wrap) wrap.classList.remove("report-chart-wrap--ready");

  const prev = chartTimers.get(canvasId);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(() => {
    renderFn();
    if (wrap) {
      requestAnimationFrame(() => {
        wrap.classList.add("report-chart-wrap--ready");
      });
    }
    chartTimers.delete(canvasId);
  }, delayMs);

  chartTimers.set(canvasId, timer);
}
