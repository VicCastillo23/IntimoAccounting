import "./loadEnv.js";
import express from "express";
import multer from "multer";
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
  getLibroDiarioEntries,
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
import { getLedgerAuxiliarMayor, getReportsDashboard } from "./store/reportsStore.js";
import { upsertPosPurchaseOrder, buildPosDayPolizaDraft } from "./store/posIngestStore.js";
import {
  buildActivosTemplateXlsx,
  importActivosFromExcelBuffer,
  listAssetInventory,
  createAssetInventoryItem,
  updateAssetInventoryItem,
} from "./store/activosStore.js";
import {
  listDepreciationSchedules,
  createDepreciationSchedule,
  updateDepreciationSchedule,
  syncDepreciationFromActivos,
} from "./store/depreciacionStore.js";
import { calcularFactorActualizacion } from "./services/inegiInpc.js";
import { getBrandingForApi } from "./config/branding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const app = express();
const port = Number(process.env.PORT) || 3010;

const uploadActivos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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

/** Ingesta de tickets de venta desde IntimoCoffeeApp (API key, sin sesión web). */
function requirePosIngestAuth(req, res, next) {
  const secret = String(process.env.POS_INGEST_SECRET || "").trim();
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: "Ingesta POS deshabilitada: define POS_INGEST_SECRET en el servidor.",
    });
  }
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (token !== secret) {
    return res.status(401).json({ success: false, message: "API key POS inválida." });
  }
  next();
}

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

/** Borrador de póliza INGRESOS desde tickets del día en pos.purchase_orders (requiere PostgreSQL). */
app.get("/api/pos/poliza-draft", requireAuth, async (req, res) => {
  const date = String(req.query.date || "").slice(0, 10);
  try {
    const out = await buildPosDayPolizaDraft(date);
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Se requiere PostgreSQL (DATABASE_URL) y tablas POS para el borrador.",
          code: out.reason,
        });
      }
      if (out.reason === "invalid_date") {
        return res.status(400).json({
          success: false,
          message: "Indica date=YYYY-MM-DD (día de las ventas POS).",
        });
      }
      return res.status(400).json({ success: false, message: "No se pudo armar el borrador." });
    }
    res.json({ success: true, data: out });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al generar borrador POS",
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

app.get("/api/activos/plantilla.xlsx", requireAuth, (_req, res) => {
  try {
    const buf = buildActivosTemplateXlsx();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="plantilla-activos.xlsx"');
    res.send(buf);
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "No se pudo generar la plantilla.",
    });
  }
});

app.get("/api/activos", requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit);
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const out = await listAssetInventory({ limit, batchId, q });
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Inventario de activos requiere PostgreSQL (DATABASE_URL).",
          code: out.reason,
          data: [],
        });
      }
      if (out.reason === "missing_table") {
        return res.status(503).json({
          success: false,
          message:
            "Falta la tabla de activos. Ejecuta npm run db:migrate-all o aplica deploy/postgres/08_asset_inventory.sql.",
          code: out.reason,
          data: [],
        });
      }
      return res.status(500).json({
        success: false,
        message: "Error al listar activos.",
        code: out.reason,
      });
    }
    res.json({ success: true, data: out.rows });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al listar activos",
    });
  }
});

app.post("/api/activos", requireAuth, async (req, res) => {
  try {
    const out = await createAssetInventoryItem(req.body || {});
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Registrar activos requiere PostgreSQL (DATABASE_URL).",
          code: out.reason,
        });
      }
      if (out.reason === "validation") {
        return res.status(400).json({ success: false, message: out.message || "Datos inválidos." });
      }
      if (out.reason === "missing_table") {
        return res.status(503).json({
          success: false,
          message: out.message || "Falta migración de activos.",
          code: out.reason,
        });
      }
      return res.status(400).json({
        success: false,
        message: out.message || "No se pudo guardar.",
      });
    }
    res.status(201).json({ success: true, data: out.row });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al crear activo",
    });
  }
});

app.patch("/api/activos/:id", requireAuth, async (req, res) => {
  try {
    const out = await updateAssetInventoryItem(req.params.id, req.body || {});
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Actualizar activos requiere PostgreSQL (DATABASE_URL).",
          code: out.reason,
        });
      }
      if (out.reason === "validation") {
        return res.status(400).json({ success: false, message: out.message || "Datos inválidos." });
      }
      if (out.reason === "not_found") {
        return res.status(404).json({ success: false, message: out.message || "No encontrado." });
      }
      if (out.reason === "missing_table") {
        return res.status(503).json({
          success: false,
          message: out.message || "Falta migración de activos.",
          code: out.reason,
        });
      }
      return res.status(400).json({
        success: false,
        message: out.message || "No se pudo actualizar.",
      });
    }
    res.json({ success: true, data: out.row });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al actualizar activo",
    });
  }
});

