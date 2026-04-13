const $ = (sel) => document.querySelector(sel);

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alertEl = $("#login-alert");
  const btn = $("#login-submit");
  const username = $("#login-user").value.trim();
  const password = $("#login-pass").value;
  alertEl.hidden = true;
  btn.disabled = true;
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alertEl.hidden = false;
      alertEl.className = "login-alert login-alert--error";
      alertEl.textContent = json.message || "No se pudo iniciar sesión.";
      return;
    }
    window.location.href = "/";
  } catch {
    alertEl.hidden = false;
    alertEl.className = "login-alert login-alert--error";
    alertEl.textContent = "Error de red. Intenta de nuevo.";
  } finally {
    btn.disabled = false;
  }
});

(async () => {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const json = await res.json();
    if (json.success && json.user) window.location.href = "/";
  } catch {
    /* permanece en login */
  }
})();
