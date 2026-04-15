import "./loadEnv.js";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "node:url";
import { parseKeyHex } from "./crypto/vault.js";
import { getSessionMiddleware } from "./auth/sessionConfig.js";
import { requireAuth } from "./auth/middleware.js";
import { handleLogin, handleLogout, handleMe, handleSetFiscalYear } from "./auth/routes.js";
import { initUsersStore } from "./auth/usersStore.js";
import {
  initPolizasStore,
  saveNewPoliza,
  peekNextFolio,
  filterPolizasByYear,
  getPolizaById,
  updatePoliza,
  deletePoliza,
} from "./store/polizasStore.js";
import {
  listSatCodigoAgrupador,
  listChartAccounts,
  createChartAccount,
  updateChartAccount,
} from "./store/catalogStore.js";
import { checkDb, ensureDatabaseExistsIfNeeded } from "./db/pool.js";
import { ensureCatalogDevIfNeeded } from "./db/ensureCatalogDev.js";
import { getReportsDashboard } from "./store/reportsStore.js";
import { getBrandingForApi } from "./config/branding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const app = express();
const port = Number(process.env.PORT) || 3010;

const trustProxyEnv = String(process.env.TRUST_PROXY || "").toLowerCase();
const useTrustProxy =
  process.env.NODE_ENV === "production" ||
  trustProxyEnv === "1" ||
  trustProxyEnv === "true";
if (useTrustProxy) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const dataKey = parseKeyHex(process.env.DATA_ENCRYPTION_KEY);
initUsersStore(dataKey);

app.use(getSessionMiddleware(session));
app.use(express.json({ limit: "512kb" }));

function totals(lines) {
  const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

app.get("/health", async (_req, res) => {
  const database = await checkDb();
  res.json({
    ok: true,
    service: "intimo-accounting",
    env: process.env.NODE_ENV || "development",
    persistence: process.env.DATABASE_URL?.trim() ? "postgresql" : "file",
    database,
  });
});

app.post("/api/auth/login", handleLogin);
app.post("/api/auth/logout", handleLogout);
app.get("/api/auth/me", handleMe);

app.get("/api/config/branding", requireAuth, (_req, res) => {
  res.json({ success: true, data: getBrandingForApi() });
});

const DEPTO_VALUES = ["ADMINISTRACION", "SERVICIOS_GENERALES", "OTROS"];

const POLIZA_TYPES = new Set(["DIARIO", "INGRESOS", "EGRESOS", "TRANSFERENCIA"]);

function normDepto(v) {
  const u = String(v || "").toUpperCase();
  return DEPTO_VALUES.includes(u) ? u : "ADMINISTRACION";
}

/** @param {import("express").Request} req */
function resolveFiscalYear(req) {
  const fy = req.session?.fiscalYear;
  return typeof fy === "number" && fy >= 1990 && fy <= 2100 ? fy : null;
}

function yearOfIsoDate(s) {
  const t = String(s || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return parseInt(t.slice(0, 4), 10);
}

app.post("/api/session/fiscal-year", requireAuth, handleSetFiscalYear);

app.get("/api/polizas", requireAuth, (req, res) => {
  const fy = resolveFiscalYear(req);
  const data = fy == null ? [] : filterPolizasByYear(fy);
  res.json({ success: true, data, fiscalYear: fy });
});

app.get("/api/polizas/next-folio", requireAuth, async (req, res) => {
  try {
    const fy = resolveFiscalYear(req);
    if (fy == null) {
      return res.status(400).json({
        success: false,
        message: "Selecciona un ejercicio fiscal para continuar.",
      });
    }
    const folio = await peekNextFolio(fy);
    res.json({ success: true, folio });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al obtener folio",
    });
  }
});

app.get("/api/catalog/sat", requireAuth, async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const out = await listSatCodigoAgrupador(q);
    if (!out.ok) {
      return res.status(503).json({
        success: false,
        message: "Catálogo SAT requiere PostgreSQL (DATABASE_URL).",
        code: out.reason,
        data: [],
      });
    }
    res.json({ success: true, data: out.rows });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al cargar código agrupador",
    });
  }
});

