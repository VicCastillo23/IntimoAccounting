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
  if (!brand) return;
  brand.querySelectorAll(".sidebar__wordmark, .sidebar__app-label").forEach((el) => el.remove());
  if (brand.querySelector(".sidebar__brand-icon")) return;
  const img = document.createElement("img");
  img.className = "sidebar__brand-icon";
  img.src = SIDEBAR_LOGO_SRC;
  img.alt = "Íntimo";
  img.decoding = "async";
  img.loading = "eager";
  brand.prepend(img);
}

function ensureMobileBarLogo() {
  const brand = document.querySelector(".app-mobile-bar__brand");
  if (!brand) return;
  brand.querySelectorAll(".app-mobile-bar__wordmark, .app-mobile-bar__sub").forEach((el) => el.remove());
  if (brand.querySelector(".app-mobile-bar__logo")) return;
  const img = document.createElement("img");
  img.className = "app-mobile-bar__logo";
  img.src = SIDEBAR_LOGO_SRC;
  img.alt = "Íntimo";
  img.decoding = "async";
  img.loading = "eager";
  brand.prepend(img);
}

export function applyShellBranding() {
  ensureFavicon();
  ensureSidebarLogo();
  ensureMobileBarLogo();
}

/** @param {string | null | undefined} username */
export function formatSessionUserLabel(username) {
  const name = String(username || "").trim() || "—";
  return `Usuario: ${name}`;
}
