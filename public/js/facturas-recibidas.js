import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);
const selectedInvoiceIds = new Set();

/** @type {any[]} */
let allRows = [];
/** @type {{ key: string, dir: "asc" | "desc" }} */
let sortState = { key: "fecha", dir: "desc" };

/** @type {Record<string, Set<string> | null>} null = sin filtro (todos) */
const columnFilters = {
  uuid: null,
  proveedor: null,
  serie: null,
  fecha: null,
  subtotal: null,
  iva: null,
  retenciones: null,
  descuentos: null,
  total: null,
  concepto: null,
  estatus: null,
  poliza: null,
};

const COLUMNS = [
  "uuid",
  "proveedor",
  "serie",
  "fecha",
  "subtotal",
  "iva",
  "retenciones",
  "descuentos",
  "total",
  "concepto",
  "estatus",
  "poliza",
];

/** @type {{ col: string, draft: Set<string>, values: { key: string, label: string }[], query: string } | null} */
let openMenu = null;

const fmtMoney = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(
    Number(n || 0)
  );

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyXml(xml) {
  const INDENT = "    ";
  const raw = String(xml || "").trim();
  if (!raw) return "";
  const withBreaks = raw.replace(/>\s*</g, "><").replace(/(>)(<)(\/?)/g, "$1\n$2$3");
  const lines = withBreaks.split("\n");
  let pad = 0;
  const out = [];
  const splitAttrs = (line) => {
    const s = String(line || "");
    if (!/^<[^!?/][^>]*>$/.test(s) && !/^<[^!?/][^>]*\/>$/.test(s)) return s;
    const selfClosing = /\/>$/.test(s);
    const inner = s.slice(1, selfClosing ? -2 : -1).trim();
    const firstSpace = inner.indexOf(" ");
    if (firstSpace === -1) return s;
    const tagName = inner.slice(0, firstSpace);
    const attrsRaw = inner.slice(firstSpace + 1).trim();
    const attrs = attrsRaw.match(/[\w:.-]+\s*=\s*"[^"]*"/g) || [];
    if (attrs.length <= 2) return s;
    const baseIndent = INDENT.repeat(pad);
    const attrIndent = `${baseIndent}${INDENT}`;
    const closer = selfClosing ? "/>" : ">";
    return `${baseIndent}<${tagName}\n${attrs.map((a) => `${attrIndent}${a}`).join("\n")}\n${baseIndent}${closer}`;
  };
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (/^<\//.test(l)) pad = Math.max(0, pad - 1);
    const indented = `${INDENT.repeat(pad)}${l}`;
    out.push(splitAttrs(indented));
    if (/^<[^!?][^>]*[^/]>$/.test(l) && !/^<.*<\/.*>$/.test(l)) pad += 1;
  }
  return out.join("\n");
}

function highlightXml(xmlPretty) {
  const lines = String(xmlPretty || "").split("\n");
  return lines
    .map((line) => {
      let s = escapeHtml(line);
      s = s.replace(/(&lt;!--.*?--&gt;)/g, '<span class="xml-comment">$1</span>');
      s = s.replace(/(&lt;\??\/?)([\w:.-]+)/g, '$1<span class="xml-tag">$2</span>');
      s = s.replace(
        /([\w:.-]+)(=)(&quot;.*?&quot;)/g,
        '<span class="xml-attr">$1</span><span class="xml-punc">$2</span><span class="xml-value">$3</span>'
      );
      s = s.replace(/(&lt;|&gt;|\/&gt;|\?&gt;)/g, '<span class="xml-punc">$1</span>');
      return s;
    })
    .join("\n");
}

