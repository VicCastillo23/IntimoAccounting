-- Compras / pedidos desde POS, tablet o waiter (cierre diario, sincronización)
SET search_path TO pos, public;

CREATE TABLE IF NOT EXISTS pos.purchase_orders (
    id              BIGSERIAL PRIMARY KEY,
    external_id     VARCHAR(128) NOT NULL,
    source          VARCHAR(32) NOT NULL DEFAULT 'pos',
    status          VARCHAR(32) NOT NULL DEFAULT 'completed',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    currency        VARCHAR(8) NOT NULL DEFAULT 'MXN',
    subtotal        NUMERIC(18, 4) NOT NULL DEFAULT 0,
    tax             NUMERIC(18, 4) NOT NULL DEFAULT 0,
    total           NUMERIC(18, 4) NOT NULL DEFAULT 0,
    loyalty_customer_id BIGINT NULL,
    raw_payload     JSONB NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_pos_purchase_external UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS pos.purchase_lines (
    id              BIGSERIAL PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES pos.purchase_orders(id) ON DELETE CASCADE,
    line_no         INT NOT NULL,
    sku_or_code     VARCHAR(128) NULL,
    description     TEXT NULL,
    qty             NUMERIC(18, 4) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(18, 4) NOT NULL DEFAULT 0,
    line_total      NUMERIC(18, 4) NOT NULL DEFAULT 0,
    meta            JSONB NULL,
    CONSTRAINT uq_pos_line_order_no UNIQUE (order_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_pos_orders_occurred ON pos.purchase_orders (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_orders_source ON pos.purchase_orders (source);
