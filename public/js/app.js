import { initMobileNav } from "./mobile-nav.js";

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

function lineTotals(lines) {
  const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

function typeShort(t) {
  const m = { DIARIO: "Di", INGRESOS: "Ig", EGRESOS: "Eg" };
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

function isCreateModalOpen() {
  const m = document.getElementById("modal-create-poliza");
  return !!(m && !m.hidden);
}

async function refreshCreateFolioPreview() {
  const el = document.getElementById("create-folio-preview");
  if (!el) return;
  try {
    const res = await apiFetch("/api/polizas/next-folio");
    await ensureAuthed(res);
    const j = await res.json();
    el.textContent = j.success && j.folio ? j.folio : "—";
  } catch {
    el.textContent = "—";
  }
}

function openCreateModal() {
  const backdrop = document.getElementById("modal-create-poliza");
  if (!backdrop) return;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-poliza-open");
  const today = new Date().toISOString().slice(0, 10);
  const d = document.getElementById("create-date");
  if (d) d.value = today;
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
        accountCode: "105.01",
        accountName: "Caja general",
        lineConcept: "Venta ticket mostrador",
        invoiceUrl: "https://example.com/cfdi/ticket-0082.xml",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 450,
        credit: 0,
      },
      {
        ticketId: "T-0411-0083",
        accountCode: "105.01",
        accountName: "Caja general",
        lineConcept: "Venta ticket (pendiente factura)",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 320,
        credit: 0,
      },
      {
        ticketId: "T-0411-0084",
        accountCode: "105.01",
        accountName: "Caja general",
        lineConcept: "Venta ticket",
        invoiceUrl: "https://example.com/cfdi/ticket-0084.pdf",
        fxCurrency: "USD",
        depto: "SERVICIOS_GENERALES",
        debit: 390,
        credit: 0,
      },
      {
        ticketId: "",
        accountCode: "401.01",
        accountName: "Ventas nacionales",
        lineConcept: "Consolidado ventas",
        invoiceUrl: "",
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
        debit: 0,
        credit: 1000,
      },
      {
        ticketId: "",
        accountCode: "208.01",
        accountName: "IVA trasladado cobrado",
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

function sourceLabel(ref) {
  if (!ref || !ref.kind) return "—";
  if (ref.kind === "manual") return "Manual";
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
    <div class="poliza-readonly">
      <div class="poliza-toolbar">
        <button type="button" class="poliza-toolbtn" disabled title="Próximamente"><span class="material-symbols-outlined">print</span></button>
        <button type="button" class="poliza-toolbtn" disabled title="Próximamente"><span class="material-symbols-outlined">delete</span></button>
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
    </div>`;
}

function updateCreateTotalsBar() {
  const { debit, credit, balanced } = lineTotals(createLines);
  const bar = $("#create-totals");
  if (!bar) return;
  bar.className = "totals-bar" + (createLines.length >= 2 && !balanced ? " totals-bar--warn" : "");
  bar.innerHTML = `
    <span>Debe: <strong>${formatMoney(debit)}</strong></span>
    <span>Haber: <strong>${formatMoney(credit)}</strong></span>
    <span>${balanced && createLines.length >= 2 ? "✓ Cuadra" : createLines.length < 2 ? "—" : "⚠ Debe cuadrar"}</span>
  `;
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
      return `
    <tr data-idx="${i}">
      <td class="poliza-col-ticket-concept">
        <textarea class="line-input poliza-line-concept-textarea poliza-ticket-concept-unified" data-field="ticketConceptBlock" rows="3" placeholder="Primera línea: T-0411-0082 · Luego el concepto del movimiento">${escapeHtml(ticketConceptVal)}</textarea>
      </td>
      <td class="poliza-col-cuenta"><input class="line-input" type="text" data-field="accountCode" value="${escapeAttr(line.accountCode)}" /></td>
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
  polizas = json.data || [];
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

  $("#poliza-viewer-root").addEventListener("click", (e) => {
    if (e.target.closest("#btn-new-from-view")) {
      openCreate();
      return;
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
    if (field === "fxCurrency" && createLines[idx]) {
      createLines[idx].fxCurrency = t.value;
      const p = currencyPrefix(t.value);
      row.querySelectorAll(".poliza-amt-prefix").forEach((el) => {
        el.textContent = p;
      });
      updateCreateTotalsBar();
    }
    if (field === "depto" && createLines[idx]) {
      createLines[idx].depto = t.value;
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
        if (!createLines[idx]) return;
        const num = parseAmountInputString(t.value);
        createLines[idx][field] = num;
        t.value = formatAmountForInput(num);
        updateCreateTotalsBar();
      }
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
  const lines = createLines.map((l) => ({
    ticketId: String(l.ticketId || "").trim(),
    accountCode: l.accountCode.trim(),
    accountName: l.accountName.trim(),
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
  const validLines = lines.filter(
    (l) => (l.ticketId || l.accountCode) && (l.debit > 0 || l.credit > 0)
  );
  if (validLines.length < 2) {
    showAlert("Completa al menos dos líneas con ticket o cuenta y debe o haber.");
    return;
  }
  if (!concept) {
    showAlert("Escribe un concepto general.");
    return;
  }
  const t = lineTotals(validLines);
  if (!t.balanced) {
    showAlert("Los totales de debe y haber deben coincidir.");
    return;
  }
  const btn = $("#btn-save-poliza");
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch("/api/polizas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, concept, lines: validLines }),
    });
    await ensureAuthed(res);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || "No se pudo guardar");
    polizas = [json.data, ...polizas];
    selectedId = json.data.id;
    viewerMode = "view";
    closeCreateModal();
    renderTable();
    renderViewer();
    showAlert("Póliza guardada (persistencia cifrada en disco).", "success");
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
  const el = document.getElementById("session-user");
  if (el) el.textContent = j.user.username;
  wireUi();
  initMobileNav();
  try {
    await load();
  } catch (err) {
    showAlert(err.message || "No se pudo conectar al servidor.");
  }
}

boot();
