-- Inventario de activos / almacén (carga desde Excel en la app)
SET search_path TO accounting, public;

CREATE TABLE IF NOT EXISTS accounting.asset_inventory (
  id                  BIGSERIAL PRIMARY KEY,
  import_batch_id     UUID NOT NULL,
  import_filename     TEXT NOT NULL DEFAULT '',
  row_num             INT NOT NULL DEFAULT 0,
  category            TEXT NOT NULL DEFAULT '',
  name                TEXT NOT NULL DEFAULT '',
  sku                 TEXT NOT NULL DEFAULT '',
  quantity            NUMERIC(18, 4) NOT NULL DEFAULT 1,
  unit                TEXT NOT NULL DEFAULT '',
  location            TEXT NOT NULL DEFAULT '',
  state_condition     TEXT NOT NULL DEFAULT '',
  acquisition_date    DATE NULL,
  cost_estimate         NUMERIC(18, 4) NULL,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_inventory_batch ON accounting.asset_inventory (import_batch_id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_inventory_category ON accounting.asset_inventory (lower(category));
CREATE INDEX IF NOT EXISTS idx_asset_inventory_name ON accounting.asset_inventory (lower(name));
CREATE INDEX IF NOT EXISTS idx_asset_inventory_created ON accounting.asset_inventory (created_at DESC);
