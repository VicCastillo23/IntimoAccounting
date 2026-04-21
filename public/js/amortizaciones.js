import { initAuthShell } from "./auth-shell.js";

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let deprecSearchTimer = 0;
/** @type {Array<Record<string, unknown>>} */
let lastDeprecRows = [];
/** @type {Array<Record<string, unknown>>} */
let activosInventory = [];
/** @type {string | null} */
let editingDeprecId = null;
/** @type {number} */
let deprecFy = new Date().getFullYear();
/** @type {number[]} */
let deprecYearCols = [];
/** @type {number | null} */
let lastInegiFactor = null;

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * @param {number | undefined} fy
 */
function yearColumnsForFy(fy) {
  const y = Math.floor(Number(fy)) || new Date().getFullYear();
  return [y - 3, y - 2, y - 1, y];
}

/** Columnas fijas + años dinámicos + acciones (debe coincidir con thead / filas) */
function tableColCount() {
  return 17 + deprecYearCols.length;
}

function fmtLifeMonths(m) {
  if (m == null || m === "") return "—";
  const v = Number(m);
  if (!Number.isFinite(v) || v < 1) return "—";
  return String(Math.floor(v));
}

/**
 * @param {Record<string, unknown>} r
 */
function ipcSummaryCell(r) {
  let f = r.ipc_factors_by_year;
  if (typeof f === "string") {
    try {
      f = JSON.parse(f);
    } catch {
      return `<td class="deprec-ipc-summary">—</td>`;
    }
  }
  if (!f || typeof f !== "object") return `<td class="deprec-ipc-summary">—</td>`;
  const parts = Object.keys(f)
    .filter((k) => /^\d{4}$/.test(k))
    .sort()
    .map((k) => {
      const v = Number(/** @type {Record<string, unknown>} */ (f)[k]);
      if (!Number.isFinite(v) || v <= 0) return null;
      return `${k}: ${v.toLocaleString("es-MX", { maximumFractionDigits: 4 })}`;
    })
    .filter(Boolean);
  if (!parts.length) return `<td class="deprec-ipc-summary">—</td>`;
  const full = parts.join(" · ");
  const titleAttr = full.length > 40 ? ` title="${escapeHtml(full)}"` : "";
  const shown = full.length > 40 ? `${escapeHtml(full.slice(0, 37))}…` : escapeHtml(full);
  return `<td class="deprec-ipc-summary"${titleAttr}>${shown}</td>`;
}