app.get("/api/catalog/accounts", requireAuth, async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const out = await listChartAccounts(q);
    if (!out.ok) {
      return res.status(503).json({
        success: false,
        message: "Catálogo de cuentas requiere PostgreSQL (DATABASE_URL).",
        code: out.reason,
        data: [],
      });
    }
    res.json({ success: true, data: out.rows });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al cargar cuentas",
    });
  }
});

app.post("/api/catalog/accounts", requireAuth, async (req, res) => {
  try {
    const row = await createChartAccount(req.body || {});
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al crear cuenta";
    const code = /unique|duplicate|violates/i.test(msg) ? 409 : 400;
    res.status(code).json({ success: false, message: msg });
  }
});

app.patch("/api/catalog/accounts/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Id inválido." });
    }
    const row = await updateChartAccount(id, req.body || {});
    res.json({ success: true, data: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al actualizar";
    res.status(400).json({ success: false, message: msg });
  }
});

app.get("/api/reports/dashboard", requireAuth, async (req, res) => {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    const asOf = typeof req.query.asOf === "string" ? req.query.asOf : "";
    const out = await getReportsDashboard({ from, to, asOf: asOf || undefined });
    if (!out.ok) {
      const code = out.reason === "invalid_range" ? 400 : 503;
      return res.status(code).json({
        success: false,
        message:
          out.reason === "no_database"
            ? "Reportería requiere PostgreSQL (DATABASE_URL)."
            : "Rango de fechas inválido (usa YYYY-MM-DD).",
        code: out.reason,
      });
    }
    res.json({ success: true, data: out });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al generar reportes",
    });
  }
});

function normPolizaLine(l) {
  const fx = String(l.fxCurrency || "MX").toUpperCase();
  const fxCurrency = ["MX", "USD", "CAD", "EUR"].includes(fx) ? fx : "MX";
  return {
    ticketId: String(l.ticketId || "").trim(),
    accountCode: String(l.accountCode || "").trim(),
    accountName: String(l.accountName || "").trim(),
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    lineConcept: String(l.lineConcept || "").trim(),
    invoiceUrl: String(l.invoiceUrl || "").trim(),
    fxCurrency,
    depto: normDepto(l.depto),
  };
}

app.post("/api/polizas", requireAuth, async (req, res) => {
  const fy = resolveFiscalYear(req);
  if (fy == null) {
    return res.status(400).json({
      success: false,
      message: "Selecciona un ejercicio fiscal antes de registrar pólizas.",
    });
  }

  const { type, concept, lines, polizaDate } = req.body || {};
  const typeU = String(type || "").toUpperCase();
  if (!POLIZA_TYPES.has(typeU)) {
    return res.status(400).json({
      success: false,
      message: "Tipo de póliza no válido.",
    });
  }
  if (!concept || !Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Se requiere tipo, concepto y al menos dos movimientos.",
    });
  }
  const t = totals(lines);
  if (!t.balanced) {
    return res.status(400).json({
      success: false,
      message: "La póliza debe cuadrar: suma cargos = suma abonos.",
    });
  }

  const dateStr = typeof polizaDate === "string" ? polizaDate.slice(0, 10) : "";
  const yDate = yearOfIsoDate(dateStr);
  if (yDate == null || yDate !== fy) {
    return res.status(400).json({
      success: false,
      message: "La fecha de la póliza debe pertenecer al ejercicio fiscal activo.",
    });
  }

  try {
    const row = await saveNewPoliza({
      type: typeU,
      concept: String(concept).trim(),
      polizaDate: dateStr,
      lines: lines.map(normPolizaLine),
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo guardar la póliza";
    const code = /unique|duplicate|violates/i.test(msg) ? 409 : 500;
    res.status(code).json({ success: false, message: msg });
  }
});

