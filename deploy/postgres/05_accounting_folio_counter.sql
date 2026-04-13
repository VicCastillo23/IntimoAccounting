-- Contador global para folios P-AAAA-NNNN (misma lógica que el archivo local)
SET search_path TO accounting, public;

CREATE TABLE IF NOT EXISTS accounting.folio_counter (
    singleton SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
    next_seq INT NOT NULL DEFAULT 1
);

INSERT INTO accounting.folio_counter (singleton, next_seq)
VALUES (1, 1)
ON CONFLICT (singleton) DO NOTHING;
