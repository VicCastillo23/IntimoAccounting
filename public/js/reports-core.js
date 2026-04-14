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
}
