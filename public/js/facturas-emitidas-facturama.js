import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);
const SAT_PRODUCT_OPTIONS = [
  ["90101500", "Establecimientos para comer y beber"],
  ["50202300", "Bebidas no alcohólicas"],
  ["50181900", "Pan, pasteles y repostería"],
  ["50101700", "Café y té"],
  ["50201700", "Café"],
  ["50202200", "Té"],
  ["50202400", "Jugos"],
  ["50202500", "Bebidas energéticas o deportivas"],
  ["50202600", "Bebidas carbonatadas"],
  ["50161500", "Chocolate y sustitutos"],
  ["50192100", "Botanas y snacks"],
  ["50192300", "Postres preparados"],
  ["50192500", "Sándwiches y wraps"],
  ["50192700", "Ensaladas preparadas"],
  ["50192800", "Platillos preparados"],
  ["50192900", "Sopas preparadas"],
  ["50193000", "Pastas y noodles preparados"],
  ["50193100", "Pizzas preparadas"],
  ["50193200", "Hamburguesas y hot dogs"],
  ["50193300", "Tacos y antojitos"],
  ["50171800", "Salsas y aderezos"],
  ["50172000", "Condimentos y especias"],
  ["53131600", "Servicios de cafetería para eventos"],
  ["01010101", "No existe en catálogo"],
];

const SAT_UNIT_OPTIONS = [
  ["E48", "Unidad de servicio"],
  ["H87", "Pieza"],
  ["ACT", "Actividad"],
  ["A9", "Tarifa"],
  ["DAY", "Día"],
  ["HUR", "Hora"],
  ["LTR", "Litro"],
  ["KGM", "Kilogramo"],
  ["MTR", "Metro"],
  ["XBX", "Caja"],
  ["XPK", "Paquete"],
];

async function api(url) {
  const r = await fetch(url, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || `Error HTTP ${r.status}`);
  return j.data;
}

function normRfc(v) {
  return String(v || "").trim().toUpperCase();
}

function isRfcLike(v) {
  const rfc = normRfc(v);
  return /^([A-Z&Ñ]{3,4})\d{6}[A-Z0-9]{3}$/.test(rfc);
}

function validateRegimeCfdiUse(rfc, regime, cfdiUse) {
  const rrfc = normRfc(rfc);
  const r = String(regime || "").trim();
  const u = String(cfdiUse || "").trim().toUpperCase();
  if (r === "605" && u === "G03") {
    return "El uso CFDI G03 no es válido con régimen 605.";
  }
  if (r === "616" && u !== "S01") {
    return "Para régimen 616 usa CFDI S01 (sin efectos fiscales).";
  }
  if (rrfc === "XAXX010101000" && u !== "S01") {
    return "Para RFC genérico XAXX010101000 usa CFDI S01.";
  }
  return "";
}

function extractApiError(json, fallback) {
  const detail = json?.details;
  const modelState = detail?.ModelState || detail?.modelState;
  if (modelState && typeof modelState === "object") {
    const firstKey = Object.keys(modelState)[0];
    const firstVal = modelState[firstKey];
    if (Array.isArray(firstVal) && firstVal.length) {
      return `${json?.message || fallback} · ${String(firstVal[0])}`;
    }
    if (typeof firstVal === "string" && firstVal) {
      return `${json?.message || fallback} · ${firstVal}`;
    }
  }
  return json?.message || fallback;
}

function setStatus(msg, ok = true) {
  const st = $("#mi-status");
  if (!st) return;
  st.textContent = msg;
  st.style.color = ok ? "var(--intimo-gray-medium)" : "#b00020";
}

function gatherFormData() {
  const concepts = [...document.querySelectorAll(".mi-item-row")]
    .map((row) => {
      const description = String(row.querySelector('[data-field="description"]')?.value || "").trim();
      const total = Number(row.querySelector('[data-field="total"]')?.value || 0);
      const productCode = String(row.querySelector('[data-field="productCode"]')?.value || "").trim();
      const unitCode = String(row.querySelector('[data-field="unitCode"]')?.value || "").trim();
      const unitLabel = String(row.querySelector('[data-field="unitLabel"]')?.value || "").trim();
      return { description, total, productCode, unitCode, unitLabel, taxRate: 0.16 };
    })
    .filter((x) => x.description && x.total > 0);
  return {
    rfc: normRfc($("#mi-rfc")?.value),
    name: String($("#mi-name")?.value || "").trim(),
    regime: String($("#mi-regime")?.value || "").trim(),
    cfdiUse: String($("#mi-cfdi-use")?.value || "").trim(),
    concepts,
    zip: String($("#mi-zip")?.value || "").trim(),
    email: String($("#mi-email")?.value || "").trim(),
    street: String($("#mi-street")?.value || "").trim(),
    extNumber: String($("#mi-ext-number")?.value || "").trim(),
    intNumber: String($("#mi-int-number")?.value || "").trim(),
    city: String($("#mi-city")?.value || "").trim(),
    colony: String($("#mi-colony")?.value || "").trim(),
    locality: String($("#mi-locality")?.value || "").trim(),
    state: String($("#mi-state")?.value || "").trim(),
    country: String($("#mi-country")?.value || "").trim(),
  };
}

