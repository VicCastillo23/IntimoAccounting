import { initAuthShell } from "./auth-shell.js";
import {
  loadDashboard,
  reportChartAnimation,
  runChartWithStagger,
  setMeta,
  wireToolbar,
} from "./reports-core.js";
import { renderFlujoEfectivo } from "./reports-renders.js";

let chart;

function renderChart(d) {
  if (!window.Chart) return;
  const ctx = document.getElementById("report-chart-flujo")?.getContext("2d");
  if (!ctx) return;
  const cf = d.estadoFlujoEfectivo;
  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Utilidad neta", "Var. capital trabajo", "Neto efectivo"],
      datasets: [{ data: [cf.indirectoSimplificado.utilidadNeta, cf.indirectoSimplificado.variacionCapitalTrabajoAprox, cf.cuentasEfectivoSat.netoIncrementoEfectivo], backgroundColor: ["#2e7d32", "#ef6c00", "#1565c0"] }],
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
  renderFlujoEfectivo(d);
  runChartWithStagger("report-chart-flujo", () => renderChart(d));
}

async function boot() {
  if (!(await initAuthShell())) return;
  wireToolbar(load);
  await load();
}

boot();
