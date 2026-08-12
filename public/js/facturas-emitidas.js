import { initAuthShell } from "./auth-shell.js";
import { INVOICES_PAGE_SIZE, renderInvoicesPager } from "./invoices-pager.js";

const $ = (s) => document.querySelector(s);
const selectedIssuedIds = new Set();

/** @type {any[]} */
let allRows = [];
/** @type {{ key: string, dir: "asc" | "desc" }} */
let sortState = { key: "fecha", dir: "desc" };
let currentPage = 1;

/** @type {Record<string, Set<string> | null>} */
const columnFilters = {
  uuid: null,
  serie: null,
  fecha: null,
  rfc: null,
  total: null,
  estatus: null,
  poliza: null,
};

const COLUMNS = ["uuid", "serie", "fecha", "rfc", "total", "estatus", "poliza"];

/** @type {{ col: string, draft: Set<string>, values: { key: string, label: string }[], query: string } | null} */
let openMenu = null;

function money(v) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(v || 0));
}

function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDate(v) {
  const t = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "—";
  const d = new Date(`${t}T12:00:00`);
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

function renderUuidTwoLines(uuid) {
  const raw = String(uuid || "").trim();
  if (!raw || raw === "—") return "—";
  const compact = raw.replace(/\s+/g, "");
  if (compact.length <= 18) return esc(compact);
  const mid = Math.ceil(compact.length / 2);
  return `<span class="fr-uuid-two-line"><span>${esc(compact.slice(0, mid))}</span><span>${esc(compact.slice(mid))}</span></span>`;
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
    out.push(splitAttrs(`${INDENT.repeat(pad)}${l}`));
    if (/^<[^!?][^>]*[^/]>$/.test(l) && !/^<.*<\/.*>$/.test(l)) pad += 1;
  }
  return out.join("\n");
}

function highlightXml(xmlPretty) {
  return String(xmlPretty || "")
    .split("\n")
    .map((line) => {
      let s = esc(line);
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

async function api(url) {
  const r = await fetch(url, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || `Error HTTP ${r.status}`);
  return j.data;
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || `Error HTTP ${r.status}`);
  return j.data;
}

async function apiUpload(url, formData) {
  const r = await fetch(url, { method: "POST", credentials: "include", body: formData });
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
    case "serie":
      return serieFolio(r) || "—";
    case "fecha":
      return issuedDay(r) || "—";
    case "rfc":
      return String(r.customer_rfc || "").trim() || "—";
    case "total":
      return String(Number(r.total || 0));
    case "estatus":
      return String(r.status || "").trim().toUpperCase() || "—";
    case "poliza":
      return String(r.poliza_folio || "").trim() || "—";
    default:
      return "—";
  }
}

function cellLabel(r, col) {
  if (col === "fecha") return fmtDate(r.issued_at);
  if (col === "total") return money(r.total);
  return cellKey(r, col);
}

function uniqueValues(col) {
  const map = new Map();
  for (const r of allRows) {
    const key = cellKey(r, col);
    if (!map.has(key)) map.set(key, cellLabel(r, col));
  }
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true, sensitivity: "base" }));
}

function sortValue(r, key) {
  switch (key) {
    case "uuid":
      return String(r.cfdi_uuid || "");
    case "serie":
      return serieFolio(r);
    case "fecha":
      return issuedDay(r) || String(r.created_at || "");
    case "rfc":
      return String(r.customer_rfc || "");
    case "total":
      return Number(r.total || 0);
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

function updateFilterMeta(shown, total, pageFrom, pageTo, pages) {
  const meta = $("#fe-filter-meta");
  if (!meta) return;
  if (!total) {
    meta.textContent = "Sin facturas emitidas disponibles.";
    return;
  }
  const range = `Mostrando ${pageFrom}–${pageTo} de ${shown}`;
  const pagesLabel = pages > 1 ? ` · ${pages} página(s)` : "";
  if (filtersActive()) {
    meta.textContent = `Filtro activo: ${range} (de ${total} cargadas)${pagesLabel}`;
    return;
  }
  meta.textContent = `${range}${pagesLabel}`;
}

function updateFilterBtnStates() {
  document.querySelectorAll("#fe-table .col-filter-btn").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const col = btn.getAttribute("data-col") || "";
    btn.classList.toggle("col-filter-btn--active", Boolean(columnFilters[col]));
    btn.classList.toggle("col-filter-btn--sorted", sortState.key === col);
  });
}

function updateBatchMeta() {
  const meta = $("#fe-batch-meta");
  if (!meta) return;
  meta.textContent = selectedIssuedIds.size
    ? `${selectedIssuedIds.size} factura(s) seleccionada(s).`
    : "Selecciona facturas emitidas en la tabla.";
}