function fmtMoney(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function recalcItemsTotal() {
  const total = [...document.querySelectorAll('.mi-item-row [data-field="total"]')].reduce(
    (s, el) => s + (Number(el.value || 0) || 0),
    0
  );
  const tag = $("#mi-items-total");
  if (tag) tag.textContent = `Total: ${fmtMoney(total)}`;
}

function addConceptRow(defaults = {}) {
  const host = $("#mi-items");
  if (!host) return;
  const row = document.createElement("div");
  row.className = "mi-item-row";
  row.style.display = "grid";
  row.style.gridTemplateColumns = "minmax(220px,2fr) minmax(120px,1fr) minmax(220px,1.4fr) minmax(170px,1fr) minmax(160px,1fr) auto";
  row.style.gap = ".5rem";
  row.style.marginBottom = ".5rem";
  const productCode = String(defaults.productCode || "90101500");
  const unitCode = String(defaults.unitCode || "E48");
  const unitLabel = String(defaults.unitLabel || "Unidad de servicio");
  const productOptionsHtml = SAT_PRODUCT_OPTIONS.map(
    ([code, label]) => `<option value="${code}" ${productCode === code ? "selected" : ""}>${code} · ${label}</option>`
  ).join("");
  const unitOptionsHtml = SAT_UNIT_OPTIONS.map(
    ([code, label]) => `<option value="${code}" ${unitCode === code ? "selected" : ""}>${code} · ${label}</option>`
  ).join("");
  row.innerHTML = `
    <input class="report-field__input" data-field="description" type="text" placeholder="Concepto" value="${String(defaults.description || "").replaceAll('"', "&quot;")}" />
    <input class="report-field__input" data-field="total" type="number" min="0.01" step="0.01" placeholder="Total MXN" value="${Number(defaults.total || 0) > 0 ? Number(defaults.total) : ""}" />
    <select class="report-field__input" data-field="productCode">
      ${productOptionsHtml}
    </select>
    <select class="report-field__input" data-field="unitCode">
      ${unitOptionsHtml}
    </select>
    <input class="report-field__input" data-field="unitLabel" type="text" placeholder="Unidad" value="${unitLabel.replaceAll('"', "&quot;")}" />
    <div style="display:flex; align-items:center; justify-content:flex-end;">
      <button type="button" class="btn btn--text btn--sm" data-action="remove">Quitar</button>
    </div>
  `;
  host.appendChild(row);
  row.querySelector('[data-action="remove"]')?.addEventListener("click", () => {
    row.remove();
    recalcItemsTotal();
  });
  row.querySelector('[data-field="total"]')?.addEventListener("input", recalcItemsTotal);
  recalcItemsTotal();
}

function showResult(html) {
  const box = $("#mi-result");
  if (box) box.innerHTML = html;
}

function wireManualForm() {
  $("#mi-add-item")?.addEventListener("click", () =>
    addConceptRow({ description: "", total: 0, productCode: "90101500", unitCode: "E48", unitLabel: "Unidad de servicio" })
  );
  if (!document.querySelector(".mi-item-row")) addConceptRow({ description: "Consumo de alimentos", total: 150 });

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
  });

  $("#manual-invoice-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = gatherFormData();
    if (!isRfcLike(d.rfc)) return setStatus("RFC inválido.", false);
    if (!d.name || !d.regime || !d.cfdiUse || !/^\d{5}$/.test(d.zip) || !d.concepts.length) {
      return setStatus("Completa nombre, régimen, uso CFDI, CP y al menos un concepto válido.", false);
    }
    const regimeErr = validateRegimeCfdiUse(d.rfc, d.regime, d.cfdiUse);
    if (regimeErr) return setStatus(regimeErr, false);
    setStatus("Timbrando factura en Facturama...");
    try {
      const res = await fetch("/api/facturacion/manual/emitir", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver: {
            rfc: d.rfc,
            legalName: d.name,
            taxRegime: d.regime,
            cfdiUse: d.cfdiUse,
            zipCode: d.zip,
            email: d.email,
            street: d.street,
            extNumber: d.extNumber,
            intNumber: d.intNumber,
            municipality: d.city,
            colony: d.colony,
            locality: d.locality,
            state: d.state,
            country: d.country || "México",
          },
          invoice: {
            concepts: d.concepts,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(extractApiError(json, `Error HTTP ${res.status}`));
      const out = json.data || {};
      showResult(`
        <div class="alert alert--success">
          Factura generada correctamente. UUID: <strong>${out.uuid || "—"}</strong>
          ${out.downloads?.xml ? ` · <a href="${out.downloads.xml}" target="_blank" rel="noopener">XML</a>` : ""}
          ${out.downloads?.pdf ? ` · <a href="${out.downloads.pdf}" target="_blank" rel="noopener">PDF</a>` : ""}
        </div>
      `);
      setStatus("Factura timbrada.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), false);
    }
  });
}

async function init() {
  const session = await initAuthShell();
  if (!session) return;

  await api("/api/facturama/bridge-config");
  const note = $("#facturama-bridge-note");

  if (note) {
    note.textContent = "Facturación manual independiente de tickets. Timbra directo con Facturama y guarda registro en emitidas.";
  }
  wireManualForm();
}

init().catch((e) => {
  const note = $("#facturama-bridge-note");
  if (note) note.textContent = `No se pudo abrir Facturama: ${e instanceof Error ? e.message : String(e)}`;
});
