-- % depreciación anual + factores IPC por ejercicio (JSON por año).
SET search_path TO accounting, public;

ALTER TABLE accounting.asset_depreciation_schedule
  ADD COLUMN IF NOT EXISTS annual_depreciation_pct NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS ipc_factors_by_year JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE accounting.asset_depreciation_schedule
  ALTER COLUMN useful_life_months DROP NOT NULL;
