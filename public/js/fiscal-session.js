/**
 * Ejercicio fiscal en sesión: modal inicial, selector lateral, POST /api/session/fiscal-year.
 */

const YEARS = [];
for (let y = 2030; y >= 2018; y--) YEARS.push(y);

function $(sel, root = document) {
  return root.querySelector(sel);
}

async function postFiscalYear(year) {
  const res = await fetch("/api/session/fiscal-year", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year }),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    throw new Error(j.message || "No se pudo guardar el ejercicio.");
  }
  return j.fiscalYear;
}

function ensureFiscalModal() {
  let backdrop = $("#modal-fiscal-year");
  if (backdrop) return backdrop;

  backdrop = document.createElement("div");
  backdrop.id = "modal-fiscal-year";
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("aria-hidden", "false");
  backdrop.innerHTML = `
    <div class="modal modal--fiscal" role="dialog" aria-modal="true" aria-labelledby="modal-fiscal-title" tabindex="-1">
      <div class="modal__header">
        <h2 class="modal__title" id="modal-fiscal-title">Ejercicio fiscal</h2>
      </div>
      <div class="modal__body">
        <p class="modal__hint">Selecciona el año contable en el que trabajarás (pólizas, reportes y catálogo usan el mismo criterio).</p>
        <label class="field">
          <span class="field__label">Año</span>
          <select id="fiscal-year-select" class="field__input"></select>
        </label>
        <p class="modal__hint modal__hint--small" id="modal-fiscal-error" role="alert"></p>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn btn--primary" id="btn-fiscal-confirm">Continuar</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const sel = $("#fiscal-year-select", backdrop);
  if (sel) {
    const current = new Date().getFullYear();
    sel.innerHTML = YEARS.map((y) => `<option value="${y}" ${y === current ? "selected" : ""}>${y}</option>`).join("");
  }

  return backdrop;
}

/**
 * Si no hay ejercicio en sesión, muestra modal hasta que el usuario confirme.
 * @returns {Promise<number | null>} año fiscal o null si no autenticado
 */
export async function ensureFiscalYear() {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  const j = await r.json();
  if (!j.success || !j.user) {
    window.location.href = "/login.html";
    return null;
  }
  if (j.fiscalYear != null) {
    return j.fiscalYear;
  }

  const backdrop = ensureFiscalModal();
  backdrop.hidden = false;

  const errEl = $("#modal-fiscal-error");
  const showErr = (msg) => {
    if (errEl) errEl.textContent = msg || "";
  };

  return new Promise((resolve) => {
    const onConfirm = async () => {
      const sel = $("#fiscal-year-select");
      const y = Number(sel?.value);
      showErr("");
      try {
        const fy = await postFiscalYear(y);
        backdrop.hidden = true;
        backdrop.setAttribute("aria-hidden", "true");
        $("#btn-fiscal-confirm", backdrop)?.removeEventListener("click", onConfirm);
        resolve(fy);
      } catch (e) {
        showErr(e instanceof Error ? e.message : String(e));
      }
    };
    $("#btn-fiscal-confirm", backdrop)?.addEventListener("click", onConfirm);
    requestAnimationFrame(() => {
      $(".modal--fiscal", backdrop)?.focus();
    });
  });
}

/**
 * Inserta selector de ejercicio bajo la etiqueta de sesión (una vez por página).
 * @param {number} currentYear
 * @param {() => void} [onChanged] recarga opcional tras cambiar
 */
export function injectFiscalSidebar(currentYear, onChanged) {
  const nav = $("#app-sidebar .sidebar__nav");
  const sessionP = $("#session-label");
  if (!nav || !sessionP) return;

  let wrap = $("#sidebar-fiscal-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "sidebar-fiscal-wrap";
    wrap.className = "sidebar__fiscal";
    wrap.innerHTML = `
      <span class="sidebar__fiscal-label">Ejercicio fiscal</span>
      <div class="sidebar__fiscal-row">
        <select id="sidebar-fiscal-year" class="field__input field__input--compact" aria-label="Ejercicio fiscal"></select>
        <button type="button" class="btn btn--ghost btn--sm" id="sidebar-fiscal-apply">Cambiar</button>
      </div>`;
    sessionP.insertAdjacentElement("afterend", wrap);
  }

  const sel = $("#sidebar-fiscal-year");
  if (sel && !sel.dataset.wired) {
    sel.innerHTML = YEARS.map((y) => `<option value="${y}">${y}</option>`).join("");
    sel.dataset.wired = "1";
  }
  if (sel) sel.value = String(currentYear);

  const btn = $("#sidebar-fiscal-apply");
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", async () => {
      const y = Number(sel?.value);
      try {
        await postFiscalYear(y);
        if (typeof onChanged === "function") onChanged();
        else window.location.reload();
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    });
  }
}
