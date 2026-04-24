-- Token opaco para enlace/QR de facturación del cliente (no expone id ni número de orden secuencial).
SET search_path TO pos, public;

ALTER TABLE pos.purchase_orders
  ADD COLUMN IF NOT EXISTS public_invoice_token VARCHAR(40);

UPDATE pos.purchase_orders
SET public_invoice_token = gen_random_uuid()::text
WHERE public_invoice_token IS NULL OR BTRIM(public_invoice_token) = '';

ALTER TABLE pos.purchase_orders
  ALTER COLUMN public_invoice_token SET DEFAULT gen_random_uuid()::text;

ALTER TABLE pos.purchase_orders
  ALTER COLUMN public_invoice_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_purchase_orders_public_invoice_token
  ON pos.purchase_orders (public_invoice_token);
