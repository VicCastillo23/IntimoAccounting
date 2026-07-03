-- Catálogo POS (carta): categorías, productos y modificadores.
-- Fuente de verdad en el servidor; la tablet (IntimoCoffeeApp) sincroniza en modo lectura.
SET search_path TO pos, public;

-- ── Categorías (jerarquía de 2 niveles: parent_id NULL = familia) ───────────
CREATE TABLE IF NOT EXISTS pos.catalog_categories (
    id                VARCHAR(64) PRIMARY KEY,          -- "p1".."p7" familias, "1".."18" hojas
    name              TEXT NOT NULL,
    description       TEXT NULL,
    color             VARCHAR(16) NOT NULL DEFAULT '#666666',
    icon              TEXT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order        INT NOT NULL DEFAULT 0,
    parent_id         VARCHAR(64) NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_categories_parent ON pos.catalog_categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_catalog_categories_updated ON pos.catalog_categories (updated_at DESC);

-- ── Productos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos.catalog_products (
    id                VARCHAR(64) PRIMARY KEY,
    name              TEXT NOT NULL,
    description       TEXT NULL,
    price             NUMERIC(18, 4) NOT NULL DEFAULT 0,
    category_id       VARCHAR(64) NOT NULL,             -- categoría hoja
    image_url         TEXT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    stock_quantity    INT NULL,
    min_stock_level   INT NULL,
    barcode           TEXT NULL,
    tax_rate_percent  VARCHAR(8) NULL DEFAULT '16',
    sort_order        INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON pos.catalog_products (category_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_active ON pos.catalog_products (is_active);
CREATE INDEX IF NOT EXISTS idx_catalog_products_updated ON pos.catalog_products (updated_at DESC);

-- ── Modificadores ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos.catalog_modifier_options (
    id                  VARCHAR(96) PRIMARY KEY,
    category_id         VARCHAR(64) NOT NULL,           -- categoría hoja a la que aplica
    name                TEXT NOT NULL,
    description         TEXT NULL,
    price_extra         NUMERIC(18, 4) NOT NULL DEFAULT 0,
    sort_order          INT NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    ui_group            VARCHAR(32) NOT NULL DEFAULT 'DYNAMIC', -- DYNAMIC | PRICED_MULTI | TEMP_SINGLE
    section_title       TEXT NULL,
    section_sort_order  INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_modifiers_category ON pos.catalog_modifier_options (category_id);
CREATE INDEX IF NOT EXISTS idx_catalog_modifiers_updated ON pos.catalog_modifier_options (updated_at DESC);

-- ── Trigger updated_at (para sincronización delta) ──────────────────────────
CREATE OR REPLACE FUNCTION pos.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_catalog_categories_touch ON pos.catalog_categories;
CREATE TRIGGER trg_catalog_categories_touch BEFORE UPDATE ON pos.catalog_categories
    FOR EACH ROW EXECUTE FUNCTION pos.touch_updated_at();

DROP TRIGGER IF EXISTS trg_catalog_products_touch ON pos.catalog_products;
CREATE TRIGGER trg_catalog_products_touch BEFORE UPDATE ON pos.catalog_products
    FOR EACH ROW EXECUTE FUNCTION pos.touch_updated_at();

DROP TRIGGER IF EXISTS trg_catalog_modifiers_touch ON pos.catalog_modifier_options;
CREATE TRIGGER trg_catalog_modifiers_touch BEFORE UPDATE ON pos.catalog_modifier_options
    FOR EACH ROW EXECUTE FUNCTION pos.touch_updated_at();
