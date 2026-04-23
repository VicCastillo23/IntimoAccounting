# PostgreSQL compartido (AWS RDS) — POS, Loyalty, Facturación, Contabilidad

## Enfoque

- **Una instancia RDS PostgreSQL** (Multi-AZ en producción), una **base de datos** (p. ej. `intimo_loyalty` creada con `IntimoCoffeeLoyaltyServer/deploy/postgres-crear-bd.sql`).
- **Loyalty** sigue usando el esquema **`public`** (tablas actuales del servidor Kotlin / Exposed); **no** es obligatorio migrarlas ahora.
- **Nuevos dominios** viven en esquemas dedicados para orden y permisos:
  - **`pos`** — compras / tickets desde tablet, POS, waiter.
  - **`invoicing`** — CFDI / facturas, enlaces PDF/XML, referencias a pedidos.
  - **`accounting`** — pólizas y líneas (objetivo: fuente de verdad junto o reemplazo gradual de `data/polizas.enc`).

Los scripts `*.sql` de esta carpeta son **idempotentes** en lo posible (`IF NOT EXISTS`).

## Orden de ejecución

Desde una máquina con `psql` y acceso al endpoint RDS (o túnel SSH):

```bash
cd deploy/postgres
export PGHOST=tu-rds.xxx.region.rds.amazonaws.com
export PGPORT=5432
export PGDATABASE=intimo_loyalty
export PGUSER=intimo_loyalty
export PGPASSWORD='***'

psql -v ON_ERROR_STOP=1 -f 00_extensions.sql
psql -v ON_ERROR_STOP=1 -f 01_schemas.sql
psql -v ON_ERROR_STOP=1 -f 02_pos.sql
psql -v ON_ERROR_STOP=1 -f 03_invoicing.sql
psql -v ON_ERROR_STOP=1 -f 04_accounting.sql
psql -v ON_ERROR_STOP=1 -f 05_accounting_folio_counter.sql
psql -v ON_ERROR_STOP=1 -f 06_accounting_catalog.sql
psql -v ON_ERROR_STOP=1 -f 07_sat_codigo_agrupador_seed.sql
# Enlaces CFDI en tickets POS + XML en líneas de póliza (IntimoInvoicing ↔ Accounting)
psql -v ON_ERROR_STOP=1 -f 11_pos_invoice_and_poliza_xml.sql
```

Los archivos `06` y `07` crean las tablas del **código agrupador SAT** (referencia) y del **catálogo de cuentas de la empresa**, y cargan el listado de códigos agrupadores (verifica contra el PDF oficial del SAT). Edita `01_schemas.sql` si tu rol de aplicación no se llama `intimo_loyalty`.

## Variables de entorno por servicio

| Servicio | Variable típica | Notas |
|----------|-----------------|--------|
| Loyalty (Kotlin) | `DB_URL`, `DB_USER`, `DB_PASSWORD` | Ya configurado; JDBC a la misma BD. |
| Accounting (Node) | `DATABASE_URL` | Opcional; `postgresql://user:pass@host:5432/dbname`. Si falta, sigue usando solo archivos `.enc`. |
| POS / Waiter / Invoicing | Igual patrón JDBC o `DATABASE_URL` | Conectar al mismo host/BD, esquema según app. |

En **AWS Secrets Manager** guarda usuario/contraseña; en EC2 usa `Environment=` o archivo `.env` no versionado.

## Robustez en AWS

- RDS **PostgreSQL 14+**, almacenamiento cifrado, **backups automáticos** y ventana de mantenimiento.
- **Security group**: solo subredes de aplicación (EC2/ECS/Lambda) al puerto **5432**.
- Mismo **VPC** que los servicios que deben hablar con la BD.
- Para cargas mayores: **read replica** solo lectura (reportes), no obligatorio al inicio.

## Próximos pasos de producto

1. **Loyalty**: sin cambios obligatorios; opcional mover tablas a `loyalty` schema en una migración aparte.
2. **POS**: insertar en `pos.purchase_orders` desde el job de cierre o API.
3. **Facturación**: escribir en `invoicing.invoices` al timbrar.
4. **Accounting**: leer/escribir `accounting.polizas` desde Node (sustituir o duplicar sincronización desde `.enc`).

El servicio **IntimoAccounting** expone comprobación opcional: `GET /health` incluye `database` si defines `DATABASE_URL`.
