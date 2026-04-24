import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { decryptJson, encryptJson } from "../crypto/vault.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.enc");

/** @type {Buffer} */
let _key;
/** @type {{ users: Array<{ id: string; username: string; passwordHash: string }> }} */
let _cache = { users: [] };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { mode: 0o700 });
}

function readEncrypted() {
  const raw = fs.readFileSync(USERS_FILE, "utf8").trim();
  return decryptJson(raw, _key);
}

function writeEncrypted(data) {
  ensureDir();
  const payload = encryptJson(data, _key);
  fs.writeFileSync(USERS_FILE, payload + "\n", { mode: 0o600 });
  _cache = data;
}

/**
 * @param {Buffer} key32
 */
export function initFileUsersStore(key32) {
  _key = key32;
  ensureDir();

  if (!fs.existsSync(USERS_FILE)) {
    bootstrapUsers();
    return;
  }

  try {
    _cache = readEncrypted();
  } catch (e) {
    throw new Error(
      `No se pudo descifrar ${USERS_FILE}. Verifica DATA_ENCRYPTION_KEY. ${e.message}`
    );
  }
}

function bootstrapUsers() {
  const isProd = process.env.NODE_ENV === "production";
  let username = process.env.ACCOUNTING_ADMIN_USER;
  let password = process.env.ACCOUNTING_ADMIN_PASSWORD;

  if (isProd) {
    if (!username || !password) {
      throw new Error(
        "En producción def ACCOUNTING_ADMIN_USER y ACCOUNTING_ADMIN_PASSWORD para crear el primer usuario."
      );
    }
  } else {
    username = username || "admin";
    password = password || "admin";
    console.warn(
      "[intimo-accounting] Usuario inicial de desarrollo: admin / admin — cámbialo con ACCOUNTING_ADMIN_* y borra data/users.enc"
    );
  }

  const id = "u-" + Date.now();
  const passwordHash = bcrypt.hashSync(password, 12);
  _cache = {
    users: [{ id, username: String(username).trim(), passwordHash }],
  };
  writeEncrypted(_cache);
}

/**
 * @param {string} username
 * @param {string} password
 */
export async function verifyCredentialsFile(username, password) {
  const u = _cache.users.find((x) => x.username === String(username).trim());
  if (!u) return null;
  const ok = await bcrypt.compare(String(password), u.passwordHash);
  if (!ok) return null;
  return { id: u.id, username: u.username };
}

export function getUserByIdFile(id) {
  const u = _cache.users.find((x) => x.id === id);
  return u ? { id: u.id, username: u.username } : null;
}
