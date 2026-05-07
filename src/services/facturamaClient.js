function getFacturamaBaseUrl() {
  return String(process.env.FACTURAMA_API_URL || "https://api.facturama.mx").replace(/\/+$/, "");
}

function getFacturamaAuthHeader() {
  const user = String(process.env.FACTURAMA_USER || "").trim();
  const pass = String(process.env.FACTURAMA_PASSWORD || "").trim();
  if (!user || !pass) return null;
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

async function facturamaFetch(path, init = {}) {
  const auth = getFacturamaAuthHeader();
  if (!auth) throw new Error("Facturama credentials not configured");
  const url = `${getFacturamaBaseUrl()}/${String(path || "").replace(/^\//, "")}`;
  const headers = new Headers(init.headers || {});
  if (!headers.has("Authorization")) headers.set("Authorization", auth);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers });
}

export async function stampFacturamaCfdi(payload) {
  const res = await facturamaFetch("api-lite/3/cfdis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.Message || json?.message || text || `HTTP ${res.status}`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function getCsdEnv() {
  const rfc = String(process.env.FACTURAMA_EMISOR_RFC || "").trim().toUpperCase();
  const certificate = String(process.env.FACTURAMA_CSD_CERTIFICATE_BASE64 || "").trim();
  const privateKey = String(process.env.FACTURAMA_CSD_PRIVATE_KEY_BASE64 || "").trim();
  const privateKeyPassword = String(process.env.FACTURAMA_CSD_PRIVATE_KEY_PASSWORD || "").trim();
  return { rfc, certificate, privateKey, privateKeyPassword };
}

function hasCsdEnv() {
  const c = getCsdEnv();
  return Boolean(c.rfc && c.certificate && c.privateKey && c.privateKeyPassword);
}

function looksLikeAlreadyExistsError(json, text) {
  const rfcMsgs = json?.ModelState?.Rfc;
  if (Array.isArray(rfcMsgs)) {
    return rfcMsgs.some((m) => /ya existe|asociado a este RFC/i.test(String(m)));
  }
  return /ya existe un CSD|asociado a este RFC/i.test(String(text || ""));
}

/**
 * Replica la lógica operativa usada en Invoicing: si hay CSD en .env,
 * intenta registrarlo (POST) y si ya existe lo toma como OK.
 */
export async function ensureFacturamaCsdFromEnv() {
  if (!hasCsdEnv()) return { ok: true, skipped: true };
  const { rfc, certificate, privateKey, privateKeyPassword } = getCsdEnv();
  const payload = {
    Rfc: rfc,
    Certificate: certificate,
    PrivateKey: privateKey,
    PrivateKeyPassword: privateKeyPassword,
  };
  const res = await facturamaFetch("api-lite/csds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (res.ok) return { ok: true, skipped: false };
  if (looksLikeAlreadyExistsError(json, text)) return { ok: true, skipped: false, alreadyExists: true };
  const msg = json?.Message || json?.message || text || `HTTP ${res.status}`;
  const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  err.status = res.status;
  err.body = json;
  throw err;
}

export async function downloadFacturamaCfdiById(id, format) {
  const fmt = String(format || "").toLowerCase();
  const fid = encodeURIComponent(String(id || "").trim());

  // Igual que Invoicing: issuedLite responde JSON con Content base64.
  const issuedLite = await facturamaFetch(`cfdi/${fmt}/issuedLite/${fid}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const issuedText = await issuedLite.text();
  let issuedJson;
  try {
    issuedJson = issuedText ? JSON.parse(issuedText) : {};
  } catch {
    issuedJson = {};
  }
  if (issuedLite.ok && typeof issuedJson?.Content === "string" && issuedJson.Content.length > 0) {
    return {
      buffer: Buffer.from(issuedJson.Content, "base64"),
      contentType:
        String(issuedJson.ContentType || "").toLowerCase() === "pdf" || fmt === "pdf"
          ? "application/pdf"
          : "application/xml",
    };
  }

  // Fallback binario (algunas cuentas/rutas responden stream directo).
  const res = await facturamaFetch(`api-lite/3/cfdis/${fid}/${fmt}`, { method: "GET" });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (res.ok) {
    return {
      buffer: Buffer.from(bytes),
      contentType: fmt === "pdf" ? "application/pdf" : "application/xml",
    };
  }

  const text = new TextDecoder().decode(bytes);
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  const msg =
    issuedJson?.Message ||
    issuedJson?.message ||
    json?.Message ||
    json?.message ||
    text ||
    `HTTP ${res.status}`;
  const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  err.status = res.status;
  err.body = json;
  throw err;
}
