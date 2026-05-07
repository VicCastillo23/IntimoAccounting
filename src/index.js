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
import { initUsersStoreAsync } from "./auth/usersStore.js";
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
import { checkDb, ensureDatabaseExistsIfNeeded, getPool } from "./db/pool.js";
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
import {
  importReceivedInvoicesZip,
  importIssuedInvoicesZip,
  listReceivedInvoices,
  getReceivedInvoiceById,
  updateReceivedInvoiceStatus,
  listIssuedInvoicesBase,
  getIssuedInvoicesByPrefixedIds,
  getIssuedInvoiceDetailByPrefixedId,
  linkPaidReceivedInvoice,
} from "./store/receivedInvoicesStore.js";
import { calcularFactorActualizacion } from "./services/inegiInpc.js";
import { getBrandingForApi } from "./config/branding.js";
import {
  downloadFacturamaCfdiById,
  ensureFacturamaCsdFromEnv,
  stampFacturamaCfdi,
} from "./services/facturamaClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const app = express();
const port = Number(process.env.PORT) || 3010;

const uploadActivos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const uploadInvoicesZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
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

app.get("/api/facturama/bridge-config", requireAuth, (_req, res) => {
  const baseUrl = String(process.env.INVOICING_APP_URL || "https://facturacion.cafeintimo.mx").trim();
  res.json({
    success: true,
    data: {
      invoicingAppUrl: baseUrl,
      note: "Subpágina puente hacia el módulo de facturación Facturama.",
    },
  });
});

const DEPTO_VALUES = ["ADMINISTRACION", "SERVICIOS_GENERALES", "OTROS"];

const POLIZA_TYPES = new Set(["DIARIO", "INGRESOS", "EGRESOS", "TRANSFERENCIA"]);
const RECEIVED_INVOICE_STATUSES = new Set(["pending", "paid", "cancelled"]);

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

function respondStoreError(res, out, fallbackMessage) {
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
      message: out.message || "Falta migración de base de datos.",
      code: out.reason,
    });
  }
  if (out.reason === "validation") {
    return res.status(400).json({ success: false, message: out.message || "Datos inválidos.", code: out.reason });
  }
  if (out.reason === "not_found") {
    return res.status(404).json({ success: false, message: out.message || "No encontrado.", code: out.reason });
  }
  return res.status(400).json({ success: false, message: out.message || fallbackMessage, code: out.reason });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatCfdiEmissionDateMexico(d = new Date()) {
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const wallIso = wall.replace(" ", "T");
  const tzPart =
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Mexico_City",
      timeZoneName: "longOffset",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value || "";
  const m = tzPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetIso = m ? `${m[1]}${m[2]}:${m[3]}` : "-06:00";
  return `${wallIso}${offsetIso}`;
}

const DEFAULT_EMISOR_NAME_BY_RFC = {
  EKU9003173C9: "ESCUELA KEMPER URGATE",
};

function isGenericOrForeignRfc(rfc) {
  const v = String(rfc || "").trim().toUpperCase();
  return v === "XAXX010101000" || v === "XEXX010101000";
}

function facturamaConfigured() {
  return Boolean(process.env.FACTURAMA_USER?.trim() && process.env.FACTURAMA_PASSWORD?.trim());
}

