import axios from "axios";

/** Serie INPC mensual, base agosto 2018 = 100 (BIE). No está disponible con fuente BISE en el Banco de Indicadores. */
const INDICADOR_INPC_DEFAULT = "628194";
const BIE_BASE = "https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml";

/** Caché en memoria de la serie completa (INEGI devuelve todas las observaciones). */
let seriesCache = /** @type {{ observations: Array<{ TIME_PERIOD?: string, OBS_VALUE?: string }>, fetchedAt: number } | null} */ (
  null
);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getToken() {
  let t = String(process.env.INEGI_BIE_TOKEN || "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function getIndicadorInpc() {
  const id = String(process.env.INEGI_INPC_INDICADOR || INDICADOR_INPC_DEFAULT).trim();
  return id || INDICADOR_INPC_DEFAULT;
}

/**
 * Como en tu ejemplo: `response.data.INEGI_SERIES[0].OBSERVATIONS`; otras respuestas usan `Series[0]`.
 * @param {unknown} body
 * @returns {{ OBSERVATIONS?: unknown[], observations?: unknown[] } | null}
 */
function firstSeriesFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = /** @type {Record<string, unknown>} */ (body);
  const s =
    o.INEGI_SERIES?.[0] ??
    o.Series?.[0] ??
    o.inegi_series?.[0] ??
    o.series?.[0];
  return s && typeof s === "object" ? /** @type {{ OBSERVATIONS?: unknown[], observations?: unknown[] }} */ (s) : null;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeInegiPeriod(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})$/);
  if (!m) return s;
  const mo = String(Number.parseInt(m[2], 10)).padStart(2, "0");
  return `${m[1]}-${mo}`;
}

/**
 * @param {unknown} periodo
 * @param {number} y
 * @param {string} mm
 */
function periodoCoincide(periodo, y, mm) {
  return normalizeInegiPeriod(periodo) === `${y}-${mm}`;
}

/**
 * @param {unknown} data
 * @returns {unknown}
 */
