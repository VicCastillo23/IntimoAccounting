import { initMobileNav } from "./mobile-nav.js";

/** Sesión + logout reutilizable en páginas con el mismo shell lateral. */
export async function initAuthShell() {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  const j = await r.json();
  if (!j.success || !j.user) {
    window.location.href = "/login.html";
    return false;
  }
  const el = document.getElementById("session-user");
  if (el) el.textContent = j.user.username;
  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignorar */
    }
    window.location.href = "/login.html";
  });
  initMobileNav();
  return true;
}