function buildManualCfdiPayload(data) {
  const emisorRfc = String(process.env.FACTURAMA_EMISOR_RFC || "").trim().toUpperCase();
  const emisorName =
    String(process.env.FACTURAMA_EMISOR_NAME || "").trim() || DEFAULT_EMISOR_NAME_BY_RFC[emisorRfc] || "";
  const emisorRegime = String(process.env.FACTURAMA_EMISOR_FISCAL_REGIME || "601").trim();
  const expPlace = String(process.env.FACTURAMA_EXPEDITION_PLACE || "42501").trim();
  const serie = String(process.env.FACTURAMA_CFDI_SERIE || "INT").trim();
  const productCode = String(process.env.FACTURAMA_PRODUCT_CODE || "90101500").trim();
  const unitLabel = String(process.env.FACTURAMA_CFDI_UNIT_LABEL || "Unidad de servicio").trim();
  const unitCode = String(process.env.FACTURAMA_CFDI_UNIT_CODE || "E48").trim();
  const paymentForm = String(process.env.FACTURAMA_PAYMENT_FORM || "28").trim();
  const taxRate = Number(process.env.FACTURAMA_MANUAL_TAX_RATE || 0.16) || 0.16;

  const concepts = Array.isArray(data.concepts) ? data.concepts : [];
  const items = concepts.map((c) => {
    const lineTotal = round2(c.total);
    const lineTaxRate = Number(c.taxRate) >= 0 ? Number(c.taxRate) : taxRate;
    const subtotal = round2(lineTotal / (1 + lineTaxRate));
    const iva = round2(lineTotal - subtotal);
    return {
      ProductCode: String(c.productCode || productCode).trim() || productCode,
      Description: String(c.description || "").trim(),
      Unit: String(c.unitLabel || unitLabel).trim() || unitLabel,
      UnitCode: String(c.unitCode || unitCode).trim() || unitCode,
      UnitPrice: subtotal,
      Quantity: 1,
      Subtotal: subtotal,
      TaxObject: "02",
      Taxes: [{ Total: iva, Name: "IVA", Base: subtotal, Rate: lineTaxRate, IsRetention: false }],
      Total: lineTotal,
    };
  });
  const folio = `MAN-${Date.now().toString(36).toUpperCase()}`;
  const now = formatCfdiEmissionDateMexico();
  const receiverTaxZip = isGenericOrForeignRfc(data.rfc) ? expPlace : data.zipCode;
  const receiverBlock = {
    Rfc: data.rfc,
    Name: data.legalName,
    CfdiUse: data.cfdiUse,
    FiscalRegime: data.taxRegime,
    TaxZipCode: receiverTaxZip,
  };
  const street = String(data.street || "").trim();
  const exteriorNumber = String(data.extNumber || "").trim();
  const neighborhood = String(data.colony || "").trim();
  const municipality = String(data.municipality || "").trim();
  const state = String(data.state || "").trim();
  const country = String(data.country || "México").trim() || "México";
  if (street && exteriorNumber && neighborhood && municipality && state) {
    receiverBlock.Address = {
      Street: street.slice(0, 100),
      ExteriorNumber: exteriorNumber.slice(0, 30),
      Neighborhood: neighborhood.slice(0, 80),
      ZipCode: String(receiverTaxZip || "").trim(),
      Municipality: municipality.slice(0, 100),
      State: state.slice(0, 100),
      Country: country.slice(0, 50),
    };
    const int = String(data.intNumber || "").trim();
    const loc = String(data.locality || "").trim();
    if (int) receiverBlock.Address.InteriorNumber = int.slice(0, 30);
    if (loc) receiverBlock.Address.Locality = loc.slice(0, 80);
  }

  return {
    NameId: 1,
    Date: now,
    Serie: serie,
    Folio: folio,
    CfdiType: "I",
    Currency: "MXN",
    PaymentForm: paymentForm,
    PaymentMethod: "PUE",
    Exportation: "01",
    ExpeditionPlace: expPlace,
    Issuer: {
      Rfc: emisorRfc,
      Name: emisorName,
      FiscalRegime: emisorRegime,
    },
    Receiver: receiverBlock,
    Items: items,
  };
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

app.post(
  "/api/invoices/received/import-zip",
  requireAuth,
  (req, res, next) => {
    uploadInvoicesZip.single("file")(req, res, (err) => {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? "Archivo demasiado grande (máx. 30 MB)."
            : err.message || "Error al recibir el ZIP.";
        return res.status(400).json({ success: false, message: msg });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const f = req.file;
      if (!f?.buffer) {
        return res.status(400).json({ success: false, message: "Adjunta un archivo ZIP con CFDI XML." });
      }
      const name = String(f.originalname || "").toLowerCase();
      if (!name.endsWith(".zip")) {
        return res.status(400).json({ success: false, message: "Formato no soportado. Usa un .zip del SAT." });
      }
      const out = await importReceivedInvoicesZip(f.buffer, {
        sourceName: f.originalname || "cfdi-recibidas.zip",
        uploadedBy: String(req.session?.username || ""),
      });
      if (!out.ok) return respondStoreError(res, out, "No se pudo importar el ZIP.");
      res.status(201).json({ success: true, data: out });
    } catch (e) {
      res.status(500).json({
        success: false,
        message: e instanceof Error ? e.message : "Error al importar ZIP de facturas recibidas",
      });
    }
  }
);

app.get("/api/invoices/received", requireAuth, async (req, res) => {
  try {
    const out = await listReceivedInvoices({
      query: typeof req.query.query === "string" ? req.query.query : "",
      issuerRfc: typeof req.query.issuerRfc === "string" ? req.query.issuerRfc : "",
      status: typeof req.query.status === "string" ? req.query.status : "",
      from: typeof req.query.from === "string" ? req.query.from : "",
      to: typeof req.query.to === "string" ? req.query.to : "",
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 50,
    });
    if (!out.ok) return respondStoreError(res, out, "No se pudo consultar facturas recibidas.");
    res.json({ success: true, data: out });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al consultar facturas recibidas",
    });
  }
});