function syncCheckAllState() {
  const all = $("#fe-check-all");
  if (!all) return;
  const checks = [...document.querySelectorAll('#fe-tbody input[type="checkbox"][data-id]')];
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
  const tbody = $("#fe-tbody");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10">Sin facturas emitidas disponibles.</td></tr>`;
    updateBatchMeta();
    syncCheckAllState();
    return;
  }
  const available = new Set(rows.map((r) => String(r.id || "")));
  for (const id of [...selectedIssuedIds]) {
    if (!available.has(id) && !allRows.some((r) => String(r.id) === id)) selectedIssuedIds.delete(id);
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr data-id="${esc(r.id || "")}">
      <td><input type="checkbox" data-id="${esc(r.id || "")}" ${selectedIssuedIds.has(String(r.id || "")) ? "checked" : ""} ${r.poliza_folio ? "disabled" : ""} /></td>
      <td>${renderUuidTwoLines(r.cfdi_uuid || "—")}</td>
      <td>${esc(r.series || "")}${r.folio ? `-${esc(r.folio)}` : ""}</td>
      <td>${fmtDate(r.issued_at)}</td>
      <td>${esc(r.customer_rfc || "—")}</td>
      <td class="data-table__num">${money(r.total)}</td>
      <td>${esc((r.status || "").toUpperCase())}</td>
      <td>${esc(r.poliza_folio || "—")}</td>
      <td>${r.xml_url ? `<a href="${esc(r.xml_url)}" target="_blank" rel="noopener">XML</a>` : "—"}</td>
      <td>${r.pdf_url ? `<a href="${esc(r.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : "—"}</td>
    </tr>
  `
    )
    .join("");
  updateBatchMeta();
  syncCheckAllState();
}

function applyView({ resetPage = false } = {}) {
  if (resetPage) currentPage = 1;
  const filtered = allRows.filter((r) => rowMatches(r));
  filtered.sort((a, b) => compareRows(a, b, sortState.key, sortState.dir));
  const pages = Math.max(1, Math.ceil(filtered.length / INVOICES_PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  const start = (currentPage - 1) * INVOICES_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + INVOICES_PAGE_SIZE);
  const pageFrom = filtered.length ? start + 1 : 0;
  const pageTo = start + pageRows.length;
  updateFilterMeta(filtered.length, allRows.length, pageFrom, pageTo, pages);
  updateFilterBtnStates();
  render(pageRows);
  renderInvoicesPager({
    container: $("#fe-pager"),
    page: currentPage,
    pageSize: INVOICES_PAGE_SIZE,
    total: filtered.length,
    onPage: (p) => {
      currentPage = p;
      applyView();
    },
  });
}

function clearFilters() {
  for (const col of COLUMNS) columnFilters[col] = null;
  sortState = { key: "fecha", dir: "desc" };
  closeColMenu();
  applyView({ resetPage: true });
}

function closeColMenu() {
  openMenu = null;
  const menu = $("#fe-col-menu");
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
  const menu = $("#fe-col-menu");
  if (!menu || !openMenu) return;
  const visible = draftVisibleValues();
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
      <p class="col-menu__count">${openMenu.draft.size} seleccionada(s)</p>
      <label class="col-menu__search">
        <input type="search" id="fe-col-menu-q" placeholder="Buscar" value="${esc(openMenu.query)}" autocomplete="off" />
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
              <input type="checkbox" data-key="${esc(v.key)}" ${openMenu.draft.has(v.key) ? "checked" : ""} />
              <span title="${esc(v.label)}">${esc(v.label)}</span>
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
  const menu = $("#fe-col-menu");
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
  $("#fe-col-menu-q")?.focus();
}

function acceptColMenu() {
  if (!openMenu) return;
  const { col, draft, values } = openMenu;
  if (draft.size === 0) columnFilters[col] = new Set(["__none_match__"]);
  else if (draft.size >= values.length) columnFilters[col] = null;
  else columnFilters[col] = new Set(draft);
  closeColMenu();
  applyView({ resetPage: true });
}

function wireColMenu() {
  $("#fe-table")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest(".col-filter-btn");
    if (!(btn instanceof HTMLElement)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const col = btn.getAttribute("data-col");
    if (!col) return;
    if (openMenu?.col === col && !$("#fe-col-menu")?.hidden) {
      closeColMenu();
      return;
    }
    openColMenu(col, btn);
  });

  $("#fe-col-menu")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !openMenu) return;
    const actBtn = t.closest("[data-act]");
    if (!(actBtn instanceof HTMLElement)) return;
    const act = actBtn.getAttribute("data-act");
    if (act === "sort-asc") {
      sortState = { key: openMenu.col, dir: "asc" };
      applyView({ resetPage: true });
      return;
    }
    if (act === "sort-desc") {
      sortState = { key: openMenu.col, dir: "desc" };
      applyView({ resetPage: true });
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
    if (act === "accept") acceptColMenu();
  });

  $("#fe-col-menu")?.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "checkbox" || !openMenu) return;
    const key = t.getAttribute("data-key");
    if (!key) return;
    if (t.checked) openMenu.draft.add(key);
    else openMenu.draft.delete(key);
    const countEl = $("#fe-col-menu .col-menu__count");
    if (countEl) countEl.textContent = `${openMenu.draft.size} seleccionada(s)`;
  });

  $("#fe-col-menu")?.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.id !== "fe-col-menu-q" || !openMenu) return;
    openMenu.query = t.value;
    renderColMenuBody();
    const q = $("#fe-col-menu-q");
    if (q instanceof HTMLInputElement) {
      q.focus();
      const len = q.value.length;
      q.setSelectionRange(len, len);
    }
  });

  document.addEventListener("click", (ev) => {
    const menu = $("#fe-col-menu");
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
    if (openMenu) closeColMenu();
  });
}

