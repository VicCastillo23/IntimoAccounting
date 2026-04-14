import { initAuthShell } from "./auth-shell.js";
import {
  loadDashboard,
  reportChartAnimation,
  runChartWithStagger,
  setMeta,
  wireToolbar,
} from "./reports-core.js";
import { renderEsf } from "./reports-renders.js";

let chart;

function renderChart(d) {
  if (!window.Chart) return;
  const ctx = document.getElementById("report-chart-esf")?.getContext("2d");
  if (!ctx) return;
  const bs = d.balanceSheet;
  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Activo", "Pasivo", "Capital", "Resultado"],
      datasets: [{ data: [bs.activo, bs.pasivo, bs.capital, bs.resultadoDelEjercicio], backgroundColor: ["#37474f", "#6d4c41", "#1b5e20", "#ef6c00"] }],
    },
    options: { responsive: true, maintainAspectRatio: false, ...reportChartAnimation() },
  });
}

async function load() {
  const d = await loadDashboard();
  if (!d) return;
  setMeta(d);
  renderEsf(d);
  runChartWithStagger("report-chart-esf", () => renderChart(d));
}

async function boot() {
  if (!(await initAuthShell())) return;
  wireToolbar(load);
  await load();
}

boot();
