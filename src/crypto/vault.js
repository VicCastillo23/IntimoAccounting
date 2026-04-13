import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;

/**
 * @param {string} hex64 64 caracteres hex = 32 bytes
 * @returns {Buffer}
 */
export function parseKeyHex(hex64) {
  const cleaned = String(hex64 || "").replace(/\s/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error(
      "DATA_ENCRYPTION_KEY debe ser exactamente 64 caracteres hexadecimales (32 bytes). Genera uno con: npm run gen:data-key"
    );
  }
  return Buffer.from(cleaned, "hex");
}

/**
 * Cifra texto UTF-8 (AES-256-GCM). El resultado es opaco en disco.
 * @param {string} plaintext
 * @param {Buffer} key32
 */
export function encryptUtf8(plaintext, key32) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key32, iv, { authTagLength: AUTH_TAG_LEN });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * @param {string} b64
 * @param {Buffer} key32
 * @returns {string}
 */
export function decryptUtf8(b64, key32) {
  const buf = Buffer.from(b64, "base64");
  if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) {
    throw new Error("Blob cifrado inválido o corrupto.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key32, iv, { authTagLength: AUTH_TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * @param {unknown} obj
 * @param {Buffer} key32
 */
export function encryptJson(obj, key32) {
  return encryptUtf8(JSON.stringify(obj), key32);
}

/**
 * @param {string} b64
 * @param {Buffer} key32
 */
export function decryptJson(b64, key32) {
  return JSON.parse(decryptUtf8(b64, key32));
}
