-- Control de depreciación (activos tangibles) y amortización (intangibles), línea recta.
SET search_path TO accounting, public;

CREATE TABLE IF NOT EXISTS accounting.asset_depreciation_schedule (
  id                    BIGSERIAL PRIMARY KEY,
  tipo                  TEXT NOT NULL DEFAULT 'depreciacion'
                        CHECK (tipo IN ('depreciacion', 'amortizacion')),
  asset_inventory_id    BIGINT NULL REFERENCES accounting.asset_inventory (id) ON DELETE SET NULL,
  name                  TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL DEFAULT '',
  sku                   TEXT NOT NULL DEFAULT '',
  acquisition_date      DATE NULL,
  cost_original         NUMERIC(18, 4) NOT NULL DEFAULT 0,
  residual_value        NUMERIC(18, 4) NOT NULL DEFAULT 0,
  useful_life_months    INT NOT NULL DEFAULT 60,
  accumulated_booked  NUMERIC(18, 4) NOT NULL DEFAULT 0,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_depreciation_tipo ON accounting.asset_depreciation_schedule (tipo);
CREATE INDEX IF NOT EXISTS idx_asset_depreciation_name ON accounting.asset_depreciation_schedule (lower(name));
CREATE INDEX IF NOT EXISTS idx_asset_depreciation_created ON accounting.asset_depreciation_schedule (created_at DESC);