app.get("/api/depreciaciones", requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const fyQ = Number(req.query.fy);
    const fy =
      Number.isFinite(fyQ) && fyQ >= 1990 && fyQ <= 2100 ? Math.floor(fyQ) : undefined;
    const out = await listDepreciationSchedules({ limit, q, fy });
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Este módulo requiere PostgreSQL (DATABASE_URL).",
          code: out.reason,
          data: [],
          meta: { yearColumns: [] },
        });
      }
      if (out.reason === "missing_table") {
        return res.status(503).json({
          success: false,
          message:
            "Falta migración de depreciaciones. Ejecuta npm run db:migrate-all (archivos 09 y 10 en deploy/postgres).",
          code: out.reason,
          data: [],
          meta: { yearColumns: [] },
        });
      }
      return res.status(500).json({
        success: false,
        message: "Error al listar registros.",
        code: out.reason,
      });
    }
    res.json({
      success: true,
      data: out.rows,
      meta: { yearColumns: out.yearColumns ?? [] },
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al listar depreciaciones",
    });
  }
});

app.post("/api/depreciaciones/sync-from-activos", requireAuth, async (req, res) => {
  try {
    const out = await syncDepreciationFromActivos();
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Este módulo requiere PostgreSQL (DATABASE_URL).",
          code: out.reason,
        });
      }
      if (out.reason === "missing_table") {
        return res.status(503).json({
          success: false,
          message: out.message || "Falta migración.",
          code: out.reason,
        });
      }
      return res.status(400).json({
        success: false,
        message: out.message || "No se pudo sincronizar.",
      });
    }
    res.status(201).json({ success: true, data: { inserted: out.inserted ?? 0 } });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al sincronizar",
    });
  }
});

app.get("/api/inpc/factor", requireAuth, async (req, res) => {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      return res.status(400).json({
        success: false,
        message: "Indica from=YYYY-MM y to=YYYY-MM (mes del INPC a comparar).",
      });
    }
    const [fy, fm] = from.split("-").map((x) => Number(x));
    const [ty, tm] = to.split("-").map((x) => Number(x));
    const data = await calcularFactorActualizacion(fy, fm, ty, tm);
    res.json({ success: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /** @type {{ code?: string }} */ (e).code;
    const status = code === "missing_token" ? 503 : 502;
    res.status(status).json({ success: false, message: msg });
  }
});

app.post("/api/depreciaciones", requireAuth, async (req, res) => {
  try {
    const out = await createDepreciationSchedule(req.body || {});
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Este módulo requiere PostgreSQL (DATABASE_URL).",
          code: out.reason,
        });
      }
      if (out.reason === "validation") {
        return res.status(400).json({ success: false, message: out.message || "Datos inválidos." });
      }
      if (out.reason === "missing_table") {
        return res.status(503).json({
          success: false,
          message: out.message || "Falta migración.",
          code: out.reason,
        });
      }
      return res.status(400).json({
        success: false,
        message: out.message || "No se pudo guardar.",
      });
    }
    res.status(201).json({ success: true, data: out.row });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al crear registro",
    });
  }
});

app.patch("/api/depreciaciones/:id", requireAuth, async (req, res) => {
  try {
    const out = await updateDepreciationSchedule(req.params.id, req.body || {});
    if (!out.ok) {
      if (out.reason === "no_database") {
        return res.status(503).json({
          success: false,
          message: "Este módulo requiere PostgreSQL (DATABASE_URL).",
          code: out.reason,
        });
      }
      if (out.reason === "validation") {
        return res.status(400).json({ success: false, message: out.message || "Datos inválidos." });
      }
      if (out.reason === "not_found") {
        return res.status(404).json({ success: false, message: out.message || "No encontrado." });
      }
      if (out.reason === "missing_table") {
        return res.status(503).json({
          success: false,
          message: out.message || "Falta migración.",
          code: out.reason,
        });
      }
      return res.status(400).json({
        success: false,
        message: out.message || "No se pudo actualizar.",
      });
    }
    res.json({ success: true, data: out.row });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al actualizar registro",
    });
  }
});

