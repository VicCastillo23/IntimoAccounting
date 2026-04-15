import { initMobileNav } from "./mobile-nav.js";
import { ensureFiscalYear, injectFiscalSidebar } from "./fiscal-session.js";

/**
 * Sesión + ejercicio fiscal + logout en páginas con el mismo shell lateral.
 * @param {{ onFiscalChange?: () => void }} [options] al cambiar ejercicio (p. ej. recargar reportes)
 */
export async function initAuthShell(options = {}) {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  const j = await r.json();
  if (!j.success || !j.user) {
    window.location.href = "/login.html";
    return null;
  }
  const el = document.getElementById("session-user");
  if (el) el.textContent = j.user.username;

  let fiscalYear = j.fiscalYear;
  if (fiscalYear == null) {
    fiscalYear = await ensureFiscalYear();
    if (fiscalYear == null) return null;
  }

  injectFiscalSidebar(fiscalYear, options.onFiscalChange);

  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignorar */
    }
    window.location.href = "/login.html";
  });
  initMobileNav();
  return { username: j.user.username, fiscalYear };
}
