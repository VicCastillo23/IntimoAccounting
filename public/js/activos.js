import { initAuthShell } from "./auth-shell.js";

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let activosSearchTimer = 0;
/** @type {Array<Record<string, unknown>>} */
let lastActivosRows = [];
/** @type {string | null} */
let editingActivosId = null;

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function showAlert(msg, kind = "error") {
  const el = $("#activos-alert");
  if (!el) return;
  el.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

function fmtMoney(n) {
  if (n == null || n === "") return "—";
  return money.format(Number(n) || 0);
}

function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return String(v);
}

function fmtCostInput(n) {
  if (n == null || n === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return String(v);
}

function openActivosModal(isEdit) {
  const backdrop = $("#modal-activos");
  if (!backdrop) return;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
  const title = $("#modal-activos-title");
  if (title) title.textContent = isEdit ? "Editar activo" : "Nuevo activo";
  document.querySelector("#modal-activos .modal")?.focus();
}

function closeActivosModal() {
  const backdrop = $("#modal-activos");
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
  editingActivosId = null;
  const err = $("#activos-form-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function clearActivosForm() {
  editingActivosId = null;
  const idEl = $("#activos-form-id");
  if (idEl) idEl.value = "";
  const map = [
    ["activos-form-category", ""],
    ["activos-form-name", ""],
    ["activos-form-sku", ""],
    ["activos-form-quantity", "1"],
    ["activos-form-unit", ""],
    ["activos-form-location", ""],
    ["activos-form-state", ""],
    ["activos-form-date", ""],
    ["activos-form-cost", ""],
    ["activos-form-notes", ""],
  ];
  for (const [id, val] of map) {
    const el = $(`#${id}`);
    if (el) el.value = val;
  }
}

/**
 * @param {Record<string, unknown>} r
 */
function fillActivosFormFromRow(r) {
  editingActivosId = r.id != null ? String(r.id) : null;
  const idEl = $("#activos-form-id");
  if (idEl) idEl.value = editingActivosId || "";
  const set = (id, v) => {
    const el = $(`#${id}`);
    if (el) el.value = v;
  };
  set("activos-form-category", String(r.category ?? ""));
  const nm = String(r.name ?? "");
  set("activos-form-name", nm === "—" ? "" : nm);
  set("activos-form-sku", String(r.sku ?? ""));
  set("activos-form-quantity", fmtQty(r.quantity));
  set("activos-form-unit", String(r.unit ?? ""));
  set("activos-form-location", String(r.location ?? ""));
  set("activos-form-state", String(r.state_condition ?? ""));
  const ad = r.acquisition_date;
  set("activos-form-date", ad && String(ad).trim() ? String(ad).slice(0, 10) : "");
  set("activos-form-cost", fmtCostInput(r.cost_estimate));
  set("activos-form-notes", String(r.notes ?? ""));
}

function collectActivosPayload() {
  const val = (id) => $(`#${id}`)?.value?.trim() ?? "";
  const qtyRaw = $("#activos-form-quantity")?.value;
  const qty = qtyRaw === "" || qtyRaw == null ? 1 : Number(qtyRaw);
  return {
    category: val("activos-form-category"),
    name: val("activos-form-name"),
    sku: val("activos-form-sku"),
    quantity: Number.isFinite(qty) && qty >= 0 ? qty : 1,
    unit: val("activos-form-unit"),
    location: val("activos-form-location"),
    state_condition: val("activos-form-state"),
    acquisition_date: val("activos-form-date") || null,
    cost_estimate: val("activos-form-cost") === "" ? null : val("activos-form-cost"),
    notes: $("#activos-form-notes")?.value?.trim() ?? "",
  };
}

async function saveActivosModal() {
  const errEl = $("#activos-form-error");
  const btn = $("#btn-activos-modal-save");
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  const payload = collectActivosPayload();
  if (btn) btn.disabled = true;
  try {
    const isEdit = Boolean(editingActivosId);
    const url = isEdit ? `/api/activos/${encodeURIComponent(editingActivosId)}` : "/api/activos";
    const res = await fetch(url, {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }
    const j = await res.json();
    if (!res.ok || !j.success) {
      throw new Error(j.message || "No se pudo guardar.");
    }
    closeActivosModal();
    clearActivosForm();
    await loadList();
    showAlert(isEdit ? "Activo actualizado." : "Activo registrado.", "success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (errEl) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadList() {
  const q = $("#activos-q")?.value?.trim() || "";
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  qs.set("limit", "1000");
  const res = await fetch(`/api/activos?${qs}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  const j = await res.json();
  const tbody = $("#activos-tbody");
  if (!tbody) return;
  if (!res.ok || !j.success) {
    showAlert(j.message || "No se pudo cargar el inventario.");
    tbody.innerHTML = `<tr><td colspan="10" class="data-table__empty">—</td></tr>`;
    lastActivosRows = [];
    return;
  }
  showAlert("");
  const rows = Array.isArray(j.data) ? j.data : [];
  lastActivosRows = rows;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="data-table__empty">Sin registros. Importa un Excel, agrega manualmente o revisa la búsqueda.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.category || "—")}</td>
      <td>${escapeHtml(r.name || "—")}</td>
      <td>${escapeHtml(r.sku || "—")}</td>
      <td class="report-num">${escapeHtml(fmtQty(r.quantity))}</td>
      <td>${escapeHtml(r.unit || "—")}</td>
      <td>${escapeHtml(r.location || "—")}</td>
      <td>${escapeHtml(r.state_condition || "—")}</td>
      <td>${escapeHtml(r.acquisition_date || "—")}</td>
      <td class="report-num">${escapeHtml(fmtMoney(r.cost_estimate))}</td>
      <td class="activos-actions">
        <button type="button" class="btn btn--ghost btn--sm activos-btn-edit" data-activos-edit="${escapeHtml(String(r.id))}" aria-label="Editar fila">
          <span class="material-symbols-outlined" aria-hidden="true">edit</span>
        </button>
      </td>
    </tr>`
    )
    .join("");
}

async function doImport() {
  const input = $("#activos-file");
  const file = input?.files?.[0];
  if (!file) {
    showAlert("Selecciona un archivo Excel.");
    return;
  }
  showAlert("");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/activos/import", {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showAlert(j.message || "Error al importar.");
    return;
  }
  const n = j.data?.inserted ?? 0;
  showAlert(`Importación correcta: ${n} renglón(es) guardados. Lote: ${j.data?.importBatchId || "—"}.`, "success");
  input.value = "";
  $("#activos-file-name").textContent = "";
  $("#btn-activos-import").disabled = true;
  await loadList();
}

async function boot() {
  const session = await initAuthShell();
  if (!session) return;

  const fileInput = $("#activos-file");
  const btnImport = $("#btn-activos-import");
  const nameEl = $("#activos-file-name");

  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (nameEl) nameEl.textContent = f ? f.name : "";
    if (btnImport) btnImport.disabled = !f;
  });

  btnImport?.addEventListener("click", () => void doImport());
  $("#btn-activos-reload")?.addEventListener("click", () => void loadList());
  $("#activos-q")?.addEventListener("input", () => {
    window.clearTimeout(activosSearchTimer);
    activosSearchTimer = window.setTimeout(() => void loadList(), 280);
  });

  $("#btn-activos-add")?.addEventListener("click", () => {
    clearActivosForm();
    openActivosModal(false);
  });

  $("#btn-activos-modal-cancel")?.addEventListener("click", () => {
    closeActivosModal();
    clearActivosForm();
  });

  $("#btn-activos-modal-save")?.addEventListener("click", () => void saveActivosModal());

  $("#modal-activos")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-activos") {
      closeActivosModal();
      clearActivosForm();
    }
  });

  $("#activos-tbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-activos-edit]");
    if (!btn) return;
    e.preventDefault();
    const idStr = btn.getAttribute("data-activos-edit");
    if (!idStr) return;
    const row = lastActivosRows.find((x) => String(x.id) === idStr);
    if (!row) return;
    fillActivosFormFromRow(row);
    openActivosModal(true);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = $("#modal-activos");
    if (m && !m.hidden) {
      closeActivosModal();
      clearActivosForm();
    }
  });

  await loadList();
}

boot();
