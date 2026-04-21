/**
 * Formato interno Íntimo para código agrupador SAT (misma lógica en UI y migraciones Node).
 * Ej.: 100-001-001-000 CAJA, 100-001-002-001 BANCOS NACIONALES.
 */

export const SAT_MAIN_SECTIONS = new Map([
  ["activo", 100],
  ["pasivo", 200],
  ["capital", 300],
  ["ingresos", 400],
  ["costos", 500],
  ["gastos", 600],
  ["cuentas de orden", 700],
]);

export function pad3(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "000";
  return String(Math.trunc(v)).padStart(3, "0");
}

export function isMainSectionRow(r) {
  if (!r?.es_seccion) return false;
  const k = String(r.descripcion || "").trim().toLowerCase();
  return SAT_MAIN_SECTIONS.has(k);
}

/**
 * @param {{ codigo: string | null, descripcion: string, es_seccion: boolean }} r
 * @param {{ groupBase: number, subsection: number }} ctx
 */
export function formatSatAsIntimoCode(r, ctx) {
  if (r.es_seccion) {
    if (isMainSectionRow(r)) {
      const base = String(ctx.groupBase || 0).padStart(3, "0");
      return { code: `${base}-000-000-000`, desc: String(r.descripcion || "").toUpperCase() };
    }
    const base = String(ctx.groupBase || 0).padStart(3, "0");
    const sub = pad3(ctx.subsection);
    return { code: `${base}-${sub}-000-000`, desc: String(r.descripcion || "").toUpperCase() };
  }

  const raw = String(r.codigo || "").trim();
  const parts = raw.split(".").filter(Boolean);
  const major = pad3(parts[0] || 0);
  const minor = pad3(parts[1] || 0);
  const base = String(ctx.groupBase || 0).padStart(3, "0");
  const sub = pad3(ctx.subsection || 1);
  return { code: `${base}-${sub}-${major}-${minor}`, desc: String(r.descripcion || "").toUpperCase() };
}

/**
 * @param {Array<{ id: number, codigo: string | null, descripcion: string, orden: number, es_seccion: boolean }>} satRows
 * @returns {Map<number, { code: string, desc: string }>}
 */
export function buildSatDisplayById(satRows) {
  const sorted = [...satRows].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  /** @type {Map<number, { code: string, desc: string }>} */
  const map = new Map();
  const ctx = { groupBase: 100, subsection: 1 };

  for (const r of sorted) {
    if (isMainSectionRow(r)) {
      const k = String(r.descripcion || "").trim().toLowerCase();
      ctx.groupBase = SAT_MAIN_SECTIONS.get(k) || 100;
      ctx.subsection = 0;
    } else if (r.es_seccion) {
      ctx.subsection = (ctx.subsection || 0) + 1;
    } else if (!ctx.subsection) {
      ctx.subsection = 1;
    }
    const { code, desc } = formatSatAsIntimoCode(r, ctx);
    map.set(Number(r.id), { code, desc });
  }
  return map;
}

/** Nivel de anidación SAT (puntos en codigo original), para indentación en tabla. */
export function satCodigoDepth(codigo) {
  if (!codigo) return 0;
  const parts = String(codigo).trim().split(".");
  return Math.max(0, parts.length - 1);
}

/**
 * Nivel visual en el árbol (0 = raíz del grupo) a partir del código íntimo A-B-C-D.
 * Sirve para secciones sin `codigo` con puntos en la fila SAT.
 */
export function intimoSatCodeTreeDepth(code) {
  const parts = String(code || "").trim().split("-");
  if (parts.length !== 4) return 0;
  let depth = 0;
  for (let i = 1; i < 4; i += 1) {
    const n = parseInt(parts[i], 10);
    if (Number.isFinite(n) && n !== 0) depth = i;
  }
  return depth;
}
