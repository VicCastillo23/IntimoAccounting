import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { initialPolizas } from "./mock/polizas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3010;

/** @type {typeof initialPolizas} */
let polizas = structuredClone(initialPolizas);
let seq = polizas.length + 1;

function nextFolio() {
  const y = new Date().getFullYear();
  const n = String(seq++).padStart(4, "0");
  return `P-${y}-${n}`;
}

function totals(lines) {
  const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "intimo-accounting",
    env: process.env.NODE_ENV || "development",
    polizasCount: polizas.length,
    note: "Mock en memoria; BD y sync con tablet en siguientes iteraciones.",
  });
});

app.get("/api/polizas", (_req, res) => {
  res.json({ success: true, data: polizas });
});

app.post("/api/polizas", (req, res) => {
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
  const row = {
    id,
    folio: nextFolio(),
    date: new Date().toISOString().slice(0, 10),
    type: String(type).toUpperCase(),
    concept: String(concept).trim(),
    sourceRef: { kind: "manual", label: null, tabletSync: false },
    lines: lines.map((l) => ({
      accountCode: String(l.accountCode || "").trim(),
      accountName: String(l.accountName || "").trim(),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    })),
  };
  polizas = [row, ...polizas];
  res.status(201).json({ success: true, data: row });
});

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`intimo-accounting http://localhost:${port}`);
});
