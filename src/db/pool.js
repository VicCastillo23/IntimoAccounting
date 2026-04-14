import pg from "pg";

let pool = null;

/**
 * En desarrollo, si DATABASE_URL apunta a una base que aún no existe, se conecta a `postgres`
 * y ejecuta CREATE DATABASE. En producción no hace nada (define NODE_ENV=production).
 * Desactivar: ACCOUNTING_NO_AUTO_DB=1
 */
export async function ensureDatabaseExistsIfNeeded() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || process.env.NODE_ENV === "production") return;
  if (process.env.ACCOUNTING_NO_AUTO_DB === "1") return;

  let dbName;
  try {
    const u = new URL(url);
    dbName = decodeURIComponent(u.pathname.replace(/^\//, "") || "");
  } catch {
    return;
  }
  if (!dbName || dbName === "postgres") return;

  const test = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await test.connect();
    await test.end();
    return;
  } catch (e) {
    await test.end().catch(() => {});
    if (!e || e.code !== "3D000") return;
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 8000,
  });
  await admin.connect();
  try {
    const ident = /^[a-z_][a-z0-9_]*$/i.test(dbName)
      ? dbName
      : `"${String(dbName).replace(/"/g, '""')}"`;
    await admin.query(`CREATE DATABASE ${ident}`);
    console.warn(
      `[intimo-accounting] Base "${dbName}" creada (solo desarrollo). Si faltan tablas: npm run db:migrate-all`
    );
  } finally {
    await admin.end();
  }
}

/** @returns {import("pg").Pool | null} */
export function getPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX) || 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

export async function checkDb() {
  const p = getPool();
  if (!p) {
    return { configured: false, ok: null, message: "DATABASE_URL no definida (solo almacenamiento local)" };
  }
  const client = await p.connect();
  try {
    await client.query("SELECT 1 AS ok");
    return { configured: true, ok: true };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    client.release();
  }
}