app.patch("/api/polizas/:id", requireAuth, async (req, res) => {
  const fy = resolveFiscalYear(req);
  if (fy == null) {
    return res.status(400).json({
      success: false,
      message: "Selecciona un ejercicio fiscal.",
    });
  }

  const id = String(req.params.id || "").trim();
  const existing = getPolizaById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Póliza no encontrada." });
  }
  const yExisting = yearOfIsoDate(String(existing.date || ""));
  if (yExisting !== fy) {
    return res.status(403).json({
      success: false,
      message: "Esta póliza no pertenece al ejercicio fiscal activo.",
    });
  }

  const { type, concept, lines, polizaDate } = req.body || {};
  const typeU = String(type || "").toUpperCase();
  if (!POLIZA_TYPES.has(typeU)) {
    return res.status(400).json({
      success: false,
      message: "Tipo de póliza no válido.",
    });
  }
  if (!concept || !Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Se requiere concepto y al menos dos movimientos.",
    });
  }
  const t = totals(lines);
  if (!t.balanced) {
    return res.status(400).json({
      success: false,
      message: "La póliza debe cuadrar: suma cargos = suma abonos.",
    });
  }

  const dateStr = typeof polizaDate === "string" ? polizaDate.slice(0, 10) : "";
  const yDate = yearOfIsoDate(dateStr);
  if (yDate == null || yDate !== fy) {
    return res.status(400).json({
      success: false,
      message: "La fecha de la póliza debe pertenecer al ejercicio fiscal activo.",
    });
  }

  try {
    const row = await updatePoliza(id, {
      type: typeU,
      concept: String(concept).trim(),
      polizaDate: dateStr,
      lines: lines.map(normPolizaLine),
    });
    res.json({ success: true, data: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo actualizar la póliza";
    res.status(400).json({ success: false, message: msg });
  }
});

app.delete("/api/polizas/:id", requireAuth, async (req, res) => {
  const fy = resolveFiscalYear(req);
  if (fy == null) {
    return res.status(400).json({
      success: false,
      message: "Selecciona un ejercicio fiscal.",
    });
  }

  const id = String(req.params.id || "").trim();
  const existing = getPolizaById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Póliza no encontrada." });
  }
  const yExisting = yearOfIsoDate(String(existing.date || ""));
  if (yExisting !== fy) {
    return res.status(403).json({
      success: false,
      message: "Esta póliza no pertenece al ejercicio fiscal activo.",
    });
  }

  try {
    await deletePoliza(id);
    res.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo eliminar la póliza";
    res.status(400).json({ success: false, message: msg });
  }
});

app.get("/login.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

function sendHtmlIfAuthed(htmlFile) {
  return (req, res) => {
    if (!req.session?.userId) {
      return res.redirect("/login.html");
    }
    res.sendFile(path.join(publicDir, htmlFile));
  };
}

app.get("/index.html", sendHtmlIfAuthed("index.html"));

app.get("/catalogo.html", sendHtmlIfAuthed("catalogo.html"));

const reportPages = [
  "report-balanza.html",
  "report-situacion-financiera.html",
  "report-actividad.html",
  "report-cambios-situacion.html",
  "report-variacion-capital.html",
  "report-flujo-efectivo.html",
];
for (const f of reportPages) {
  app.get(`/${f}`, sendHtmlIfAuthed(f));
}

app.get("/reporteria.html", (req, res) => {
  res.redirect(302, "/report-balanza.html");
});

app.get("/placeholder.html", (req, res) => {
  if (!req.session?.userId) {
    return res.redirect("/login.html");
  }
  res.sendFile(path.join(publicDir, "placeholder.html"));
});

app.use(
  express.static(publicDir, {
    index: false,
    fallthrough: true,
  })
);

app.get("/", sendHtmlIfAuthed("index.html"));

async function main() {
  await ensureDatabaseExistsIfNeeded();
  await ensureCatalogDevIfNeeded();
  await initPolizasStore(dataKey);
  app.listen(port, "0.0.0.0", () => {
    console.log(`intimo-accounting http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
