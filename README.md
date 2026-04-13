# Íntimo · Contabilidad

Aplicación web para **pólizas contables** (asientos con movimientos dinámicos), misma línea visual que **IntimoInvoicing** (sidebar oscuro, tablas claras, tipografía Roboto).

## Requisitos

- Node.js 20+

## Desarrollo local

```bash
npm install
cp .env.example .env   # opcional: PORT=3010 por defecto en código
npm run dev
```

Abre [http://localhost:3010](http://localhost:3010) (o el puerto definido en `PORT`).

- Los datos son **mock en memoria**; al reiniciar el servidor vuelven los ejemplos iniciales.
- API: `GET /api/polizas`, `POST /api/polizas`, `GET /health`.

## Próximos pasos

- Base de datos y modelo alineado a los mismos hechos económicos que registra la tablet (órdenes, pagos, etc.).
- Despliegue en el **mismo EC2** que el resto del ecosistema: subdominio en Nginx como proxy reverso a este servicio (puerto interno fijo o socket), TLS con el certificado existente.

## Repositorio remoto (GitHub)

En la máquina local el proyecto ya puede tener `git init` y commits. Para publicarlo:

1. Crea un repositorio vacío en GitHub (sin README si ya tienes uno local).
2. `git remote add origin https://github.com/TU_ORG/intimo-accounting.git`
3. `git push -u origin main`
