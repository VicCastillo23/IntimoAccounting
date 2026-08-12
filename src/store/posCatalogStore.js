import { randomUUID } from "node:crypto";
import { getPool } from "../db/pool.js";

function noDb() {
  return { ok: false, reason: "no_database" };
}

function missingTable(msg) {
  return { ok: false, reason: "missing_table", message: msg };
}

function isMissingTableError(e) {
  const msg = e instanceof Error ? e.message : String(e);
  return /relation.*catalog_|does not exist/i.test(msg);
}

/** @param {import("pg").QueryResultRow} r */
function mapCategoryRow(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    icon: r.icon,
    isActive: r.is_active,
    sortOrder: Number(r.sort_order ?? 0),
    parentCategoryId: r.parent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** @param {import("pg").QueryResultRow} r */
function mapProductRow(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    price: String(r.price ?? "0"),
    categoryId: r.category_id,
    categoryName: r.category_name ?? null,
    imageUrl: r.image_url,
    isActive: r.is_active,
    stockQuantity: r.stock_quantity != null ? Number(r.stock_quantity) : null,
    minStockLevel: r.min_stock_level != null ? Number(r.min_stock_level) : null,
    barcode: r.barcode,
    taxRatePercent: r.tax_rate_percent != null ? String(r.tax_rate_percent) : null,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** @param {import("pg").QueryResultRow} r */
function mapModifierRow(r) {
  return {
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    description: r.description,
    priceExtra: String(r.price_extra ?? "0"),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: r.is_active,
    uiGroup: r.ui_group,
    sectionTitle: r.section_title,
    sectionSortOrder: Number(r.section_sort_order ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * @param {{ q?: string, parentId?: string, activeOnly?: boolean }} opts
 */
export async function listCatalogCategories(opts = {}) {
  const pool = getPool();
  if (!pool) return { ...noDb(), rows: [] };

  const activeOnly = opts.activeOnly !== false;
  const q = String(opts.q || "").trim();
  const parentId = opts.parentId;

  const where = [];
  const params = [];
  if (activeOnly) where.push("is_active = TRUE");
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`lower(name) LIKE $${params.length}`);
  }
  if (parentId === null || parentId === "") {
    where.push("parent_id IS NULL");
  } else if (typeof parentId === "string" && parentId) {
    params.push(parentId);
    where.push(`parent_id = $${params.length}`);
  }

  const sql = `
    SELECT * FROM pos.catalog_categories
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY sort_order ASC, name ASC
  `;
  try {
    const { rows } = await pool.query(sql, params);
    return { ok: true, rows: rows.map(mapCategoryRow) };
  } catch (e) {
    if (isMissingTableError(e)) {
      return {
        ...missingTable(
          "Falta el catálogo POS. Ejecuta deploy/postgres/15_pos_catalog.sql y npm run db:seed-catalog."
        ),
        rows: [],
      };
    }
    throw e;
  }
}

/**
 * @param {{ q?: string, categoryId?: string, activeOnly?: boolean, limit?: number }} opts
 */
export async function listCatalogProducts(opts = {}) {
  const pool = getPool();
  if (!pool) return { ...noDb(), rows: [] };

  const activeOnly = opts.activeOnly !== false;
  const q = String(opts.q || "").trim();
  const categoryId = String(opts.categoryId || "").trim();
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 2000) : 2000;

  const where = [];
  const params = [];
  if (activeOnly) where.push("p.is_active = TRUE");
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(p.name) LIKE $${params.length} OR lower(COALESCE(p.description,'')) LIKE $${params.length})`);
  }
  if (categoryId) {
    params.push(categoryId);
    where.push(`p.category_id = $${params.length}`);
  }

  const sql = `
    SELECT p.*, c.name AS category_name
    FROM pos.catalog_products p
    LEFT JOIN pos.catalog_categories c ON c.id = p.category_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY c.sort_order ASC, p.sort_order ASC, p.name ASC
    LIMIT ${limit}
  `;
  try {
    const { rows } = await pool.query(sql, params);
    return { ok: true, rows: rows.map(mapProductRow) };
  } catch (e) {
    if (isMissingTableError(e)) {
      return {
        ...missingTable(
          "Falta el catálogo POS. Ejecuta deploy/postgres/15_pos_catalog.sql y npm run db:seed-catalog."
        ),
        rows: [],
      };
    }
    throw e;
  }
}

/**
 * @param {{ categoryId?: string, activeOnly?: boolean }} opts
 */
export async function listCatalogModifiers(opts = {}) {
  const pool = getPool();
  if (!pool) return { ...noDb(), rows: [] };

  const activeOnly = opts.activeOnly !== false;
  const categoryId = String(opts.categoryId || "").trim();
  const where = [];
  const params = [];
  if (activeOnly) where.push("is_active = TRUE");
  if (categoryId) {
    params.push(categoryId);
    where.push(`category_id = $${params.length}`);
  }

  const sql = `
    SELECT * FROM pos.catalog_modifier_options
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY category_id ASC, section_sort_order ASC, sort_order ASC
  `;
  try {
    const { rows } = await pool.query(sql, params);
    return { ok: true, rows: rows.map(mapModifierRow) };
  } catch (e) {
    if (isMissingTableError(e)) {
      return {
        ...missingTable("Falta el catálogo POS. Ejecuta deploy/postgres/15_pos_catalog.sql."),
        rows: [],
      };
    }
    throw e;
  }
}

/**
 * Catálogo completo o delta para la tablet (Bearer POS_INGEST_SECRET).
 * @param {{ since?: string | null, includeInactive?: boolean }} opts
 */
export async function getCatalogForSync(opts = {}) {
  const pool = getPool();
  if (!pool) return { ...noDb() };

  const sinceRaw = String(opts.since || "").trim();
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  // En delta (since), siempre incluir inactivos para que la tablet oculte/desactive productos.
  // En sync full, por defecto solo activos salvo includeInactive explícito.
  const includeInactive = opts.includeInactive === true || Boolean(since);

  const activeClause = includeInactive ? "" : " AND is_active = TRUE";
  const params = since ? [since] : [];
  const sinceClause = since ? ` AND updated_at >= $1::timestamptz` : "";

  try {
    const [cats, prods, mods, maxRow] = await Promise.all([
      pool.query(
        `SELECT * FROM pos.catalog_categories WHERE TRUE${activeClause}${sinceClause} ORDER BY sort_order ASC`,
        params
      ),
      pool.query(
        `SELECT * FROM pos.catalog_products WHERE TRUE${activeClause}${sinceClause} ORDER BY sort_order ASC, name ASC`,
        params
      ),
      pool.query(
        `SELECT * FROM pos.catalog_modifier_options WHERE TRUE${activeClause}${sinceClause}
         ORDER BY category_id ASC, section_sort_order ASC, sort_order ASC`,
        params
      ),
      pool.query(`
        SELECT GREATEST(
          COALESCE((SELECT max(updated_at) FROM pos.catalog_categories), 'epoch'::timestamptz),
          COALESCE((SELECT max(updated_at) FROM pos.catalog_products), 'epoch'::timestamptz),
          COALESCE((SELECT max(updated_at) FROM pos.catalog_modifier_options), 'epoch'::timestamptz)
        ) AS max_updated_at
      `),
    ]);

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      serverVersion: maxRow.rows[0]?.max_updated_at ?? null,
      delta: Boolean(since),
      categories: cats.rows.map(mapCategoryRow),
      products: prods.rows.map(mapProductRow),
      modifierOptions: mods.rows.map(mapModifierRow),
      counts: {
        categories: cats.rows.length,
        products: prods.rows.length,
        modifierOptions: mods.rows.length,
      },
    };
  } catch (e) {
    if (isMissingTableError(e)) {
      return missingTable("Falta el catálogo POS. Ejecuta deploy/postgres/15_pos_catalog.sql.");
    }
    throw e;
  }
}

/**
 * @param {Record<string, unknown>} body
 */
export async function updateCatalogProduct(id, body) {
  const pool = getPool();
  if (!pool) return noDb();
  const pid = String(id || "").trim();
  if (!pid) return { ok: false, reason: "validation", message: "ID de producto requerido." };

  const b = body && typeof body === "object" ? body : {};
  const fields = [];
  const params = [pid];

  const setField = (col, val, cast = "") => {
    params.push(val);
    fields.push(`${col} = $${params.length}${cast}`);
  };

  if (b.name !== undefined) {
    const name = String(b.name ?? "").trim();
    if (!name) return { ok: false, reason: "validation", message: "El nombre es obligatorio." };
    setField("name", name);
  }
  if (b.description !== undefined) setField("description", b.description ? String(b.description) : null);
  if (b.price !== undefined) {
    const price = Number(b.price);
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, reason: "validation", message: "Precio inválido." };
    }
    setField("price", price);
  }
  if (b.categoryId !== undefined || b.category_id !== undefined) {
    setField("category_id", String(b.categoryId ?? b.category_id ?? "").trim());
  }
  if (b.isActive !== undefined || b.is_active !== undefined) {
    setField("is_active", Boolean(b.isActive ?? b.is_active));
  }
  if (b.stockQuantity !== undefined || b.stock_quantity !== undefined) {
    const v = b.stockQuantity ?? b.stock_quantity;
    setField("stock_quantity", v === null || v === "" ? null : Number(v));
  }
  if (b.minStockLevel !== undefined || b.min_stock_level !== undefined) {
    const v = b.minStockLevel ?? b.min_stock_level;
    setField("min_stock_level", v === null || v === "" ? null : Number(v));
  }
  if (b.taxRatePercent !== undefined || b.tax_rate_percent !== undefined) {
    const v = b.taxRatePercent ?? b.tax_rate_percent;
    setField("tax_rate_percent", v == null || v === "" ? null : String(v));
  }
  if (b.sortOrder !== undefined || b.sort_order !== undefined) {
    setField("sort_order", Number(b.sortOrder ?? b.sort_order ?? 0));
  }

  if (!fields.length) {
    return { ok: false, reason: "validation", message: "Nada que actualizar." };
  }

  try {
    const sql = `
      UPDATE pos.catalog_products SET ${fields.join(", ")}
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query(sql, params);
    if (!rows.length) return { ok: false, reason: "not_found", message: "Producto no encontrado." };
    const withCat = await pool.query(
      `SELECT p.*, c.name AS category_name FROM pos.catalog_products p
       LEFT JOIN pos.catalog_categories c ON c.id = p.category_id WHERE p.id = $1`,
      [pid]
    );
    return { ok: true, row: mapProductRow(withCat.rows[0] || rows[0]) };
  } catch (e) {
    if (isMissingTableError(e)) return missingTable("Falta migración de catálogo POS.");
    throw e;
  }
}

