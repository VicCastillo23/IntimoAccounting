-- Facturacion recibida (carga ZIP/XML SAT)
SET search_path TO invoicing, public;

CREATE TABLE IF NOT EXISTS invoicing.received_import_batches (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid(),
    source_name         TEXT NOT NULL DEFAULT '',
    source_size_bytes   BIGINT NOT NULL DEFAULT 0,
    total_entries       INTEGER NOT NULL DEFAULT 0,
    xml_entries         INTEGER NOT NULL DEFAULT 0,
    inserted_count      INTEGER NOT NULL DEFAULT 0,
    duplicate_count     INTEGER NOT NULL DEFAULT 0,
    error_count         INTEGER NOT NULL DEFAULT 0,
    uploaded_by         VARCHAR(120) NULL,
    summary             JSONB NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_received_import_batches_public_id UNIQUE (public_id)
);

CREATE INDEX IF NOT EXISTS idx_received_import_batches_created
  ON invoicing.received_import_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS invoicing.received_invoices (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid(),
    import_batch_id     BIGINT NULL REFERENCES invoicing.received_import_batches(id) ON DELETE SET NULL,
    cfdi_uuid           VARCHAR(64) NULL,
    issuer_rfc          VARCHAR(20) NOT NULL DEFAULT '',
    receiver_rfc        VARCHAR(20) NOT NULL DEFAULT '',
    series              VARCHAR(24) NULL,
    folio               VARCHAR(64) NULL,
    issued_at           TIMESTAMPTZ NULL,
    subtotal            NUMERIC(18, 4) NOT NULL DEFAULT 0,
    taxes_transferred   NUMERIC(18, 4) NOT NULL DEFAULT 0,
    taxes_withheld      NUMERIC(18, 4) NOT NULL DEFAULT 0,
    total               NUMERIC(18, 4) NOT NULL DEFAULT 0,
    currency            VARCHAR(8) NOT NULL DEFAULT 'MXN',
    cfdi_type           VARCHAR(8) NOT NULL DEFAULT '',
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    poliza_id           VARCHAR(64) NULL REFERENCES accounting.polizas(id) ON DELETE SET NULL,
    paid_at             TIMESTAMPTZ NULL,
    payment_mode        VARCHAR(20) NULL,
    xml_sha256          VARCHAR(64) NOT NULL DEFAULT '',
    source_zip_name     TEXT NOT NULL DEFAULT '',
    source_entry_name   TEXT NOT NULL DEFAULT '',
    xml_raw             TEXT NOT NULL DEFAULT '',
    meta                JSONB NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_received_invoices_public_id UNIQUE (public_id),
    CONSTRAINT ck_received_invoice_status CHECK (status IN ('pending', 'paid', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_received_invoices_cfdi_uuid
  ON invoicing.received_invoices ((upper(cfdi_uuid)))
  WHERE cfdi_uuid IS NOT NULL AND length(trim(cfdi_uuid)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_received_invoices_xml_sha256
  ON invoicing.received_invoices (xml_sha256)
  WHERE length(trim(xml_sha256)) > 0;

CREATE INDEX IF NOT EXISTS idx_received_invoices_issuer_rfc
  ON invoicing.received_invoices (issuer_rfc);

CREATE INDEX IF NOT EXISTS idx_received_invoices_receiver_rfc
  ON invoicing.received_invoices (receiver_rfc);

CREATE INDEX IF NOT EXISTS idx_received_invoices_issued_at
  ON invoicing.received_invoices (issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_received_invoices_status
  ON invoicing.received_invoices (status);

CREATE INDEX IF NOT EXISTS idx_received_invoices_created
  ON invoicing.received_invoices (created_at DESC);
