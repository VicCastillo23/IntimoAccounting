import { initAuthShell } from "./auth-shell.js";
import { applyReportFiscalRange, getDateRange, loadDashboard, setMeta, wireToolbar } from "./reports-core.js";
import { renderVariacionCapital } from "./reports-renders.js";
import { initReportPrintBranding } from "./report-print-branding.js";

async function load() {
  const d = await loadDashboard();
  if (!d) return;
  setMeta(d);
  renderVariacionCapital(d);
}

async function boot() {
  const session = await initAuthShell({ onFiscalChange: () => void load() });
  if (!session) return;
  applyReportFiscalRange(session.fiscalYear);
  initReportPrintBranding(getDateRange);
  wireToolbar(load);
  await load();
}

boot();
