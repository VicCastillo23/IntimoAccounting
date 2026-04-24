import bcrypt from "bcryptjs";
import { getPool } from "../db/pool.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ id: string; username: string } | null>}
 */
export async function verifyCredentialsDb(username, password) {
  const pool = getPool();
  if (!pool) return null;
  const u = String(username || "").trim();
  if (!u) return null;
  const r = await pool.query(
    `SELECT id, username, password_hash
     FROM auth.app_users
     WHERE lower(trim(username)) = lower(trim($1))
     LIMIT 1`,
    [u]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return null;
  return { id: String(row.id), username: row.username };
}

/**
 * @param {string} id
 * @returns {Promise<{ id: string; username: string } | null>}
 */
export async function getUserByIdDb(id) {
  const pool = getPool();
  if (!pool) return null;
  const sid = String(id || "").trim();
  if (!UUID_RE.test(sid)) return null;
  const r = await pool.query(
    `SELECT id, username FROM auth.app_users WHERE id = $1::uuid LIMIT 1`,
    [sid]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return { id: String(row.id), username: row.username };
}

/**
 * Si la tabla está vacía, crea el primer usuario (mismas vars que el archivo cifrado).
 */
export async function bootstrapAuthUsersIfEmpty() {
  const pool = getPool();
  if (!pool) return;
  const n = await pool.query(`SELECT COUNT(*)::int AS c FROM auth.app_users`);
  if (n.rows[0].c > 0) return;

  const isProd = process.env.NODE_ENV === "production";
  let username = process.env.ACCOUNTING_ADMIN_USER;
  let password = process.env.ACCOUNTING_ADMIN_PASSWORD;

  if (isProd) {
    if (!username || !password) {
      throw new Error(
        "La tabla auth.app_users está vacía. En producción define ACCOUNTING_ADMIN_USER y ACCOUNTING_ADMIN_PASSWORD para crear el primer usuario en PostgreSQL."
      );
    }
  } else {
    username = username || "admin";
    password = password || "admin";
    console.warn(
      "[intimo-accounting] auth.app_users vacía: creando usuario admin / admin (solo desarrollo)."
    );
  }

  const passwordHash = bcrypt.hashSync(String(password), 12);
  await pool.query(
    `INSERT INTO auth.app_users (username, password_hash) VALUES ($1, $2)`,
    [String(username).trim(), passwordHash]
  );
}
