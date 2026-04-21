import { initMobileNav } from "./mobile-nav.js";
import { ensureFiscalYear, injectFiscalSidebar } from "./fiscal-session.js";
import {
  buildSatDisplayById,
  intimoSatCodeTreeDepth,
  isMainSectionRow,
  satCodigoDepth,
} from "./intimo-account-code.js";

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

/** Evita fallos silenciosos si /api devuelve HTML (404, proxy mal) en lugar de JSON. */
async function parseJsonResponse(res) {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`Respuesta vacía del servidor (HTTP ${res.status}).`);
  }
  const first = trimmed[0];
  if (first !== "{" && first !== "[") {
    throw new Error(
      `El servidor no devolvió JSON (HTTP ${res.status}). Suele pasar si no reiniciaste Node tras el deploy, o si Nginx no enruta /api al mismo puerto que la app.`
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`JSON inválido (HTTP ${res.status}).`);
  }
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

let satRows = [];
/** @type {Map<number, { code: string, desc: string }>} */
let satDisplayById = new Map();
let chartRows = [];
let satQ = "";
let chartQ = "";
/** @type {number | null} */
let editingId = null;
/** SAT (izquierda): id de fila clicada para filtrar cuentas por rubro; null = todas */
let selectedSatRubroId = null;

function showAlert(msg, kind = "error") {
  const slot = $("#catalog-alert");
  if (!slot) return;
  slot.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

function getSatSorted() {
  return [...satRows].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

/**
 * IDs SAT (hojas con codigo) incluidas en el rubro de la fila clicada.
 * - Código (ej. 1.1): solo esa fila.
 * - Sección principal (Activo, Pasivo…): todas las hojas hasta la siguiente sección principal.
 * - Subsección (Activos circulantes…): hojas hasta la siguiente fila es_seccion.
 */
function satIdsForRubroClicked(clickedSatId) {
  const sorted = getSatSorted();
  const idx = sorted.findIndex((r) => Number(r.id) === Number(clickedSatId));
  if (idx === -1) return new Set();
  const row = sorted[idx];

  if (!row.es_seccion && row.codigo) {
    return new Set([Number(row.id)]);
  }
  if (row.es_seccion && isMainSectionRow(row)) {
    const ids = new Set();
    for (let k = idx + 1; k < sorted.length; k++) {
      const x = sorted[k];
      if (isMainSectionRow(x)) break;
      if (!x.es_seccion && x.codigo) ids.add(Number(x.id));
    }
    return ids;
  }
  if (row.es_seccion) {
    const ids = new Set();
    for (let k = idx + 1; k < sorted.length; k++) {
      const x = sorted[k];
      if (x.es_seccion) break;
      if (x.codigo) ids.add(Number(x.id));
    }
    return ids;
  }
  return new Set();
}

function toggleSatRubroFilter(satId) {
  if (selectedSatRubroId != null && Number(selectedSatRubroId) === Number(satId)) {
    selectedSatRubroId = null;
  } else {
    selectedSatRubroId = satId;
  }
  renderSat();
  renderChart();
}

function updateChartRubroHint() {
  const hint = $("#chart-rubro-hint");
  if (!hint) return;
  if (selectedSatRubroId == null) {
    hint.textContent = "";
    hint.removeAttribute("title");
    hint.classList.remove("catalogo-rubro-hint--on");
    return;
  }
  const disp = satDisplayById.get(Number(selectedSatRubroId));
  const label = disp ? `${disp.code} — ${disp.desc}` : "Rubro seleccionado";
  const msg = `Mostrando cuentas del rubro: ${label}. Clic de nuevo en la misma fila SAT para ver todas.`;
  hint.textContent = msg;
  hint.setAttribute("title", msg);
  hint.classList.add("catalogo-rubro-hint--on");
}

function renderSat() {
  const tbody = $("#sat-tbody");
  if (!tbody) return;
  const q = satQ.trim().toLowerCase();
  const rows = satRows.filter((r) => {
    if (!q) return true;
    const disp = satDisplayById.get(Number(r.id));
    const ic = (disp?.code || "").toLowerCase();
    const idesc = (disp?.desc || "").toLowerCase();
    const c = (r.codigo || "").toLowerCase();
    const d = (r.descripcion || "").toLowerCase();
    return ic.includes(q) || idesc.includes(q) || c.includes(q) || d.includes(q);
  });
  if (!satRows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="data-table__empty">Sin datos de código agrupador. En desarrollo el servidor intenta cargarlos al arrancar; si sigue vacío, ejecuta <code>npm run db:migrate-all</code> y reinicia.</td></tr>`;
    return;
  }
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="data-table__empty">Ningún renglón coincide con la búsqueda.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const disp = satDisplayById.get(Number(r.id));
      const code = disp?.code ?? "—";
      const desc = disp?.desc ?? String(r.descripcion || "");
      const depth =
        disp?.code && disp.code !== "—"
          ? intimoSatCodeTreeDepth(disp.code)
          : satCodigoDepth(r.codigo);
      const active =
        selectedSatRubroId != null && Number(selectedSatRubroId) === Number(r.id) ? " catalogo-sat-data--active" : "";
      return `<tr class="catalogo-sat-data${active}" data-sat-id="${Number(r.id)}" style="--sat-depth:${depth}">
        <td class="catalogo-cod"><strong>${escapeHtml(code)}</strong></td>
        <td class="catalogo-sat-desc">${escapeHtml(desc)}</td>
      </tr>`;
    })
    .join("");
}

function naturLabel(n) {
  return n === "A" ? "A — Acreedora" : "D — Deudora";
}

/** Texto corto en la tabla; el formulario/modal sigue usando `naturLabel`. */
function naturTableCode(n) {
  return n === "A" ? "A" : "D";
}

function renderChart() {
  const tbody = $("#chart-tbody");
  if (!tbody) return;
  updateChartRubroHint();
  if (!chartRows.length) {
    if (!satRows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="data-table__empty">Sin datos SAT en la base. Revisa la consola del servidor o ejecuta <code>npm run db:migrate-all</code>.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="data-table__empty">No hay cuentas de empresa. Usa <strong>Nueva cuenta</strong>.</td></tr>`;
    }
    return;
  }
  const rubroIds =
    selectedSatRubroId == null ? null : satIdsForRubroClicked(selectedSatRubroId);

  const q = chartQ.trim().toLowerCase();
  const filtered = chartRows.filter((r) => {
    if (rubroIds != null) {
      if (rubroIds.size === 0) return false;
      const sid = r.sat_codigo_agrupador_id;
      if (sid == null || !rubroIds.has(Number(sid))) return false;
    }
    if (!q) return true;
    const blob = `${r.num_cta} ${r.descripcion} ${r.codigo_agrupador || ""} ${r.desc_agrupador || ""}`.toLowerCase();
    return blob.includes(q);
  });
  if (!filtered.length) {
    const msg =
      rubroIds != null && rubroIds.size === 0
        ? "Este rubro SAT no incluye cuentas agrupadoras (solo títulos). Elija un código concreto."
        : rubroIds != null
          ? "Ninguna cuenta de la empresa enlazada a este rubro."
          : "Ninguna cuenta coincide con la búsqueda.";
    tbody.innerHTML = `<tr><td colspan="5" class="data-table__empty">${escapeHtml(msg)}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered
    .map((r) => {
      const satCell = r.codigo_agrupador
        ? escapeHtml(`${r.codigo_agrupador} — ${r.desc_agrupador || ""}`)
        : "—";
      const satTitle =
        r.codigo_agrupador != null
          ? ` title="${escapeAttr(`${r.codigo_agrupador} — ${r.desc_agrupador || ""}`)}"`
          : "";
      const descTitle = ` title="${escapeAttr(r.descripcion)}"`;
      const naturTitle = ` title="${escapeAttr(naturLabel(r.natur))}"`;
      return `
    <tr data-id="${r.id}" class="catalogo-chart-row">
      <td class="catalogo-cell-num"><strong>${escapeHtml(r.num_cta)}</strong></td>
      <td class="catalogo-cell-desc"${descTitle}>${escapeHtml(r.descripcion)}</td>
      <td class="catalogo-cell-natur"${naturTitle}>${escapeHtml(naturTableCode(r.natur))}</td>
      <td class="catalogo-cell-sat"${satTitle}>${satCell}</td>
      <td class="catalogo-actions">
        <button type="button" class="btn btn--text btn--sm" data-edit="${r.id}">Editar</button>
        <button type="button" class="btn btn--text btn--sm catalogo-btn-danger" data-deactivate="${r.id}">Desactivar</button>
      </td>
    </tr>`;
    })
    .join("");
}

/** Parte antes del primer punto (p. ej. "1", "10", "65"). */
function majorKey(codigo) {
  if (!codigo) return "";
  const s = String(codigo).trim();
  const dot = s.indexOf(".");
  return dot === -1 ? s : s.slice(0, dot);
}

function populateSatMajors() {
  const majorSel = $("#acc-sat-major");
  if (!majorSel) return;
  const withCode = satRows.filter((r) => r.codigo && !r.es_seccion);
  const majors = new Set();
  for (const r of withCode) {
    majors.add(majorKey(r.codigo));
  }
  const sorted = [...majors].sort((a, b) => {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.localeCompare(b, "es", { numeric: true });
  });
  majorSel.innerHTML =
    `<option value="">— Sin asignar —</option>` +
    sorted
      .map((m) => {
        const labelRow = withCode.find((r) => majorKey(r.codigo) === m && String(r.codigo) === m);
        const desc = labelRow ? labelRow.descripcion : m;
        return `<option value="${escapeAttr(m)}">${escapeHtml(m)} — ${escapeHtml(desc)}</option>`;
      })
      .join("");
}

/**
 * @param {string} majorCode
 * @param {number | null} selectedSatId id de accounting.sat_codigo_agrupador
 */
function populateSatMinors(majorCode, selectedSatId) {
  const minorSel = $("#acc-sat-minor");
  if (!minorSel) return;
  if (!majorCode) {
    minorSel.disabled = true;
    minorSel.innerHTML = `<option value="">— Elija principal arriba —</option>`;
    return;
  }
  minorSel.disabled = false;
  const withCode = satRows.filter((r) => r.codigo && !r.es_seccion);
  const minors = withCode.filter((r) => {
    const c = String(r.codigo);
    return c === majorCode || c.startsWith(`${majorCode}.`);
  });
  minors.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  minorSel.innerHTML =
    `<option value="">— Elija subcódigo —</option>` +
    minors
      .map((r) => {
        const sel = selectedSatId != null && Number(selectedSatId) === Number(r.id) ? " selected" : "";
        const disp = satDisplayById.get(Number(r.id));
        const label = disp
          ? `${escapeHtml(disp.code)} — ${escapeHtml(disp.desc)}`
          : `${escapeHtml(r.codigo)} — ${escapeHtml(r.descripcion)}`;
        return `<option value="${escapeAttr(String(r.id))}"${sel}>${label}</option>`;
      })
      .join("");
  if (selectedSatId != null) {
    minorSel.value = String(selectedSatId);
  }
}

async function loadSat() {
  let res;
  try {
    res = await apiFetch("/api/catalog/sat");
  } catch {
    satRows = [];
    satDisplayById = new Map();
    showAlert("Error de red al cargar el código agrupador.");
    renderSat();
    return;
  }
  try {
    await ensureAuthed(res);
  } catch (e) {
    if (e instanceof Error && e.message === "Sesión expirada.") return;
    throw e;
  }
  let j;
  try {
    j = await parseJsonResponse(res);
  } catch (e) {
    if (e.message === "Sesión expirada.") return;
    satRows = [];
    satDisplayById = new Map();
    showAlert(e instanceof Error ? e.message : String(e));
    renderSat();
    return;
  }
  if (!res.ok) {
    satRows = [];
    satDisplayById = new Map();
    showAlert(j.message || "No se pudo cargar el código agrupador.");
    renderSat();
    return;
  }
  showAlert("");
  satRows = j.data || [];
  satDisplayById = buildSatDisplayById(satRows);
  renderSat();
  populateSatMajors();
  populateSatMinors($("#acc-sat-major")?.value || "", null);
}

async function loadChart() {
  let res;
  try {
    res = await apiFetch("/api/catalog/accounts");
  } catch {
    chartRows = [];
    showAlert("Error de red al cargar cuentas de empresa.");
    renderChart();
    return;
  }
  try {
    await ensureAuthed(res);
  } catch (e) {
    if (e instanceof Error && e.message === "Sesión expirada.") return;
    throw e;
  }
  let j;
  try {
    j = await parseJsonResponse(res);
  } catch (e) {
    if (e.message === "Sesión expirada.") return;
    chartRows = [];
    showAlert(e instanceof Error ? e.message : String(e));
    renderChart();
    return;
  }
  if (!res.ok) {
    chartRows = [];
    showAlert(j.message || "No se pudo cargar el catálogo de cuentas.");
    renderChart();
    return;
  }
  chartRows = j.data || [];
  renderChart();
}

function openModal(isEdit) {
  const backdrop = $("#modal-account");
  if (!backdrop) return;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
  const title = $("#modal-account-title");
  if (title) title.textContent = isEdit ? "Editar cuenta" : "Nueva cuenta";
  const num = $("#acc-num-cta");
  if (num) num.toggleAttribute("readonly", Boolean(isEdit));
  document.querySelector(".modal--account")?.focus();
}

function closeModal() {
  const backdrop = $("#modal-account");
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
  editingId = null;
  const err = $("#account-form-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function clearForm() {
  editingId = null;
  const f = {
    num: $("#acc-num-cta"),
    desc: $("#acc-desc"),
    sub: $("#acc-sub"),
    nivel: $("#acc-nivel"),
    natur: $("#acc-natur"),
  };
  if (f.num) {
    f.num.value = "";
    f.num.removeAttribute("readonly");
  }
  if (f.desc) f.desc.value = "";
  if (f.sub) f.sub.value = "";
  if (f.nivel) f.nivel.value = "1";
  if (f.natur) f.natur.value = "D";
  const maj = $("#acc-sat-major");
  if (maj) maj.value = "";
  populateSatMinors("", null);
}

function fillFormFromRow(r) {
  editingId = r.id;
  const num = $("#acc-num-cta");
  const desc = $("#acc-desc");
  const sub = $("#acc-sub");
  const nivel = $("#acc-nivel");
  const natur = $("#acc-natur");
  if (num) {
    num.value = r.num_cta || "";
    num.setAttribute("readonly", "readonly");
  }
  if (desc) desc.value = r.descripcion || "";
  if (sub) sub.value = r.sub_cta_de || "";
  if (nivel) {
    const n = Number(r.nivel) === 2 ? "2" : "1";
    nivel.value = n;
  }
  if (natur) natur.value = r.natur === "A" ? "A" : "D";

  populateSatMajors();
  const satId = r.sat_codigo_agrupador_id;
  const majEl = $("#acc-sat-major");
  if (!satId) {
    if (majEl) majEl.value = "";
    populateSatMinors("", null);
    return;
  }
  const satRow = satRows.find((x) => Number(x.id) === Number(satId));
  if (satRow && satRow.codigo) {
    const maj = majorKey(satRow.codigo);
    if (majEl) majEl.value = maj;
    populateSatMinors(maj, Number(satId));
  } else {
    if (majEl) majEl.value = "";
    populateSatMinors("", null);
  }
}

async function saveAccount() {
  const errEl = $("#account-form-error");
  const payload = {
    num_cta: $("#acc-num-cta")?.value?.trim() || "",
    descripcion: $("#acc-desc")?.value?.trim() || "",
    sub_cta_de: $("#acc-sub")?.value?.trim() || "",
    nivel: Number($("#acc-nivel")?.value) === 2 ? 2 : 1,
    natur: $("#acc-natur")?.value || "D",
    sat_codigo_agrupador_id: $("#acc-sat-minor")?.value
      ? Number($("#acc-sat-minor").value)
      : null,
  };
  if (!payload.sub_cta_de) payload.sub_cta_de = null;

  const btn = $("#btn-account-save");
  if (btn) btn.disabled = true;
  try {
    if (editingId != null) {
      const { num_cta: _n, ...patch } = payload;
      const res = await apiFetch(`/api/catalog/accounts/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await ensureAuthed(res);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || "Error al guardar");
    } else {
      const res = await apiFetch("/api/catalog/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await ensureAuthed(res);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || "Error al crear");
    }
    closeModal();
    clearForm();
    await loadChart();
    showAlert("Cuenta guardada.", "success");
  } catch (e) {
    if (errEl && e.message !== "Sesión expirada.") {
      errEl.textContent = e.message || "Error";
      errEl.hidden = false;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deactivateAccount(id) {
  if (!confirm("¿Desactivar esta cuenta? No aparecerá en listados de captura.")) return;
  try {
    const res = await apiFetch(`/api/catalog/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: false }),
    });
    await ensureAuthed(res);
    const j = await res.json();
    if (!res.ok) throw new Error(j.message || "Error");
    await loadChart();
    showAlert("Cuenta desactivada.", "success");
  } catch (e) {
    if (e.message !== "Sesión expirada.") showAlert(e.message || "Error");
  }
}

function wireUi() {
  document.querySelector(".catalogo-panel--sat .table-wrap")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.catalogo-sat-data");
    if (!tr?.dataset?.satId) return;
    const id = Number(tr.dataset.satId);
    if (!Number.isFinite(id)) return;
    toggleSatRubroFilter(id);
  });

  $("#sat-search")?.addEventListener("input", (e) => {
    satQ = e.target.value;
    renderSat();
  });
  $("#chart-search")?.addEventListener("input", (e) => {
    chartQ = e.target.value;
    renderChart();
  });

  $("#btn-new-account")?.addEventListener("click", () => {
    clearForm();
    populateSatMajors();
    openModal(false);
  });

  $("#acc-sat-major")?.addEventListener("change", () => {
    const m = $("#acc-sat-major")?.value?.trim() || "";
    populateSatMinors(m, null);
  });

  $("#btn-account-cancel")?.addEventListener("click", () => {
    closeModal();
    clearForm();
  });

  $("#btn-account-save")?.addEventListener("click", () => void saveAccount());

  $("#modal-account")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-account") {
      closeModal();
      clearForm();
    }
  });

  $("#chart-tbody")?.addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(ed.getAttribute("data-edit"));
      const r = chartRows.find((x) => Number(x.id) === id);
      if (r) {
        fillFormFromRow(r);
        openModal(true);
      }
      return;
    }
    const de = e.target.closest("[data-deactivate]");
    if (de) {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(de.getAttribute("data-deactivate"));
      void deactivateAccount(id);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = $("#modal-account");
    if (m && !m.hidden) {
      closeModal();
      clearForm();
    }
  });

  $("#btn-logout")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignorar */
    }
    window.location.href = "/login.html";
  });
}

async function boot() {
  let me;
  try {
    me = await apiFetch("/api/auth/me");
  } catch {
    showAlert("Error de red. No se pudo comprobar la sesión.");
    return;
  }
  let j;
  try {
    j = await parseJsonResponse(me);
  } catch (e) {
    showAlert(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!j.success || !j.user) {
    window.location.href = "/login.html";
    return;
  }
  let fiscalYear = j.fiscalYear;
  if (fiscalYear == null) {
    fiscalYear = await ensureFiscalYear();
    if (fiscalYear == null) return;
  }
  const el = document.getElementById("session-user");
  if (el) el.textContent = j.user.username;
  injectFiscalSidebar(fiscalYear, async () => {
    await loadSat();
    await loadChart();
  });
  wireUi();
  initMobileNav();
  await loadSat();
  await loadChart();
}

boot();
