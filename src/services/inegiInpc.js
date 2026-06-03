import axios from "axios";

/**
 * INPC índice general base 2018=100 (Constructor BIE de INEGI).
 * @see https://www.inegi.org.mx/servicios/api_indicadores.html — indicador 910420, quincenal.
 */
const INDICADOR_INPC_DEFAULT = "910420";
/** Serie mensual legada (solo si tu token no expone 910420). */
const INDICADOR_INPC_LEGACY = "628194";
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
 * Extrae año y mes de TIME_PERIOD (mensual YYYY-MM o quincenal YYYY/MM/DD).
 * @param {unknown} raw
 * @returns {{ year: number, month: number, day: number } | null}
 */
function parseObservationYearMonth(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?/);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = m[3] ? Number.parseInt(m[3], 10) : 0;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month, day: Number.isFinite(day) ? day : 0 };
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
 * Varias URLs como en el Constructor de Consultas INEGI (BIE / BIE-BISE, geo 00, etc.).
 */
function buildCandidateUrls(token) {
  const version = String(process.env.INEGI_BIE_API_VERSION || "2.0").trim() || "2.0";
  const recientesEnv = String(process.env.INEGI_BIE_RECENTES || "").trim().toLowerCase();
  /** false = serie histórica (necesaria para factor inicio/fin). true solo devuelve el último dato. */
  const recientesPreferido = recientesEnv === "true";

  const customGeo = String(process.env.INEGI_BIE_GEO_AREA || "").trim();
  const geoTries = customGeo ? [customGeo, "00", "0700", "00000"] : ["00", "0700", "00000"];

  const fuenteEnv = String(process.env.INEGI_BIE_FUENTE || "").trim();
  const fuenteTries = fuenteEnv
    ? [fuenteEnv, "BIE-BISE", "BIE", "BISE"]
    : ["BIE-BISE", "BIE", "BISE"];

  const indicadorEnv = getIndicadorInpc();
  const indicadorTries =
    indicadorEnv === INDICADOR_INPC_DEFAULT
      ? [INDICADOR_INPC_DEFAULT, INDICADOR_INPC_LEGACY]
      : [indicadorEnv, INDICADOR_INPC_DEFAULT, INDICADOR_INPC_LEGACY];

  const seen = new Set();
  const urls = [];
  for (const indicador of indicadorTries) {
    for (const fuente of fuenteTries) {
      for (const geo of geoTries) {
        for (const recientes of [recientesPreferido, !recientesPreferido]) {
          const u = buildIndicatorUrl(token, indicador, geo, recientes, fuente, version);
          if (!seen.has(u)) {
            seen.add(u);
            urls.push({ url: u, indicador, fuente, geo });
          }
        }
      }
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
    "Usa el Constructor BIE de INEGI (indicador 910420, geo 00, fuente BIE-BISE). Si ves ErrorCode 100, revisa el token en el correo de INEGI y define INEGI_BIE_TOKEN en .env. Registro: https://www.inegi.org.mx/servicios/api_indicadores.html";

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
 * INPC para un mes calendario. Serie quincenal (910420): usa la última quincena del mes.
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

  let bestValue = null;
  let bestDay = -1;

  for (const item of data) {
    const ym = parseObservationYearMonth(item?.TIME_PERIOD);
    if (!ym || ym.year !== y || ym.month !== m) continue;
    if (item?.OBS_VALUE == null || String(item.OBS_VALUE).trim() === "") continue;
    const v = parseFloat(String(item.OBS_VALUE).replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) continue;
    if (ym.day >= bestDay) {
      bestDay = ym.day;
      bestValue = v;
    }
  }

  if (bestValue != null) return bestValue;

  throw new Error(
    `No se encontró INPC publicado para ${y}-${mm}. Comprueba que INEGI ya haya publicado ese mes (serie quincenal 910420) o elige otro rango.`
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