app.get("/api/invoices/received/:id", requireAuth, async (req, res) => {
  try {
    const out = await getReceivedInvoiceById(req.params.id);
    if (!out.ok) return respondStoreError(res, out, "No se pudo consultar la factura recibida.");
    res.json({ success: true, data: out.row });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al consultar factura recibida",
    });
  }
});

app.get("/api/invoices/received/:id/download", requireAuth, async (req, res) => {
  try {
    const format = String(req.query.format || "xml").toLowerCase();
    if (!["xml", "pdf"].includes(format)) {
      return res.status(400).json({ success: false, message: "Formato inválido." });
    }
    const out = await getReceivedInvoiceById(req.params.id);
    if (!out.ok) return respondStoreError(res, out, "No se pudo consultar la factura recibida.");
    if (format === "pdf") {
      return res.status(404).json({
        success: false,
        message: "Esta factura recibida no tiene PDF almacenado. Solo XML importado del SAT.",
      });
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="factura-recibida.xml"`);
    res.send(String(out.row?.xml_raw || ""));
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al descargar factura recibida",
    });
  }
});

app.patch("/api/invoices/received/:id/status", requireAuth, async (req, res) => {
  try {
    const status = String(req.body?.status || "").toLowerCase();
    if (!RECEIVED_INVOICE_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: "Estatus inválido." });
    }
    const out = await updateReceivedInvoiceStatus(req.params.id, /** @type {"pending"|"paid"|"cancelled"} */ (status));
    if (!out.ok) return respondStoreError(res, out, "No se pudo actualizar estatus.");
    res.json({ success: true, data: out.row });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al actualizar estatus",
    });
  }
});

app.post("/api/invoices/received/:id/pay", requireAuth, async (req, res) => {
  const fy = resolveFiscalYear(req);
  if (fy == null) {
    return res.status(400).json({
      success: false,
      message: "Selecciona un ejercicio fiscal antes de marcar facturas pagadas.",
    });
  }
  try {
    const mode = String(req.body?.mode || "").toLowerCase();
    if (!["automatic", "suggested"].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: "Modo inválido. Usa automatic o suggested.",
      });
    }

    const invoiceOut = await getReceivedInvoiceById(req.params.id);
    if (!invoiceOut.ok) return respondStoreError(res, invoiceOut, "No se encontró la factura.");
    const inv = invoiceOut.row;
    if (mode === "automatic" && inv?.poliza_id) {
      return res.status(409).json({
        success: false,
        message: "Esta factura ya está vinculada a una póliza y no puede generar otra.",
      });
    }
    const total = Number(inv.total || 0);
    const provider = String(inv.issuer_rfc || "").trim();
    const requestedPolizaDate = String(req.body?.polizaDate || "").slice(0, 10);
    const dateCandidate = String(inv.issued_at || "").slice(0, 10);
    const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(dateCandidate) ? dateCandidate : `${fy}-12-31`;
    const polizaDate = requestedPolizaDate || fallbackDate;
    const yPoliza = yearOfIsoDate(polizaDate);
    if (yPoliza == null || yPoliza !== fy) {
      return res.status(400).json({
        success: false,
        message: "La fecha de la póliza debe pertenecer al ejercicio fiscal activo.",
      });
    }

    const draft = {
      type: "EGRESOS",
      concept: `Pago factura recibida ${inv.cfdi_uuid || `${inv.series || ""}${inv.folio || ""}`}`.trim(),
      polizaDate,
      sourceRef: {
        module: "invoicing-received",
        invoicePublicId: inv.public_id,
        cfdiUuid: inv.cfdi_uuid || "",
        mode,
      },
      lines: [
        {
          ticketId: "",
          accountCode: "201.01.001",
          accountName: `Proveedores ${provider}`.trim(),
          debit: total,
          credit: 0,
          lineConcept: "Liquidación de proveedor",
          invoiceUrl: "",
          invoiceXmlUrl: `/api/invoices/received/${encodeURIComponent(String(inv.public_id || ""))}/download?format=xml`,
          fxCurrency: "MX",
          depto: "ADMINISTRACION",
        },
        {
          ticketId: "",
          accountCode: "102.01.001",
          accountName: "Bancos",
          debit: 0,
          credit: total,
          lineConcept: "Salida de bancos",
          invoiceUrl: "",
          invoiceXmlUrl: `/api/invoices/received/${encodeURIComponent(String(inv.public_id || ""))}/download?format=xml`,
          fxCurrency: "MX",
          depto: "ADMINISTRACION",
        },
      ],
    };

    if (mode === "suggested") {
      const linkOut = await linkPaidReceivedInvoice(req.params.id, null, "suggested");
      if (!linkOut.ok) return respondStoreError(res, linkOut, "No se pudo guardar modo sugerido.");
      return res.json({
        success: true,
        data: {
          mode: "suggested",
          invoice: linkOut.row,
          draftPoliza: draft,
        },
      });
    }

    const saved = await saveNewPoliza({
      type: draft.type,
      concept: draft.concept,
      polizaDate: draft.polizaDate,
      lines: draft.lines.map(normPolizaLine),
      sourceRef: draft.sourceRef,
    });
    const linkOut = await linkPaidReceivedInvoice(req.params.id, String(saved.id), "automatic");
    if (!linkOut.ok) return respondStoreError(res, linkOut, "No se pudo vincular la factura pagada.");
    res.status(201).json({
      success: true,
      data: {
        mode: "automatic",
        invoice: linkOut.row,
        poliza: saved,
      },
    });
  } catch (e) {
    const errCode = e && typeof e === "object" && "code" in e ? String(/** @type {{code?: string}} */ (e).code) : "";
    const conflict = errCode === "TICKET_IN_USE" || errCode === "TICKET_DUP_LINE";
    res.status(conflict ? 409 : 500).json({
      success: false,
      code: errCode || undefined,
      message: e instanceof Error ? e.message : "Error al registrar pago de factura recibida",
    });
  }
});

app.post("/api/invoices/received/pay-batch", requireAuth, async (req, res) => {
  const fy = resolveFiscalYear(req);
  if (fy == null) {
    return res.status(400).json({
      success: false,
      message: "Selecciona un ejercicio fiscal antes de registrar pagos.",
    });
  }
  try {
    const invoiceIdsRaw = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds : [];
    const invoiceIds = [...new Set(invoiceIdsRaw.map((x) => String(x || "").trim()).filter(Boolean))];
    if (!invoiceIds.length) {
      return res.status(400).json({ success: false, message: "Selecciona al menos una factura." });
    }
    const polizaDate = String(req.body?.polizaDate || "").slice(0, 10);
    const yPoliza = yearOfIsoDate(polizaDate);
    if (yPoliza == null || yPoliza !== fy) {
      return res.status(400).json({
        success: false,
        message: "La fecha de la póliza debe pertenecer al ejercicio fiscal activo.",
      });
    }

    /** @type {Array<any>} */
    const invoices = [];
    for (const id of invoiceIds) {
      const out = await getReceivedInvoiceById(id);
      if (!out.ok) return respondStoreError(res, out, "No se encontró una factura seleccionada.");
      if (String(out.row?.status || "") !== "pending") {
        return res.status(409).json({
          success: false,
          message: `Solo se pueden incluir facturas pendientes. ID: ${id}`,
        });
      }
      invoices.push(out.row);
    }

    const lines = [];
    for (const inv of invoices) {
      const provider = String(inv.issuer_rfc || "PROVEEDOR").trim() || "PROVEEDOR";
      const amount = Number(inv.total || 0);
      const ref = String(inv.cfdi_uuid || `${inv.series || ""}${inv.folio || ""}` || inv.public_id || "").trim();
      lines.push({
        ticketId: "",
        accountCode: "201.01.001",
        accountName: `Proveedores ${provider}`.trim(),
        debit: amount,
        credit: 0,
        lineConcept: `Liquidación factura ${ref}`.trim(),
        invoiceUrl: "",
        invoiceXmlUrl: `/api/invoices/received/${encodeURIComponent(String(inv.public_id || ""))}/download?format=xml`,
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
      });
      lines.push({
        ticketId: "",
        accountCode: "102.01.001",
        accountName: "Bancos",
        debit: 0,
        credit: amount,
        lineConcept: `Salida de bancos factura ${ref}`.trim(),
        invoiceUrl: "",
        invoiceXmlUrl: `/api/invoices/received/${encodeURIComponent(String(inv.public_id || ""))}/download?format=xml`,
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
      });
    }

    const concept = `Pago facturas recibidas (${invoices.length})`;
    const saved = await saveNewPoliza({
      type: "EGRESOS",
      concept,
      polizaDate,
      lines: lines.map(normPolizaLine),
      sourceRef: {
        module: "invoicing-received",
        mode: "automatic-batch",
        invoicePublicIds: invoices.map((i) => i.public_id),
      },
    });

    for (const inv of invoices) {
      const linkOut = await linkPaidReceivedInvoice(String(inv.public_id), String(saved.id), "automatic");
      if (!linkOut.ok) return respondStoreError(res, linkOut, "No se pudo vincular una factura al pago.");
    }

    res.status(201).json({
      success: true,
      data: {
        poliza: saved,
        linkedCount: invoices.length,
      },
    });
  } catch (e) {
    const errCode = e && typeof e === "object" && "code" in e ? String(/** @type {{code?: string}} */ (e).code) : "";
    const conflict = errCode === "TICKET_IN_USE" || errCode === "TICKET_DUP_LINE";
    res.status(conflict ? 409 : 500).json({
      success: false,
      code: errCode || undefined,
      message: e instanceof Error ? e.message : "Error al registrar pago masivo de facturas",
    });
  }
});

app.get("/api/invoices/issued", requireAuth, async (req, res) => {
  try {
    const out = await listIssuedInvoicesBase({
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 50,
    });
    if (!out.ok) return respondStoreError(res, out, "No se pudo consultar facturas emitidas.");
    res.json({ success: true, data: out });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al consultar facturas emitidas",
    });
  }
});

app.get("/api/invoices/issued/:id", requireAuth, async (req, res) => {
  try {
    const out = await getIssuedInvoiceDetailByPrefixedId(req.params.id);
    if (!out.ok) return respondStoreError(res, out, "No se pudo consultar la factura emitida.");
    res.json({ success: true, data: out.row });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al consultar factura emitida",
    });
  }
});

app.post(
  "/api/invoices/issued/import-zip",
  requireAuth,
  (req, res, next) => {
    uploadInvoicesZip.single("file")(req, res, (err) => {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? "Archivo demasiado grande (máx. 30 MB)."
            : err.message || "Error al recibir el ZIP.";
        return res.status(400).json({ success: false, message: msg });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const f = req.file;
      if (!f?.buffer) {
        return res.status(400).json({ success: false, message: "Adjunta un archivo ZIP con CFDI XML emitidos." });
      }
      const name = String(f.originalname || "").toLowerCase();
      if (!name.endsWith(".zip")) {
        return res.status(400).json({ success: false, message: "Formato no soportado. Usa un .zip del SAT." });
      }
      const out = await importIssuedInvoicesZip(f.buffer, {
        sourceName: f.originalname || "cfdi-emitidas.zip",
        uploadedBy: String(req.session?.username || ""),
      });
      if (!out.ok) return respondStoreError(res, out, "No se pudo importar el ZIP de emitidas.");
      res.status(201).json({ success: true, data: out });
    } catch (e) {
      res.status(500).json({
        success: false,
        message: e instanceof Error ? e.message : "Error al importar ZIP de facturas emitidas",
      });
    }
  }
);

app.post("/api/invoices/issued/poliza-batch", requireAuth, async (req, res) => {
  const fy = resolveFiscalYear(req);
  if (fy == null) {
    return res.status(400).json({
      success: false,
      message: "Selecciona un ejercicio fiscal antes de registrar pólizas.",
    });
  }
  try {
    const idsRaw = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds : [];
    const invoiceIds = [...new Set(idsRaw.map((x) => String(x || "").trim()).filter(Boolean))];
    if (!invoiceIds.length) {
      return res.status(400).json({ success: false, message: "Selecciona al menos una factura emitida." });
    }
    const polizaDate = String(req.body?.polizaDate || "").slice(0, 10);
    const yPoliza = yearOfIsoDate(polizaDate);
    if (yPoliza == null || yPoliza !== fy) {
      return res.status(400).json({
        success: false,
        message: "La fecha de la póliza debe pertenecer al ejercicio fiscal activo.",
      });
    }
    const out = await getIssuedInvoicesByPrefixedIds(invoiceIds);
    if (!out.ok) return respondStoreError(res, out, "No se pudieron consultar las facturas emitidas.");
    const rows = out.rows || [];
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "No se encontraron facturas emitidas seleccionadas." });
    }
    const found = new Set(rows.map((r) => String(r.id)));
    for (const id of invoiceIds) {
      if (!found.has(id)) {
        return res.status(404).json({ success: false, message: `Factura no encontrada: ${id}` });
      }
    }
    const alreadyLinkedBySourceRef = rows.filter((r) => String(r.poliza_folio || "").trim());
    /** @type {Map<string, string>} */
    const linkedByInvoiceUrl = new Map();
    const pool = getPool();
    if (pool) {
      const invoiceUrls = [...new Set(rows.map((r) => String(r.pdf_url || "").trim()).filter(Boolean))];
      const invoiceXmlUrls = [...new Set(rows.map((r) => String(r.xml_url || "").trim()).filter(Boolean))];
      if (invoiceUrls.length || invoiceXmlUrls.length) {
        const { rows: linkedRows } = await pool.query(
          `
          SELECT p.folio, pl.invoice_url, pl.invoice_xml_url
          FROM accounting.poliza_lines pl
          INNER JOIN accounting.polizas p ON p.id = pl.poliza_id
          WHERE (cardinality($1::text[]) > 0 AND pl.invoice_url = ANY($1::text[]))
             OR (cardinality($2::text[]) > 0 AND pl.invoice_xml_url = ANY($2::text[]))
          `,
          [invoiceUrls, invoiceXmlUrls]
        );
        const byUrl = new Map();
        for (const lr of linkedRows) {
          const folio = String(lr.folio || "").trim();
          const u1 = String(lr.invoice_url || "").trim();
          const u2 = String(lr.invoice_xml_url || "").trim();
          if (folio && u1 && !byUrl.has(u1)) byUrl.set(u1, folio);
          if (folio && u2 && !byUrl.has(u2)) byUrl.set(u2, folio);
        }
        for (const r of rows) {
          const hit =
            byUrl.get(String(r.xml_url || "").trim()) ||
            byUrl.get(String(r.pdf_url || "").trim()) ||
            "";
          if (hit) linkedByInvoiceUrl.set(String(r.id), hit);
        }
      }
    }
    const alreadyLinked = rows.filter(
      (r) => String(r.poliza_folio || "").trim() || linkedByInvoiceUrl.has(String(r.id))
    );
    if (alreadyLinked.length) {
      const folios = [...new Set(alreadyLinked.map((x) => String(x.poliza_folio || linkedByInvoiceUrl.get(String(x.id)) || "").trim()).filter(Boolean))];
      return res.status(409).json({
        success: false,
        message: `Hay ${alreadyLinked.length} factura(s) emitida(s) que ya tienen póliza (${folios.slice(0, 3).join(", ")}).`,
      });
    }

    const lines = [];
    for (const r of rows) {
      const amount = Number(r.total || 0);
      const customer = String(r.customer_rfc || "CLIENTES DIVERSOS").trim() || "CLIENTES DIVERSOS";
      const ref = String(r.cfdi_uuid || `${r.series || ""}${r.folio || ""}` || r.public_id || "").trim();
      lines.push({
        ticketId: "",
        accountCode: "102.01.001",
        accountName: "Bancos",
        debit: amount,
        credit: 0,
        lineConcept: `Cobro factura emitida ${ref || customer}`.trim(),
        invoiceUrl: String(r.pdf_url || "").trim(),
        invoiceXmlUrl: String(r.xml_url || "").trim(),
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
      });
      lines.push({
        ticketId: "",
        accountCode: "401.01.001",
        accountName: "Ingresos por ventas",
        debit: 0,
        credit: amount,
        lineConcept: `Ingreso por factura emitida ${ref || customer}`.trim(),
        invoiceUrl: String(r.pdf_url || "").trim(),
        invoiceXmlUrl: String(r.xml_url || "").trim(),
        fxCurrency: "MX",
        depto: "ADMINISTRACION",
      });
    }

    const saved = await saveNewPoliza({
      type: "INGRESOS",
      concept: `Cobro facturas emitidas (${rows.length})`,
      polizaDate,
      lines: lines.map(normPolizaLine),
      sourceRef: {
        module: "invoicing-issued",
        mode: "automatic-batch",
        invoiceIds,
      },
    });
    res.status(201).json({
      success: true,
      data: {
        poliza: saved,
        linkedCount: rows.length,
      },
    });
  } catch (e) {
    const errCode = e && typeof e === "object" && "code" in e ? String(/** @type {{code?: string}} */ (e).code) : "";
    const conflict = errCode === "TICKET_IN_USE" || errCode === "TICKET_DUP_LINE";
    res.status(conflict ? 409 : 500).json({
      success: false,
      code: errCode || undefined,
      message: e instanceof Error ? e.message : "Error al registrar póliza masiva de facturas emitidas",
    });
  }
});

/** Facturación manual vía Facturama (alias legacy: /api/facturama/manual/emitir). */
async function handleManualFacturacionEmitir(req, res) {
  try {
    if (!facturamaConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Facturama no configurado en Accounting (FACTURAMA_USER / FACTURAMA_PASSWORD).",
      });
    }
    const receiver = req.body?.receiver || {};
    const invoice = req.body?.invoice || {};
    const rfc = String(receiver.rfc || "").trim().toUpperCase();
    const legalName = String(receiver.legalName || "").trim();
    const taxRegime = String(receiver.taxRegime || "").trim();
    const cfdiUse = String(receiver.cfdiUse || "").trim();
    const zipCode = String(receiver.zipCode || "").trim();
    const street = String(receiver.street || "").trim();
    const extNumber = String(receiver.extNumber || "").trim();
    const intNumber = String(receiver.intNumber || "").trim();
    const colony = String(receiver.colony || "").trim();
    const municipality = String(receiver.municipality || "").trim();
    const locality = String(receiver.locality || "").trim();
    const state = String(receiver.state || "").trim();
    const country = String(receiver.country || "México").trim() || "México";
    const concepts = Array.isArray(invoice.concepts)
      ? invoice.concepts
          .map((x) => ({
            description: String(x?.description || "").trim(),
            total: Number(x?.total || 0),
            productCode: String(x?.productCode || "").trim(),
            unitCode: String(x?.unitCode || "").trim(),
            unitLabel: String(x?.unitLabel || "").trim(),
            taxRate: Number(x?.taxRate || 0.16),
          }))
          .filter((x) => x.description && x.total > 0)
      : [];
    const total = concepts.reduce((s, x) => s + (Number(x.total) || 0), 0);
    const emisorRfc = String(process.env.FACTURAMA_EMISOR_RFC || "").trim().toUpperCase();
    const emisorName =
      String(process.env.FACTURAMA_EMISOR_NAME || "").trim() || DEFAULT_EMISOR_NAME_BY_RFC[emisorRfc] || "";
    const expeditionPlace = String(process.env.FACTURAMA_EXPEDITION_PLACE || "42501").trim();

    if (!/^([A-Z&Ñ]{3,4})\d{6}[A-Z0-9]{3}$/.test(rfc)) {
      return res.status(422).json({ success: false, message: "RFC inválido." });
    }
    if (!legalName || !taxRegime || !cfdiUse || !/^\d{5}$/.test(zipCode) || !concepts.length || !(total > 0)) {
      return res.status(422).json({
        success: false,
        message: "Faltan datos requeridos (nombre, régimen, uso CFDI, CP y conceptos).",
      });
    }
    if (!emisorRfc) {
      return res.status(422).json({
        success: false,
        message: "Falta FACTURAMA_EMISOR_RFC en .env.",
      });
    }
    if (!emisorName) {
      return res.status(422).json({
        success: false,
        message: "Falta FACTURAMA_EMISOR_NAME en .env para ese RFC emisor.",
      });
    }
    if (!/^\d{5}$/.test(expeditionPlace)) {
      return res.status(422).json({
        success: false,
        message: "FACTURAMA_EXPEDITION_PLACE debe ser un código postal de 5 dígitos.",
      });
    }

    const payload = buildManualCfdiPayload({
      rfc,
      legalName,
      taxRegime,
      cfdiUse,
      zipCode,
      street,
      extNumber,
      intNumber,
      colony,
      municipality,
      locality,
      state,
      country,
      concepts,
    });

    // Misma lógica operativa que Invoicing: si CSD existe en .env, registrar/validar en Facturama.
    await ensureFacturamaCsdFromEnv();
    const raw = await stampFacturamaCfdi(payload);
    const uuid = String(raw?.Complement?.TaxStamp?.Uuid || "").trim();
    const facturamaId = String(raw?.Id || "").trim();
    const folio = String(raw?.Folio || payload.Folio || "");
    const issuedAt = String(raw?.Date || new Date().toISOString());

    const xmlPath = `/api/facturacion/manual/${encodeURIComponent(uuid || facturamaId)}/download?format=xml`;
    const pdfPath = `/api/facturacion/manual/${encodeURIComponent(uuid || facturamaId)}/download?format=pdf`;

    const pool = getPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO invoicing.invoices
             (folio, series, cfdi_uuid, customer_rfc, issuer_rfc, total, currency, status, pdf_url, xml_url, meta, issued_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'MXN', 'issued_manual', $7, $8, $9::jsonb, $10::timestamptz)`,
          [
            folio,
            String(raw?.Serie || payload.Serie || "INT"),
            uuid || null,
            rfc,
            String(process.env.FACTURAMA_EMISOR_RFC || "").trim().toUpperCase(),
            total,
            pdfPath,
            xmlPath,
            JSON.stringify({ facturamaId, source: "accounting_manual" }),
            issuedAt,
          ]
        );
      } catch {
        /* no bloquear respuesta si falla registro local */
      }
    }

    res.status(201).json({
      success: true,
      data: {
        uuid: uuid || null,
        facturamaId,
        folio,
        downloads: { xml: xmlPath, pdf: pdfPath },
      },
    });
  } catch (e) {
    const status =
      (typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : null) ||
      e?.response?.status ||
      500;
    const msg =
      e?.body?.Message ||
      e?.body?.message ||
      e?.response?.data?.Message ||
      e?.response?.data?.message ||
      e?.message ||
      "No se pudo timbrar";
    res.status(status).json({ success: false, message: String(msg), details: e?.body || null });
  }
}