app.post(
  "/api/activos/import",
  requireAuth,
  (req, res, next) => {
    uploadActivos.single("file")(req, res, (err) => {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? "Archivo demasiado grande (máx. 8 MB)."
            : err.message || "Error al recibir el archivo.";
        return res.status(400).json({ success: false, message: msg });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const f = req.file;
      if (!f?.buffer) {
        return res.status(400).json({ success: false, message: "Adjunta un archivo Excel (.xlsx o .xls)." });
      }
      const name = String(f.originalname || "").toLowerCase();
      if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
        return res.status(400).json({
          success: false,
          message: "Formato no soportado. Usa Excel .xlsx o .xls.",
        });
      }
      const out = await importActivosFromExcelBuffer(f.buffer, f.originalname || "import.xlsx");
      if (!out.ok) {
        if (out.reason === "no_database") {
          return res.status(503).json({
            success: false,
            message: "Importar activos requiere PostgreSQL (DATABASE_URL).",
            code: out.reason,
          });
        }
        if (out.reason === "parse_error") {
          return res.status(400).json({ success: false, message: out.message || "Archivo inválido." });
        }
        if (out.reason === "missing_table") {
          return res.status(503).json({
            success: false,
            message: out.message || "Falta migración de activos.",
            code: out.reason,
          });
        }
        return res.status(400).json({
          success: false,
          message: out.message || "No se pudo importar.",
        });
      }
      res.status(201).json({ success: true, data: out });
    } catch (e) {
      res.status(500).json({
        success: false,
        message: e instanceof Error ? e.message : "Error al importar",
      });
    }
  }
);

app.post("/api/pos/purchase-orders", requirePosIngestAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const row = await upsertPosPurchaseOrder({
      externalId: b.externalId,
      source: b.source,
      occurredAt: b.occurredAt,
      currency: b.currency,
      subtotal: b.subtotal,
      tax: b.tax,
      total: b.total,
      loyaltyCustomerId: b.loyaltyCustomerId,
      lines: b.lines,
      rawPayload: b.rawPayload,
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al guardar ticket POS";
    const code =
      e && typeof e === "object" && "code" in e && e.code === "BAD_REQUEST" ? 400 : 500;
    res.status(code).json({ success: false, message: msg });
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

app.get("/api/reports/auxiliar-mayor", requireAuth, async (req, res) => {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    const account = typeof req.query.account === "string" ? req.query.account : "";
    const out = await getLedgerAuxiliarMayor({ from, to, accountCode: account });
    if (!out.ok) {
      const code =
        out.reason === "invalid_range" || out.reason === "missing_account"
          ? 400
          : out.reason === "no_database"
            ? 503
            : 500;
      const message =
        out.reason === "no_database"
          ? "Auxiliar requiere PostgreSQL (DATABASE_URL)."
          : out.reason === "missing_account"
            ? "Indica el número de cuenta (NumCta)."
            : out.reason === "invalid_range"
              ? "Rango de fechas inválido (usa YYYY-MM-DD)."
              : "No se pudo generar el auxiliar.";
      return res.status(code).json({ success: false, message, code: out.reason });
    }
    res.json({ success: true, data: out });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al generar auxiliar de mayor",
    });
  }
});

app.get("/api/reports/libro-diario", requireAuth, (req, res) => {
  const fy = resolveFiscalYear(req);
  if (fy == null) {
    return res.status(400).json({
      success: false,
      message: "Selecciona un ejercicio fiscal antes de consultar el libro diario.",
    });
  }
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const out = getLibroDiarioEntries({ from, to, fiscalYear: fy });
  if (!out.ok) {
    const message =
      out.reason === "invalid_range"
        ? "Rango de fechas inválido (usa YYYY-MM-DD)."
        : "No se pudo armar el libro diario.";
    return res.status(400).json({ success: false, message, code: out.reason });
  }
  res.json({ success: true, data: out });
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

  const { type, concept, lines, polizaDate, sourceRef } = req.body || {};
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
      sourceRef,
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
app.get("/auxiliar-mayor.html", sendHtmlIfAuthed("auxiliar-mayor.html"));
app.get("/libro-diario.html", sendHtmlIfAuthed("libro-diario.html"));
app.get("/activos.html", sendHtmlIfAuthed("activos.html"));
app.get("/amortizaciones.html", sendHtmlIfAuthed("amortizaciones.html"));

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
  try {
    await ensureDatabaseExistsIfNeeded();
    await ensureCatalogDevIfNeeded();
    await initPolizasStore(dataKey);
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : undefined;
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT") {
      console.error(
        "[intimo-accounting] No hay PostgreSQL en la dirección de DATABASE_URL (.env).\n" +
          "  Arranque local (cluster en .pgdata, puerto 5433): npm run setup:local\n" +
          "  Migraciones: npm run db:migrate-all\n" +
          "  O apunta DATABASE_URL a tu instancia (RDS, Docker, etc.)."
      );
    }
    throw err;
  }
  app.listen(port, "0.0.0.0", () => {
    console.log(`intimo-accounting http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
