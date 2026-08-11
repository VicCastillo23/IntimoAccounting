import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);
const selectedIssuedIds = new Set();

/** @type {any[]} */
let allRows = [];
/** @type {{ key: string, dir: "asc" | "desc" }} */
let sortState = { key: "fecha", dir: "desc" };

const FILTER_IDS = {
  uuid: "#fe-f-uuid",
  serie: "#fe-f-serie",
  fecha: "#fe-f-fecha",
  rfc: "#fe-f-rfc",
  total: "#fe-f-total",
  estatus: "#fe-f-estatus",
  poliza: "#fe-f-poliza",
};

function money(v) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(v || 0));
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

function readFilters() {
  return {
    uuid: String($(FILTER_IDS.uuid)?.value || "").trim().toLowerCase(),
    serie: String($(FILTER_IDS.serie)?.value || "").trim().toLowerCase(),
    fecha: String($(FILTER_IDS.fecha)?.value || "").trim(),
    rfc: String($(FILTER_IDS.rfc)?.value || "").trim().toLowerCase(),
    total: String($(FILTER_IDS.total)?.value || "").trim().toLowerCase().replace(/[$,\s]/g, ""),
    estatus: String($(FILTER_IDS.estatus)?.value || "").trim().toUpperCase(),
    poliza: String($(FILTER_IDS.poliza)?.value || "").trim(),
  };
}

function rowMatches(r, f) {
  if (f.uuid && !String(r.cfdi_uuid || "").toLowerCase().includes(f.uuid)) return false;
  if (f.serie && !serieFolio(r).toLowerCase().includes(f.serie)) return false;
  if (f.fecha && issuedDay(r) !== f.fecha) return false;
  if (f.rfc && !String(r.customer_rfc || "").toLowerCase().includes(f.rfc)) return false;
  if (f.total) {
    const totalStr = String(Number(r.total || 0));
    const moneyStr = money(r.total).toLowerCase().replace(/[$,\s]/g, "");
    if (!totalStr.includes(f.total) && !moneyStr.includes(f.total)) return false;
  }
  if (f.estatus && String(r.status || "").toUpperCase() !== f.estatus) return false;
  if (f.poliza === "__none__" && String(r.poliza_folio || "").trim()) return false;
  if (f.poliza === "__any__" && !String(r.poliza_folio || "").trim()) return false;
  if (f.poliza && f.poliza !== "__none__" && f.poliza !== "__any__") {
    if (!String(r.poliza_folio || "").toLowerCase().includes(f.poliza.toLowerCase())) return false;
  }
  return true;
}

function compareRows(a, b, key, dir) {
  const mul = dir === "asc" ? 1 : -1;
  const va = (() => {
    switch (key) {
      case "uuid":
        return String(a.cfdi_uuid || "");
      case "serie":
        return serieFolio(a);
      case "fecha":
        return issuedDay(a) || String(a.created_at || "");
      case "rfc":
        return String(a.customer_rfc || "");
      case "total":
        return Number(a.total || 0);
      case "estatus":
        return String(a.status || "").toUpperCase();
      case "poliza":
        return String(a.poliza_folio || "");
      default:
        return "";
    }
  })();
  const vb = (() => {
    switch (key) {
      case "uuid":
        return String(b.cfdi_uuid || "");
      case "serie":
        return serieFolio(b);
      case "fecha":
        return issuedDay(b) || String(b.created_at || "");
      case "rfc":
        return String(b.customer_rfc || "");
      case "total":
        return Number(b.total || 0);
      case "estatus":
        return String(b.status || "").toUpperCase();
      case "poliza":
        return String(b.poliza_folio || "");
      default:
        return "";
    }
  })();
  if (typeof va === "number" && typeof vb === "number") {
    if (va === vb) return 0;
    return va < vb ? -mul : mul;
  }
  return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * mul;
}

function applyView() {
  const f = readFilters();
  const filtered = allRows.filter((r) => rowMatches(r, f));
  filtered.sort((a, b) => compareRows(a, b, sortState.key, sortState.dir));
  updateFilterMeta(filtered.length, allRows.length, f);
  updateSortIndicators();
  render(filtered);
}

