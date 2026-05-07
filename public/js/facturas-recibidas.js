import { initAuthShell } from "./auth-shell.js";

const $ = (s) => document.querySelector(s);
const selectedInvoiceIds = new Set();
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
      s = s.replace(/([\w:.-]+)(=)(&quot;.*?&quot;)/g, '<span class="xml-attr">$1</span><span class="xml-punc">$2</span><span class="xml-value">$3</span>');
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

function currentFilters() {
  const p = new URLSearchParams();
  const query = $("#fr-query")?.value?.trim() || "";
  const issuerRfc = $("#fr-issuer")?.value?.trim() || "";
  const status = $("#fr-status")?.value?.trim() || "";
  const from = $("#fr-from")?.value?.trim() || "";
  const to = $("#fr-to")?.value?.trim() || "";
  if (query) p.set("query", query);
  if (issuerRfc) p.set("issuerRfc", issuerRfc);
  if (status) p.set("status", status);
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  p.set("limit", "100");
  return p.toString();
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

async function loadReceivedInvoices() {
  const tbody = $("#fr-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="13">Cargando...</td></tr>`;
  try {
    const data = await api(`/api/invoices/received?${currentFilters()}`);
    const rows = Array.isArray(data.rows) ? data.rows : [];
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
  } catch (e) {
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

async function init() {
  const session = await initAuthShell();
  if (!session) return;
  wireTableActions();
  $("#fr-import-btn")?.addEventListener("click", importZip);
  $("#fr-filter-btn")?.addEventListener("click", loadReceivedInvoices);
  $("#fr-batch-pay-btn")?.addEventListener("click", () => void paySelectedInvoices());
  $("#fr-clear-btn")?.addEventListener("click", () => {
    ["#fr-query", "#fr-issuer", "#fr-status", "#fr-from", "#fr-to"].forEach((sel) => {
      const el = $(sel);
      if (el) el.value = "";
    });
    loadReceivedInvoices();
  });
  const batchDate = $("#fr-batch-date");
  if (batchDate && !batchDate.value) batchDate.value = new Date().toISOString().slice(0, 10);
  updateBatchMeta();
  await loadReceivedInvoices();
}

init().catch((e) => {
  setAlert(e instanceof Error ? e.message : "No se pudo iniciar Facturas recibidas.", false);
});
