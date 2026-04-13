-- Facturación (CFDI, enlaces, estado)
SET search_path TO invoicing, public;

CREATE TABLE IF NOT EXISTS invoicing.invoices (
    id              BIGSERIAL PRIMARY KEY,
    public_id       UUID NOT NULL DEFAULT gen_random_uuid(),
    folio           VARCHAR(64) NULL,
    series          VARCHAR(16) NULL,
    cfdi_uuid       VARCHAR(64) NULL,
    customer_rfc    VARCHAR(20) NULL,
    issuer_rfc      VARCHAR(20) NULL,
    total           NUMERIC(18, 4) NOT NULL DEFAULT 0,
    currency        VARCHAR(8) NOT NULL DEFAULT 'MXN',
    status          VARCHAR(32) NOT NULL DEFAULT 'draft',
    pdf_url         TEXT NULL,
    xml_url         TEXT NULL,
    pos_order_id    BIGINT NULL REFERENCES pos.purchase_orders(id) ON DELETE SET NULL,
    meta            JSONB NULL,
    issued_at       TIMESTAMPTZ NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_invoicing_public_id UNIQUE (public_id)
);

CREATE INDEX IF NOT EXISTS idx_invoicing_cfdi ON invoicing.invoices (cfdi_uuid) WHERE cfdi_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoicing_pos_order ON invoicing.invoices (pos_order_id) WHERE pos_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoicing_created ON invoicing.invoices (created_at DESC);
