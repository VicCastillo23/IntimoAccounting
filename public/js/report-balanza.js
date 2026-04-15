import { initAuthShell } from "./auth-shell.js";
import {
  applyReportFiscalRange,
  loadDashboard,
  reportChartAnimation,
  runChartWithStagger,
  setMeta,
  wireToolbar,
} from "./reports-core.js";
import { renderBalanza } from "./reports-renders.js";

let chart;

function renderChart(d) {
  if (!window.Chart) return;
  const ctx = document.getElementById("report-chart-balanza")?.getContext("2d");
  if (!ctx) return;
  const top = [...(d.trialBalance || [])]
    .map((r) => ({
      label: r.accountCode,
      value: Math.abs((Number(r.saldoDeudor) || 0) - (Number(r.saldoAcreedor) || 0)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map((x) => x.label),
      datasets: [{ label: "Saldo neto", data: top.map((x) => x.value), backgroundColor: "#1f1f1f" }],
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
  renderBalanza(d);
  runChartWithStagger("report-chart-balanza", () => renderChart(d));
}

async function boot() {
  const session = await initAuthShell({ onFiscalChange: () => void load() });
  if (!session) return;
  applyReportFiscalRange(session.fiscalYear);
  wireToolbar(load);
  await load();
}

boot();
