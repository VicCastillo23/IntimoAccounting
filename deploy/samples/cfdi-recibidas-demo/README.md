# ZIP de prueba — importación incremental (1–3 vs 1–5)

Son **XML mínimos de demostración** (no son CFDI reales del SAT). Sirven para validar que al importar un ZIP nuevo el sistema **compara por UUID** (y por hash del XML): las facturas **1, 2 y 3** ya existentes se marcan como duplicadas y las **4 y 5** se insertan.

## Archivos ZIP

| ZIP | Contenido | UUID (TimbreFiscalDigital) |
|-----|-------------|------------------------------|
| `cfdi-recibidas-3-facturas-ejemplo.zip` | `factura-01.xml` … `factura-03.xml` | `1111…`, `2222…`, `3333…` |
| `cfdi-recibidas-5-facturas-123mas45-ejemplo.zip` | Mismos `01–03` **sin cambiar UUID** + `factura-04.xml` + `factura-05.xml` | `1111…` … `5555…` |

Los ZIP están en la carpeta **padre**: `deploy/samples/` (junto a esta carpeta `cfdi-recibidas-demo/`).

## Flujo de prueba recomendado

1. **Importa** `cfdi-recibidas-3-facturas-ejemplo.zip`  
   - Esperado: **3 insertadas**, 0 duplicadas (si esos UUID aún no están en la BD).

2. **Importa** `cfdi-recibidas-5-facturas-123mas45-ejemplo.zip`  
   - Esperado: **3 duplicadas** (mismo UUID que 1, 2 y 3) + **2 insertadas** (facturas 4 y 5).  
   - Total del lote: **2 insertadas, 3 duplicadas** (el orden de los mensajes por archivo puede variar según el orden dentro del ZIP).

Así validas que “cualquier ZIP” puede mezclar facturas ya cargadas con facturas nuevas y solo persiste lo que falta.

## XML sueltos (fuente)

En esta carpeta: `factura-01.xml` … `factura-05.xml`.
