/**
 * Datos de empresa para reportes impresos (NIF / presentación).
 * Variables en .env: COMPANY_NAME, COMPANY_LOGO, COMPANY_ADDRESS, COMPANY_RFC
 */

function parseAddress(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  return s
    .split(/\r?\n|\|/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getBrandingForApi() {
  const companyName = String(process.env.COMPANY_NAME || "Íntimo").trim() || "Íntimo";
  const logoUrl = String(process.env.COMPANY_LOGO || "/brand/intimo-logo.png").trim() || "/brand/intimo-logo.png";
  const addressLines = parseAddress(process.env.COMPANY_ADDRESS);
  const rfc = String(process.env.COMPANY_RFC || "").trim();

  return {
    companyName,
    logoUrl,
    addressLines,
    rfc,
  };
}
