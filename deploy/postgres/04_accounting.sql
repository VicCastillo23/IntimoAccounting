-- Contabilidad: pólizas y movimientos (alineado al modelo JSON actual del front)
SET search_path TO accounting, public;

CREATE TABLE IF NOT EXISTS accounting.polizas (
    id                  VARCHAR(64) PRIMARY KEY,
    folio               VARCHAR(32) NOT NULL,
    poliza_date         DATE NOT NULL,
    type                VARCHAR(32) NOT NULL,
    concept             TEXT NOT NULL,
    source_ref          JSONB NULL,
    accounting_batch_date DATE NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_accounting_folio UNIQUE (folio)
);

CREATE TABLE IF NOT EXISTS accounting.poliza_lines (
    id              BIGSERIAL PRIMARY KEY,
    poliza_id       VARCHAR(64) NOT NULL REFERENCES accounting.polizas(id) ON DELETE CASCADE,
    line_index      INT NOT NULL,
    ticket_id       VARCHAR(128) NOT NULL DEFAULT '',
    account_code    VARCHAR(64) NOT NULL DEFAULT '',
    account_name    VARCHAR(512) NOT NULL DEFAULT '',
    debit           NUMERIC(18, 4) NOT NULL DEFAULT 0,
    credit          NUMERIC(18, 4) NOT NULL DEFAULT 0,
    line_concept    TEXT NOT NULL DEFAULT '',
    invoice_url     TEXT NOT NULL DEFAULT '',
    fx_currency     VARCHAR(8) NOT NULL DEFAULT 'MX',
    depto           VARCHAR(64) NOT NULL DEFAULT 'ADMINISTRACION',
    CONSTRAINT uq_accounting_line UNIQUE (poliza_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_accounting_polizas_date ON accounting.polizas (poliza_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_poliza ON accounting.poliza_lines (poliza_id);
