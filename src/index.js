import "./loadEnv.js";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "node:url";
import { parseKeyHex } from "./crypto/vault.js";
import { getSessionMiddleware } from "./auth/sessionConfig.js";
import { requireAuth } from "./auth/middleware.js";
import { handleLogin, handleLogout, handleMe } from "./auth/routes.js";
import { initUsersStore } from "./auth/usersStore.js";
import {
  initPolizasStore,
  getPolizas,
  saveNewPoliza,
  peekNextFolio,
} from "./store/polizasStore.js";
import { checkDb } from "./db/pool.js";

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

const DEPTO_VALUES = ["ADMINISTRACION", "SERVICIOS_GENERALES", "OTROS"];

function normDepto(v) {
  const u = String(v || "").toUpperCase();
  return DEPTO_VALUES.includes(u) ? u : "ADMINISTRACION";
}

app.get("/api/polizas", requireAuth, (_req, res) => {
  res.json({ success: true, data: getPolizas() });
});

app.get("/api/polizas/next-folio", requireAuth, async (_req, res) => {
  try {
    const folio = await peekNextFolio();
    res.json({ success: true, folio });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e instanceof Error ? e.message : "Error al obtener folio",
    });
  }
});

app.post("/api/polizas", requireAuth, async (req, res) => {
  const { type, concept, lines } = req.body || {};
  if (!type || !concept || !Array.isArray(lines) || lines.length < 2) {
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
  const normLine = (l) => {
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
  };

  try {
    const row = await saveNewPoliza({
      type: String(type).toUpperCase(),
      concept: String(concept).trim(),
      lines: lines.map(normLine),
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo guardar la póliza";
    const code = /unique|duplicate|violates/i.test(msg) ? 409 : 500;
    res.status(code).json({ success: false, message: msg });
  }
});

app.get("/login.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

function sendAppIfAuthed(req, res) {
  if (!req.session?.userId) {
    return res.redirect("/login.html");
  }
  res.sendFile(path.join(publicDir, "index.html"));
}

app.get("/index.html", sendAppIfAuthed);

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

app.get("/", sendAppIfAuthed);

async function main() {
  await initPolizasStore(dataKey);
  app.listen(port, "0.0.0.0", () => {
    console.log(`intimo-accounting http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
