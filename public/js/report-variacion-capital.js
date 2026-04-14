import { initAuthShell } from "./auth-shell.js";
import {
  loadDashboard,
  reportChartAnimation,
  runChartWithStagger,
  setMeta,
  wireToolbar,
} from "./reports-core.js";
import { renderVariacionCapital } from "./reports-renders.js";

let chart;

function renderChart(d) {
  if (!window.Chart) return;
  const ctx = document.getElementById("report-chart-capital")?.getContext("2d");
  if (!ctx) return;
  const v = d.variacionCapitalContable;
  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "line",
    data: {
      labels: ["Inicio", "Resultado", "Cierre"],
      datasets: [{ label: "Capital", data: [v.capitalAlInicio, v.resultadoDelPeriodo, v.capitalAlCierre], borderColor: "#1f1f1f", backgroundColor: "rgba(31,31,31,0.15)", tension: 0.25, fill: true }],
    },
    options: { responsive: true, maintainAspectRatio: false, ...reportChartAnimation() },
  });
}

async function load() {
  const d = await loadDashboard();
  if (!d) return;
  setMeta(d);
  renderVariacionCapital(d);
  runChartWithStagger("report-chart-capital", () => renderChart(d));
}

async function boot() {
  if (!(await initAuthShell())) return;
  wireToolbar(load);
  await load();
}

boot();
