/**
 * Mock de pólizas contables.
 * Las pólizas de producción se alimentarán desde BD (ventas/tablet) con job de cierre diario.
 */

function line(x) {
  return {
    depto: "0",
    centro: "0",
    proyecto: "0",
    lineConcept: "",
    exchangeRate: 1,
    ...x,
  };
}

export const initialPolizas = [
  {
    id: "pol-001",
    folio: "P-2026-0001",
    date: "2026-04-10",
    type: "INGRESOS",
    concept:
      "Venta F-FACT 34 — consumo mostrador (referencia orden tablet; UUID en facturación)",
    sourceRef: { kind: "order_summary", label: "ord-mock-1042", tabletSync: false },
    /** Fecha contable del lote cuando exista importación automática */
    accountingBatchDate: null,
    lines: [
      line({
        accountCode: "105.01",
        accountName: "Caja general",
        debit: 1160.0,
        credit: 0,
        lineConcept: "Cobro venta mostrador — MXN",
        depto: "0",
        centro: "0",
        proyecto: "0",
        exchangeRate: 1,
      }),
      line({
        accountCode: "401.01",
        accountName: "Ventas nacionales",
        debit: 0,
        credit: 1000.0,
        lineConcept: "Consumo alimentos 90101500",
        exchangeRate: 1,
      }),
      line({
        accountCode: "208.01",
        accountName: "IVA trasladado cobrado",
        debit: 0,
        credit: 160.0,
        lineConcept: "IVA 16 %",
        exchangeRate: 1,
      }),
    ],
  },
  {
    id: "pol-002",
    folio: "P-2026-0002",
    date: "2026-04-10",
    type: "DIARIO",
    concept: "Costo de ventas — insumos cafetería",
    sourceRef: { kind: "inventory_movement", label: "inv-mock-07", tabletSync: false },
    accountingBatchDate: null,
    lines: [
      line({
        accountCode: "501.01",
        accountName: "Costo de ventas",
        debit: 420.0,
        credit: 0,
        lineConcept: "Salida inventario insumos",
        exchangeRate: 1,
      }),
      line({
        accountCode: "115.01",
        accountName: "Inventarios",
        debit: 0,
        credit: 420.0,
        lineConcept: "Ajuste inventario",
        exchangeRate: 1,
      }),
    ],
  },
  {
    id: "pol-003",
    folio: "P-2026-0003",
    date: "2026-04-11",
    type: "EGRESOS",
    concept: "Pago proveedor empaques",
    sourceRef: { kind: "manual", label: null, tabletSync: false },
    accountingBatchDate: null,
    lines: [
      line({
        accountCode: "601.01",
        accountName: "Gastos de administración",
        debit: 850.0,
        credit: 0,
        lineConcept: "Empaque y consumibles",
        exchangeRate: 1,
      }),
      line({
        accountCode: "102.01",
        accountName: "Bancos",
        debit: 0,
        credit: 850.0,
        lineConcept: "Transferencia proveedor",
        exchangeRate: 1,
      }),
    ],
  },
];