/**
 * @param {Record<string, unknown>} body
 */
export async function createCatalogProduct(body) {
  const pool = getPool();
  if (!pool) return noDb();

  const b = body && typeof body === "object" ? body : {};
  const name = String(b.name ?? "").trim();
  const categoryId = String(b.categoryId ?? b.category_id ?? "").trim();
  const price = Number(b.price);
  if (!name) return { ok: false, reason: "validation", message: "El nombre es obligatorio." };
  if (!categoryId) return { ok: false, reason: "validation", message: "La categoría es obligatoria." };
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, reason: "validation", message: "Precio inválido." };
  }

  const id = String(b.id ?? "").trim() || randomUUID();

  try {
    const { rows } = await pool.query(
      `INSERT INTO pos.catalog_products (
        id, name, description, price, category_id, is_active,
        stock_quantity, min_stock_level, tax_rate_percent, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        id,
        name,
        b.description ? String(b.description) : null,
        price,
        categoryId,
        b.isActive !== undefined ? Boolean(b.isActive) : true,
        b.stockQuantity != null ? Number(b.stockQuantity) : 100,
        b.minStockLevel != null ? Number(b.minStockLevel) : 5,
        b.taxRatePercent != null ? String(b.taxRatePercent) : "16",
        Number(b.sortOrder ?? 0),
      ]
    );
    const withCat = await pool.query(
      `SELECT p.*, c.name AS category_name FROM pos.catalog_products p
       LEFT JOIN pos.catalog_categories c ON c.id = p.category_id WHERE p.id = $1`,
      [id]
    );
    return { ok: true, row: mapProductRow(withCat.rows[0] || rows[0]) };
  } catch (e) {
    if (isMissingTableError(e)) return missingTable("Falta migración de catálogo POS.");
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate key|unique/i.test(msg)) {
      return { ok: false, reason: "validation", message: "Ya existe un producto con ese ID." };
    }
    throw e;
  }
}

/**
 * Crea una categoría hoja con nombre libre (compatible con sync tablet: padre pN + hoja numérica).
 * @param {Record<string, unknown>} body
 */
export async function createCatalogCategory(body) {
  const pool = getPool();
  if (!pool) return noDb();

  const b = body && typeof body === "object" ? body : {};
  const name = String(b.name ?? "").trim();
  if (!name) return { ok: false, reason: "validation", message: "El nombre de la categoría es obligatorio." };
  if (name.length > 120) {
    return { ok: false, reason: "validation", message: "El nombre es demasiado largo (máx. 120)." };
  }

  const color = String(b.color || "#666666").trim() || "#666666";
  let parentId = String(b.parentCategoryId ?? b.parentId ?? b.parent_id ?? "").trim();

  try {
    if (parentId) {
      const parent = await pool.query(
        `SELECT id, parent_id FROM pos.catalog_categories WHERE id = $1 LIMIT 1`,
        [parentId]
      );
      if (!parent.rows.length) {
        return { ok: false, reason: "validation", message: "La categoría padre no existe." };
      }
      if (parent.rows[0].parent_id != null) {
        return { ok: false, reason: "validation", message: "Debes elegir una familia (categoría padre)." };
      }
    } else {
      const maxParent = await pool.query(`
        SELECT COALESCE(
          MAX(
            CASE
              WHEN id ~ '^p[0-9]+$' THEN CAST(substring(id from 2) AS integer)
              ELSE 0
            END
          ),
          0
        )::int AS n
        FROM pos.catalog_categories
        WHERE parent_id IS NULL
      `);
      const nextParentN = Number(maxParent.rows[0]?.n || 0) + 1;
      parentId = `p${nextParentN}`;
      const parentSort = await pool.query(
        `SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS s FROM pos.catalog_categories WHERE parent_id IS NULL`
      );
      await pool.query(
        `INSERT INTO pos.catalog_categories (
          id, name, description, color, icon, is_active, sort_order, parent_id
        ) VALUES ($1,$2,NULL,$3,NULL,TRUE,$4,NULL)`,
        [parentId, name, color, Number(parentSort.rows[0]?.s || nextParentN)]
      );
    }

    const maxLeaf = await pool.query(`
      SELECT COALESCE(
        MAX(
          CASE
            WHEN id ~ '^[0-9]+$' THEN CAST(id AS integer)
            ELSE 0
          END
        ),
        0
      )::int AS n
      FROM pos.catalog_categories
      WHERE parent_id IS NOT NULL
    `);
    const leafId = String(Number(maxLeaf.rows[0]?.n || 0) + 1);
    const leafSort = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS s FROM pos.catalog_categories WHERE parent_id = $1`,
      [parentId]
    );

    const { rows } = await pool.query(
      `INSERT INTO pos.catalog_categories (
        id, name, description, color, icon, is_active, sort_order, parent_id
      ) VALUES ($1,$2,NULL,$3,NULL,TRUE,$4,$5)
      RETURNING *`,
      [leafId, name, color, Number(leafSort.rows[0]?.s || 1), parentId]
    );

    return { ok: true, row: mapCategoryRow(rows[0]), parentId };
  } catch (e) {
    if (isMissingTableError(e)) return missingTable("Falta migración de catálogo POS.");
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate key|unique/i.test(msg)) {
      return { ok: false, reason: "validation", message: "Ya existe una categoría con ese identificador. Reintenta." };
    }
    throw e;
  }
}

