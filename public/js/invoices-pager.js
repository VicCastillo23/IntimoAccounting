/**
 * Paginación compartida para listados de facturas (25 por página).
 * @param {{
 *   container: HTMLElement | null,
 *   page: number,
 *   pageSize: number,
 *   total: number,
 *   onPage: (page: number) => void,
 * }} opts
 */
export function renderInvoicesPager({ container, page, pageSize, total, onPage }) {
  if (!container) return;
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  if (!total) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);

  const windowSize = 7;
  let start = Math.max(1, safePage - Math.floor(windowSize / 2));
  let end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const nums = [];
  for (let i = start; i <= end; i++) nums.push(i);

  container.innerHTML = `
    <div class="invoices-pager__meta">Mostrando ${from}–${to} de ${total} · Página ${safePage} de ${pages}</div>
    <div class="invoices-pager__controls">
      <button type="button" class="btn btn--ghost invoices-pager__btn" data-page="prev" ${safePage <= 1 ? "disabled" : ""}>Anterior</button>
      ${start > 1 ? `<button type="button" class="btn btn--ghost invoices-pager__btn" data-page="1">1</button><span class="invoices-pager__ellipsis">…</span>` : ""}
      ${nums
        .map(
          (n) =>
            `<button type="button" class="btn ${n === safePage ? "btn--primary" : "btn--ghost"} invoices-pager__btn" data-page="${n}" ${n === safePage ? "aria-current=\"page\"" : ""}>${n}</button>`
        )
        .join("")}
      ${end < pages ? `<span class="invoices-pager__ellipsis">…</span><button type="button" class="btn btn--ghost invoices-pager__btn" data-page="${pages}">${pages}</button>` : ""}
      <button type="button" class="btn btn--ghost invoices-pager__btn" data-page="next" ${safePage >= pages ? "disabled" : ""}>Siguiente</button>
    </div>
  `;

  container.onclick = (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest("[data-page]");
    if (!(btn instanceof HTMLElement) || btn.hasAttribute("disabled")) return;
    const raw = btn.getAttribute("data-page");
    let next = safePage;
    if (raw === "prev") next = safePage - 1;
    else if (raw === "next") next = safePage + 1;
    else next = Number(raw) || safePage;
    next = Math.min(pages, Math.max(1, next));
    if (next !== safePage) onPage(next);
  };
}

export const INVOICES_PAGE_SIZE = 25;
