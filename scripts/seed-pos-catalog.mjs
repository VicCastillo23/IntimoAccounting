#!/usr/bin/env node
/**
 * Carga inicial del catálogo POS (carta) al servidor: pos.catalog_categories,
 * pos.catalog_products, pos.catalog_modifier_options.
 *
 * Uso:
 *   node scripts/seed-pos-catalog.mjs           # solo si las tablas están vacías
 *   node scripts/seed-pos-catalog.mjs --force   # upsert aunque ya haya datos
 *   node scripts/seed-pos-catalog.mjs --dry     # no escribe, solo reporta conteos
 *
 * Requiere DATABASE_URL. Ejecutar en el servidor (o local apuntando a la BD).
 */
import pg from "pg";
import "../src/loadEnv.js";
import { buildCatalog } from "./pos-catalog-data.mjs";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const dry = argv.includes("--dry");

const url = String(process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL no está definida.");
  process.exit(1);
}

const { categories, products, modifiers } = buildCatalog();

const pool = new pg.Pool({ connectionString: url, max: 1 });

async function main() {
  const client = await pool.connect();
  try {
    const { rows: cnt } = await client.query(`
      SELECT
        (SELECT count(*) FROM pos.catalog_categories) AS categories,
        (SELECT count(*) FROM pos.catalog_products) AS products,
        (SELECT count(*) FROM pos.catalog_modifier_options) AS modifiers
    `);
    const existing = cnt[0];
    console.error(`Existente en servidor → categorías=${existing.categories} productos=${existing.products} modificadores=${existing.modifiers}`);
    console.error(`A cargar desde seed   → categorías=${categories.length} productos=${products.length} modificadores=${modifiers.length}`);

    if (dry) {
      console.error("(--dry) No se escribió nada.");
      return;
    }

    const hasData = Number(existing.categories) + Number(existing.products) + Number(existing.modifiers) > 0;
    if (hasData && !force) {
      console.error("Ya hay datos en el catálogo. Usa --force para hacer upsert (sobrescribe con el seed).");
      return;
    }

    await client.query("BEGIN");

    for (const c of categories) {
      await client.query(
        `INSERT INTO pos.catalog_categories (id, name, description, color, icon, is_active, sort_order, parent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, description=EXCLUDED.description, color=EXCLUDED.color,
           icon=EXCLUDED.icon, is_active=EXCLUDED.is_active, sort_order=EXCLUDED.sort_order,
           parent_id=EXCLUDED.parent_id`,
        [c.id, c.name, c.description, c.color, c.icon, c.isActive, c.sortOrder, c.parentId]
      );
    }

    for (const p of products) {
      await client.query(
        `INSERT INTO pos.catalog_products (id, name, description, price, category_id, is_active, stock_quantity, min_stock_level, tax_rate_percent, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price,
           category_id=EXCLUDED.category_id, is_active=EXCLUDED.is_active,
           stock_quantity=EXCLUDED.stock_quantity, min_stock_level=EXCLUDED.min_stock_level,
           tax_rate_percent=EXCLUDED.tax_rate_percent, sort_order=EXCLUDED.sort_order`,
        [p.id, p.name, p.description, p.price, p.categoryId, p.isActive, p.stockQuantity, p.minStockLevel, p.taxRatePercent, p.sortOrder]
      );
    }

    for (const m of modifiers) {
      await client.query(
        `INSERT INTO pos.catalog_modifier_options (id, category_id, name, description, price_extra, sort_order, is_active, ui_group, section_title, section_sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description,
           price_extra=EXCLUDED.price_extra, sort_order=EXCLUDED.sort_order, is_active=EXCLUDED.is_active,
           ui_group=EXCLUDED.ui_group, section_title=EXCLUDED.section_title, section_sort_order=EXCLUDED.section_sort_order`,
        [m.id, m.categoryId, m.name, m.description, m.priceExtra, m.sortOrder, m.isActive, m.uiGroup, m.sectionTitle, m.sectionSortOrder]
      );
    }

    await client.query("COMMIT");
    console.error("Catálogo cargado correctamente.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
