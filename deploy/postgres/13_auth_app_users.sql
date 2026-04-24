-- Usuarios de portal web compartidos entre IntimoAccounting e IntimoInvoicing (misma DATABASE_URL).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower_idx
  ON auth.app_users (lower(trim(username)));

COMMENT ON TABLE auth.app_users IS 'Login web staff; compartido con facturación (SESSION distinta por app).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intimo_loyalty') THEN
    GRANT USAGE ON SCHEMA auth TO intimo_loyalty;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO intimo_loyalty;
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO intimo_loyalty;
  END IF;
END
$$;