function fmtDate(s) {
  const t = String(s || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  const d = new Date(`${t}T12:00:00`);
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

function renderUuidTwoLines(uuid) {
  const raw = String(uuid || "").trim();
  if (!raw || raw === "—") return "—";
  const compact = raw.replaceAll(/\s+/g, "");
  if (compact.length <= 18) return escapeHtml(compact);
  const mid = Math.ceil(compact.length / 2);
  const top = compact.slice(0, mid);
  const bottom = compact.slice(mid);
  return `<span class="fr-uuid-two-line"><span>${escapeHtml(top)}</span><span>${escapeHtml(bottom)}</span></span>`;
}

function setAlert(message, ok = true) {
  const box = $("#fr-alert");
  if (!box) return;
  box.className = `alert ${ok ? "alert--success" : "alert--error"}`;
  box.textContent = message;
  box.hidden = false;
}

function clearAlert() {
  const box = $("#fr-alert");
  if (!box) return;
  box.hidden = true;
}

async function api(url, options = {}) {
  const r = await fetch(url, { credentials: "include", ...options });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || `Error HTTP ${r.status}`);
  return j.data;
}

function serieFolio(r) {
  const s = String(r.series || "").trim();
  const f = String(r.folio || "").trim();
  if (s && f) return `${s}-${f}`;
  return s || f || "";
}

function issuedDay(r) {
  return String(r.issued_at || "").slice(0, 10);
}

function cellKey(r, col) {
  switch (col) {
    case "uuid":
      return String(r.cfdi_uuid || "").trim() || "—";
    case "proveedor":
      return String(r.issuer_rfc || "").trim() || "—";
    case "serie":
      return serieFolio(r) || "—";
    case "fecha":
      return issuedDay(r) || "—";
    case "subtotal":
      return String(Number(r.subtotal || 0));
    case "iva":
      return String(Number(r.taxes_transferred || 0));
    case "retenciones":
      return String(Number(r.taxes_withheld || 0));
    case "descuentos":
      return String(Number(r.discounts || 0));
    case "total":
      return String(Number(r.total || 0));
    case "concepto":
      return String(r.concept || "").trim() || "—";
    case "estatus":
      return String(r.status || "").trim().toUpperCase() || "—";
    case "poliza":
      return String(r.poliza_folio || "").trim() || "—";
    default:
      return "—";
  }
}

function cellLabel(r, col) {
  switch (col) {
    case "fecha":
      return fmtDate(r.issued_at);
    case "subtotal":
      return fmtMoney(r.subtotal);
    case "iva":
      return fmtMoney(r.taxes_transferred);
    case "retenciones":
      return fmtMoney(r.taxes_withheld);
    case "descuentos":
      return fmtMoney(r.discounts);
    case "total":
      return fmtMoney(r.total);
    default:
      return cellKey(r, col);
  }
}

function uniqueValues(col) {
  const map = new Map();
  for (const r of allRows) {
    const key = cellKey(r, col);
    if (!map.has(key)) map.set(key, cellLabel(r, col));
  }
  const moneyCols = new Set(["subtotal", "iva", "retenciones", "descuentos", "total"]);
  const entries = [...map.entries()].map(([key, label]) => ({ key, label }));
  entries.sort((a, b) => {
    if (moneyCols.has(col) || col === "fecha") {
      return a.key.localeCompare(b.key, "es", { numeric: true });
    }
    return a.label.localeCompare(b.label, "es", { numeric: true, sensitivity: "base" });
  });
  return entries;
}

function sortValue(r, key) {
  switch (key) {
    case "uuid":
      return String(r.cfdi_uuid || "");
    case "proveedor":
      return String(r.issuer_rfc || "");
    case "serie":
      return serieFolio(r);
    case "fecha":
      return issuedDay(r) || String(r.created_at || "");
    case "subtotal":
      return Number(r.subtotal || 0);
    case "iva":
      return Number(r.taxes_transferred || 0);
    case "retenciones":
      return Number(r.taxes_withheld || 0);
    case "descuentos":
      return Number(r.discounts || 0);
    case "total":
      return Number(r.total || 0);
    case "concepto":
      return String(r.concept || "");
    case "estatus":
      return String(r.status || "").toUpperCase();
    case "poliza":
      return String(r.poliza_folio || "");
    default:
      return "";
  }
}

function compareRows(a, b, key, dir) {
  const mul = dir === "asc" ? 1 : -1;
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (typeof va === "number" && typeof vb === "number") {
    if (va === vb) return 0;
    return va < vb ? -mul : mul;
  }
  return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * mul;
}

function rowMatches(r) {
  for (const col of COLUMNS) {
    const selected = columnFilters[col];
    if (!selected) continue;
    if (!selected.has(cellKey(r, col))) return false;
  }
  return true;
}

function filtersActive() {
  return COLUMNS.some((c) => columnFilters[c] instanceof Set);
}

function updateFilterMeta(shown, total) {
  const meta = $("#fr-filter-meta");
  if (!meta) return;
  if (!total) {
    meta.textContent = "Sin facturas recibidas disponibles.";
    return;
  }
  meta.textContent = filtersActive()
    ? `Filtro activo: ${shown} de ${total} factura(s).`
    : `Mostrando ${shown} de ${total} factura(s).`;
}

function updateFilterBtnStates() {
  document.querySelectorAll("#fr-table .col-filter-btn").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const col = btn.getAttribute("data-col") || "";
    const active = columnFilters[col] instanceof Set || (sortState.key === col);
    btn.classList.toggle("col-filter-btn--active", Boolean(columnFilters[col]));
    btn.classList.toggle("col-filter-btn--sorted", sortState.key === col);
    btn.title =
      sortState.key === col
        ? `Orden: ${sortState.dir === "asc" ? "A→Z" : "Z→A"}${columnFilters[col] ? " · filtro activo" : ""}`
        : columnFilters[col]
          ? "Filtro activo"
          : "Ordenar y filtrar";
  });
}

