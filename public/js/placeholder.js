import { initAuthShell } from "./auth-shell.js";

const TITLES = {
  "catalogo-cuentas": "Catálogo de cuentas",
  "auxiliares-mayor": "Auxiliares de mayor",
  "libro-diario": "Libro diario",
  "control-almacen": "Control de almacén",
  "control-activos": "Control de activos",
  "control-depreciaciones-amortizaciones": "Control de depreciaciones y amortizaciones",
  "balanza-comprobacion": "Balanza de comprobación",
  "estado-situacion-financiera": "Estado de situación financiera",
  "estado-actividad": "Estado de actividad",
  "estado-cambios-situacion-financiera": "Estado de cambios en la situación financiera",
  "estado-variacion-capital-contable": "Estado de variación en las cuentas de capital contable",
  "estado-flujo-efectivo": "Estado de flujo de efectivo",
};

const ok = await initAuthShell();
if (!ok) throw new Error("redirect");

const params = new URLSearchParams(window.location.search);
const m = params.get("m") || "";
const title = TITLES[m] || "Sección";
const h1 = document.getElementById("placeholder-title");
if (h1) h1.textContent = title;

document.querySelectorAll("[data-nav]").forEach((el) => {
  const slug = el.getAttribute("data-nav");
  el.classList.toggle("sidebar__link--active", slug === m);
});
