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
let chartRows = [];
let satQ = "";
let chartQ = "";
/** @type {number | null} */
let editingId = null;

function showAlert(msg, kind = "error") {
  const slot = $("#catalog-alert");
  if (!slot) return;
  slot.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

/** Nivel de anidación: "1" → 0, "1.1" / "65.10" → 1, etc. */
function satCodigoDepth(codigo) {
  if (!codigo) return 0;
  const parts = String(codigo).trim().split(".");
  return Math.max(0, parts.length - 1);
}

function renderSat() {
  const tbody = $("#sat-tbody");
  if (!tbody) return;
  const q = satQ.trim().toLowerCase();
  const rows = satRows.filter((r) => {
    if (!q) return true;
    const c = (r.codigo || "").toLowerCase();
    const d = (r.descripcion || "").toLowerCase();
    return c.includes(q) || d.includes(q);
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
      if (r.es_seccion) {
        return `<tr class="catalogo-sat-section"><td colspan="2">${escapeHtml(r.descripcion)}</td></tr>`;
      }
      const depth = satCodigoDepth(r.codigo);
      return `<tr class="catalogo-sat-data" style="--sat-depth:${depth}">
        <td class="catalogo-cod">${escapeHtml(r.codigo || "—")}</td>
        <td class="catalogo-sat-desc">${escapeHtml(r.descripcion)}</td>
      </tr>`;
    })
    .join("");
}

function naturLabel(n) {
  return n === "A" ? "A — Acreedora" : "D — Deudora";
}

function renderChart() {
  const tbody = $("#chart-tbody");
  if (!tbody) return;
  if (!chartRows.length) {
    if (!satRows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="data-table__empty">Sin datos SAT en la base. Revisa la consola del servidor o ejecuta <code>npm run db:migrate-all</code>.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="data-table__empty">No hay cuentas de empresa. Usa <strong>Nueva cuenta</strong>.</td></tr>`;
    }
    return;
  }
  const q = chartQ.trim().toLowerCase();
  const filtered = chartRows.filter((r) => {
    if (!q) return true;
    const blob = `${r.num_cta} ${r.descripcion} ${r.codigo_agrupador || ""} ${r.desc_agrupador || ""}`.toLowerCase();
    return blob.includes(q);
  });
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="data-table__empty">Ninguna cuenta coincide con la búsqueda.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered
    .map(
      (r) => `
    <tr data-id="${r.id}" class="catalogo-chart-row">
      <td class="catalogo-cell-num"><strong>${escapeHtml(r.num_cta)}</strong></td>
      <td class="catalogo-cell-desc">${escapeHtml(r.descripcion)}</td>
      <td class="catalogo-cell-natur">${escapeHtml(naturLabel(r.natur))}</td>
      <td class="catalogo-cell-sat">${r.codigo_agrupador ? escapeHtml(`${r.codigo_agrupador} — ${r.desc_agrupador || ""}`) : "—"}</td>
      <td class="catalogo-actions">
        <button type="button" class="btn btn--text btn--sm" data-edit="${r.id}">Editar</button>
        <button type="button" class="btn btn--text btn--sm catalogo-btn-danger" data-deactivate="${r.id}">Desactivar</button>
      </td>
    </tr>`
    )
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
        return `<option value="${escapeAttr(String(r.id))}"${sel}>${escapeHtml(r.codigo)} — ${escapeHtml(r.descripcion)}</option>`;
      })
      .join("");
  if (selectedSatId != null) {
    minorSel.value = String(selectedSatId);
  }
}

async function loadSat() {
  const res = await apiFetch("/api/catalog/sat");
  await ensureAuthed(res);
  const j = await res.json();
  if (!res.ok) {
    satRows = [];
    showAlert(j.message || "No se pudo cargar el código agrupador.");
    renderSat();
    return;
  }
  showAlert("");
  satRows = j.data || [];
  renderSat();
  populateSatMajors();
  populateSatMinors($("#acc-sat-major")?.value || "", null);
}

async function loadChart() {
  const res = await apiFetch("/api/catalog/accounts");
  await ensureAuthed(res);
  const j = await res.json();
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
      const id = Number(ed.getAttribute("data-edit"));
      const r = chartRows.find((x) => x.id === id);
      if (r) {
        fillFormFromRow(r);
        openModal(true);
      }
      return;
    }
    const de = e.target.closest("[data-deactivate]");
    if (de) {
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
  await loadSat();
  await loadChart();
}

boot();
