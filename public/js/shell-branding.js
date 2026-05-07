const SIDEBAR_LOGO_SRC = "/assets/intimo-sidebar-logo.png";
const FAVICON_SRC = "/assets/intimo-favicon.png";

function ensureFavicon() {
  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    document.head.appendChild(icon);
  }
  icon.setAttribute("rel", "icon");
  icon.setAttribute("type", "image/png");
  icon.setAttribute("href", FAVICON_SRC);
}

function ensureSidebarLogo() {
  const brand = document.querySelector(".sidebar__brand");
  if (!brand || brand.querySelector(".sidebar__brand-icon")) return;
  const img = document.createElement("img");
  img.className = "sidebar__brand-icon";
  img.src = SIDEBAR_LOGO_SRC;
  img.alt = "Intimo";
  img.decoding = "async";
  img.loading = "eager";
  brand.insertBefore(img, brand.firstChild);
}

export function applyShellBranding() {
  ensureFavicon();
  ensureSidebarLogo();
}
