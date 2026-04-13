# Íntimo · Contabilidad

Aplicación web para **pólizas contables** (asientos con movimientos dinámicos), misma línea visual que **IntimoInvoicing** (sidebar oscuro, tablas claras, tipografía Roboto).

## Requisitos

- Node.js 20+

## Configuración inicial

1. Copia variables de entorno:

   ```bash
   cp .env.example .env
   ```

2. Genera secretos y pégalos en `.env`:

   ```bash
   npm run gen:data-key       # DATA_ENCRYPTION_KEY (64 hex)
   npm run gen:session-secret # SESSION_SECRET
   ```

3. **Pólizas y cierre diario:** la pantalla está preparada para un **job al cierre del día** que lea ventas/tickets desde la base de datos (tablet / POS): **un renglón por ticket**, enlace opcional a **descarga de factura** (CFDI/PDF) y **moneda** por línea (MX, USD, CAD, EUR). Persistencia futura en PostgreSQL u otro motor.

4. **Primera ejecución:** si no existen `data/users.enc` ni `data/polizas.enc`, el servidor crea:

   - Usuario inicial: en **desarrollo**, si no defines `ACCOUNTING_ADMIN_*`, se usa `admin` / `admin` (aparece advertencia en consola). En **producción** debes definir `ACCOUNTING_ADMIN_USER` y `ACCOUNTING_ADMIN_PASSWORD`.
   - Pólizas de ejemplo: se generan a partir del mock y se guardan cifradas en `data/polizas.enc`.

## Desarrollo local

```bash
npm install
npm run dev
```

La vista **Pólizas** usa layout listado + visualizador (maestro/detalle), captura en el panel derecho y textos de ayuda sobre la integración diaria con BD.

Abre [http://localhost:3010](http://localhost:3010). Sin sesión, se redirige a `/login.html`.

## Seguridad (implementado)

| Aspecto | Detalle |
|--------|---------|
| Contraseñas | **bcrypt** (cost 12); nunca en texto plano. |
| Sesión | Cookie **httpOnly**, **sameSite=lax**; en producción **secure** con HTTPS. Firmada con `SESSION_SECRET`. |
| Datos en disco | `data/users.enc` y `data/polizas.enc`: **AES-256-GCM** con `DATA_ENCRYPTION_KEY`. |
| Tránsito | En producción usar **HTTPS** (Nginx + Let’s Encrypt en el EC2). En local el tráfego va en claro; no uses credenciales reales. |
| Cabeceras | **Helmet** (CSP desactivada por compatibilidad con assets estáticos; se puede endurecer después). |
| Fuerza bruta | Bloqueo temporal en `/api/auth/login` tras muchos fallos por IP. |

**Nota:** Los datos solo existen descifrados en memoria del proceso Node mientras corre. Quien tenga la clave y los archivos `.enc` puede descifrarlos; protege el servidor y los backups como harías con cualquier secreto.

## API (requiere sesión salvo login / me)

- `POST /api/auth/login` — `{ username, password }`
- `POST /api/auth/logout`
- `GET /api/auth/me` — `{ user: null | { username } }`
- `GET /api/polizas`, `POST /api/polizas`
- `GET /health` — comprobación mínima (sin datos sensibles)

## PostgreSQL (opcional, mismo RDS que Loyalty)

En este repositorio, `deploy/postgres/` define esquemas **`pos`**, **`invoicing`** y **`accounting`** sobre la misma base que ya usa el servidor de loyalty. Ejecuta los `.sql` en orden (ver ese README).

Si defines **`DATABASE_URL`** en `.env`:

- `GET /health` incluye el estado de conexión y `persistence: "postgresql"`.
- Las pólizas se guardan en **`accounting.polizas`** / **`accounting.poliza_lines`** (ejecuta también **`deploy/postgres/05_accounting_folio_counter.sql`** en el servidor).

Sin `DATABASE_URL`, el modo sigue siendo **`data/polizas.enc`** cifrado (`persistence: "file"` en `/health`).

**Systemd:** el proceso carga `.env` desde la **raíz del proyecto** (`loadEnv.js`), no desde `process.cwd`. Aun así conviene en la unidad: `WorkingDirectory=/ruta/a/IntimoAccounting` y opcionalmente `EnvironmentFile=.../.env`.

## Vista previa en el servidor (aún no productivo)

Para que en **AWS** se comporte **como en local** (mismo flujo, `admin` / `admin` si no creaste usuario, cookies sin `Secure` forzado):

- Mantén **`NODE_ENV=development`** en el `.env` del servidor (no uses `production` hasta que quieras endurecer).
- Con **Nginx** delante, pon **`TRUST_PROXY=1`** para que el rate limit de login use la IP real del visitante.
- Sigue definiendo **`DATA_ENCRYPTION_KEY`** y **`SESSION_SECRET`** (el servidor no arranca sin ellos).

Cuando quieras pasar a productivo: **`NODE_ENV=production`**, HTTPS, y **`ACCOUNTING_ADMIN_USER` / `ACCOUNTING_ADMIN_PASSWORD`** obligatorios si aún no existe `data/users.enc`.

## Próximos pasos

- Sesiones persistentes en Redis u otro store si escalas varias instancias.
- Base de datos (PostgreSQL) con cifrado en reposo a nivel volumen o columnas sensibles, según política.
- Despliegue en el **mismo EC2**: subdominio en Nginx como proxy reverso, TLS.

## Repositorio remoto (GitHub)

1. Crea un repositorio vacío en GitHub.
2. `git remote add origin https://github.com/TU_ORG/intimo-accounting.git`
3. `git push -u origin main`
