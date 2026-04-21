import { initMobileNav } from "./mobile-nav.js";
import { ensureFiscalYear, injectFiscalSidebar } from "./fiscal-session.js";
import { initPolizaPrintBranding, refreshPolizaPrintHeader } from "./report-print-branding.js";

const $ = (sel, root = document) => root.querySelector(sel);

function apiFetch(url, opts = {}) {
  return fetch(url, { credentials: "include", ...opts });
}

async function ensureAuthed(res) {
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Sesión expirada.");
  }
}

function formatMoney(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);
}

const FX_OPTIONS = [
  { value: "MX", label: "MX (MXN)" },
  { value: "USD", label: "USD" },
  { value: "CAD", label: "CAD" },
  { value: "EUR", label: "EUR" },
];

function fxLabel(code) {
  const m = { MX: "MX (MXN)", USD: "USD", CAD: "CAD", EUR: "EUR" };
  return m[code] || m.MX;
}

function deptoLabel(code) {
  const m = {
    ADMINISTRACION: "Administración",
    SERVICIOS_GENERALES: "Servicios generales",
    OTROS: "Otros",
  };
  return m[code] || "—";
}

/** @param {string} url */
function invoicePdfLinkHtml(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return escapeHtml(u);
  return `<a href="${escapeAttr(u)}" class="poliza-pdf-btn poliza-pdf-btn--readonly" target="_blank" rel="noopener noreferrer" download title="Descargar o abrir factura (PDF/CFDI)"><span class="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span></a>`;
}

/** Texto único para captura: primera línea tipo T-… se guarda como ticket; el resto como concepto mov. */
function joinTicketConceptBlock(ticketId, lineConcept) {
  const t = String(ticketId || "").trim();
  const c = String(lineConcept || "").trim();
  if (t && c) return `${t}\n${c}`;
  if (c) return c;
  return t;
}

function parseTicketConceptBlock(text) {
  const raw = String(text ?? "");
  const lines = raw.split(/\r?\n/);
  const first = lines[0]?.trim() ?? "";
  const rest = lines.slice(1).join("\n").trim();
  if (/^T-[\w.-]+$/i.test(first)) {
    return { ticketId: first, lineConcept: rest };
  }
  return { ticketId: "", lineConcept: raw.trim() };
}

function currencyPrefix(fx) {
  const m = { MX: "$", USD: "US$", CAD: "C$", EUR: "€" };
  return m[fx] || "$";
}

