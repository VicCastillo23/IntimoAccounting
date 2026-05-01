const NAV_GROUPS = [
  {
    id: "contabilidad",
    label: "Contabilidad",
    items: [
      { href: "/", icon: "dynamic_feed", label: "Polizas dinamicas", match: { path: "/" } },
      { href: "/catalogo.html", icon: "list_alt", label: "Catalogo de cuentas", match: { path: "/catalogo.html" } },
      { href: "/auxiliar-mayor.html", icon: "menu_book", label: "Auxiliares de mayor", match: { path: "/auxiliar-mayor.html" } },
      { href: "/libro-diario.html", icon: "import_contacts", label: "Libro diario", match: { path: "/libro-diario.html" } },
      {
        href: "/placeholder.html?m=control-almacen",
        icon: "warehouse",
        label: "Control de almacen",
        match: { path: "/placeholder.html", m: "control-almacen" },
      },
      { href: "/activos.html", icon: "inventory_2", label: "Control de activos", match: { path: "/activos.html" } },
      {
        href: "/amortizaciones.html",
        icon: "trending_down",
        label: "Control de depreciaciones y amortizaciones",
        match: { path: "/amortizaciones.html" },
      },
    ],
  },
  {
    id: "facturacion",
    label: "Facturacion",
    items: [
      { href: "/facturas-recibidas.html", icon: "download", label: "Facturas recibidas", match: { path: "/facturas-recibidas.html" } },
      { href: "/facturas-emitidas.html", icon: "upload", label: "Facturas emitidas", match: { path: "/facturas-emitidas.html" } },
      {
        href: "/facturas-emitidas-facturama.html",
        icon: "receipt_long",
        label: "Facturacion Facturama",
        match: { path: "/facturas-emitidas-facturama.html" },
      },
    ],
  },
  {
    id: "reporteria",
    label: "Reporteria",
    items: [
      { href: "/report-balanza.html", icon: "balance", label: "Balanza de comprobacion", match: { path: "/report-balanza.html" } },
      {
        href: "/report-situacion-financiera.html",
        icon: "pie_chart",
        label: "Estado de situacion financiera",
        match: { path: "/report-situacion-financiera.html" },
      },
      {
        href: "/report-actividad.html",
        icon: "analytics",
        label: "Estado de resultado integral",
        match: { path: "/report-actividad.html" },
      },
      {
        href: "/report-cambios-situacion.html",
        icon: "swap_horiz",
        label: "Estado de cambios en la situacion financiera",
        match: { path: "/report-cambios-situacion.html" },
      },
      {
        href: "/report-variacion-capital.html",
        icon: "account_balance_wallet",
        label: "Estado de variacion en las cuentas de capital contable",
        match: { path: "/report-variacion-capital.html" },
      },
      {
        href: "/report-flujo-efectivo.html",
        icon: "payments",
        label: "Estado de flujo de efectivo",
        match: { path: "/report-flujo-efectivo.html" },
      },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    items: [{ href: "/health", icon: "monitor_heart", label: "Estado del servicio", external: true, match: null }],
  },
];

function isActiveMatch(match, pathname, params) {
  if (!match) return false;
  if (match.path !== pathname) return false;
  if (match.m && params.get("m") !== match.m) return false;
  return true;
}

function buildLinkItem(item, isActive) {
  const externalAttrs = item.external ? ' target="_blank" rel="noopener"' : "";
  return `
    <a class="sidebar__link${isActive ? " sidebar__link--active" : ""}" href="${item.href}"${externalAttrs}>
      <span class="material-symbols-outlined" aria-hidden="true">${item.icon}</span>
      ${item.label}
    </a>
  `;
}

function buildGroup(group, pathname, params) {
  let hasActive = false;
  const links = group.items
    .map((item) => {
      const active = isActiveMatch(item.match, pathname, params);
      if (active) hasActive = true;
      return buildLinkItem(item, active);
    })
    .join("");

  return `
    <section class="sidebar__group${hasActive ? " is-open" : ""}" data-sidebar-group="${group.id}">
      <button
        type="button"
        class="sidebar__group-toggle"
        aria-expanded="${hasActive ? "true" : "false"}"
        aria-controls="sidebar-group-panel-${group.id}"
      >
        <span class="sidebar__section-title">${group.label}</span>
        <span class="material-symbols-outlined sidebar__group-chevron" aria-hidden="true">expand_more</span>
      </button>
      <div class="sidebar__group-panel" id="sidebar-group-panel-${group.id}">
        ${links}
      </div>
    </section>
  `;
}

export function initSidebarNav() {
  const nav = document.querySelector(".sidebar__nav");
  if (!nav) return;

  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const groupsHtml = NAV_GROUPS.map((group) => buildGroup(group, pathname, params)).join("");

  nav.innerHTML = `
    ${groupsHtml}
    <button type="button" class="sidebar__link sidebar__link--as-btn" id="btn-logout">
      <span class="material-symbols-outlined" aria-hidden="true">logout</span>
      Cerrar sesion
    </button>
  `;

  nav.querySelectorAll(".sidebar__group-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.closest(".sidebar__group");
      if (!section) return;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      section.classList.toggle("is-open", !expanded);
    });
  });
}
