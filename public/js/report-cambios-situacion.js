import { initAuthShell } from "./auth-shell.js";
import {
  applyReportFiscalRange,
  loadDashboard,
  reportChartAnimation,
  runChartWithStagger,
  setMeta,
  wireToolbar,
} from "./reports-core.js";
import { renderCambiosSituacion, renderOpeningBalances } from "./reports-renders.js";

let chart;

function renderChart(d) {
  if (!window.Chart) return;
  const ctx = document.getElementById("report-chart-cambios")?.getContext("2d");
  if (!ctx) return;
  const c = d.cambiosSituacionFinanciera;
  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Activo", "Pasivo", "Patrimonio"],
      datasets: [{ label: "Variación", data: [c.activo.variacion, c.pasivo.variacion, c.capitalContable.variacion], backgroundColor: ["#1565c0", "#6d4c41", "#2e7d32"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, ...reportChartAnimation() },
  });
}

async function load() {
  const d = await loadDashboard();
  if (!d) return;
  setMeta(d);
  renderOpeningBalances(d);
  renderCambiosSituacion(d);
  runChartWithStagger("report-chart-cambios", () => renderChart(d));
}

async function boot() {
  const session = await initAuthShell({ onFiscalChange: () => void load() });
  if (!session) return;
  applyReportFiscalRange(session.fiscalYear);
  wireToolbar(load);
  await load();
}

boot();
