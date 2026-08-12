import { initAuthShell } from "./auth-shell.js";

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Quita ceros de más: "50.0000" → "50", "12.5000" → "12.5" */
function fmtNumber(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(n);
}

let searchTimer = 0;
/** @type {string | null} null = alta nueva */
let editingProductId = null;
/** @type {Array<Record<string, unknown>>} */
let lastRows = [];
/** @type {Array<Record<string, unknown>>} */
let leafCategories = [];

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function showAlert(msg, kind = "error") {
  const el = $("#carta-alert");
  if (!el) return;
  el.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Sesión expirada");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    throw new Error(j.message || `Error ${res.status}`);
  }
  return j;
}

function fillCategorySelects() {
  const filter = $("#carta-category");
  const form = $("#carta-form-category");
  const opts = leafCategories
    .map((c) => `<option value="${escapeHtml(String(c.id))}">${escapeHtml(String(c.name))}</option>`)
    .join("");
  if (filter) {
    const cur = filter.value;
    filter.innerHTML = `<option value="">Todas</option>${opts}`;
    filter.value = cur;
  }
  if (form) form.innerHTML = opts;
}

async function loadCategories() {
  const j = await apiFetch("/api/catalog/categories?activeOnly=1");
  const all = Array.isArray(j.data) ? j.data : [];
  leafCategories = all.filter((c) => c.parentCategoryId);
  fillCategorySelects();
}

async function loadStats() {
  const el = $("#carta-stats");
  if (!el) return;
  try {
    const j = await apiFetch("/api/catalog/stats");
    const s = j.data || {};
    const last = s.last_product_update ? new Date(s.last_product_update).toLocaleString("es-MX") : "—";
    el.innerHTML = `<p class="carta-stats-line">
      <strong>${s.products ?? 0}</strong> productos activos ·
      <strong>${s.categories ?? 0}</strong> categorías ·
      <strong>${s.modifiers ?? 0}</strong> modificadores ·
      Última actualización: ${escapeHtml(last)}
    </p>`;
  } catch (e) {
    el.innerHTML = `<p class="carta-stats-line">${escapeHtml(e instanceof Error ? e.message : "Sin estadísticas")}</p>`;
  }
}