function updateBatchMeta() {
  const meta = $("#fr-batch-meta");
  if (!meta) return;
  const n = selectedInvoiceIds.size;
  meta.textContent = n > 0 ? `${n} factura(s) seleccionada(s).` : "Selecciona facturas en la tabla.";
}

function syncCheckAllState() {
  const all = $("#fr-check-all");
  if (!all) return;
  const checks = [...document.querySelectorAll('#fr-tbody input[type="checkbox"][data-selectable="1"]')];
  if (!checks.length) {
    all.checked = false;
    all.indeterminate = false;
    return;
  }
  const checked = checks.filter((c) => c.checked).length;
  all.checked = checked > 0 && checked === checks.length;
  all.indeterminate = checked > 0 && checked < checks.length;
}

function render(rows) {
  const tbody = $("#fr-tbody");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="13">Sin resultados.</td></tr>`;
    selectedInvoiceIds.clear();
    updateBatchMeta();
    syncCheckAllState();
    return;
  }
  const available = new Set(rows.map((r) => String(r.public_id)));
  for (const id of [...selectedInvoiceIds]) {
    if (!available.has(id)) selectedInvoiceIds.delete(id);
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr data-id="${escapeHtml(r.public_id)}">
        <td>
          <input type="checkbox" data-selectable="${r.status === "pending" ? "1" : "0"}" data-id="${escapeHtml(r.public_id)}" ${selectedInvoiceIds.has(String(r.public_id)) ? "checked" : ""} ${r.status === "pending" ? "" : "disabled"} />
        </td>
        <td>${renderUuidTwoLines(r.cfdi_uuid || "—")}</td>
        <td>${escapeHtml(r.issuer_rfc || "—")}</td>
        <td>${escapeHtml(r.series || "")}${r.folio ? `-${escapeHtml(r.folio)}` : ""}</td>
        <td>${fmtDate(r.issued_at)}</td>
        <td class="data-table__num">${fmtMoney(r.subtotal)}</td>
        <td class="data-table__num">${fmtMoney(r.taxes_transferred)}</td>
        <td class="data-table__num">${fmtMoney(r.taxes_withheld)}</td>
        <td class="data-table__num">${fmtMoney(r.discounts)}</td>
        <td class="data-table__num">${fmtMoney(r.total)}</td>
        <td>${escapeHtml(r.concept || "—")}</td>
        <td>${escapeHtml((r.status || "").toUpperCase())}</td>
        <td>${escapeHtml(r.poliza_folio || "—")}</td>
      </tr>
    `
    )
    .join("");
  updateBatchMeta();
  syncCheckAllState();
}

