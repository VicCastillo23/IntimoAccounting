/**
 * Boot síncrono del menú lateral (sin type=module) para evitar el parpadeo
 * al navegar entre pantallas. Debe cargarse justo después de .sidebar__nav.
 */
(function () {
  const NAV_GROUPS = [
    {
      id: "contabilidad",
      label: "Contabilidad",
      items: [
        { href: "/", icon: "dynamic_feed", label: "Polizas dinamicas", match: { path: "/" } },
        { href: "/catalogo.html", icon: "list_alt", label: "Catalogo de cuentas", match: { path: "/catalogo.html" } },
        { href: "/auxiliar-mayor.html", icon: "menu_book", label: "Auxiliares de mayor", match: { path: "/auxiliar-mayor.html" } },
        { href: "/libro-diario.html", icon: "import_contacts", label: "Libro diario", match: { path: "/libro-diario.html" } },
        { href: "/carta.html", icon: "restaurant_menu", label: "Carta / Productos", match: { path: "/carta.html" } },
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
          label: "Facturacion Manual",
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
      items: [{ href: "/status.html", icon: "monitor_heart", label: "Estado del servicio", match: { path: "/status.html" } }],
    },
  ];

  const OPEN_GROUPS_KEY = "intimo.sidebar.openGroups";
  const USER_KEY = "intimo.sidebar.userLabel";
  const LOGO_SRC = "/assets/intimo-sidebar-logo.png";

  function isActiveMatch(match, pathname, params) {
    if (!match) return false;
    if (match.path !== pathname) return false;
    if (match.m && params.get("m") !== match.m) return false;
    return true;
  }

  function readOpenGroups() {
    try {
      const raw = sessionStorage.getItem(OPEN_GROUPS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return new Set(parsed.map(String));
    } catch {
      return null;
    }
  }

  function buildLink(item, isActive) {
    return (
      '<a class="sidebar__link' +
      (isActive ? " sidebar__link--active" : "") +
      '" href="' +
      item.href +
      '">' +
      '<span class="material-symbols-outlined" aria-hidden="true">' +
      item.icon +
      "</span> " +
      item.label +
      "</a>"
    );
  }

  function buildGroup(group, pathname, params, openIds) {
    let hasActive = false;
    const links = group.items
      .map(function (item) {
        const active = isActiveMatch(item.match, pathname, params);
        if (active) hasActive = true;
        return buildLink(item, active);
      })
      .join("");
    const isOpen = openIds.has(group.id);
    return (
      '<section class="sidebar__group' +
      (isOpen ? " is-open" : "") +
      '" data-sidebar-group="' +
      group.id +
      '">' +
      '<button type="button" class="sidebar__group-toggle" aria-expanded="' +
      (isOpen ? "true" : "false") +
      '" aria-controls="sidebar-group-panel-' +
      group.id +
      '">' +
      '<span class="sidebar__section-title">' +
      group.label +
      "</span>" +
      '<span class="material-symbols-outlined sidebar__group-chevron" aria-hidden="true">expand_more</span>' +
      "</button>" +
      '<div class="sidebar__group-panel" id="sidebar-group-panel-' +
      group.id +
      '"' +
      (hasActive ? ' data-has-active="1"' : "") +
      ">" +
      links +
      "</div></section>"
    );
  }

  function ensureLogo(selector, className) {
    const brand = document.querySelector(selector);
    if (!brand || brand.querySelector("." + className)) return;
    const img = document.createElement("img");
    img.className = className;
    img.src = LOGO_SRC;
    img.alt = "Íntimo";
    img.decoding = "async";
    img.loading = "eager";
    brand.insertBefore(img, brand.firstChild);
  }

  const nav = document.querySelector(".sidebar__nav");
  if (!nav) return;

  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  let activeGroupId = null;
  for (let i = 0; i < NAV_GROUPS.length; i++) {
    const group = NAV_GROUPS[i];
    for (let j = 0; j < group.items.length; j++) {
      if (isActiveMatch(group.items[j].match, pathname, params)) {
        activeGroupId = group.id;
        break;
      }
    }
    if (activeGroupId) break;
  }

  const stored = readOpenGroups();
  const openIds = stored ? new Set(stored) : new Set(activeGroupId ? [activeGroupId] : []);
  if (activeGroupId) openIds.add(activeGroupId);

  nav.innerHTML =
    NAV_GROUPS.map(function (group) {
      return buildGroup(group, pathname, params, openIds);
    }).join("") +
    '<button type="button" class="sidebar__link sidebar__link--as-btn" id="btn-logout">' +
    '<span class="material-symbols-outlined" aria-hidden="true">logout</span> Cerrar sesion</button>';
  nav.dataset.sidebarBooted = "1";

  try {
    sessionStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(Array.from(openIds)));
  } catch (_) {
    /* ignore */
  }

  ensureLogo(".sidebar__brand", "sidebar__brand-icon");
  ensureLogo(".app-mobile-bar__brand", "app-mobile-bar__logo");

  try {
    const userLabel = sessionStorage.getItem(USER_KEY);
    const userEl = document.getElementById("session-user");
    if (userLabel && userEl && !userEl.textContent.trim()) {
      userEl.textContent = userLabel;
    }
  } catch (_) {
    /* ignore */
  }

  window.__INTIMO_SIDEBAR_BOOT__ = {
    NAV_GROUPS: NAV_GROUPS,
    OPEN_GROUPS_KEY: OPEN_GROUPS_KEY,
    USER_KEY: USER_KEY,
  };
})();
