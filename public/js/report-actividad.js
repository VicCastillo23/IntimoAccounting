import { initAuthShell } from "./auth-shell.js";
import { loadDashboard, setMeta, wireToolbar } from "./reports-core.js";
import { renderActividad } from "./reports-renders.js";

async function load() {
  const d = await loadDashboard();
  if (!d) return;
  setMeta(d);
  renderActividad(d);
}

async function boot() {
  if (!(await initAuthShell())) return;
  wireToolbar(load);
  await load();
}

boot();