function applyView() {
  const filtered = allRows.filter((r) => rowMatches(r));
  filtered.sort((a, b) => compareRows(a, b, sortState.key, sortState.dir));
  updateFilterMeta(filtered.length, allRows.length);
  updateFilterBtnStates();
  render(filtered);
}

function clearFilters() {
  for (const col of COLUMNS) columnFilters[col] = null;
  sortState = { key: "fecha", dir: "desc" };
  closeColMenu();
  applyView();
}

function closeColMenu() {
  openMenu = null;
  const menu = $("#fr-col-menu");
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
}

function draftVisibleValues() {
  if (!openMenu) return [];
  const q = openMenu.query.toLowerCase().trim();
  if (!q) return openMenu.values;
  return openMenu.values.filter(
    (v) => v.label.toLowerCase().includes(q) || v.key.toLowerCase().includes(q)
  );
}

function renderColMenuBody() {
  const menu = $("#fr-col-menu");
  if (!menu || !openMenu) return;
  const visible = draftVisibleValues();
  const selectedCount = openMenu.draft.size;
  const total = openMenu.values.length;
  menu.innerHTML = `
    <div class="col-menu__section">
      <button type="button" class="col-menu__action" data-act="sort-asc">Ordenar de la A a la Z</button>
      <button type="button" class="col-menu__action" data-act="sort-desc">Ordenar de la Z a la A</button>
    </div>
    <div class="col-menu__section">
      <p class="col-menu__section-title">Filtrar por valores</p>
      <div class="col-menu__links">
        <button type="button" class="col-menu__link" data-act="select-all">Seleccionar las ${total} opciones</button>
        <button type="button" class="col-menu__link" data-act="clear">Borrar</button>
      </div>
      <p class="col-menu__count">${selectedCount} seleccionada(s)</p>
      <label class="col-menu__search">
        <input type="search" id="fr-col-menu-q" placeholder="Buscar" value="${escapeHtml(openMenu.query)}" autocomplete="off" />
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
      </label>
      <ul class="col-menu__list" role="listbox" aria-multiselectable="true">
        ${
          visible.length
            ? visible
                .map(
                  (v) => `
          <li>
            <label class="col-menu__item">
              <input type="checkbox" data-key="${escapeHtml(v.key)}" ${openMenu.draft.has(v.key) ? "checked" : ""} />
              <span title="${escapeHtml(v.label)}">${escapeHtml(v.label)}</span>
            </label>
          </li>`
                )
                .join("")
            : `<li class="col-menu__empty">Sin coincidencias</li>`
        }
      </ul>
    </div>
    <div class="col-menu__footer">
      <button type="button" class="btn btn--ghost col-menu__btn" data-act="cancel">Cancelar</button>
      <button type="button" class="btn btn--primary col-menu__btn" data-act="accept">Aceptar</button>
    </div>
  `;
}