function showAlert(msg, kind = "error") {
  const el = $("#deprec-alert");
  if (!el) return;
  el.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

function fmtMoney(n) {
  if (n == null || n === "") return "—";
  return money.format(Number(n) || 0);
}

function fmtTipo(t) {
  return t === "amortizacion" ? "Amort." : "Depr.";
}

function fmtPct(n) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v.toLocaleString("es-MX", { maximumFractionDigits: 4 })}%`;
}

/** Depreciación mensual con varios decimales (como Excel) */
function fmtMonthly(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 9 });
}

function fmtCostInput(n) {
  if (n == null || n === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return String(v);
}

function renderDeprecThead() {
  const thead = $("#deprec-thead");
  if (!thead) return;
  const ys = deprecYearCols.length ? deprecYearCols : yearColumnsForFy(deprecFy);
  const yearThs = ys
    .map(
      (y) =>
        `<th class="report-num deprec-th-year" title="Depreciación anual × factor IPC del ejercicio ${y}">${y}</th>`
    )
    .join("");
  thead.innerHTML = `
    <tr>
      <th>Id</th>
      <th>Tipo</th>
      <th class="report-num" title="Id en inventario de activos">Inv.</th>
      <th>Categoría</th>
      <th>Código</th>
      <th>Fecha adquis.</th>
      <th>Descripción</th>
      <th class="report-num">Monto orig.</th>
      <th class="report-num">Valor residual</th>
      <th class="report-num">% anual</th>
      <th class="report-num" title="Vida útil en meses (si no aplica % anual)">Vida (m)</th>
      <th class="report-num">Dep. mensual</th>
      <th class="report-num">Dep. anual</th>
      <th title="Factores IPC capturados por ejercicio">IPC</th>
      ${yearThs}
      <th class="report-num">Dep. acum.</th>
      <th class="report-num">Valor libros</th>
      <th class="deprec-th-actions">Acciones</th>
    </tr>`;
}

function populateInegiApplyYearSelect() {
  const sel = $("#inegi-apply-year");
  if (!sel) return;
  const ys = deprecYearCols.length ? deprecYearCols : yearColumnsForFy(deprecFy);
  const preserved = sel.value;
  sel.innerHTML = ys.map((y) => `<option value="${y}">${y}</option>`).join("");
  if (preserved && ys.includes(Number(preserved))) sel.value = preserved;
  else if (ys.length) sel.value = String(ys[ys.length - 1]);
}

function ensureInegiMonthDefaults() {
  const from = $("#inegi-from");
  const to = $("#inegi-to");
  if (from && !from.value) {
    from.value = `${deprecFy - 1}-01`;
  }
  if (to && !to.value) {
    to.value = `${deprecFy}-01`;
  }
}

function fmtInegiNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function renderDeprecIpcInputs() {
  const wrap = $("#deprec-ipc-inputs");
  if (!wrap) return;
  const ys = deprecYearCols.length ? deprecYearCols : yearColumnsForFy(deprecFy);
  wrap.innerHTML = ys
    .map(
      (y) => `
    <label class="field" style="margin:0">
      <span class="field__label">IPC ${y}</span>
      <input class="field__input" type="text" inputmode="decimal" id="deprec-ipc-${y}" placeholder="1" autocomplete="off" />
    </label>`
    )
    .join("");
}

function updateInegiApplyButtonState() {
  const btn = $("#btn-inegi-apply");
  const modal = $("#modal-deprec");
  if (!btn) return;
  const modalOpen = Boolean(modal && !modal.hidden);
  const hasFactor = lastInegiFactor != null && Number.isFinite(lastInegiFactor);
  btn.disabled = !modalOpen || !hasFactor;
}

function toggleInegiPanel() {
  const panel = $("#inegi-panel-wrap");
  const btn = $("#btn-inegi-toggle");
  if (!panel || !btn) return;
  const opening = panel.hidden;
  panel.hidden = !opening;
  btn.setAttribute("aria-expanded", opening ? "true" : "false");
  if (opening) {
    ensureInegiMonthDefaults();
    populateInegiApplyYearSelect();
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function runInegiCalc() {
  const from = $("#inegi-from")?.value?.trim();
  const to = $("#inegi-to")?.value?.trim();
  const resEl = $("#inegi-result");
  const wrap = $("#inegi-apply-wrap");
  lastInegiFactor = null;
  updateInegiApplyButtonState();
  if (!from || !to) {
    if (resEl) {
      resEl.className = "deprec-inegi-result deprec-inegi-result--err";
      resEl.textContent = "Elige ambos meses (INPC inicio y fin).";
    }
    if (wrap) wrap.hidden = true;
    updateInegiApplyButtonState();
    return;
  }
  if (resEl) {
    resEl.className = "deprec-inegi-result";
    resEl.textContent = "Consultando INEGI…";
  }
  if (wrap) wrap.hidden = true;
  try {
    const res = await fetch(
      `/api/inpc/factor?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { credentials: "include" }
    );
    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }
    const j = await res.json();
    if (!res.ok || !j.success) {
      throw new Error(j.message || "No se pudo calcular el factor.");
    }
    const d = j.data;
    lastInegiFactor = typeof d.factor === "number" ? d.factor : Number(d.factor);
    if (resEl) {
      resEl.className = "deprec-inegi-result deprec-inegi-result--ok";
      resEl.innerHTML = `INPC inicio (${escapeHtml(d.periodoInicio)}): <strong>${fmtInegiNum(d.inpcInicio)}</strong> · INPC fin (${escapeHtml(d.periodoFin)}): <strong>${fmtInegiNum(d.inpcFin)}</strong> · <strong>Factor:</strong> ${escapeHtml(String(d.factor))}`;
    }
    if (wrap) wrap.hidden = false;
    populateInegiApplyYearSelect();
    updateInegiApplyButtonState();
  } catch (e) {
    if (wrap) wrap.hidden = true;
    if (resEl) {
      resEl.className = "deprec-inegi-result deprec-inegi-result--err";
      resEl.textContent = e instanceof Error ? e.message : String(e);
    }
    updateInegiApplyButtonState();
  }
}

