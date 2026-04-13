-- Esquemas por dominio (Loyalty permanece en public)
CREATE SCHEMA IF NOT EXISTS pos;
CREATE SCHEMA IF NOT EXISTS invoicing;
CREATE SCHEMA IF NOT EXISTS accounting;

-- Rol de aplicación: ajusta el nombre si usas otro usuario en RDS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intimo_loyalty') THEN
    GRANT USAGE ON SCHEMA pos TO intimo_loyalty;
    GRANT USAGE ON SCHEMA invoicing TO intimo_loyalty;
    GRANT USAGE ON SCHEMA accounting TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT ALL ON TABLES TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA invoicing GRANT ALL ON TABLES TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA accounting GRANT ALL ON TABLES TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT ALL ON SEQUENCES TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA invoicing GRANT ALL ON SEQUENCES TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA accounting GRANT ALL ON SEQUENCES TO intimo_loyalty;
  END IF;
END
$$;