async function loadIssued() {
  const data = await api("/api/invoices/issued?limit=5000");
  allRows = Array.isArray(data.rows) ? data.rows : [];
  applyView({ resetPage: true });
}

async function showDetail(id) {
  const box = $("#fe-detail");
  if (!box) return;
  box.innerHTML = "Cargando detalle...";
  try {
    const d = await api(`/api/invoices/issued/${encodeURIComponent(id)}`);
    const suggestedDate = String(d.issued_at || "").slice(0, 10);
    const hasPoliza = Boolean(String(d.poliza_folio || "").trim());
    const disabledAttr = hasPoliza ? "disabled" : "";
    let xmlPreview = "";
    if (d.xml_url) {
      try {
        const r = await fetch(d.xml_url, { credentials: "include" });
        if (r.ok) {
          const txt = await r.text();
          xmlPreview = `<details><summary>Ver XML</summary><pre class="fr-xml fr-xml--pretty"><code class="fr-xml-code">${highlightXml(prettyXml(txt))}</code></pre></details>`;
        }
      } catch {
        xmlPreview = "";
      }
    }
    box.innerHTML = `
      <h3>Detalle de factura</h3>
      <p><strong>UUID:</strong> ${esc(d.cfdi_uuid || "—")}</p>
      <p><strong>Emisor:</strong> ${esc(d.issuer_rfc || "—")} &nbsp; | &nbsp; <strong>Receptor:</strong> ${esc(d.customer_rfc || "—")}</p>
      <p><strong>Fecha:</strong> ${fmtDate(d.issued_at)} &nbsp; | &nbsp; <strong>Subtotal:</strong> ${money(d.subtotal)} &nbsp; | &nbsp; <strong>IVA:</strong> ${money(
      d.taxes_transferred
    )}</p>
      <p><strong>Retenciones:</strong> ${money(d.taxes_withheld)} &nbsp; | &nbsp; <strong>Descuentos:</strong> ${money(d.discounts)} &nbsp; | &nbsp; <strong>Total:</strong> ${money(d.total)}</p>
      <p><strong>Concepto:</strong> ${esc(d.concept || "—")}</p>
      <p><strong>Estatus:</strong> ${esc(d.status || "—")} &nbsp; | &nbsp; <strong>Póliza:</strong> ${esc(d.poliza_folio || "—")}</p>
      <div class="report-toolbar" style="padding:0; margin:1rem 0 0.5rem;">
        <label class="report-field">Fecha póliza ingreso
          <input id="fe-pay-date" class="report-field__input" type="date" value="${esc(suggestedDate)}" />
        </label>
        <button id="fe-pay-auto" class="btn btn--primary" type="button" ${disabledAttr}>Crear póliza de ingreso</button>
      </div>
      <p class="report-muted">${
        hasPoliza
          ? "Esta factura ya está ligada a una póliza; no se puede volver a generar otra desde aquí."
          : "Puedes usar una fecha pasada; debe pertenecer al ejercicio fiscal activo."
      }</p>
      <p>
        ${d.xml_url ? `<a href="${esc(d.xml_url)}" target="_blank" rel="noopener">XML</a>` : "—"}
        &nbsp;|&nbsp;
        ${d.pdf_url ? `<a href="${esc(d.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : "—"}
      </p>
      ${xmlPreview}
    `;
    if (!hasPoliza) {
      document.getElementById("fe-pay-auto")?.addEventListener("click", () => void createSinglePoliza(id));
    }
  } catch (e) {
    box.innerHTML = `<p>No se pudo cargar detalle: ${esc(e.message)}</p>`;
  }
}

async function createSinglePoliza(id) {
  const polizaDate = String(document.getElementById("fe-pay-date")?.value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(polizaDate)) throw new Error("Selecciona una fecha válida.");
  const out = await apiPost("/api/invoices/issued/poliza-batch", {
    invoiceIds: [id],
    polizaDate,
  });
  alert(`Póliza creada: ${out?.poliza?.folio || out?.poliza?.id || "OK"} · Facturas: ${Number(out?.linkedCount) || 0}`);
  selectedIssuedIds.delete(id);
  await loadIssued();
  await showDetail(id);
}

async function createBatchPoliza() {
  if (!selectedIssuedIds.size) throw new Error("Selecciona al menos una factura emitida.");
  const polizaDate = String($("#fe-batch-date")?.value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(polizaDate)) throw new Error("Selecciona una fecha válida.");
  const out = await apiPost("/api/invoices/issued/poliza-batch", {
    invoiceIds: [...selectedIssuedIds],
    polizaDate,
  });
  alert(`Póliza creada: ${out?.poliza?.folio || out?.poliza?.id || "OK"} · Facturas: ${Number(out?.linkedCount) || 0}`);
  selectedIssuedIds.clear();
}

async function importZipEmitidas() {
  const input = $("#fe-zip");
  const f = input?.files?.[0];
  if (!f) throw new Error("Selecciona un ZIP de CFDI emitidos.");
  const fd = new FormData();
  fd.append("file", f);
  const out = await apiUpload("/api/invoices/issued/import-zip", fd);
  alert(
    `Importación completa: ${out.summary?.inserted || 0} insertadas, ${out.summary?.duplicates || 0} duplicadas, ${out.summary?.errors || 0} con error.`
  );
  if (input) input.value = "";
}

async function deleteInvoices() {
  const hasSel = selectedIssuedIds.size > 0;
  const n = hasSel ? selectedIssuedIds.size : allRows.length;
  if (!n) {
    alert("No hay facturas para eliminar.");
    return;
  }
  const scope = hasSel ? `${n} factura(s) seleccionada(s)` : `TODAS las facturas emitidas (${n})`;
  if (!confirm(`¿Eliminar ${scope}?`)) return;
  if (!confirm("Segunda confirmación: esta acción no se puede deshacer. ¿Continuar?")) return;
  const out = await apiPost("/api/invoices/issued/delete", {
    confirm: "ELIMINAR",
    all: !hasSel,
    ids: hasSel ? [...selectedIssuedIds] : [],
  });
  selectedIssuedIds.clear();
  alert(`Eliminadas: ${Number(out?.deleted) || 0}.`);
  const box = $("#fe-detail");
  if (box) box.innerHTML = `<p class="report-muted">Selecciona una factura para ver su detalle.</p>`;
  await loadIssued();
}

async function init() {
  const session = await initAuthShell();
  if (!session) return;
  const tbody = $("#fe-tbody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="10">Cargando...</td></tr>`;
  wireColMenu();
  $("#fe-clear-filters")?.addEventListener("click", () => clearFilters());
  $("#fe-delete-btn")?.addEventListener("click", async () => {
    try {
      await deleteInvoices();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  });
  $("#fe-tbody")?.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "checkbox" || !t.dataset.id) return;
    const id = String(t.dataset.id);
    if (t.checked) selectedIssuedIds.add(id);
    else selectedIssuedIds.delete(id);
    updateBatchMeta();
    syncCheckAllState();
  });
  $("#fe-tbody")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.closest('input[type="checkbox"]') || t.closest("a")) return;
    const tr = t.closest("tr[data-id]");
    const id = tr?.getAttribute("data-id");
    if (!id) return;
    void showDetail(id);
  });
  $("#fe-check-all")?.addEventListener("change", (ev) => {
    const checked = ev.target instanceof HTMLInputElement ? ev.target.checked : false;
    document.querySelectorAll('#fe-tbody input[type="checkbox"][data-id]').forEach((el) => {
      if (!(el instanceof HTMLInputElement) || el.disabled) return;
      el.checked = checked;
      const id = String(el.dataset.id || "");
      if (!id) return;
      if (checked) selectedIssuedIds.add(id);
      else selectedIssuedIds.delete(id);
    });
    updateBatchMeta();
    syncCheckAllState();
  });
  $("#fe-batch-btn")?.addEventListener("click", async () => {
    try {
      await createBatchPoliza();
      await loadIssued();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  });
  $("#fe-zip")?.addEventListener("change", async () => {
    try {
      await importZipEmitidas();
      await loadIssued();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  });
  $("#fe-import-btn")?.addEventListener("click", () => $("#fe-zip")?.click());
  const d = $("#fe-batch-date");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  updateBatchMeta();
  try {
    await loadIssued();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10">No se pudo cargar: ${esc(e.message)}</td></tr>`;
  }
}

init();
