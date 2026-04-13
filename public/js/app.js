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

/** @param {string} url */
function invoiceLinkHtml(url) {
  const u = String(url || "").trim();
  if (!u) return `<span class="poliza-cell--empty">—</span>`;
  if (!/^https?:\/\//i.test(u)) return escapeHtml(u);
  return `<a href="${escapeAttr(u)}" class="poliza-invoice-link" target="_blank" rel="noopener noreferrer">Descargar factura</a>`;
}

function fxSelectOptions(selected) {
  return FX_OPTIONS.map(
    (o) => `<option value="${o.value}" ${selected === o.value ? "selected" : ""}>${o.label}</option>`
  ).join("");
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
  return {
    ticketId: String(l.ticketId || "").trim(),
    accountCode: l.accountCode || "",
    accountName: l.accountName || "",
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    lineConcept: l.lineConcept || "",
    invoiceUrl: String(l.invoiceUrl || "").trim(),
    fxCurrency,
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
      `${l.ticketId || ""} ${l.accountCode} ${l.accountName} ${l.lineConcept || ""} ${l.invoiceUrl || ""}`.trim()
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
    .map(
      (l) => `
    <tr>
      <td>${l.ticketId ? escapeHtml(l.ticketId) : "—"}</td>
      <td>${escapeHtml(l.accountCode)}</td>
      <td>${escapeHtml(l.accountName)}</td>
      <td class="poliza-cell-factura">${invoiceLinkHtml(l.invoiceUrl)}</td>
      <td>${escapeHtml(l.lineConcept || "—")}</td>
      <td>${escapeHtml(fxLabel(l.fxCurrency))}</td>
      <td class="num">${l.debit ? formatMoney(l.debit) : "—"}</td>
      <td class="num">${l.credit ? formatMoney(l.credit) : "—"}</td>
    </tr>`
    )
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
              <th>Ticket</th>
              <th>No. cuenta</th>
              <th>Nombre</th>
              <th>Factura</th>
              <th>Concepto mov.</th>
              <th>Moneda</th>
              <th class="num">Debe</th>
              <th class="num">Haber</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="poliza-lines-table--totals">
              <td colspan="6">Totales</td>
              <td class="num">${formatMoney(debit)}</td>
              <td class="num">${formatMoney(credit)}</td>
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
    .map(
      (line, i) => `
    <tr data-idx="${i}">
      <td><input class="line-input" type="text" data-field="ticketId" placeholder="T-…" value="${escapeAttr(line.ticketId)}" /></td>
      <td><input class="line-input" type="text" data-field="accountCode" value="${escapeAttr(line.accountCode)}" /></td>
      <td><input class="line-input" type="text" data-field="accountName" value="${escapeAttr(line.accountName)}" /></td>
      <td><input class="line-input" type="url" data-field="invoiceUrl" placeholder="https://… CFDI/PDF" value="${escapeAttr(line.invoiceUrl)}" /></td>
      <td><input class="line-input" type="text" data-field="lineConcept" value="${escapeAttr(line.lineConcept)}" /></td>
      <td>
        <select class="line-input line-input--select" data-field="fxCurrency">${fxSelectOptions(line.fxCurrency || "MX")}</select>
      </td>
      <td class="num"><input class="line-input line-input--num" type="number" step="0.01" min="0" data-field="debit" value="${line.debit || ""}" /></td>
      <td class="num"><input class="line-input line-input--num" type="number" step="0.01" min="0" data-field="credit" value="${line.credit || ""}" /></td>
      <td><button type="button" class="btn btn--ghost btn--sm" data-remove-line="${i}">✕</button></td>
    </tr>`
    )
    .join("");
}

function openCreate() {
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
      debit: 0,
      credit: 0,
    });
    renderCreateLinesTable();
    updateCreateTotalsBar();
  });

  const modalRoot = document.getElementById("modal-create-poliza");
  modalRoot?.addEventListener("click", (e) => {
    if (e.target === modalRoot) closeCreateModal();
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
    const val = e.target.value;
    if (field === "debit" || field === "credit") {
      createLines[idx][field] = val === "" ? 0 : Number(val);
    } else {
      createLines[idx][field] = val;
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
      updateCreateTotalsBar();
    }
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
  try {
    await load();
  } catch (err) {
    showAlert(err.message || "No se pudo conectar al servidor.");
  }
}

boot();
