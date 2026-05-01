import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);

async function api(url) {
  const r = await fetch(url, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || `Error HTTP ${r.status}`);
  return j.data;
}

function safeUrl(v) {
  const raw = String(v || "").trim();
  if (!raw) return "https://facturacion.cafeintimo.mx";
  try {
    const u = new URL(raw);
    if (!["https:", "http:"].includes(u.protocol)) throw new Error("bad protocol");
    return u.toString();
  } catch {
    return "https://facturacion.cafeintimo.mx";
  }
}

async function init() {
  const session = await initAuthShell();
  if (!session) return;

  const cfg = await api("/api/facturama/bridge-config");
  const base = safeUrl(cfg?.invoicingAppUrl);
  const note = $("#facturama-bridge-note");
  const link = $("#facturama-open-link");
  const frame = $("#facturama-frame");

  if (note) {
    note.textContent =
      "Este panel usa el mismo módulo de Invoicing (Facturama). Si tu navegador bloquea cookies de terceros, usa 'Abrir en nueva pestaña'.";
  }
  if (link) link.href = base;
  if (frame) frame.src = base;
}

init().catch((e) => {
  const note = $("#facturama-bridge-note");
  if (note) note.textContent = `No se pudo abrir Facturama: ${e instanceof Error ? e.message : String(e)}`;
});
