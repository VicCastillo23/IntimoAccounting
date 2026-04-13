import "dotenv/config";
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
  addPoliza,
  nextFolio,
  peekNextFolio,
} from "./store/polizasStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const app = express();
const port = Number(process.env.PORT) || 3010;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const dataKey = parseKeyHex(process.env.DATA_ENCRYPTION_KEY);
initUsersStore(dataKey);
initPolizasStore(dataKey);

app.use(getSessionMiddleware(session));
app.use(express.json({ limit: "512kb" }));

function totals(lines) {
  const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "intimo-accounting",
    env: process.env.NODE_ENV || "development",
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

app.get("/api/polizas/next-folio", requireAuth, (_req, res) => {
  res.json({ success: true, folio: peekNextFolio() });
});

app.post("/api/polizas", requireAuth, (req, res) => {
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
  const id = `pol-${Date.now()}`;
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

  const row = {
    id,
    folio: nextFolio(),
    date: new Date().toISOString().slice(0, 10),
    type: String(type).toUpperCase(),
    concept: String(concept).trim(),
    sourceRef: { kind: "manual", label: null, tabletSync: false },
    accountingBatchDate: null,
    lines: lines.map(normLine),
  };
  addPoliza(row);
  res.status(201).json({ success: true, data: row });
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

app.listen(port, "0.0.0.0", () => {
  console.log(`intimo-accounting http://localhost:${port}`);
});