function applyInegiFactorToIpcField() {
  if (lastInegiFactor == null || !Number.isFinite(lastInegiFactor)) return;
  const y = $("#inegi-apply-year")?.value;
  if (!y) return;
  const inp = $(`#deprec-ipc-${y}`);
  if (inp) {
    inp.value = String(lastInegiFactor);
    return;
  }
  showAlert("Abre «Nuevo registro» o «Editar» una fila para que existan los campos IPC del año y vuelve a pulsar «Poner en campo IPC».");
}

async function refreshFiscalYear() {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  const j = await r.json();
  if (j.success && j.fiscalYear != null) deprecFy = Number(j.fiscalYear);
  deprecYearCols = yearColumnsForFy(deprecFy);
  renderDeprecThead();
  renderDeprecIpcInputs();
  populateInegiApplyYearSelect();
}

async function loadActivosForSelect() {
  const res = await fetch("/api/activos?limit=1000", { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  const j = await res.json();
  if (!res.ok || !j.success) {
    activosInventory = [];
    return;
  }
  activosInventory = Array.isArray(j.data) ? j.data : [];
  const sel = $("#deprec-form-asset");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Sin vincular —</option>';
  for (const a of activosInventory) {
    const id = String(a.id);
    const label = [a.category, a.name, a.sku].filter(Boolean).join(" · ") || `Id ${id}`;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label.length > 120 ? `${label.slice(0, 117)}…` : label;
    sel.appendChild(opt);
  }
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function applyAssetFromInventory(assetIdStr) {
  if (!assetIdStr) return;
  const a = activosInventory.find((x) => String(x.id) === assetIdStr);
  if (!a) return;
  const nm = String(a.name ?? "").trim();
  const set = (id, v) => {
    const el = $(`#${id}`);
    if (el) el.value = v;
  };
  set("deprec-form-category", String(a.category ?? ""));
  set("deprec-form-name", nm === "—" ? "" : nm);
  set("deprec-form-sku", String(a.sku ?? ""));
  const ad = a.acquisition_date;
  set("deprec-form-date", ad && String(ad).trim() ? String(ad).slice(0, 10) : "");
  set("deprec-form-cost", fmtCostInput(a.cost_estimate));
}

function openDeprecModal() {
  const backdrop = $("#modal-deprec");
  if (!backdrop) return;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
  const title = $("#modal-deprec-title");
  if (title) title.textContent = editingDeprecId ? "Editar registro" : "Nuevo registro";
  document.querySelector("#modal-deprec .modal")?.focus();
  updateInegiApplyButtonState();
}

function closeDeprecModal() {
  const backdrop = $("#modal-deprec");
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
  editingDeprecId = null;
  const err = $("#deprec-form-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  updateInegiApplyButtonState();
}

function clearDeprecForm() {
  editingDeprecId = null;
  const idEl = $("#deprec-form-id");
  if (idEl) idEl.value = "";
  const tipo = $("#deprec-form-tipo");
  if (tipo) tipo.value = "depreciacion";
  const asset = $("#deprec-form-asset");
  if (asset) asset.value = "";
  const set = (id, v) => {
    const el = $(`#${id}`);
    if (el) el.value = v;
  };
  set("deprec-form-name", "");
  set("deprec-form-category", "");
  set("deprec-form-sku", "");
  set("deprec-form-date", "");
  set("deprec-form-cost", "");
  set("deprec-form-residual", "0");
  set("deprec-form-pct", "10");
  set("deprec-form-months", "");
  set("deprec-form-accum", "0");
  set("deprec-form-notes", "");
  renderDeprecIpcInputs();
}

/**
 * @param {Record<string, unknown>} r
 */
function fillDeprecFormFromRow(r) {
  editingDeprecId = r.id != null ? String(r.id) : null;
  renderDeprecIpcInputs();
  const idEl = $("#deprec-form-id");
  if (idEl) idEl.value = editingDeprecId || "";
  const tipo = $("#deprec-form-tipo");
  if (tipo) tipo.value = r.tipo === "amortizacion" ? "amortizacion" : "depreciacion";
  const aid = r.asset_inventory_id;
  const asset = $("#deprec-form-asset");
  if (asset) asset.value = aid != null && aid !== "" ? String(aid) : "";
  const set = (id, v) => {
    const el = $(`#${id}`);
    if (el) el.value = v;
  };
  set("deprec-form-name", String(r.name ?? ""));
  set("deprec-form-category", String(r.category ?? ""));
  set("deprec-form-sku", String(r.sku ?? ""));
  const ad = r.acquisition_date;
  set("deprec-form-date", ad && String(ad).trim() ? String(ad).slice(0, 10) : "");
  set("deprec-form-cost", fmtCostInput(r.cost_original));
  set("deprec-form-residual", fmtCostInput(r.residual_value) || "0");
  const pct = r.annual_depreciation_pct;
  set("deprec-form-pct", pct != null && pct !== "" ? String(pct) : "");
  const mo = r.useful_life_months;
  set("deprec-form-months", mo != null && Number(mo) > 0 ? String(mo) : "");
  set("deprec-form-accum", fmtCostInput(r.accumulated_booked) || "0");
  set("deprec-form-notes", String(r.notes ?? ""));

  let factors = r.ipc_factors_by_year;
  if (typeof factors === "string") {
    try {
      factors = JSON.parse(factors);
    } catch {
      factors = {};
    }
  }
  if (!factors || typeof factors !== "object") factors = {};
  for (const y of deprecYearCols) {
    const inp = $(`#deprec-ipc-${y}`);
    if (inp) {
      const v = factors[String(y)];
      inp.value = v != null && v !== "" && Number(v) !== 1 ? String(v) : "";
    }
  }
}

function collectIpcPayload() {
  /** @type {Record<string, number>} */
  const o = {};
  for (const y of deprecYearCols) {
    const raw = $(`#deprec-ipc-${y}`)?.value?.trim() ?? "";
    if (raw === "") continue;
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n > 0) o[String(y)] = n;
  }
  return o;
}

function collectDeprecPayload() {
  const val = (id) => $(`#${id}`)?.value?.trim() ?? "";
  const assetVal = $("#deprec-form-asset")?.value?.trim() ?? "";
  const monthsRaw = $("#deprec-form-months")?.value?.trim();
  const months =
    monthsRaw === "" || monthsRaw == null ? null : Number(monthsRaw);
  return {
    tipo: $("#deprec-form-tipo")?.value || "depreciacion",
    asset_inventory_id: assetVal === "" ? null : assetVal,
    name: val("deprec-form-name"),
    category: val("deprec-form-category"),
    sku: val("deprec-form-sku"),
    acquisition_date: val("deprec-form-date") || null,
    cost_original: val("deprec-form-cost"),
    residual_value: val("deprec-form-residual") === "" ? "0" : val("deprec-form-residual"),
    annual_depreciation_pct: val("deprec-form-pct") === "" ? null : val("deprec-form-pct"),
    useful_life_months:
      months != null && Number.isFinite(months) && months >= 1 ? months : null,
    accumulated_booked: val("deprec-form-accum") === "" ? "0" : val("deprec-form-accum"),
    notes: $("#deprec-form-notes")?.value?.trim() ?? "",
    ipc_factors_by_year: collectIpcPayload(),
  };
}

async function saveDeprecModal() {
  const errEl = $("#deprec-form-error");
  const btn = $("#btn-deprec-modal-save");
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  const payload = collectDeprecPayload();
  if (btn) btn.disabled = true;
  try {
    const isEdit = Boolean(editingDeprecId);
    const url = isEdit ? `/api/depreciaciones/${encodeURIComponent(editingDeprecId)}` : "/api/depreciaciones";
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
    closeDeprecModal();
    clearDeprecForm();
    await loadList();
    showAlert(isEdit ? "Registro actualizado." : "Registro creado.", "success");
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

async function syncFromActivos() {
  const btn = $("#btn-deprec-sync-activos");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/depreciaciones/sync-from-activos", {
      method: "POST",
      credentials: "include",
    });
    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }
    const j = await res.json();
    if (!res.ok || !j.success) {
      throw new Error(j.message || "No se pudo sincronizar.");
    }
    const n = j.data?.inserted ?? 0;
    showAlert(
      n === 0
        ? "No hay activos nuevos con costo mayor a 0 sin renglón de depreciación (o ya estaban todos enlazados)."
        : `Se agregaron ${n} renglón(es) desde el inventario (10% anual por defecto; edítalos si hace falta).`,
      n === 0 ? "error" : "success"
    );
    await loadList();
  } catch (e) {
    showAlert(e instanceof Error ? e.message : "Error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadList() {
  const q = $("#deprec-q")?.value?.trim() || "";
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  qs.set("limit", "1000");
  qs.set("fy", String(deprecFy));
  const res = await fetch(`/api/depreciaciones?${qs}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  const j = await res.json();
  const tbody = $("#deprec-tbody");
  if (!tbody) return;
  const nc = tableColCount();
  if (Array.isArray(j.meta?.yearColumns) && j.meta.yearColumns.length) {
    deprecYearCols = j.meta.yearColumns.map((x) => Number(x));
    renderDeprecThead();
    renderDeprecIpcInputs();
    populateInegiApplyYearSelect();
  }
  if (!res.ok || !j.success) {
    showAlert(j.message || "No se pudo cargar la lista.");
    tbody.innerHTML = `<tr><td colspan="${nc}" class="data-table__empty">—</td></tr>`;
    lastDeprecRows = [];
    return;
  }
  showAlert("");
  const rows = Array.isArray(j.data) ? j.data : [];
  lastDeprecRows = rows;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${nc}" class="data-table__empty">Sin registros. Usa «Desde inventario de activos», «Nuevo registro» o revisa la búsqueda.</td></tr>`;
    return;
  }
  const ys = deprecYearCols.length ? deprecYearCols : yearColumnsForFy(deprecFy);
  tbody.innerHTML = rows
    .map((r) => {
      const byYear = /** @type {Record<string, unknown>} */ (r.depreciation_by_year || {});
      const yearTds = ys
        .map((y) => `<td class="report-num">${escapeHtml(fmtMoney(byYear[String(y)]))}</td>`)
        .join("");
      const fmtDate = (d) => {
        if (!d || String(d).trim() === "") return "—";
        const s = String(d).slice(0, 10);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? escapeHtml(`${m[3]}-${m[2]}-${m[1]}`) : escapeHtml(String(d));
      };
      const invId =
        r.asset_inventory_id != null && r.asset_inventory_id !== ""
          ? escapeHtml(String(r.asset_inventory_id))
          : "—";
      return `
    <tr>
      <td>${escapeHtml(String(r.id ?? ""))}</td>
      <td>${escapeHtml(fmtTipo(String(r.tipo ?? "")))}</td>
      <td class="report-num">${invId}</td>
      <td>${escapeHtml(r.category || "—")}</td>
      <td>${escapeHtml(r.sku || "—")}</td>
      <td>${fmtDate(r.acquisition_date)}</td>
      <td>${escapeHtml(r.name || "—")}</td>
      <td class="report-num">${escapeHtml(fmtMoney(r.cost_original))}</td>
      <td class="report-num">${escapeHtml(fmtMoney(r.residual_value))}</td>
      <td class="report-num">${escapeHtml(fmtPct(r.annual_depreciation_pct))}</td>
      <td class="report-num">${escapeHtml(fmtLifeMonths(r.useful_life_months))}</td>
      <td class="report-num">${escapeHtml(fmtMonthly(r.monthly_charge))}</td>
      <td class="report-num">${escapeHtml(fmtMoney(r.annual_depreciation))}</td>
      ${ipcSummaryCell(r)}
      ${yearTds}
      <td class="report-num">${escapeHtml(fmtMoney(r.accumulated_booked))}</td>
      <td class="report-num">${escapeHtml(fmtMoney(r.net_book_value))}</td>
      <td class="deprec-actions">
        <button type="button" class="btn btn--ghost btn--sm deprec-btn-edit" data-deprec-edit="${escapeHtml(String(r.id))}" aria-label="Editar fila">
          <span class="material-symbols-outlined" aria-hidden="true">edit</span>
        </button>
      </td>
    </tr>`;
    })
    .join("");
}

async function boot() {
  const session = await initAuthShell({
    onFiscalChange: () => {
      void (async () => {
        await refreshFiscalYear();
        await loadList();
      })();
    },
  });
  if (!session) return;

  deprecFy = session.fiscalYear ?? new Date().getFullYear();
  deprecYearCols = yearColumnsForFy(deprecFy);
  renderDeprecThead();
  renderDeprecIpcInputs();
  populateInegiApplyYearSelect();

  await loadActivosForSelect();

  $("#btn-deprec-reload")?.addEventListener("click", () => void loadList());
  $("#deprec-q")?.addEventListener("input", () => {
    window.clearTimeout(deprecSearchTimer);
    deprecSearchTimer = window.setTimeout(() => void loadList(), 280);
  });

  $("#btn-deprec-sync-activos")?.addEventListener("click", () => void syncFromActivos());

  $("#btn-deprec-add")?.addEventListener("click", async () => {
    await loadActivosForSelect();
    clearDeprecForm();
    openDeprecModal();
  });

  $("#deprec-form-asset")?.addEventListener("change", (e) => {
    const t = /** @type {HTMLSelectElement} */ (e.target);
    applyAssetFromInventory(t.value?.trim() || "");
  });

  $("#btn-deprec-modal-cancel")?.addEventListener("click", () => {
    closeDeprecModal();
    clearDeprecForm();
  });

  $("#btn-deprec-modal-save")?.addEventListener("click", () => void saveDeprecModal());

  $("#btn-inegi-toggle")?.addEventListener("click", () => toggleInegiPanel());
  $("#btn-inegi-calc")?.addEventListener("click", () => void runInegiCalc());
  $("#btn-inegi-apply")?.addEventListener("click", () => applyInegiFactorToIpcField());

  updateInegiApplyButtonState();

  $("#modal-deprec")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-deprec") {
      closeDeprecModal();
      clearDeprecForm();
    }
  });

  $("#deprec-tbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-deprec-edit]");
    if (!btn) return;
    e.preventDefault();
    const idStr = btn.getAttribute("data-deprec-edit");
    if (!idStr) return;
    const row = lastDeprecRows.find((x) => String(x.id) === idStr);
    if (!row) return;
    void loadActivosForSelect().then(() => {
      fillDeprecFormFromRow(row);
      openDeprecModal();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = $("#modal-deprec");
    if (m && !m.hidden) {
      closeDeprecModal();
      clearDeprecForm();
    }
  });

  await loadList();
}

boot();