function filtersActive(f) {
  return Boolean(f.uuid || f.serie || f.fecha || f.rfc || f.total || f.estatus || f.poliza);
}

function updateFilterMeta(shown, total, f) {
  const meta = $("#fe-filter-meta");
  if (!meta) return;
  if (!total) {
    meta.textContent = "Sin facturas emitidas disponibles.";
    return;
  }
  if (!filtersActive(f)) {
    meta.textContent = `Mostrando ${shown} de ${total} factura(s).`;
    return;
  }
  meta.textContent = `Filtro activo: ${shown} de ${total} factura(s).`;
}

function updateSortIndicators() {
  document.querySelectorAll("#fe-table .col-sort").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const key = btn.getAttribute("data-sort") || "";
    const ind = btn.querySelector(".col-sort__ind");
    const active = key === sortState.key;
    btn.classList.toggle("col-sort--active", active);
    btn.setAttribute("aria-sort", active ? (sortState.dir === "asc" ? "ascending" : "descending") : "none");
    if (ind) ind.textContent = active ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
  });
}

function populateEstatusOptions(rows) {
  const sel = $(FILTER_IDS.estatus);
  if (!(sel instanceof HTMLSelectElement)) return;
  const prev = sel.value;
  const statuses = [...new Set(rows.map((r) => String(r.status || "").trim().toUpperCase()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
  sel.innerHTML = `<option value="">Todos</option>${statuses.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}`;
  if (prev && statuses.includes(prev)) sel.value = prev;
}

function clearFilters() {
  for (const sel of Object.values(FILTER_IDS)) {
    const el = $(sel);
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = "";
  }
  sortState = { key: "fecha", dir: "desc" };
  applyView();
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
  const top = compact.slice(0, mid);
  const bottom = compact.slice(mid);
  return `<span class="fr-uuid-two-line"><span>${esc(top)}</span><span>${esc(bottom)}</span></span>`;
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
    selectedIssuedIds.clear();
    updateBatchMeta();
    syncCheckAllState();
    return;
  }
  const available = new Set(rows.map((r) => String(r.id || "")));
  for (const id of [...selectedIssuedIds]) {
    if (!available.has(id)) selectedIssuedIds.delete(id);
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
  const data = await api("/api/invoices/issued?limit=200");
  allRows = Array.isArray(data.rows) ? data.rows : [];
  populateEstatusOptions(allRows);
  applyView();
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

async function init() {
  const session = await initAuthShell();
  if (!session) return;
  const tbody = $("#fe-tbody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="10">Cargando...</td></tr>`;
  const load = async () => {
    try {
      const data = await api("/api/invoices/issued?limit=200");
      allRows = Array.isArray(data.rows) ? data.rows : [];
      populateEstatusOptions(allRows);
      applyView();
    } catch (e) {
      allRows = [];
      if (tbody) tbody.innerHTML = `<tr><td colspan="10">No se pudo cargar: ${esc(e.message)}</td></tr>`;
    }
  };
  const onFilterChange = () => applyView();
  Object.values(FILTER_IDS).forEach((sel) => {
    const el = $(sel);
    el?.addEventListener("input", onFilterChange);
    el?.addEventListener("change", onFilterChange);
  });
  $("#fe-clear-filters")?.addEventListener("click", () => clearFilters());
  $("#fe-table")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest(".col-sort");
    if (!(btn instanceof HTMLElement)) return;
    const key = btn.getAttribute("data-sort");
    if (!key) return;
    if (sortState.key === key) {
      sortState = { key, dir: sortState.dir === "asc" ? "desc" : "asc" };
    } else {
      sortState = { key, dir: key === "fecha" || key === "total" ? "desc" : "asc" };
    }
    applyView();
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
      if (!(el instanceof HTMLInputElement)) return;
      if (el.disabled) return;
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
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  });
  $("#fe-import-btn")?.addEventListener("click", async () => {
    try {
      await importZipEmitidas();
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  });
  const d = $("#fe-batch-date");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  updateBatchMeta();
  await load();
}

init();
