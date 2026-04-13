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

function lineTotals(lines) {
  const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

let polizas = [];
let filterType = "all";
let searchQ = "";

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
    ...(p.lines || []).map((l) => `${l.accountCode} ${l.accountName}`),
  ]
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function renderTable() {
  const tbody = $("#polizas-tbody");
  const rows = polizas.filter(matches);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="data-table__empty">No hay pólizas que coincidan.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((p) => {
      const { debit, credit } = lineTotals(p.lines || []);
      return `
      <tr data-id="${escapeAttr(p.id)}">
        <td><strong>${escapeHtml(p.folio)}</strong></td>
        <td>${escapeHtml(p.date)}</td>
        <td><span class="badge badge--neutral">${escapeHtml(p.type)}</span></td>
        <td class="concept-cell" title="${escapeAttr(p.concept)}">${escapeHtml(p.concept)}</td>
        <td>${escapeHtml(sourceLabel(p.sourceRef))}</td>
        <td class="data-table__num">${formatMoney(debit)}</td>
        <td class="data-table__num">${formatMoney(credit)}</td>
        <td class="data-table__col-action">
          <button type="button" class="link-btn" data-action="view" data-id="${escapeAttr(p.id)}">Ver movimientos</button>
        </td>
      </tr>`;
    })
    .join("");
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

async function load() {
  const res = await apiFetch("/api/polizas");
  await ensureAuthed(res);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Error al cargar");
  polizas = json.data || [];
  renderTable();
}

function showAlert(msg, kind = "error") {
  const slot = $("#alert-slot");
  slot.innerHTML = msg
    ? `<div class="alert alert--${kind === "success" ? "success" : "error"}">${escapeHtml(msg)}</div>`
    : "";
}

function closeModal(name) {
  $(`#modal-${name}`).hidden = true;
}

const createLines = [];

function updateCreateTotalsBar() {
  const { debit, credit, balanced } = lineTotals(createLines);
  const bar = $("#create-totals");
  bar.className = "totals-bar" + (createLines.length >= 2 && !balanced ? " totals-bar--warn" : "");
  bar.innerHTML = `
    <span>Cargo total: <strong>${formatMoney(debit)}</strong></span>
    <span>Abono total: <strong>${formatMoney(credit)}</strong></span>
    <span>${balanced && createLines.length >= 2 ? "✓ Cuadra" : createLines.length < 2 ? "—" : "⚠ Debe cuadrar"}</span>
  `;
}

function renderCreateLines() {
  const tbody = $("#create-lines-tbody");
  if (!createLines.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="data-table__empty">Añade al menos dos líneas.</td></tr>`;
  } else {
    tbody.innerHTML = createLines
      .map(
        (line, i) => `
      <tr data-idx="${i}">
        <td><input class="line-input" type="text" data-field="accountCode" value="${escapeAttr(line.accountCode)}" placeholder="p. ej. 105.01" /></td>
        <td><input class="line-input" type="text" data-field="accountName" value="${escapeAttr(line.accountName)}" placeholder="Nombre" /></td>
        <td class="data-table__num"><input class="line-input line-input--num" type="number" step="0.01" min="0" data-field="debit" value="${line.debit || ""}" placeholder="0" /></td>
        <td class="data-table__num"><input class="line-input line-input--num" type="number" step="0.01" min="0" data-field="credit" value="${line.credit || ""}" placeholder="0" /></td>
        <td class="data-table__col-action">
          <button type="button" class="btn btn--ghost btn--sm" data-remove-line="${i}" aria-label="Quitar línea">✕</button>
        </td>
      </tr>`
      )
      .join("");
  }
  updateCreateTotalsBar();
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
    const btn = e.target.closest("[data-action=view]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const p = polizas.find((x) => x.id === id);
    if (!p) return;
    const { debit, credit, balanced } = lineTotals(p.lines || []);
    $("#modal-view-title").textContent = p.folio;
    $("#modal-view-body").innerHTML = `
    <div class="detail-meta">
      <strong>${escapeHtml(p.type)}</strong> · ${escapeHtml(p.date)}<br />
      ${escapeHtml(p.concept)}<br />
      Origen: ${escapeHtml(sourceLabel(p.sourceRef))}
    </div>
    <div class="detail-lines table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Cuenta</th>
            <th>Nombre</th>
            <th class="data-table__num">Cargo</th>
            <th class="data-table__num">Abono</th>
          </tr>
        </thead>
        <tbody>
          ${(p.lines || [])
            .map(
              (l) => `
            <tr>
              <td>${escapeHtml(l.accountCode)}</td>
              <td>${escapeHtml(l.accountName)}</td>
              <td class="data-table__num">${formatMoney(l.debit)}</td>
              <td class="data-table__num">${formatMoney(l.credit)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="detail-meta" style="margin-top:1rem">
      Totales: cargo ${formatMoney(debit)} · abono ${formatMoney(credit)}
      ${balanced ? ` · <span class="badge badge--success">Cuadra</span>` : ` · <span class="badge" style="background:var(--intimo-warning-bg);color:var(--intimo-warning)">Revisar</span>`}
    </p>
  `;
    $("#modal-view").hidden = false;
  });

  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => closeModal(el.getAttribute("data-close-modal")));
  });

  $("#modal-view").addEventListener("click", (e) => {
    if (e.target.id === "modal-view") closeModal("view");
  });

  $("#create-lines-tbody").addEventListener("input", (e) => {
    const row = e.target.closest("tr[data-idx]");
    if (!row) return;
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

  $("#create-lines-tbody").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-line]");
    if (!rm) return;
    const i = Number(rm.getAttribute("data-remove-line"));
    createLines.splice(i, 1);
    renderCreateLines();
  });

  $("#btn-add-line").addEventListener("click", () => {
    createLines.push({ accountCode: "", accountName: "", debit: 0, credit: 0 });
    renderCreateLines();
  });

  $("#btn-new-poliza").addEventListener("click", () => {
    $("#create-type").value = "DIARIO";
    $("#create-concept").value = "";
    createLines.length = 0;
    createLines.push(
      { accountCode: "", accountName: "", debit: 0, credit: 0 },
      { accountCode: "", accountName: "", debit: 0, credit: 0 }
    );
    renderCreateLines();
    showAlert("");
    $("#modal-create").hidden = false;
  });

  $("#modal-create").addEventListener("click", (e) => {
    if (e.target.id === "modal-create") closeModal("create");
  });

  $("#btn-save-poliza").addEventListener("click", async () => {
    const type = $("#create-type").value;
    const concept = $("#create-concept").value.trim();
    const lines = createLines.map((l) => ({
      accountCode: l.accountCode.trim(),
      accountName: l.accountName.trim(),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    }));
    const validLines = lines.filter((l) => l.accountCode && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) {
      showAlert("Completa al menos dos líneas con cuenta y un cargo o abono.");
      return;
    }
    if (!concept) {
      showAlert("Escribe un concepto.");
      return;
    }
    const t = lineTotals(validLines);
    if (!t.balanced) {
      showAlert("Los totales de cargo y abono deben coincidir.");
      return;
    }
    $("#btn-save-poliza").disabled = true;
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
      renderTable();
      closeModal("create");
      showAlert("Póliza guardada (persistencia cifrada en disco).", "success");
    } catch (err) {
      if (err.message !== "Sesión expirada.") showAlert(err.message || "Error");
    } finally {
      $("#btn-save-poliza").disabled = false;
    }
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