function positionColMenu(anchor) {
  const menu = $("#fr-col-menu");
  if (!menu || !(anchor instanceof HTMLElement)) return;
  menu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  const mw = Math.min(320, window.innerWidth - pad * 2);
  menu.style.width = `${mw}px`;
  let left = rect.left;
  let top = rect.bottom + 4;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const m = menu.getBoundingClientRect();
  if (m.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - m.width);
  if (m.bottom > window.innerHeight - pad) top = Math.max(pad, rect.top - m.height - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openColMenu(col, anchor) {
  const values = uniqueValues(col);
  const current = columnFilters[col];
  const draft = current ? new Set(current) : new Set(values.map((v) => v.key));
  openMenu = { col, draft, values, query: "" };
  renderColMenuBody();
  positionColMenu(anchor);
  $("#fr-col-menu-q")?.focus();
}

function acceptColMenu() {
  if (!openMenu) return;
  const { col, draft, values } = openMenu;
  if (draft.size === 0) {
    columnFilters[col] = new Set(["__none_match__"]);
  } else if (draft.size >= values.length) {
    columnFilters[col] = null;
  } else {
    columnFilters[col] = new Set(draft);
  }
  closeColMenu();
  applyView();
}

async function loadReceivedInvoices() {
  const tbody = $("#fr-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="13">Cargando...</td></tr>`;
  try {
    const data = await api(`/api/invoices/received?limit=200`);
    allRows = Array.isArray(data.rows) ? data.rows : [];
    applyView();
  } catch (e) {
    allRows = [];
    tbody.innerHTML = `<tr><td colspan="13">No se pudo cargar (${escapeHtml(e.message)}).</td></tr>`;
  }
}

async function importZip() {
  const fileEl = $("#fr-zip");
  const f = fileEl?.files?.[0];
  if (!f) {
    setAlert("Selecciona un ZIP del SAT.", false);
    return;
  }
  clearAlert();
  const fd = new FormData();
  fd.append("file", f);
  try {
    const data = await api("/api/invoices/received/import-zip", { method: "POST", body: fd });
    setAlert(
      `Importación completa: ${data.summary?.inserted || 0} insertadas, ${data.summary?.duplicates || 0} duplicadas, ${data.summary?.errors || 0} con error.`
    );
    await loadReceivedInvoices();
    if (fileEl) fileEl.value = "";
  } catch (e) {
    setAlert(e.message, false);
  }
}

async function showDetail(id) {
  const box = $("#fr-detail");
  if (!box) return;
  box.innerHTML = "Cargando detalle...";
  try {
    const row = await api(`/api/invoices/received/${encodeURIComponent(id)}`);
    const suggestedDate = String(row.issued_at || "").slice(0, 10);
    const hasPoliza = Boolean(String(row.poliza_id || "").trim());
    const disabledAttr = hasPoliza ? "disabled" : "";
    box.innerHTML = `
      <h3>Detalle de factura</h3>
      <p><strong>UUID:</strong> ${escapeHtml(row.cfdi_uuid || "—")}</p>
      <p><strong>Emisor:</strong> ${escapeHtml(row.issuer_rfc || "—")} &nbsp; | &nbsp; <strong>Receptor:</strong> ${escapeHtml(
      row.receiver_rfc || "—"
    )}</p>
      <p><strong>Fecha:</strong> ${fmtDate(row.issued_at)} &nbsp; | &nbsp; <strong>Subtotal:</strong> ${fmtMoney(row.subtotal)} &nbsp; | &nbsp; <strong>IVA:</strong> ${fmtMoney(row.taxes_transferred)}</p>
      <p><strong>Retenciones:</strong> ${fmtMoney(row.taxes_withheld)} &nbsp; | &nbsp; <strong>Descuentos:</strong> ${fmtMoney(row.discounts)} &nbsp; | &nbsp; <strong>Total:</strong> ${fmtMoney(row.total)}</p>
      <p><strong>Concepto:</strong> ${escapeHtml(row.concept || "—")}</p>
      <p><strong>Estatus:</strong> ${escapeHtml(row.status || "—")} &nbsp; | &nbsp; <strong>Modo pago:</strong> ${escapeHtml(row.payment_mode || "—")}</p>
      <div class="report-toolbar" style="padding:0; margin:1rem 0 0.5rem;">
        <label class="report-field">Fecha póliza egreso
          <input id="fr-pay-date" class="report-field__input" type="date" value="${escapeHtml(suggestedDate)}" />
        </label>
        <button id="fr-pay-auto" class="btn btn--primary" type="button" ${disabledAttr}>Crear póliza de egreso</button>
      </div>
      <p class="report-muted">${
        hasPoliza
          ? "Esta factura ya está ligada a una póliza; no se puede volver a generar otra desde aquí."
          : "Puedes usar una fecha pasada; debe pertenecer al ejercicio fiscal activo."
      }</p>
      <details>
        <summary>Ver XML</summary>
        <pre class="fr-xml fr-xml--pretty"><code class="fr-xml-code">${highlightXml(prettyXml(row.xml_raw || ""))}</code></pre>
      </details>
    `;
    if (!hasPoliza) {
      document.getElementById("fr-pay-auto")?.addEventListener("click", () => void payInvoice(id));
    }
  } catch (e) {
    box.innerHTML = `<p>No se pudo obtener detalle: ${escapeHtml(e.message)}</p>`;
  }
}

async function payInvoice(id) {
  const polizaDate = String(document.getElementById("fr-pay-date")?.value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(polizaDate)) {
    setAlert("Selecciona una fecha de póliza válida.", false);
    return;
  }
  try {
    const data = await api(`/api/invoices/received/${encodeURIComponent(id)}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "automatic", polizaDate }),
    });
    setAlert(`Póliza creada: ${data?.poliza?.folio || data?.poliza?.id || "OK"}.`);
    await loadReceivedInvoices();
    await showDetail(id);
  } catch (e) {
    setAlert(e instanceof Error ? e.message : String(e), false);
  }
}

async function paySelectedInvoices() {
  if (!selectedInvoiceIds.size) {
    setAlert("Selecciona al menos una factura pendiente.", false);
    return;
  }
  const polizaDate = String($("#fr-batch-date")?.value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(polizaDate)) {
    setAlert("Selecciona una fecha válida para la póliza masiva.", false);
    return;
  }
  try {
    const data = await api("/api/invoices/received/pay-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceIds: [...selectedInvoiceIds],
        polizaDate,
      }),
    });
    setAlert(
      `Póliza creada: ${data?.poliza?.folio || data?.poliza?.id || "OK"} · Facturas vinculadas: ${Number(data?.linkedCount) || 0}.`
    );
    selectedInvoiceIds.clear();
    await loadReceivedInvoices();
  } catch (e) {
    setAlert(e instanceof Error ? e.message : String(e), false);
  }
}

async function deleteInvoices() {
  const hasSel = selectedInvoiceIds.size > 0;
  const n = hasSel ? selectedInvoiceIds.size : allRows.length;
  if (!n) {
    setAlert("No hay facturas para eliminar.", false);
    return;
  }
  const scope = hasSel ? `${n} factura(s) seleccionada(s)` : `TODAS las facturas recibidas (${n})`;
  if (!confirm(`¿Eliminar ${scope}?`)) return;
  if (!confirm("Segunda confirmación: esta acción no se puede deshacer. ¿Continuar?")) return;
  try {
    const data = await api("/api/invoices/received/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: "ELIMINAR",
        all: !hasSel,
        ids: hasSel ? [...selectedInvoiceIds] : [],
      }),
    });
    selectedInvoiceIds.clear();
    setAlert(`Eliminadas: ${Number(data?.deleted) || 0}.`);
    const box = $("#fr-detail");
    if (box) box.innerHTML = `<p class="report-muted">Selecciona una factura para ver su detalle.</p>`;
    await loadReceivedInvoices();
  } catch (e) {
    setAlert(e instanceof Error ? e.message : String(e), false);
  }
}

function wireTableActions() {
  $("#fr-tbody")?.addEventListener("click", async (ev) => {
    const t = ev.target instanceof HTMLElement ? ev.target : null;
    if (!t) return;
    const chk = t.closest('input[type="checkbox"][data-id]');
    if (chk instanceof HTMLInputElement) {
      const id = String(chk.dataset.id || "");
      if (!id) return;
      if (chk.checked) selectedInvoiceIds.add(id);
      else selectedInvoiceIds.delete(id);
      updateBatchMeta();
      syncCheckAllState();
      return;
    }
    const row = t.closest("tr[data-id]");
    const id = row?.getAttribute("data-id");
    if (!id) return;
    await showDetail(id);
  });
  $("#fr-check-all")?.addEventListener("change", (ev) => {
    const checked = ev.target instanceof HTMLInputElement ? ev.target.checked : false;
    document.querySelectorAll('#fr-tbody input[type="checkbox"][data-selectable="1"]').forEach((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      el.checked = checked;
      const id = String(el.dataset.id || "");
      if (!id) return;
      if (checked) selectedInvoiceIds.add(id);
      else selectedInvoiceIds.delete(id);
    });
    updateBatchMeta();
    syncCheckAllState();
  });
}

function wireColMenu() {
  $("#fr-table")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest(".col-filter-btn");
    if (!(btn instanceof HTMLElement)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const col = btn.getAttribute("data-col");
    if (!col) return;
    if (openMenu?.col === col && !$("#fr-col-menu")?.hidden) {
      closeColMenu();
      return;
    }
    openColMenu(col, btn);
  });

  $("#fr-col-menu")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !openMenu) return;
    const actBtn = t.closest("[data-act]");
    if (actBtn instanceof HTMLElement) {
      const act = actBtn.getAttribute("data-act");
      if (act === "sort-asc") {
        sortState = { key: openMenu.col, dir: "asc" };
        applyView();
        return;
      }
      if (act === "sort-desc") {
        sortState = { key: openMenu.col, dir: "desc" };
        applyView();
        return;
      }
      if (act === "select-all") {
        openMenu.draft = new Set(openMenu.values.map((v) => v.key));
        renderColMenuBody();
        return;
      }
      if (act === "clear") {
        openMenu.draft = new Set();
        renderColMenuBody();
        return;
      }
      if (act === "cancel") {
        closeColMenu();
        return;
      }
      if (act === "accept") {
        acceptColMenu();
        return;
      }
    }
  });

  $("#fr-col-menu")?.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "checkbox" || !openMenu) return;
    const key = t.getAttribute("data-key");
    if (!key) return;
    if (t.checked) openMenu.draft.add(key);
    else openMenu.draft.delete(key);
    const countEl = $("#fr-col-menu .col-menu__count");
    if (countEl) countEl.textContent = `${openMenu.draft.size} seleccionada(s)`;
  });

  $("#fr-col-menu")?.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.id !== "fr-col-menu-q" || !openMenu) return;
    openMenu.query = t.value;
    renderColMenuBody();
    const q = $("#fr-col-menu-q");
    if (q instanceof HTMLInputElement) {
      q.focus();
      const len = q.value.length;
      q.setSelectionRange(len, len);
    }
  });

  document.addEventListener("click", (ev) => {
    const menu = $("#fr-col-menu");
    if (!menu || menu.hidden) return;
    const t = ev.target;
    if (!(t instanceof Node)) return;
    if (menu.contains(t)) return;
    if (t instanceof Element && t.closest(".col-filter-btn")) return;
    closeColMenu();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeColMenu();
  });

  window.addEventListener("resize", () => {
    if (!openMenu) return;
    closeColMenu();
  });
}

async function init() {
  const session = await initAuthShell();
  if (!session) return;
  wireTableActions();
  wireColMenu();
  $("#fr-import-btn")?.addEventListener("click", importZip);
  $("#fr-batch-pay-btn")?.addEventListener("click", () => void paySelectedInvoices());
  $("#fr-delete-btn")?.addEventListener("click", () => void deleteInvoices());
  $("#fr-clear-filters")?.addEventListener("click", () => clearFilters());
  const batchDate = $("#fr-batch-date");
  if (batchDate && !batchDate.value) batchDate.value = new Date().toISOString().slice(0, 10);
  updateBatchMeta();
  await loadReceivedInvoices();
}

init().catch((e) => {
  setAlert(e instanceof Error ? e.message : "No se pudo iniciar Facturas recibidas.", false);
});