async function loadProducts() {
  const q = $("#carta-q")?.value?.trim() || "";
  const categoryId = $("#carta-category")?.value || "";
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (categoryId) qs.set("categoryId", categoryId);
  qs.set("limit", "500");

  const tbody = $("#carta-tbody");
  try {
    const j = await apiFetch(`/api/catalog/products?${qs}`);
    const rows = Array.isArray(j.data) ? j.data : [];
    lastRows = rows;
    showAlert("");
    if (!rows.length) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="data-table__empty">Sin productos. Ejecuta la carga inicial del catálogo en el servidor.</td></tr>`;
      }
      return;
    }
    if (tbody) {
      tbody.innerHTML = rows
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.categoryName || r.categoryId || "—")}</td>
          <td>${escapeHtml(r.name || "—")}${r.description ? `<br><small class="text-muted">${escapeHtml(r.description)}</small>` : ""}</td>
          <td class="report-num">${escapeHtml(money.format(Number(r.price) || 0))}</td>
          <td class="report-num">${escapeHtml(r.taxRatePercent ?? "—")}</td>
          <td>${r.isActive ? '<span class="badge badge--ok">Activo</span>' : '<span class="badge">Inactivo</span>'}</td>
          <td class="activos-actions">
            <button type="button" class="btn btn--ghost btn--sm" data-carta-edit="${escapeHtml(String(r.id))}" aria-label="Editar">
              <span class="material-symbols-outlined" aria-hidden="true">edit</span>
            </button>
          </td>
        </tr>`
        )
        .join("");
    }
  } catch (e) {
    showAlert(e instanceof Error ? e.message : "Error al cargar productos");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="data-table__empty">—</td></tr>`;
  }
}

function openModal(isCreate) {
  const backdrop = $("#modal-carta");
  const title = $("#modal-carta-title");
  const subtitle = $("#modal-carta-subtitle");
  if (title) title.textContent = isCreate ? "Nuevo producto" : "Editar producto";
  if (subtitle) {
    subtitle.textContent = isCreate
      ? "Se agregará a la carta; la tablet lo verá al sincronizar"
      : "Los cambios se reflejan en la tablet al sincronizar";
  }
  if (!backdrop) return;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const backdrop = $("#modal-carta");
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
  editingProductId = null;
  $("#carta-form-id").value = "";
  const err = $("#carta-form-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function openCreateForm() {
  editingProductId = null;
  $("#carta-form-id").value = "";
  $("#carta-form-name").value = "";
  $("#carta-form-price").value = "";
  $("#carta-form-tax").value = "16";
  $("#carta-form-desc").value = "";
  const filterCat = $("#carta-category")?.value;
  $("#carta-form-category").value =
    filterCat || (leafCategories[0] ? String(leafCategories[0].id) : "");
  $("#carta-form-active").checked = true;
  openModal(true);
}

function fillForm(row) {
  editingProductId = String(row.id ?? "");
  $("#carta-form-id").value = editingProductId;
  $("#carta-form-name").value = String(row.name ?? "");
  $("#carta-form-price").value = fmtNumber(row.price);
  $("#carta-form-tax").value = row.taxRatePercent != null ? fmtNumber(row.taxRatePercent) : "16";
  $("#carta-form-desc").value = row.description ? String(row.description) : "";
  $("#carta-form-category").value = String(row.categoryId ?? "");
  $("#carta-form-active").checked = row.isActive !== false;
  openModal(false);
}

async function saveProduct() {
  const name = $("#carta-form-name")?.value?.trim();
  const price = $("#carta-form-price")?.value?.trim();
  const categoryId = $("#carta-form-category")?.value?.trim();
  const errEl = $("#carta-form-error");
  const btn = $("#btn-carta-modal-save");
  if (!name || !price) {
    if (errEl) {
      errEl.textContent = "Nombre y precio son obligatorios.";
      errEl.hidden = false;
    }
    return;
  }
  if (!categoryId) {
    if (errEl) {
      errEl.textContent = "Elige una categoría.";
      errEl.hidden = false;
    }
    return;
  }
  const payload = {
    name,
    price: Number(price),
    taxRatePercent: $("#carta-form-tax")?.value?.trim() || "16",
    description: $("#carta-form-desc")?.value?.trim() || null,
    categoryId,
    isActive: $("#carta-form-active")?.checked ?? true,
  };
  if (btn) btn.disabled = true;
  try {
    if (editingProductId) {
      await apiFetch(`/api/catalog/products/${encodeURIComponent(editingProductId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeModal();
      showAlert("Producto actualizado. La tablet lo verá al sincronizar.", "success");
    } else {
      await apiFetch("/api/catalog/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeModal();
      showAlert("Producto creado. La tablet lo verá al sincronizar.", "success");
    }
    await Promise.all([loadProducts(), loadStats()]);
  } catch (e) {
    if (errEl) {
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function createCategoryFromName(rawName, { errEl, nameInput, selectAfter = true } = {}) {
  const name = String(rawName || "").trim();
  if (!name) {
    if (errEl) {
      errEl.textContent = "Escribe un nombre para la categoría.";
      errEl.hidden = false;
    }
    return null;
  }
  const j = await apiFetch("/api/catalog/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const row = j.data;
  await Promise.all([loadCategories(), loadStats()]);
  if (selectAfter && row?.id) {
    const form = $("#carta-form-category");
    if (form) form.value = String(row.id);
    const filter = $("#carta-category");
    if (filter) filter.value = String(row.id);
  }
  if (nameInput) nameInput.value = "";
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  return row;
}

async function saveInlineCategory() {
  const errEl = $("#carta-form-error");
  const btn = $("#btn-carta-create-category");
  if (btn) btn.disabled = true;
  try {
    const row = await createCategoryFromName($("#carta-new-category-name")?.value, {
      errEl,
      nameInput: $("#carta-new-category-name"),
      selectAfter: true,
    });
    if (row) showAlert(`Categoría «${row.name}» creada.`, "success");
  } catch (e) {
    if (errEl) {
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openCategoryModal() {
  const backdrop = $("#modal-carta-category");
  const err = $("#carta-category-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  const input = $("#carta-category-name");
  if (input) input.value = "";
  if (!backdrop) return;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
  input?.focus();
}

function closeCategoryModal() {
  const backdrop = $("#modal-carta-category");
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
}

async function saveCategoryModal() {
  const errEl = $("#carta-category-error");
  const btn = $("#btn-carta-category-save");
  if (btn) btn.disabled = true;
  try {
    const row = await createCategoryFromName($("#carta-category-name")?.value, {
      errEl,
      nameInput: $("#carta-category-name"),
      selectAfter: true,
    });
    if (!row) return;
    closeCategoryModal();
    showAlert(`Categoría «${row.name}» creada. Ya puedes usarla en productos.`, "success");
    await loadProducts();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function boot() {
  const session = await initAuthShell();
  if (!session) return;

  $("#btn-carta-reload")?.addEventListener("click", () => {
    void Promise.all([loadProducts(), loadStats(), loadCategories()]);
  });
  $("#btn-carta-add")?.addEventListener("click", openCreateForm);
  $("#btn-carta-add-category")?.addEventListener("click", openCategoryModal);
  $("#btn-carta-create-category")?.addEventListener("click", () => void saveInlineCategory());
  $("#btn-carta-category-save")?.addEventListener("click", () => void saveCategoryModal());
  $("#btn-carta-category-cancel")?.addEventListener("click", closeCategoryModal);
  $("#carta-new-category-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveInlineCategory();
    }
  });
  $("#carta-category-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveCategoryModal();
    }
  });
  $("#carta-q")?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void loadProducts(), 280);
  });
  $("#carta-category")?.addEventListener("change", () => void loadProducts());
  $("#btn-carta-modal-cancel")?.addEventListener("click", closeModal);
  $("#btn-carta-modal-save")?.addEventListener("click", () => void saveProduct());
  $("#modal-carta")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-carta") closeModal();
  });
  $("#modal-carta-category")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-carta-category") closeCategoryModal();
  });
  $("#carta-tbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-carta-edit]");
    if (!btn) return;
    const idStr = btn.getAttribute("data-carta-edit");
    const row = lastRows.find((x) => String(x.id) === idStr);
    if (!row) return;
    fillForm(row);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("#modal-carta-category") && !$("#modal-carta-category").hidden) {
      closeCategoryModal();
      return;
    }
    if ($("#modal-carta") && !$("#modal-carta").hidden) closeModal();
  });

  await loadCategories();
  await Promise.all([loadStats(), loadProducts()]);
}

boot();