/**
 * @param {Record<string, unknown>} body
 */
export async function updateCatalogCategory(id, body) {
  const pool = getPool();
  if (!pool) return noDb();
  const cid = String(id || "").trim();
  if (!cid) return { ok: false, reason: "validation", message: "ID de categoría requerido." };

  const b = body && typeof body === "object" ? body : {};
  const fields = [];
  const params = [cid];
  const setField = (col, val) => {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  };

  if (b.name !== undefined) {
    const name = String(b.name ?? "").trim();
    if (!name) return { ok: false, reason: "validation", message: "El nombre es obligatorio." };
    setField("name", name);
  }
  if (b.color !== undefined) setField("color", String(b.color || "#666666"));
  if (b.isActive !== undefined || b.is_active !== undefined) {
    setField("is_active", Boolean(b.isActive ?? b.is_active));
  }
  if (b.sortOrder !== undefined || b.sort_order !== undefined) {
    setField("sort_order", Number(b.sortOrder ?? b.sort_order ?? 0));
  }

  if (!fields.length) {
    return { ok: false, reason: "validation", message: "Nada que actualizar." };
  }

  try {
    const { rows } = await pool.query(
      `UPDATE pos.catalog_categories SET ${fields.join(", ")} WHERE id = $1 RETURNING *`,
      params
    );
    if (!rows.length) return { ok: false, reason: "not_found", message: "Categoría no encontrada." };
    return { ok: true, row: mapCategoryRow(rows[0]) };
  } catch (e) {
    if (isMissingTableError(e)) return missingTable("Falta migración de catálogo POS.");
    throw e;
  }
}

export async function getCatalogStats() {
  const pool = getPool();
  if (!pool) return { ...noDb() };
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM pos.catalog_categories WHERE is_active) AS categories,
        (SELECT count(*)::int FROM pos.catalog_products WHERE is_active) AS products,
        (SELECT count(*)::int FROM pos.catalog_modifier_options WHERE is_active) AS modifiers,
        (SELECT max(updated_at) FROM pos.catalog_products) AS last_product_update
    `);
    return { ok: true, stats: rows[0] };
  } catch (e) {
    if (isMissingTableError(e)) return missingTable("Falta migración de catálogo POS.");
    throw e;
  }
}
