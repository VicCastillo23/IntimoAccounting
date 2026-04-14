import { initAuthShell } from "./auth-shell.js";
import {
  loadDashboard,
  reportChartAnimation,
  runChartWithStagger,
  setMeta,
  wireToolbar,
} from "./reports-core.js";
import { renderActividad } from "./reports-renders.js";

let chart;

function renderChart(d) {
  if (!window.Chart) return;
  const ctx = document.getElementById("report-chart-actividad")?.getContext("2d");
  if (!ctx) return;
  const s = d.incomeStatement;
  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Ingresos", "Costos", "Gastos", "Util. Bruta", "Util. Neta"],
      datasets: [{ data: [s.ingresos, s.costos, s.gastos, s.utilidadBruta, s.utilidadNeta], backgroundColor: ["#2e7d32", "#ef6c00", "#c62828", "#1565c0", "#6a1b9a"] }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      ...reportChartAnimation(),
    },
  });
}

async function load() {
  const d = await loadDashboard();
  if (!d) return;
  setMeta(d);
  renderActividad(d);
  runChartWithStagger("report-chart-actividad", () => renderChart(d));
}

async function boot() {
  if (!(await initAuthShell())) return;
  wireToolbar(load);
  await load();
}

boot();
