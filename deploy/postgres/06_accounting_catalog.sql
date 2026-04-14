-- Catálogo contable: código agrupador SAT (referencia) + cuentas del contribuyente (Anexo 24)
SET search_path TO accounting, public;

-- Referencia oficial: código agrupador (PDF «Código agrupador», SAT).
-- Campos alineados al envío de Catálogo de Cuentas (Ctas: CodAgrup, NumCta, Desc, SubCtaDe, Nivel, Natur).
CREATE TABLE IF NOT EXISTS accounting.sat_codigo_agrupador (
    id                  BIGSERIAL PRIMARY KEY,
    codigo              VARCHAR(32) NULL,
    descripcion         TEXT NOT NULL,
    orden               INT NOT NULL,
    es_seccion          BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT uq_sat_codigo_agrupador_orden UNIQUE (orden)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sat_codigo_agrupador_codigo_nn
    ON accounting.sat_codigo_agrupador (codigo)
    WHERE codigo IS NOT NULL;

COMMENT ON TABLE accounting.sat_codigo_agrupador IS 'Código agrupador SAT (referencia). es_seccion = títulos de bloque sin código en el listado.';

-- Catálogo de cuentas de la empresa (NumCta propias) ligado al código agrupador para contabilidad electrónica.
CREATE TABLE IF NOT EXISTS accounting.chart_accounts (
    id                          BIGSERIAL PRIMARY KEY,
    num_cta                     VARCHAR(64) NOT NULL,
    descripcion                 TEXT NOT NULL,
    sub_cta_de                  VARCHAR(64) NULL,
    nivel                       SMALLINT NOT NULL DEFAULT 1,
    natur                       CHAR(1) NOT NULL CHECK (natur IN ('D', 'A')),
    sat_codigo_agrupador_id     BIGINT NULL REFERENCES accounting.sat_codigo_agrupador (id) ON DELETE SET NULL,
    activo                      BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_chart_accounts_num_cta UNIQUE (num_cta)
);

CREATE INDEX IF NOT EXISTS idx_chart_accounts_sat ON accounting.chart_accounts (sat_codigo_agrupador_id);
CREATE INDEX IF NOT EXISTS idx_chart_accounts_activo ON accounting.chart_accounts (activo);

ALTER TABLE accounting.chart_accounts
    DROP CONSTRAINT IF EXISTS fk_chart_sub_cta_de;
ALTER TABLE accounting.chart_accounts
    ADD CONSTRAINT fk_chart_sub_cta_de
    FOREIGN KEY (sub_cta_de) REFERENCES accounting.chart_accounts (num_cta) ON DELETE SET NULL;

COMMENT ON COLUMN accounting.chart_accounts.natur IS 'D = Deudora, A = Acreedora (Natur del Anexo 24).';
COMMENT ON COLUMN accounting.chart_accounts.sat_codigo_agrupador_id IS 'CodAgrup: vínculo al renglón del catálogo SAT (id interno).';