app.post("/api/facturacion/manual/emitir", requireAuth, handleManualFacturacionEmitir);
app.post("/api/facturama/manual/emitir", requireAuth, handleManualFacturacionEmitir);

app.get("/api/facturacion/manual/:id/download", requireAuth, async (req, res) => {
  try {
    if (!facturamaConfigured()) {
      return res.status(503).json({ success: false, message: "Facturama no configurado." });
    }
    const format = String(req.query.format || "xml").toLowerCase();
    if (!["xml", "pdf"].includes(format)) {
      return res.status(400).json({ success: false, message: "Formato inválido." });
    }
    const key = String(req.params.id || "").trim();
    const pool = getPool();
    let facturamaId = key;
    if (pool) {
      const { rows } = await pool.query(
        `SELECT meta
           FROM invoicing.invoices
          WHERE upper(coalesce(cfdi_uuid, '')) = upper($1) OR public_id::text = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [key]
      );
      const id = rows[0]?.meta?.facturamaId;
      if (id) facturamaId = String(id);
    }
    if (!facturamaId || facturamaId === key) {
      return res.status(404).json({
        success: false,
        message:
          "No se encontró el identificador de Facturama para esta factura. Revisa que se haya timbrado y guardado correctamente.",
      });
    }

    const dl = await downloadFacturamaCfdiById(facturamaId, format);
    res.setHeader("Content-Type", dl.contentType);
    res.setHeader("Content-Disposition", `inline; filename="cfdi-manual.${format}"`);
    res.send(dl.buffer);
  } catch (e) {
    const status =
      (typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : null) ||
      e?.response?.status ||
      500;
    const msg =
      e?.body?.Message ||
      e?.body?.message ||
      e?.response?.data?.Message ||
      e?.response?.data?.message ||
      e?.message ||
      "No se pudo descargar";
    res.status(status).json({ success: false, message: String(msg), details: e?.body || null });
  }
});

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
    const compareAsOf = typeof req.query.compareAsOf === "string" ? req.query.compareAsOf : "";
    const compareFrom = typeof req.query.compareFrom === "string" ? req.query.compareFrom : "";
    const compareTo = typeof req.query.compareTo === "string" ? req.query.compareTo : "";
    const out = await getReportsDashboard({
      from,
      to,
      asOf: asOf || undefined,
      compareAsOf: compareAsOf || undefined,
      compareFrom: compareFrom || undefined,
      compareTo: compareTo || undefined,
    });
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
    invoiceXmlUrl: String(l.invoiceXmlUrl || "").trim(),
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
    const errCode = e && typeof e === "object" && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
    const conflict =
      /unique|duplicate|violates/i.test(msg) ||
      errCode === "TICKET_IN_USE" ||
      errCode === "TICKET_DUP_LINE";
    const code = conflict ? 409 : 500;
    res.status(code).json({ success: false, message: msg, code: errCode || undefined });
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
    const errCode = e && typeof e === "object" && "code" in e ? String(/** @type {{ code?: string }} */ (e).code) : "";
    if (errCode === "TICKET_IN_USE" || errCode === "TICKET_DUP_LINE") {
      return res.status(409).json({ success: false, message: msg, code: errCode });
    }
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
app.get("/facturas-recibidas.html", sendHtmlIfAuthed("facturas-recibidas.html"));
app.get("/facturas-emitidas.html", sendHtmlIfAuthed("facturas-emitidas.html"));
app.get("/facturas-emitidas-facturama.html", sendHtmlIfAuthed("facturas-emitidas-facturama.html"));

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
    await initUsersStoreAsync(dataKey);
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
