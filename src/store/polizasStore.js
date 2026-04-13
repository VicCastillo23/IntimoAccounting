import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initialPolizas } from "../mock/polizas.js";
import { decryptJson, encryptJson } from "../crypto/vault.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const POLIZAS_FILE = path.join(DATA_DIR, "polizas.enc");

/** Pólizas demo retiradas: se eliminan al cargar si aún están en disco. */
const REMOVED_POLIZA_IDS = new Set(["pol-001", "pol-002", "pol-003"]);
const REMOVED_POLIZA_FOLIOS = new Set(["P-2026-0001", "P-2026-0002", "P-2026-0003"]);

/** @type {Buffer} */
let _key;

/** @type {typeof initialPolizas} */
let polizas = [];
let seq = 1;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { mode: 0o700 });
}

function loadFromDisk() {
  const raw = fs.readFileSync(POLIZAS_FILE, "utf8").trim();
  const data = decryptJson(raw, _key);
  polizas = data.polizas || [];
  seq = typeof data.seq === "number" ? data.seq : polizas.length + 1;
}

function persist() {
  ensureDir();
  const payload = encryptJson({ polizas, seq }, _key);
  fs.writeFileSync(POLIZAS_FILE, payload + "\n", { mode: 0o600 });
}

/**
 * @param {Buffer} key32
 */
export function initPolizasStore(key32) {
  _key = key32;
  ensureDir();

  if (!fs.existsSync(POLIZAS_FILE)) {
    polizas = structuredClone(initialPolizas);
    seq = polizas.length + 1;
    persist();
    return;
  }

  try {
    loadFromDisk();
    const n0 = polizas.length;
    polizas = polizas.filter(
      (p) =>
        !REMOVED_POLIZA_IDS.has(String(p.id)) &&
        !REMOVED_POLIZA_FOLIOS.has(String(p.folio))
    );
    if (polizas.length !== n0) {
      persist();
    }
  } catch (e) {
    throw new Error(
      `No se pudo descifrar ${POLIZAS_FILE}. Verifica DATA_ENCRYPTION_KEY. ${e.message}`
    );
  }
}

export function getPolizas() {
  return polizas;
}

export function getSeqState() {
  return { seq, count: polizas.length };
}

/** Folio que se asignará al siguiente alta (no incrementa el contador). */
export function peekNextFolio() {
  const y = new Date().getFullYear();
  const n = String(seq).padStart(4, "0");
  return `P-${y}-${n}`;
}

export function nextFolio() {
  const y = new Date().getFullYear();
  const n = String(seq++).padStart(4, "0");
  return `P-${y}-${n}`;
}

/** @param {Record<string, unknown>} row */
export function addPoliza(row) {
  polizas = [row, ...polizas];
  persist();
}