function coerceJsonBody(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

/**
 * @param {unknown} data
 * @returns {{ code?: string, info?: string } | null}
 */
function parseInegiErrorPayload(data) {
  if (!Array.isArray(data)) return null;
  let code;
  let info;
  for (const row of data) {
    if (typeof row !== "string") continue;
    if (row.startsWith("ErrorCode:")) code = row.slice("ErrorCode:".length).trim();
    if (row.startsWith("ErrorInfo:")) info = row.slice("ErrorInfo:".length).trim();
  }
  return code || info ? { code, info } : null;
}

/**
 * Misma forma que el ejemplo: …/INDICATOR/628194/es/0700/false/BIE/2.0/${TOKEN}?type=json
 * Token UUID en ruta sin caracteres reservados: encodeURIComponent es equivalente.
 */
function buildIndicatorUrl(token, indicador, geo, recientes, fuente, version) {
  const rec = recientes ? "true" : "false";
  const tok = String(process.env.INEGI_BIE_TOKEN_RAW_PATH || "").toLowerCase() === "true" ? token : encodeURIComponent(token);
  return `${BIE_BASE}/INDICATOR/${indicador}/es/${encodeURIComponent(geo)}/${rec}/${fuente}/${version}/${tok}?type=json`;
}

/**
 * Orden de intentos: primero el que definas con INEGI_BIE_GEO_AREA (si existe), luego 0700 (común en INPC/BIE), 00 y 00000.
 * El INPC 628194 requiere fuente BIE; los tokens solo-BISE devuelven ErrorCode 100.
 */
function buildCandidateUrls(token) {
  const indicador = getIndicadorInpc();
  const version = String(process.env.INEGI_BIE_API_VERSION || "2.0").trim() || "2.0";
  const fuente = String(process.env.INEGI_BIE_FUENTE || "BIE").trim() || "BIE";
  const recientes =
    String(process.env.INEGI_BIE_RECENTES || "false").toLowerCase() === "true";

  const customGeo = String(process.env.INEGI_BIE_GEO_AREA || "").trim();
  const geoTries = customGeo
    ? [customGeo, "0700", "00", "00000"]
    : ["0700", "00", "00000"];

  const seen = new Set();
  const urls = [];
  for (const geo of geoTries) {
    const u = buildIndicatorUrl(token, indicador, geo, recientes, fuente, version);
    if (!seen.has(u)) {
      seen.add(u);
      urls.push({ url: u });
    }
  }
  return urls;
}

/**
 * Descarga la serie completa (o usa caché).
 * @returns {Promise<Array<{ TIME_PERIOD?: string, OBS_VALUE?: string }>>}
 */
async function fetchObservations() {
  const now = Date.now();
  if (seriesCache && now - seriesCache.fetchedAt < CACHE_TTL_MS) {
    return seriesCache.observations;
  }

  const token = getToken();
  if (!token) {
    const err = new Error(
      "No hay token de INEGI. Define INEGI_BIE_TOKEN en el servidor (.env) y reinicia Node."
    );
    err.code = "missing_token";
    throw err;
  }

  const candidates = buildCandidateUrls(token);
  let lastHttpStatus = 0;
  let lastErrorDetail = "";
  let lastPayload = null;

  for (const { url } of candidates) {
    let response;
    try {
      response = await axios.get(url, {
        timeout: 25000,
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "es-MX,es;q=0.9",
          "User-Agent": "IntimoAccounting/1.0",
        },
        validateStatus: () => true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const err = new Error(`No se pudo contactar a INEGI: ${msg}`);
      err.code = "network";
      throw err;
    }

    lastHttpStatus = response.status;
    const body = coerceJsonBody(response.data);
    lastPayload = body;

    if (response.status === 200) {
      const series = firstSeriesFromBody(body);
      const observations = series?.OBSERVATIONS ?? series?.observations;
      if (Array.isArray(observations) && observations.length > 0) {
        seriesCache = { observations, fetchedAt: now };
        return observations;
      }
      lastErrorDetail = "Respuesta 200 sin OBSERVATIONS.";
      continue;
    }

    const parsed = parseInegiErrorPayload(body);
    if (parsed?.code) lastErrorDetail = `ErrorCode ${parsed.code}${parsed.info ? `: ${parsed.info}` : ""}`;
    else if (parsed?.info) lastErrorDetail = parsed.info;
    else lastErrorDetail = `HTTP ${response.status}`;
  }

  const bieHint =
    "El INPC mensual (indicador 628194) se consulta con fuente BIE. Si ves ErrorCode 100 con todos los intentos, el token suele estar limitado a BISE: en el portal de INEGI solicita también acceso al BIE (Banco de Información Económica). Registro: https://www.inegi.org.mx/servicios/api_indicadores.html";

  if (lastHttpStatus === 401 || lastHttpStatus === 403) {
    const err = new Error(
      `INEGI respondió ${lastHttpStatus} en todos los intentos. Revisa INEGI_BIE_TOKEN y permisos del token. ${bieHint}`
    );
    err.code = "http";
    throw err;
  }

  if (lastHttpStatus === 400 && parseInegiErrorPayload(lastPayload)?.code === "100") {
    const err = new Error(`INEGI: sin datos para el INPC (${lastErrorDetail}). ${bieHint}`);
    err.code = "http";
    throw err;
  }

  const err = new Error(
    lastHttpStatus
      ? `INEGI respondió HTTP ${lastHttpStatus}. ${lastErrorDetail || ""} ${bieHint}`.trim()
      : `No se obtuvo la serie INPC. ${bieHint}`
  );
  err.code = "http";
  throw err;
}

/**
 * INPC para un mes calendario (INEGI usa TIME_PERIOD YYYY/MM o YYYY-MM según serie).
 * @param {number} year
 * @param {number} month 1-12
 */
export async function getInpcForYearMonth(year, month) {
  const y = Math.floor(year);
  const m = Math.floor(month);
  if (!Number.isFinite(y) || y < 1990 || y > 2100) {
    throw new Error("Año fuera de rango.");
  }
  if (!Number.isFinite(m) || m < 1 || m > 12) {
    throw new Error("Mes inválido (usa 1–12).");
  }

  const mm = String(m).padStart(2, "0");

  const data = await fetchObservations();

  const found = data.find(
    (item) =>
      periodoCoincide(item?.TIME_PERIOD, y, mm) &&
      item?.OBS_VALUE != null &&
      String(item.OBS_VALUE).trim() !== ""
  );
  if (found) {
    const v = parseFloat(String(found.OBS_VALUE).replace(",", "."));
    if (Number.isFinite(v) && v > 0) return v;
  }

  throw new Error(
    `No se encontró INPC publicado para ${y}-${mm}. Comprueba que INEGI ya haya publicado ese mes (TIME_PERIOD en la serie) o elige otro rango.`
  );
}

/**
 * Factor de actualización = INPC al cierre / INPC al inicio (6 decimales).
 * @param {number} anioInicio
 * @param {number} mesInicio 1-12
 * @param {number} anioFin
 * @param {number} mesFin 1-12
 */
export async function calcularFactorActualizacion(anioInicio, mesInicio, anioFin, mesFin) {
  const inpcInicio = await getInpcForYearMonth(anioInicio, mesInicio);
  const inpcFin = await getInpcForYearMonth(anioFin, mesFin);

  if (!Number.isFinite(inpcInicio) || inpcInicio <= 0) {
    throw new Error("INPC de inicio no válido.");
  }
  if (!Number.isFinite(inpcFin) || inpcFin <= 0) {
    throw new Error("INPC de fin no válido.");
  }

  const raw = inpcFin / inpcInicio;
  const factor = Math.round(raw * 1e6) / 1e6;

  return {
    inpcInicio,
    inpcFin,
    factor,
    periodoInicio: `${anioInicio}-${String(mesInicio).padStart(2, "0")}`,
    periodoFin: `${anioFin}-${String(mesFin).padStart(2, "0")}`,
  };
}
