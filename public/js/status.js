import { initAuthShell } from "./auth-shell.js";

async function checkHealth() {
  const label = document.getElementById("status-label");
  const detail = document.getElementById("status-detail");
  if (label) label.textContent = "Comprobando…";
  if (detail) {
    detail.hidden = true;
    detail.textContent = "";
  }
  try {
    const res = await fetch("/health", { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    const ok = res.ok && (body.ok === true || body.status === "ok" || body.success === true || res.status === 200);
    if (label) {
      label.textContent = ok ? "Servicio en línea" : "Servicio con problemas";
      label.style.color = ok ? "#2e7d32" : "#b00020";
    }
    if (detail) {
      const bits = [];
      if (body.status) bits.push(`status: ${body.status}`);
      if (body.ok != null) bits.push(`ok: ${body.ok}`);
      if (body.database != null) bits.push(`database: ${body.database}`);
      if (body.message) bits.push(String(body.message));
      if (!bits.length) bits.push(`HTTP ${res.status}`);
      detail.textContent = bits.join(" · ");
      detail.hidden = false;
    }
  } catch (e) {
    if (label) {
      label.textContent = "No se pudo comprobar el servicio";
      label.style.color = "#b00020";
    }
    if (detail) {
      detail.textContent = e instanceof Error ? e.message : String(e);
      detail.hidden = false;
    }
  }
}

const session = await initAuthShell();
if (!session) throw new Error("redirect");

document.getElementById("btn-status-refresh")?.addEventListener("click", () => void checkHealth());
await checkHealth();
