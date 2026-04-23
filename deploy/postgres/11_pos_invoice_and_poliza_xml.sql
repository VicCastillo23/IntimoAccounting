-- Enlaces de CFDI en tickets POS (para pólizas / contabilidad) y XML en líneas de póliza
SET search_path TO pos, accounting, public;

ALTER TABLE pos.purchase_orders
  ADD COLUMN IF NOT EXISTS cfdi_uuid VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE pos.purchase_orders
  ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT NOT NULL DEFAULT '';
ALTER TABLE pos.purchase_orders
  ADD COLUMN IF NOT EXISTS invoice_xml_url TEXT NOT NULL DEFAULT '';

ALTER TABLE accounting.poliza_lines
  ADD COLUMN IF NOT EXISTS invoice_xml_url TEXT NOT NULL DEFAULT '';