/** Formato con separador de miles (es-MX), p. ej. 20,000 o 20,000.50 */
function formatAmountForInput(n) {
  if (n === 0 || n === "" || n == null) return "";
  const num = Number(n);
  if (isNaN(num) || num === 0) return "";
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

/** Valor sin separadores para editar */
function amountRawString(n) {
  if (n === 0 || n === "" || n == null) return "";
  const num = Number(n);
  if (isNaN(num) || num === 0) return "";
  return String(num);
}

function parseAmountInputString(s) {
  let t = String(s).trim().replace(/\s/g, "");
  t = t.replace(/,/g, "");
  t = t.replace(/[^\d.]/g, "");
  const dot = t.indexOf(".");
  if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");
  if (t === "" || t === ".") return 0;
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

function fxSelectOptionsCompact(selected) {
  const fx = ["MX", "USD", "CAD", "EUR"].includes(selected) ? selected : "MX";
  return ["MX", "USD", "CAD", "EUR"]
    .map((v) => `<option value="${v}" ${v === fx ? "selected" : ""}>${v}</option>`)
    .join("");
}

function deptoSelectOptions(selected) {
  const d = ["ADMINISTRACION", "SERVICIOS_GENERALES", "OTROS"].includes(selected) ? selected : "ADMINISTRACION";
  const opts = [
    ["ADMINISTRACION", "Administración"],
    ["SERVICIOS_GENERALES", "Servicios generales"],
    ["OTROS", "Otros"],
  ];
  return opts.map(([v, label]) => `<option value="${v}" ${v === d ? "selected" : ""}>${label}</option>`).join("");
}

/** Catálogo contable (captura en modal). */
const ACCOUNT_PRESETS = [
  { code: "401-01", name: "Ventas al 16%" },
  { code: "401-02", name: "Ventas al 0%" },
  { code: "207-01", name: "IVA pendiente de trasladar" },
  { code: "208-01", name: "IVA trasladado" },
  { code: "101-01", name: "Caja Chica" },
  { code: "102-01", name: "BBVA cuenta xxxxx" },
  { code: "106-01", name: "Cuentas por cobrar a corto plazo" },
];

const ACCOUNT_PRESET_OTHER = "__other__";

/**
 * 1xx → debe; 2xx y 4xx → haber. Otros primeros dígitos: sin reasignar automático.
 * @returns {"debit" | "credit" | null}
 */
function accountSideFromCode(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const first = s[0];
  if (first === "1") return "debit";
  if (first === "2" || first === "4") return "credit";
  return null;
}

/**
 * Mueve el importe a la casilla correcta según el no. de cuenta (un solo importe por línea).
 * @param {object} line
 */
function applyAmountSideToLine(line) {
  const side = accountSideFromCode(line.accountCode);
  if (!side) return;
  const d = Number(line.debit) || 0;
  const c = Number(line.credit) || 0;
  if (d === 0 && c === 0) return;
  const total = d + c;
  if (side === "debit") {
    line.debit = total;
    line.credit = 0;
  } else {
    line.credit = total;
    line.debit = 0;
  }
}

function accountPresetSelectValue(line) {
  const code = String(line.accountCode || "").trim();
  if (!code) return "";
  const hit = ACCOUNT_PRESETS.find((p) => p.code === code);
  return hit ? hit.code : ACCOUNT_PRESET_OTHER;
}

function accountPresetOptionsHtml(selectedValue) {
  const opt = (code, label) =>
    `<option value="${escapeAttr(code)}" ${code === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
  const rows = ACCOUNT_PRESETS.map((p) => opt(p.code, `${p.code} ${p.name}`));
  rows.unshift(
    `<option value="" ${selectedValue === "" ? "selected" : ""}>${escapeHtml("— Seleccionar cuenta —")}</option>`
  );
  rows.push(opt(ACCOUNT_PRESET_OTHER, "Otros… (escribe no. cuenta y nombre)"));
  return rows.join("");
}

function facturaCellEdit(line, i) {
  const u = String(line.invoiceUrl || "").trim();
  if (u && /^https?:\/\//i.test(u)) {
    return `<a href="${escapeAttr(u)}" class="poliza-pdf-btn" target="_blank" rel="noopener noreferrer" download title="Descargar o abrir factura"><span class="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span></a><button type="button" class="btn btn--ghost btn--sm poliza-pdf-clear" data-clear-invoice="${i}" title="Quitar enlace">×</button>`;
  }
  if (line._showInvoice || u) {
    return `<input type="url" class="line-input poliza-invoice-url-input" data-field="invoiceUrl" placeholder="https://…" value="${escapeAttr(u)}" />`;
  }
  return `<button type="button" class="poliza-factura-add" data-show-invoice="${i}" title="Añadir enlace de factura"><span class="material-symbols-outlined" aria-hidden="true">add_link</span></button>`;
}

function formatLineAmountDisplay(n) {
  if (!n) return "—";
  return new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
}

function syncRowAmountInputs(row, line) {
  const d = row.querySelector('[data-field="debit"]');
  const c = row.querySelector('[data-field="credit"]');
  if (d) d.value = formatAmountForInput(line.debit);
  if (c) c.value = formatAmountForInput(line.credit);
}

function lineTotals(lines) {
  const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

/** Misma forma que al guardar en API (solo líneas del modal). */
function mapCreateLinesToPayload() {
  return createLines.map((l) => ({
    ticketId: String(l.ticketId || "").trim(),
    accountCode: String(l.accountCode || "").trim(),
    accountName: String(l.accountName || "").trim(),
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    lineConcept: String(l.lineConcept || "").trim(),
    invoiceUrl: String(l.invoiceUrl || "").trim(),
    fxCurrency: ["MX", "USD", "CAD", "EUR"].includes(String(l.fxCurrency || "MX").toUpperCase())
      ? String(l.fxCurrency).toUpperCase()
      : "MX",
    depto: ["ADMINISTRACION", "SERVICIOS_GENERALES", "OTROS"].includes(String(l.depto || "ADMINISTRACION").toUpperCase())
      ? String(l.depto || "ADMINISTRACION").toUpperCase()
      : "ADMINISTRACION",
  }));
}

function filterValidPolizaLines(lines) {
  return lines.filter(
    (l) => (l.ticketId || l.accountCode) && (l.debit > 0 || l.credit > 0)
  );
}

function typeShort(t) {
  const m = { DIARIO: "Di", INGRESOS: "Ig", EGRESOS: "Eg", TRANSFERENCIA: "Tr" };
  return m[t] || (t ? String(t).slice(0, 2) : "—");
}

function folioSeq(folio) {
  const parts = String(folio).split("-");
  const last = parts[parts.length - 1];
  return String(parseInt(last, 10) || last);
}

function normLine(l) {
  const fx = String(l.fxCurrency || l.currency || "MX").toUpperCase();
  const fxCurrency = ["MX", "USD", "CAD", "EUR"].includes(fx) ? fx : "MX";
  const d = String(l.depto || "ADMINISTRACION").toUpperCase();
  const depto = ["ADMINISTRACION", "SERVICIOS_GENERALES", "OTROS"].includes(d) ? d : "ADMINISTRACION";
  return {
    ticketId: String(l.ticketId || "").trim(),
    accountCode: l.accountCode || "",
    accountName: l.accountName || "",
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    lineConcept: l.lineConcept || "",
    invoiceUrl: String(l.invoiceUrl || "").trim(),
    fxCurrency,
    depto,
  };
}

let polizas = [];
let filterType = "all";
let searchQ = "";
/** @type {string | null} */
let selectedId = null;
/** @type {"empty" | "view"} */
let viewerMode = "empty";

/** @type {string | null} */
let editingPolizaId = null;

/** Si la póliza en edición viene del borrador POS, se envía al guardar como source_ref. */
let posDraftSourceRef = null;

/** Ejercicio fiscal activo (sesión). */
let sessionFiscalYear = null;

function isCreateModalOpen() {
  const m = document.getElementById("modal-create-poliza");
  return !!(m && !m.hidden);
}

async function refreshCreateFolioPreview() {
  const el = document.getElementById("create-folio-preview");
  if (!el) return;
  if (editingPolizaId) {
    const p = polizas.find((x) => x.id === editingPolizaId);
    el.textContent = p?.folio || "—";
    return;
  }
  try {
    const res = await apiFetch("/api/polizas/next-folio");
    await ensureAuthed(res);
    const j = await res.json();
    el.textContent = j.success && j.folio ? j.folio : "—";
  } catch {
    el.textContent = "—";
  }
}

function defaultDateInFiscalYear() {
  const today = new Date().toISOString().slice(0, 10);
  const y = Number(today.slice(0, 4));
  if (sessionFiscalYear != null && y === sessionFiscalYear) return today;
  if (sessionFiscalYear != null) return `${sessionFiscalYear}-01-15`;
  return today;
}

function setCreateDateBounds() {
  const d = document.getElementById("create-date");
  if (!d || sessionFiscalYear == null) return;
  d.min = `${sessionFiscalYear}-01-01`;
  d.max = `${sessionFiscalYear}-12-31`;
}

function openCreateModal() {
  const backdrop = document.getElementById("modal-create-poliza");
  if (!backdrop) return;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-poliza-open");
  const d = document.getElementById("create-date");
  if (d) {
    setCreateDateBounds();
    d.value = defaultDateInFiscalYear();
  }
  requestAnimationFrame(() => {
    document.querySelector("#modal-create-poliza .modal--poliza")?.focus();
  });
}

function closeCreateModal() {
  const backdrop = document.getElementById("modal-create-poliza");
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-poliza-open");
  editingPolizaId = null;
  const title = document.getElementById("modal-create-poliza-title");
  if (title) title.textContent = "Nueva póliza";
}

const createLines = [];

/** Datos de demostración: tickets del día + líneas de resumen (demo; no se guarda hasta Guardar). */
function getMockNewPolizaTemplate() {
  return {
    type: "INGRESOS",
    concept: "Cierre ventas del día — tickets POS (demo)",
    lines: [
      {
        ticketId: "T-0411-0082",
        accountCode: "101-01",
        accountName: "Caja Chica",
        lineConcept: "Venta ticket mostrador",
        invoiceUrl: "https://example.com/cfdi/ticket-0082.xml",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 450,
        credit: 0,
      },
      {
        ticketId: "T-0411-0083",
        accountCode: "101-01",
        accountName: "Caja Chica",
        lineConcept: "Venta ticket (pendiente factura)",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 320,
        credit: 0,
      },
      {
        ticketId: "T-0411-0084",
        accountCode: "101-01",
        accountName: "Caja Chica",
        lineConcept: "Venta ticket",
        invoiceUrl: "https://example.com/cfdi/ticket-0084.pdf",
        fxCurrency: "USD",
        depto: "SERVICIOS_GENERALES",
        debit: 390,
        credit: 0,
      },
      {
        ticketId: "",
        accountCode: "401-01",
        accountName: "Ventas al 16%",
        lineConcept: "Consolidado ventas",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 0,
        credit: 1000,
      },
      {
        ticketId: "",
        accountCode: "208-01",
        accountName: "IVA trasladado",
        lineConcept: "IVA 16 %",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "OTROS",
        debit: 0,
        credit: 160,
      },
    ],
  };
}

/** Plantilla egresos: por defecto salida desde caja chica / efectivo (101-01). */
function getMockEgresosTemplate() {
  return {
    type: "EGRESOS",
    concept: "Egreso operativo — caja chica / efectivo (demo)",
    lines: [
      {
        ticketId: "",
        accountCode: "601-01",
        accountName: "Gastos generales",
        lineConcept: "Compra o gasto menor",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 1000,
        credit: 0,
      },
      {
        ticketId: "",
        accountCode: "101-01",
        accountName: "Caja Chica",
        lineConcept: "Salida de efectivo",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 0,
        credit: 1000,
      },
    ],
  };
}

/** Plantilla transferencia: movimiento vía bancos (102-01) frente a caja u otras cuentas. */
function getMockTransferenciaTemplate() {
  return {
    type: "TRANSFERENCIA",
    concept: "Transferencia entre cuentas — bancos (demo)",
    lines: [
      {
        ticketId: "",
        accountCode: "102-01",
        accountName: "BBVA cuenta xxxxx",
        lineConcept: "Depósito o traspaso a banco",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 500,
        credit: 0,
      },
      {
        ticketId: "",
        accountCode: "101-01",
        accountName: "Caja Chica",
        lineConcept: "Origen efectivo",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 0,
        credit: 500,
      },
    ],
  };
}

function applyTemplateForType(type) {
  if (editingPolizaId) return;
  posDraftSourceRef = null;
  const t = String(type || "").toUpperCase();
  let tpl;
  if (t === "EGRESOS") tpl = getMockEgresosTemplate();
  else if (t === "TRANSFERENCIA") tpl = getMockTransferenciaTemplate();
  else if (t === "INGRESOS") tpl = getMockNewPolizaTemplate();
  else return;
  createLines.length = 0;
  tpl.lines.forEach((line) => createLines.push({ ...line }));
  const conc = $("#create-concept");
  if (conc) conc.value = tpl.concept;
  renderCreateLinesTable();
  updateCreateTotalsBar();
}

function sourceLabel(ref) {
  if (!ref || !ref.kind) return "—";
  if (ref.kind === "manual") return "Manual";
  if (ref.kind === "pos_day" && ref.date) {
    const n = ref.ticketCount != null ? ` · ${ref.ticketCount} ticket(s)` : "";
    return `Ventas POS · ${ref.date}${n}`;
  }
  const map = {
    order_summary: "Orden (resumen)",
    inventory_movement: "Inventario",
  };
  return `${map[ref.kind] || ref.kind}${ref.label ? ` · ${ref.label}` : ""}`;
}

function matches(p) {
  if (filterType !== "all" && p.type !== filterType) return false;
  if (!searchQ.trim()) return true;
  const q = searchQ.toLowerCase();
  const blob = [
    p.folio,
    p.concept,
    p.type,
    p.date,
    sourceLabel(p.sourceRef),
    ...(p.lines || []).map((l) =>
      `${l.ticketId || ""} ${l.accountCode} ${l.accountName} ${l.lineConcept || ""} ${l.invoiceUrl || ""} ${deptoLabel(l.depto)}`.trim()
    ),
  ]
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function renderTable() {
  const tbody = $("#polizas-tbody");
  const rows = polizas.filter(matches);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="data-table__empty">No hay pólizas que coincidan.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((p) => {
      const { debit, credit } = lineTotals((p.lines || []).map(normLine));
      const rowSel = viewerMode === "view" && selectedId === p.id ? "polizas-row polizas-row--selected" : "polizas-row";
      return `
      <tr data-id="${escapeAttr(p.id)}" class="${rowSel}">
        <td><strong>${escapeHtml(p.folio)}</strong></td>
        <td>${escapeHtml(p.date)}</td>
        <td><span class="badge badge--neutral">${escapeHtml(p.type)}</span></td>
        <td class="concept-cell" title="${escapeAttr(p.concept)}">${escapeHtml(p.concept)}</td>
        <td>${escapeHtml(sourceLabel(p.sourceRef))}</td>
        <td class="data-table__num">${formatMoney(debit)}</td>
        <td class="data-table__num">${formatMoney(credit)}</td>
      </tr>`;
    })
    .join("");
}

function renderViewer() {
  const root = $("#poliza-viewer-root");
  if (!root) return;

  if (viewerMode === "empty") {
    root.innerHTML = `
      <div class="viewer-empty">
        <span class="material-symbols-outlined viewer-empty__icon" aria-hidden="true">receipt_long</span>
        <p class="viewer-empty__title">Visualizador de pólizas</p>
        <p class="viewer-empty__text">Selecciona un renglón en el listado o usa <strong>Nueva póliza</strong> para capturar un asiento.</p>
        <p class="viewer-empty__hint">Cada <strong>renglón</strong> corresponde a un <strong>ticket de venta</strong> del día; si el ticket está facturado, verás el enlace de descarga del CFDI/PDF. El cierre diario llenará esta póliza desde la base de datos.</p>
      </div>`;
    refreshPolizaPrintHeader();
    return;
  }

  const p = polizas.find((x) => x.id === selectedId);
  if (!p) {
    viewerMode = "empty";
    renderViewer();
    return;
  }

  const lines = (p.lines || []).map(normLine);
  const { debit, credit, balanced } = lineTotals(lines);
  const nPart = lines.length;

  const rowsHtml = lines
    .map((l) => {
      const block = joinTicketConceptBlock(l.ticketId, l.lineConcept);
      const factura = invoicePdfLinkHtml(l.invoiceUrl);
      return `
    <tr>
      <td class="poliza-ticket-concept-readonly poliza-col-ticket-concept">
        <div class="poliza-concept-multiline">${block ? escapeHtml(block) : "—"}</div>
      </td>
      <td class="poliza-col-cuenta">${escapeHtml(l.accountCode)}</td>
      <td class="poliza-col-nombre">${escapeHtml(l.accountName)}</td>
      <td class="poliza-col-depto">${escapeHtml(deptoLabel(l.depto))}</td>
      <td class="poliza-col-moneda">${escapeHtml(fxLabel(l.fxCurrency))}</td>
      <td class="num">${l.debit ? `${currencyPrefix(l.fxCurrency)} ${formatLineAmountDisplay(l.debit)}` : "—"}</td>
      <td class="num">${l.credit ? `${currencyPrefix(l.fxCurrency)} ${formatLineAmountDisplay(l.credit)}` : "—"}</td>
      <td class="poliza-cell-factura poliza-cell-factura--readonly">${factura}</td>
    </tr>`;
    })
    .join("");

  const syncNote =
    p.sourceRef?.kind === "manual"
      ? "Captura manual."
      : "Origen operación (tablet / inventario). En producción se consolidará con el cierre diario automático.";

  root.innerHTML = `
    <div class="poliza-readonly poliza-print-root">
      <div class="poliza-toolbar">
        <button type="button" class="poliza-toolbtn" id="btn-poliza-print" title="Imprimir póliza"><span class="material-symbols-outlined">print</span></button>
        <button type="button" class="poliza-toolbtn" id="btn-poliza-edit" title="Editar póliza"><span class="material-symbols-outlined">edit</span></button>
        <button type="button" class="poliza-toolbtn poliza-toolbtn--danger" id="btn-poliza-delete" title="Eliminar póliza"><span class="material-symbols-outlined">delete</span></button>
        <span class="poliza-toolbar__spacer"></span>
        <button type="button" class="btn btn--primary btn--sm" id="btn-new-from-view">
          <span class="material-symbols-outlined btn__icon">add</span>
          Nueva póliza
        </button>
      </div>
      <div class="poliza-meta">
        <div>
          <span class="poliza-meta__label">Tipo</span>
          <div><span class="poliza-type-pill">${escapeHtml(typeShort(p.type))}</span> <span class="poliza-meta__value">${escapeHtml(p.type)}</span></div>
        </div>
        <div>
          <span class="poliza-meta__label">Número</span>
          <div class="poliza-meta__value">${escapeHtml(folioSeq(p.folio))}</div>
        </div>
        <div>
          <span class="poliza-meta__label">Fecha</span>
          <div class="poliza-meta__value">${escapeHtml(p.date)}</div>
        </div>
        <div class="poliza-meta__field--concept">
          <span class="poliza-meta__label">Concepto</span>
          <div class="poliza-meta__value poliza-meta__value--multiline">${escapeHtml(p.concept)}</div>
        </div>
      </div>
      <div class="poliza-lines-wrap">
        <table class="poliza-lines-table">
          <thead>
            <tr>
              <th class="poliza-col-ticket-concept">Ticket / concepto mov.</th>
              <th class="poliza-col-cuenta">No. cuenta</th>
              <th class="poliza-col-nombre">Nombre</th>
              <th class="poliza-col-depto">Depto.</th>
              <th class="poliza-col-moneda">Moneda</th>
              <th class="num">Debe</th>
              <th class="num">Haber</th>
              <th class="poliza-col-factura-head">Factura</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="poliza-lines-table--totals">
              <td colspan="5">Totales</td>
              <td class="num">${formatMoney(debit)}</td>
              <td class="num">${formatMoney(credit)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="poliza-footer">
        <span>No. de partidas: <strong>${nPart}</strong></span>
        <span>Moneda: <strong>por línea</strong> (MX / USD / CAD / EUR)</span>
        <span>${balanced ? "Estado: <strong>Cuadra</strong>" : "Estado: <strong>Revisar cuadre</strong>"}</span>
      </div>
      <p class="poliza-sync-badge">${escapeHtml(syncNote)} · Origen listado: ${escapeHtml(sourceLabel(p.sourceRef))}</p>
      <p class="poliza-print-disclaimer" aria-hidden="true">
        Asiento contable conforme a prácticas bajo NIF aplicables en México. Verificar cuadre y respaldo documental (CFDI, contratos) antes de presentación oficial.
      </p>
    </div>`;
  refreshPolizaPrintHeader();
}

function updateCreateTotalsBar() {
  const payloadLines = mapCreateLinesToPayload();
  const validLines = filterValidPolizaLines(payloadLines);
  const { debit, credit, balanced } = lineTotals(validLines);
  const conceptOk = Boolean($("#create-concept")?.value?.trim());
  const bar = $("#create-totals");
  if (!bar) return;
  const needsWarn = validLines.length >= 2 && !balanced;
  bar.className = "totals-bar" + (needsWarn ? " totals-bar--warn" : "");
  bar.innerHTML = `
    <span>Debe: <strong>${formatMoney(debit)}</strong></span>
    <span>Haber: <strong>${formatMoney(credit)}</strong></span>
    <span>${
      validLines.length < 2
        ? "—"
        : balanced
          ? "✓ Cuadra"
          : "⚠ Debe cuadrar (debe = haber)"
    }</span>
  `;

  const btn = $("#btn-save-poliza");
  if (btn) {
    const canSave = validLines.length >= 2 && balanced && conceptOk;
    btn.disabled = !canSave;
    if (canSave) {
      btn.removeAttribute("title");
    } else if (!conceptOk) {
      btn.title = "Escribe un concepto general para poder guardar.";
    } else if (validLines.length < 2) {
      btn.title = "Se requieren al menos dos líneas con cuenta o ticket e importe.";
    } else if (!balanced) {
      btn.title = "La póliza no cuadra: la suma del debe debe igualar la del haber.";
    }
  }
}

function renderCreateLinesTable() {
  const tbody = $("#create-lines-tbody");
  if (!tbody) return;
  if (!createLines.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="data-table__empty">Añade líneas.</td></tr>`;
    return;
  }
  tbody.innerHTML = createLines
    .map((line, i) => {
      const fx = line.fxCurrency || "MX";
      const prefix = currencyPrefix(fx);
      const debitVal = formatAmountForInput(line.debit);
      const creditVal = formatAmountForInput(line.credit);
      const ticketConceptVal = joinTicketConceptBlock(line.ticketId, line.lineConcept);
      const presetVal = accountPresetSelectValue(line);
      const showCustomAccount = presetVal === ACCOUNT_PRESET_OTHER;
      const customCls = "line-input poliza-account-custom";
      const customExtra = showCustomAccount ? "" : " visually-hidden";
      const customDisabled = showCustomAccount ? "" : " disabled";
      return `
    <tr data-idx="${i}">
      <td class="poliza-col-ticket-concept">
        <textarea class="line-input poliza-line-concept-textarea poliza-ticket-concept-unified" data-field="ticketConceptBlock" rows="3" placeholder="Primera línea: T-0411-0082 · Luego el concepto del movimiento">${escapeHtml(ticketConceptVal)}</textarea>
      </td>
      <td class="poliza-col-cuenta poliza-col-cuenta--preset">
        <div class="poliza-account-preset-wrap">
          <select class="line-input line-input--select line-input--account-preset" data-field="accountPreset">${accountPresetOptionsHtml(presetVal)}</select>
          <input class="${customCls}${customExtra}" type="text" data-field="accountCode" placeholder="No. cuenta (ej. 101-01)" autocomplete="off" value="${escapeAttr(line.accountCode)}" aria-label="Número de cuenta si eliges Otros"${customDisabled} />
        </div>
      </td>
      <td class="poliza-col-nombre"><input class="line-input" type="text" data-field="accountName" value="${escapeAttr(line.accountName)}" /></td>
      <td class="poliza-col-depto">
        <select class="line-input line-input--select line-input--depto-compact" data-field="depto">${deptoSelectOptions(line.depto || "ADMINISTRACION")}</select>
      </td>
      <td class="poliza-col-moneda poliza-col-moneda--tight">
        <select class="line-input line-input--select line-input--fx-compact" data-field="fxCurrency">${fxSelectOptionsCompact(line.fxCurrency || "MX")}</select>
      </td>
      <td class="num poliza-col-debehaber poliza-col-debe--tight">
        <div class="poliza-amount-wrap">
          <span class="poliza-amt-prefix" aria-hidden="true">${prefix}</span>
          <input class="line-input line-input--amt" type="text" inputmode="decimal" autocomplete="off" data-field="debit" placeholder="0.00" value="${escapeAttr(debitVal)}" />
        </div>
      </td>
      <td class="num poliza-col-debehaber">
        <div class="poliza-amount-wrap">
          <span class="poliza-amt-prefix" aria-hidden="true">${prefix}</span>
          <input class="line-input line-input--amt" type="text" inputmode="decimal" autocomplete="off" data-field="credit" placeholder="0.00" value="${escapeAttr(creditVal)}" />
        </div>
      </td>
      <td class="poliza-cell-factura poliza-cell-factura--end">${facturaCellEdit(line, i)}</td>
      <td class="poliza-col-actions"><button type="button" class="btn btn--ghost btn--sm" data-remove-line="${i}">✕</button></td>
    </tr>`;
    })
    .join("");
}

async function openCreate() {
  editingPolizaId = null;
  posDraftSourceRef = null;
  const title = document.getElementById("modal-create-poliza-title");
  if (title) title.textContent = "Nueva póliza";
  const tpl = getMockNewPolizaTemplate();
  createLines.length = 0;
  tpl.lines.forEach((line) => createLines.push({ ...line }));
  renderCreateLinesTable();
  updateCreateTotalsBar();
  const sel = $("#create-type");
  if (sel) sel.value = tpl.type;
  const conc = $("#create-concept");
  if (conc) conc.value = tpl.concept;
  showAlert("");
  await refreshCreateFolioPreview();
  openCreateModal();
}

async function openPosPolizaDraft() {
  const d = $("#pos-draft-date")?.value?.trim();
  if (!d) {
    showAlert("Elige el día de las ventas POS.");
    return;
  }
  if (sessionFiscalYear != null && !d.startsWith(`${sessionFiscalYear}-`)) {
    showAlert("El día debe pertenecer al ejercicio fiscal activo.");
    return;
  }
  try {
    const res = await apiFetch(`/api/pos/poliza-draft?date=${encodeURIComponent(d)}`);
    await ensureAuthed(res);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || "Error al cargar borrador POS");
    const data = json.data;
    if (!data || !data.ticketCount) {
      showAlert("No hay tickets POS registrados para esa fecha.");
      return;
    }
    posDraftSourceRef = data.sourceRef || null;
    editingPolizaId = null;
    const title = document.getElementById("modal-create-poliza-title");
    if (title) title.textContent = "Nueva póliza";
    createLines.length = 0;
    (data.lines || []).forEach((line) => createLines.push(normLine({ ...line })));
    renderCreateLinesTable();
    updateCreateTotalsBar();
    const sel = $("#create-type");
    if (sel) sel.value = data.type || "INGRESOS";
    const conc = $("#create-concept");
    if (conc) conc.value = data.concept || "";
    const cd = $("#create-date");
    if (cd) {
      setCreateDateBounds();
      cd.value = d;
    }
    showAlert("");
    await refreshCreateFolioPreview();
    openCreateModal();
  } catch (err) {
    if (err.message !== "Sesión expirada.") showAlert(err.message || "No se pudo generar el borrador.");
  }
}

async function openEditPoliza(p) {
  if (!p) return;
  editingPolizaId = p.id;
  posDraftSourceRef = null;
  const title = document.getElementById("modal-create-poliza-title");
  if (title) title.textContent = "Editar póliza";
  createLines.length = 0;
  (p.lines || []).forEach((line) => createLines.push(normLine({ ...line })));
  renderCreateLinesTable();
  updateCreateTotalsBar();
  const sel = $("#create-type");
  if (sel) sel.value = p.type || "DIARIO";
  const conc = $("#create-concept");
  if (conc) conc.value = p.concept || "";
  const d = $("#create-date");
  if (d) {
    setCreateDateBounds();
    d.value = p.date || defaultDateInFiscalYear();
  }
  showAlert("");
  await refreshCreateFolioPreview();
  openCreateModal();
}

function selectPoliza(id) {
  selectedId = id;
  viewerMode = "view";
  renderTable();
  renderViewer();
}

async function load() {
  const res = await apiFetch("/api/polizas");
  await ensureAuthed(res);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Error al cargar");
  if (typeof json.fiscalYear === "number") sessionFiscalYear = json.fiscalYear;
  polizas = json.data || [];
  setCreateDateBounds();
  const pdd = $("#pos-draft-date");
  if (pdd && !pdd.value) {
    pdd.min = sessionFiscalYear != null ? `${sessionFiscalYear}-01-01` : "";
    pdd.max = sessionFiscalYear != null ? `${sessionFiscalYear}-12-31` : "";
    pdd.value = defaultDateInFiscalYear();
  }
  renderTable();
  if (selectedId && !polizas.find((p) => p.id === selectedId)) {
    selectedId = null;
    viewerMode = "empty";
  }
  renderViewer();
}

function showAlert(msg, kind = "error") {
  const slot = $("#alert-slot");
  if (!slot) return;
  slot.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

function wireUi() {
  $("#search-input").addEventListener("input", (e) => {
    searchQ = e.target.value;
    renderTable();
  });

  $("#create-concept")?.addEventListener("input", () => {
    if (isCreateModalOpen()) updateCreateTotalsBar();
  });
  $("#create-type")?.addEventListener("change", (e) => {
    if (isCreateModalOpen()) {
      applyTemplateForType(e.target?.value);
      updateCreateTotalsBar();
    }
  });

  document.querySelectorAll(".filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filters .chip").forEach((b) => b.classList.remove("chip--selected"));
      btn.classList.add("chip--selected");
      filterType = btn.getAttribute("data-filter") || "all";
      renderTable();
    });
  });

  $("#polizas-tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    selectPoliza(tr.getAttribute("data-id"));
  });

  $("#btn-new-poliza").addEventListener("click", () => openCreate());
  $("#btn-pos-poliza-draft")?.addEventListener("click", () => void openPosPolizaDraft());

  $("#poliza-viewer-root").addEventListener("click", (e) => {
    if (e.target.closest("#btn-new-from-view")) {
      openCreate();
      return;
    }
    if (e.target.closest("#btn-poliza-print")) {
      window.print();
      return;
    }
    if (e.target.closest("#btn-poliza-edit")) {
      const p = polizas.find((x) => x.id === selectedId);
      if (p) void openEditPoliza(p);
      return;
    }
    if (e.target.closest("#btn-poliza-delete")) {
      const p = polizas.find((x) => x.id === selectedId);
      if (!p) return;
      if (!window.confirm(`¿Eliminar la póliza ${p.folio}? Esta acción no se puede deshacer.`)) return;
      void (async () => {
        try {
          const res = await apiFetch(`/api/polizas/${encodeURIComponent(p.id)}`, { method: "DELETE" });
          await ensureAuthed(res);
          const json = await res.json();
          if (!res.ok) throw new Error(json.message || "No se pudo eliminar");
          selectedId = null;
          viewerMode = "empty";
          await load();
          showAlert("Póliza eliminada.", "success");
        } catch (err) {
          if (err.message !== "Sesión expirada.") showAlert(err.message || "Error");
        }
      })();
    }
  });

  document.getElementById("btn-cancel-create")?.addEventListener("click", () => closeCreateModal());

  document.getElementById("btn-save-poliza")?.addEventListener("click", () => void savePoliza());

  document.getElementById("btn-add-line")?.addEventListener("click", () => {
    if (!isCreateModalOpen()) return;
    createLines.push({
      ticketId: "",
      accountCode: "",
      accountName: "",
      lineConcept: "",
      invoiceUrl: "",
      fxCurrency: "MX",
      depto: "ADMINISTRACION",
      debit: 0,
      credit: 0,
    });
    renderCreateLinesTable();
    updateCreateTotalsBar();
  });

  const modalRoot = document.getElementById("modal-create-poliza");
  modalRoot?.addEventListener("click", (e) => {
    if (e.target === modalRoot) closeCreateModal();
    const showInv = e.target.closest("[data-show-invoice]");
    if (showInv && isCreateModalOpen()) {
      const i = Number(showInv.getAttribute("data-show-invoice"));
      if (createLines[i]) {
        createLines[i]._showInvoice = true;
        renderCreateLinesTable();
        requestAnimationFrame(() => {
          document.querySelector(`tr[data-idx="${i}"] .poliza-invoice-url-input`)?.focus();
        });
      }
      return;
    }
    const clr = e.target.closest("[data-clear-invoice]");
    if (clr && isCreateModalOpen()) {
      e.preventDefault();
      const i = Number(clr.getAttribute("data-clear-invoice"));
      if (createLines[i]) {
        createLines[i].invoiceUrl = "";
        createLines[i]._showInvoice = false;
        renderCreateLinesTable();
        updateCreateTotalsBar();
      }
      return;
    }
    const rm = e.target.closest("[data-remove-line]");
    if (!rm || !isCreateModalOpen()) return;
    const i = Number(rm.getAttribute("data-remove-line"));
    createLines.splice(i, 1);
    renderCreateLinesTable();
    updateCreateTotalsBar();
  });

  document.getElementById("modal-create-poliza")?.addEventListener("input", (e) => {
    const row = e.target.closest("tr[data-idx]");
    if (!row || !isCreateModalOpen()) return;
    const idx = Number(row.getAttribute("data-idx"));
    const field = e.target.getAttribute("data-field");
    if (!field || !createLines[idx]) return;
    if (field === "ticketConceptBlock") {
      const parsed = parseTicketConceptBlock(e.target.value);
      createLines[idx].ticketId = parsed.ticketId;
      createLines[idx].lineConcept = parsed.lineConcept;
    } else if (field === "debit" || field === "credit") {
      let raw = String(e.target.value).replace(/,/g, "").replace(/[^\d.]/g, "");
      const dot = raw.indexOf(".");
      if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "");
      e.target.value = raw;
      const num = raw === "" || raw === "." ? 0 : parseFloat(raw);
      createLines[idx][field] = isNaN(num) ? 0 : num;
    } else {
      createLines[idx][field] = e.target.value;
    }
    updateCreateTotalsBar();
  });

  document.getElementById("modal-create-poliza")?.addEventListener("change", (e) => {
    const t = e.target;
    const row = t.closest("tr[data-idx]");
    if (!row || !isCreateModalOpen()) return;
    const idx = Number(row.getAttribute("data-idx"));
    const field = t.getAttribute("data-field");
    const line = createLines[idx];
    if (field === "accountPreset" && line) {
      const v = t.value;
      if (v === "") {
        line.accountCode = "";
        line.accountName = "";
      } else if (v === ACCOUNT_PRESET_OTHER) {
        const wasPreset = ACCOUNT_PRESETS.some((p) => p.code === line.accountCode);
        if (wasPreset) {
          line.accountCode = "";
          line.accountName = "";
        }
      } else {
        const p = ACCOUNT_PRESETS.find((x) => x.code === v);
        if (p) {
          line.accountCode = p.code;
          line.accountName = p.name;
        }
      }
      applyAmountSideToLine(line);
      renderCreateLinesTable();
      updateCreateTotalsBar();
      return;
    }
    if (field === "fxCurrency" && line) {
      line.fxCurrency = t.value;
      const p = currencyPrefix(t.value);
      row.querySelectorAll(".poliza-amt-prefix").forEach((el) => {
        el.textContent = p;
      });
      updateCreateTotalsBar();
    }
    if (field === "depto" && line) {
      line.depto = t.value;
      updateCreateTotalsBar();
    }
  });

  document.getElementById("modal-create-poliza")?.addEventListener("focusin", (e) => {
    const t = e.target;
    if (!t.classList?.contains("line-input--amt") || !isCreateModalOpen()) return;
    const field = t.getAttribute("data-field");
    if (field !== "debit" && field !== "credit") return;
    const row = t.closest("tr[data-idx]");
    if (!row) return;
    const idx = Number(row.getAttribute("data-idx"));
    const line = createLines[idx];
    if (!line) return;
    t.value = amountRawString(line[field]);
  });

  document.getElementById("modal-create-poliza")?.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!isCreateModalOpen()) return;

    if (t.classList?.contains("line-input--amt")) {
      const field = t.getAttribute("data-field");
      if (field === "debit" || field === "credit") {
        const row = t.closest("tr[data-idx]");
        if (!row) return;
        const idx = Number(row.getAttribute("data-idx"));
        const line = createLines[idx];
        if (!line) return;
        const num = parseAmountInputString(t.value);
        line[field] = num;
        applyAmountSideToLine(line);
        syncRowAmountInputs(row, line);
        updateCreateTotalsBar();
      }
      return;
    }

    if (t.getAttribute("data-field") === "accountCode") {
      const row = t.closest("tr[data-idx]");
      if (!row) return;
      const idx = Number(row.getAttribute("data-idx"));
      const line = createLines[idx];
      if (!line) return;
      line.accountCode = String(t.value || "").trim();
      applyAmountSideToLine(line);
      syncRowAmountInputs(row, line);
      updateCreateTotalsBar();
      return;
    }

    if (!t.classList?.contains("poliza-invoice-url-input")) return;
    const row = t.closest("tr[data-idx]");
    if (!row) return;
    const idx = Number(row.getAttribute("data-idx"));
    if (!createLines[idx]) return;
    const u = String(t.value || "").trim();
    createLines[idx].invoiceUrl = u;
    if (u && /^https?:\/\//i.test(u)) {
      createLines[idx]._showInvoice = false;
      renderCreateLinesTable();
    } else if (!u) {
      createLines[idx]._showInvoice = false;
      renderCreateLinesTable();
    }
    updateCreateTotalsBar();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isCreateModalOpen()) closeCreateModal();
  });

  $("#btn-logout").addEventListener("click", async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignorar */
    }
    window.location.href = "/login.html";
  });
}

async function savePoliza() {
  const type = $("#create-type")?.value || "DIARIO";
  const concept = $("#create-concept")?.value?.trim() || "";
  const polizaDate = $("#create-date")?.value?.trim() || "";
  const lines = mapCreateLinesToPayload();
  const validLines = filterValidPolizaLines(lines);
  if (validLines.length < 2) {
    showAlert("Completa al menos dos líneas con ticket o cuenta y debe o haber.");
    return;
  }
  if (!concept) {
    showAlert("Escribe un concepto general.");
    return;
  }
  if (!polizaDate) {
    showAlert("Indica la fecha de la póliza.");
    return;
  }
  const t = lineTotals(validLines);
  if (!t.balanced) {
    showAlert(
      "No se puede guardar: la póliza no cuadra. La suma del debe debe ser igual a la del haber."
    );
    return;
  }
  const btn = $("#btn-save-poliza");
  if (btn) btn.disabled = true;
  const editing = editingPolizaId;
  const payload = { type, concept, polizaDate, lines: validLines };
  if (!editing && posDraftSourceRef) payload.sourceRef = posDraftSourceRef;
  const body = JSON.stringify(payload);
  try {
    const res = await apiFetch(editing ? `/api/polizas/${encodeURIComponent(editing)}` : "/api/polizas", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    await ensureAuthed(res);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || "No se pudo guardar");
    posDraftSourceRef = null;
    if (editing) {
      polizas = polizas.map((row) => (row.id === json.data.id ? json.data : row));
    } else {
      polizas = [json.data, ...polizas];
    }
    selectedId = json.data.id;
    viewerMode = "view";
    closeCreateModal();
    renderTable();
    renderViewer();
    showAlert(editing ? "Póliza actualizada." : "Póliza guardada.", "success");
  } catch (err) {
    if (err.message !== "Sesión expirada.") showAlert(err.message || "Error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function boot() {
  const me = await apiFetch("/api/auth/me");
  const j = await me.json();
  if (!j.success || !j.user) {
    window.location.href = "/login.html";
    return;
  }
  let fiscalYear = j.fiscalYear;
  if (fiscalYear == null) {
    fiscalYear = await ensureFiscalYear();
    if (fiscalYear == null) return;
  }
  sessionFiscalYear = fiscalYear;

  const el = document.getElementById("session-user");
  if (el) el.textContent = j.user.username;
  injectFiscalSidebar(fiscalYear, () => void load());

  void initPolizaPrintBranding(() => {
    if (viewerMode !== "view" || !selectedId) return null;
    const p = polizas.find((x) => x.id === selectedId);
    if (!p) return null;
    const d = String(p.date || "").slice(0, 10);
    const long = /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "—";
    return {
      reportTitle: `Póliza ${p.folio}`,
      periodLabel: long,
      subtitle: String(p.concept || "").trim() || undefined,
    };
  });

  wireUi();
  initMobileNav();
  try {
    await load();
  } catch (err) {
    showAlert(err.message || "No se pudo conectar al servidor.");
  }
}

boot();
