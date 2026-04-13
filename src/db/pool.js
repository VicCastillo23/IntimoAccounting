import pg from "pg";

let pool = null;

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
