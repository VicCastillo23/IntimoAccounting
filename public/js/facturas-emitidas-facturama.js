import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);
let facturamaBase = "https://facturacion.cafeintimo.mx";

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

function normRfc(v) {
  return String(v || "").trim().toUpperCase();
}

function isRfcLike(v) {
  const rfc = normRfc(v);
  return /^([A-Z&Ñ]{3,4})\d{6}[A-Z0-9]{3}$/.test(rfc);
}

function setStatus(msg, ok = true) {
  const st = $("#mi-status");
  if (!st) return;
  st.textContent = msg;
  st.style.color = ok ? "var(--intimo-gray-medium)" : "#b00020";
}

function gatherFormData() {
  return {
    rfc: normRfc($("#mi-rfc")?.value),
    name: String($("#mi-name")?.value || "").trim(),
    regime: String($("#mi-regime")?.value || "").trim(),
    cfdiUse: String($("#mi-cfdi-use")?.value || "").trim(),
    zip: String($("#mi-zip")?.value || "").trim(),
    email: String($("#mi-email")?.value || "").trim(),
    street: String($("#mi-street")?.value || "").trim(),
    city: String($("#mi-city")?.value || "").trim(),
    state: String($("#mi-state")?.value || "").trim(),
    country: String($("#mi-country")?.value || "").trim(),
  };
}

function buildFacturamaUrl() {
  const d = gatherFormData();
  const params = new URLSearchParams();
  params.set("rfc", d.rfc);
  params.set("name", d.name);
  params.set("regime", d.regime);
  params.set("cfdiUse", d.cfdiUse);
  params.set("zip", d.zip);
  if (d.email) params.set("email", d.email);
  if (d.street) params.set("street", d.street);
  if (d.city) params.set("city", d.city);
  if (d.state) params.set("state", d.state);
  if (d.country) params.set("country", d.country);
  return `${facturamaBase.replace(/\/$/, "")}/?${params.toString()}`;
}

function wireManualForm() {
  $("#mi-validate-rfc")?.addEventListener("click", () => {
    const rfc = normRfc($("#mi-rfc")?.value);
    if (!isRfcLike(rfc)) {
      setStatus("RFC inválido. Ejemplo válido: XAXX010101000", false);
      return;
    }
    $("#mi-rfc").value = rfc;
    setStatus("RFC con formato válido.");
  });

  $("#manual-invoice-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const d = gatherFormData();
    if (!isRfcLike(d.rfc)) return setStatus("RFC inválido.", false);
    if (!d.name || !d.regime || !d.cfdiUse || !/^\d{5}$/.test(d.zip)) {
      return setStatus("Completa nombre, régimen, uso CFDI y código postal válido (5 dígitos).", false);
    }
    const url = buildFacturamaUrl();
    window.open(url, "_blank", "noopener");
    setStatus("Abriendo Facturama con datos precapturados.");
  });
}

async function init() {
  const session = await initAuthShell();
  if (!session) return;

  const cfg = await api("/api/facturama/bridge-config");
  const base = safeUrl(cfg?.invoicingAppUrl);
  facturamaBase = base;
  const note = $("#facturama-bridge-note");
  const link = $("#facturama-open-link");

  if (note) {
    note.textContent = "Captura manual tipo Facturama para preparar receptor y abrir facturación en el módulo de Invoicing.";
  }
  if (link) link.href = base;
  wireManualForm();
}

init().catch((e) => {
  const note = $("#facturama-bridge-note");
  if (note) note.textContent = `No se pudo abrir Facturama: ${e instanceof Error ? e.message : String(e)}`;
});
