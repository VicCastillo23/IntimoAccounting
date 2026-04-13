/**
 * Mock de pólizas contables.
 * Más adelante: mismos hechos económicos que la tablet (órdenes, pagos, IVA) vía BD.
 */
export const initialPolizas = [
  {
    id: "pol-001",
    folio: "P-2026-0001",
    date: "2026-04-10",
    type: "INGRESOS",
    concept: "Ventas mostrador — consumo alimentos (referencia orden)",
    sourceRef: { kind: "order_summary", label: "ord-mock-1042", tabletSync: false },
    lines: [
      {
        accountCode: "105.01",
        accountName: "Caja general",
        debit: 1160.0,
        credit: 0,
      },
      {
        accountCode: "401.01",
        accountName: "Ventas nacionales",
        debit: 0,
        credit: 1000.0,
      },
      {
        accountCode: "208.01",
        accountName: "IVA trasladado cobrado",
        debit: 0,
        credit: 160.0,
      },
    ],
  },
  {
    id: "pol-002",
    folio: "P-2026-0002",
    date: "2026-04-10",
    type: "DIARIO",
    concept: "Costo de ventas — insumos cafetería",
    sourceRef: { kind: "inventory_movement", label: "inv-mock-07", tabletSync: false },
    lines: [
      {
        accountCode: "501.01",
        accountName: "Costo de ventas",
        debit: 420.0,
        credit: 0,
      },
      {
        accountCode: "115.01",
        accountName: "Inventarios",
        debit: 0,
        credit: 420.0,
      },
    ],
  },
  {
    id: "pol-003",
    folio: "P-2026-0003",
    date: "2026-04-11",
    type: "EGRESOS",
    concept: "Pago proveedor empaques",
    sourceRef: { kind: "manual", label: null, tabletSync: false },
    lines: [
      {
        accountCode: "601.01",
        accountName: "Gastos de administración",
        debit: 850.0,
        credit: 0,
      },
      {
        accountCode: "102.01",
        accountName: "Bancos",
        debit: 0,
        credit: 850.0,
      },
    ],
  },
];
