/** Menú lateral en drawer para viewports estrechos. */
export function initMobileNav() {
  const toggle = document.getElementById("btn-sidebar-toggle");
  const backdrop = document.getElementById("nav-backdrop");
  const sidebar = document.getElementById("app-sidebar");
  if (!toggle || !backdrop || !sidebar) return;

  const icon = toggle.querySelector(".material-symbols-outlined");

  const setOpen = (open) => {
    document.body.classList.toggle("nav-drawer-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute(
      "aria-label",
      open ? "Cerrar menú de navegación" : "Abrir menú de navegación"
    );
    if (icon) icon.textContent = open ? "close" : "menu";
  };

  toggle.addEventListener("click", () => {
    setOpen(!document.body.classList.contains("nav-drawer-open"));
  });

  backdrop.addEventListener("click", () => setOpen(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a.sidebar__link, .sidebar__link--as-btn")) {
      setOpen(false);
    }
  });
}
