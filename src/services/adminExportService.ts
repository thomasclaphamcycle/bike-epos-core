import { prisma } from "../lib/prisma";
import type { CsvColumn } from "../utils/csv";

const SALES_EXPORT_BATCH_SIZE = 200;
const WORKSHOP_EXPORT_BATCH_SIZE = 200;
const INVENTORY_EXPORT_BATCH_SIZE = 1000;

const toIso = (value: Date | null | undefined) => (value ? value.toISOString() : "");

export type SalesExportRow = {
  saleId: string;
  basketId: string;
  workshopJobId: string;
  customerId: string;
  receiptNumber: string;
  subtotalPence: number;
  taxPence: number;
  totalPence: number;
  changeDuePence: number;
  saleCreatedAt: string;
  saleCompletedAt: string;
  staffId: string;
  staffName: string;
  saleLineId: string;
  lineVariantId: string;
  lineSku: string;
  lineProductId: string;
  lineProductName: string;
  lineQuantity: number;
  lineUnitPricePence: number;
  lineTotalPence: number;
  paymentCount: number;
  paymentIds: string;
  paymentMethods: string;
  paymentStatuses: string;
  paymentAmountsPence: string;
  paymentCreatedAts: string;
};

export const salesExportColumns: CsvColumn<SalesExportRow>[] = [
  { header: "saleId", value: (row) => row.saleId },
  { header: "basketId", value: (row) => row.basketId },
  { header: "workshopJobId", value: (row) => row.workshopJobId },
  { header: "customerId", value: (row) => row.customerId },
  { header: "receiptNumber", value: (row) => row.receiptNumber },
  { header: "subtotalPence", value: (row) => row.subtotalPence },
  { header: "taxPence", value: (row) => row.taxPence },
  { header: "totalPence", value: (row) => row.totalPence },
  { header: "changeDuePence", value: (row) => row.changeDuePence },
  { header: "saleCreatedAt", value: (row) => row.saleCreatedAt },
  { header: "saleCompletedAt", value: (row) => row.saleCompletedAt },
  { header: "staffId", value: (row) => row.staffId },
  { header: "staffName", value: (row) => row.staffName },
  { header: "saleLineId", value: (row) => row.saleLineId },
  { header: "lineVariantId", value: (row) => row.lineVariantId },
  { header: "lineSku", value: (row) => row.lineSku },
  { header: "lineProductId", value: (row) => row.lineProductId },
  { header: "lineProductName", value: (row) => row.lineProductName },
  { header: "lineQuantity", value: (row) => row.lineQuantity },
  { header: "lineUnitPricePence", value: (row) => row.lineUnitPricePence },
  { header: "lineTotalPence", value: (row) => row.lineTotalPence },
  { header: "paymentCount", value: (row) => row.paymentCount },
  { header: "paymentIds", value: (row) => row.paymentIds },
  { header: "paymentMethods", value: (row) => row.paymentMethods },
  { header: "paymentStatuses", value: (row) => row.paymentStatuses },
  { header: "paymentAmountsPence", value: (row) => row.paymentAmountsPence },
  { header: "paymentCreatedAts", value: (row) => row.paymentCreatedAts },
];

const toSalesRows = (sale: {
  id: string;
  basketId: string | null;
  workshopJobId: string | null;
  customerId: string | null;
  receiptNumber: string | null;
  subtotalPence: number;
  taxPence: number;
  totalPence: number;
  changeDuePence: number;
  createdAt: Date;
  completedAt: Date | null;
  createdByStaffId: string | null;
  createdByStaff: {
    id: string;
    name: string | null;
    username: string;
  } | null;
  items: Array<{
    id: string;
    variantId: string;
    quantity: number;
    unitPricePence: number;
    lineTotalPence: number;
    variant: {
      sku: string;
      product: {
        id: string;
        name: string;
      };
    };
  }>;
  payments: Array<{
    id: string;
    method: string;
    status: string;
    amountPence: number;
    createdAt: Date;
  }>;
}): SalesExportRow[] => {
  const staffName =
    sale.createdByStaff?.name ??
    sale.createdByStaff?.username ??
    "";
  const staffId = sale.createdByStaff?.id ?? sale.createdByStaffId ?? "";

  const paymentIds = sale.payments.map((payment) => payment.id).join("|");
  const paymentMethods = sale.payments.map((payment) => payment.method).join("|");
  const paymentStatuses = sale.payments.map((payment) => payment.status).join("|");
  const paymentAmountsPence = sale.payments.map((payment) => payment.amountPence).join("|");
  const paymentCreatedAts = sale.payments.map((payment) => toIso(payment.createdAt)).join("|");

  const base: Omit<
    SalesExportRow,
    | "saleLineId"
    | "lineVariantId"
    | "lineSku"
    | "lineProductId"
    | "lineProductName"
    | "lineQuantity"
    | "lineUnitPricePence"
    | "lineTotalPence"
  > = {
    saleId: sale.id,
    basketId: sale.basketId ?? "",
    workshopJobId: sale.workshopJobId ?? "",
    customerId: sale.customerId ?? "",
    receiptNumber: sale.receiptNumber ?? "",
    subtotalPence: sale.subtotalPence,
    taxPence: sale.taxPence,
    totalPence: sale.totalPence,
    changeDuePence: sale.changeDuePence,
    saleCreatedAt: toIso(sale.createdAt),
    saleCompletedAt: toIso(sale.completedAt),
    staffId,
    staffName,
    paymentCount: sale.payments.length,
    paymentIds,
    paymentMethods,
    paymentStatuses,
    paymentAmountsPence,
    paymentCreatedAts,
  };

  if (sale.items.length === 0) {
    return [
      {
        ...base,
        saleLineId: "",
        lineVariantId: "",
        lineSku: "",
        lineProductId: "",
        lineProductName: "",
        lineQuantity: 0,
        lineUnitPricePence: 0,
        lineTotalPence: 0,
      },
    ];
  }

  return sale.items.map((item) => ({
    ...base,
    saleLineId: item.id,
    lineVariantId: item.variantId,
    lineSku: item.variant.sku,
    lineProductId: item.variant.product.id,
    lineProductName: item.variant.product.name,
    lineQuantity: item.quantity,
    lineUnitPricePence: item.unitPricePence,
    lineTotalPence: item.lineTotalPence,
  }));
};

export async function* streamSalesExportRows(
  batchSize = SALES_EXPORT_BATCH_SIZE,
): AsyncGenerator<SalesExportRow[], void, void> {
  let cursorId: string | undefined;

  while (true) {
    const sales = await prisma.sale.findMany({
      take: batchSize,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      orderBy: { id: "asc" },
      include: {
        createdByStaff: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        items: {
          orderBy: { id: "asc" },
          include: {
            variant: {
              select: {
                sku: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            method: true,
            status: true,
            amountPence: true,
            createdAt: true,
          },
        },
      },
    });

    if (sales.length === 0) {
      return;
    }

    yield sales.flatMap((sale) => toSalesRows(sale));
    cursorId = sales[sales.length - 1].id;
  }
}

export type WorkshopExportRow = {
  workshopJobId: string;
  linkedSaleId: string;
  status: string;
  customerId: string;
  customerName: string;
  bikeDescription: string;
  notes: string;
  promisedAt: string;
  assignedStaffId: string;
  assignedStaffName: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string;
  completedAt: string;
  closedAt: string;
  lineId: string;
  lineType: string;
  lineProductId: string;
  lineVariantId: string;
  lineDescription: string;
  lineQty: number;
  lineUnitPricePence: number;
  lineTotalPence: number;
};

export const workshopExportColumns: CsvColumn<WorkshopExportRow>[] = [
  { header: "workshopJobId", value: (row) => row.workshopJobId },
  { header: "linkedSaleId", value: (row) => row.linkedSaleId },
  { header: "status", value: (row) => row.status },
  { header: "customerId", value: (row) => row.customerId },
  { header: "customerName", value: (row) => row.customerName },
  { header: "bikeDescription", value: (row) => row.bikeDescription },
  { header: "notes", value: (row) => row.notes },
  { header: "promisedAt", value: (row) => row.promisedAt },
  { header: "assignedStaffId", value: (row) => row.assignedStaffId },
  { header: "assignedStaffName", value: (row) => row.assignedStaffName },
  { header: "createdAt", value: (row) => row.createdAt },
  { header: "updatedAt", value: (row) => row.updatedAt },
  { header: "cancelledAt", value: (row) => row.cancelledAt },
  { header: "completedAt", value: (row) => row.completedAt },
  { header: "closedAt", value: (row) => row.closedAt },
  { header: "lineId", value: (row) => row.lineId },
  { header: "lineType", value: (row) => row.lineType },
  { header: "lineProductId", value: (row) => row.lineProductId },
  { header: "lineVariantId", value: (row) => row.lineVariantId },
  { header: "lineDescription", value: (row) => row.lineDescription },
  { header: "lineQty", value: (row) => row.lineQty },
  { header: "lineUnitPricePence", value: (row) => row.lineUnitPricePence },
  { header: "lineTotalPence", value: (row) => row.lineTotalPence },
];

const toWorkshopRows = (job: {
  id: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  bikeDescription: string | null;
  notes: string | null;
  scheduledDate: Date | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  sale: { id: string } | null;
  lines: Array<{
    id: string;
    type: string;
    productId: string | null;
    variantId: string | null;
    description: string;
    qty: number;
    unitPricePence: number;
  }>;
}): WorkshopExportRow[] => {
  const base: Omit<
    WorkshopExportRow,
    | "lineId"
    | "lineType"
    | "lineProductId"
    | "lineVariantId"
    | "lineDescription"
    | "lineQty"
    | "lineUnitPricePence"
    | "lineTotalPence"
  > = {
    workshopJobId: job.id,
    linkedSaleId: job.sale?.id ?? "",
    status: job.status,
    customerId: job.customerId ?? "",
    customerName: job.customerName ?? "",
    bikeDescription: job.bikeDescription ?? "",
    notes: job.notes ?? "",
    promisedAt: toIso(job.scheduledDate),
    assignedStaffId: job.assignedStaffId ?? "",
    assignedStaffName: job.assignedStaffName ?? "",
    createdAt: toIso(job.createdAt),
    updatedAt: toIso(job.updatedAt),
    cancelledAt: toIso(job.cancelledAt),
    completedAt: toIso(job.completedAt),
    closedAt: toIso(job.closedAt),
  };

  if (job.lines.length === 0) {
    return [
      {
        ...base,
        lineId: "",
        lineType: "",
        lineProductId: "",
        lineVariantId: "",
        lineDescription: "",
        lineQty: 0,
        lineUnitPricePence: 0,
        lineTotalPence: 0,
      },
    ];
  }

  return job.lines.map((line) => ({
    ...base,
    lineId: line.id,
    lineType: line.type,
    lineProductId: line.productId ?? "",
    lineVariantId: line.variantId ?? "",
    lineDescription: line.description,
    lineQty: line.qty,
    lineUnitPricePence: line.unitPricePence,
    lineTotalPence: line.qty * line.unitPricePence,
  }));
};

export async function* streamWorkshopExportRows(
  batchSize = WORKSHOP_EXPORT_BATCH_SIZE,
): AsyncGenerator<WorkshopExportRow[], void, void> {
  let cursorId: string | undefined;

  while (true) {
    const jobs = await prisma.workshopJob.findMany({
      take: batchSize,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      orderBy: { id: "asc" },
      include: {
        sale: {
          select: {
            id: true,
          },
        },
        lines: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            type: true,
            productId: true,
            variantId: true,
            description: true,
            qty: true,
            unitPricePence: true,
          },
        },
      },
    });

    if (jobs.length === 0) {
      return;
    }

    yield jobs.flatMap((job) => toWorkshopRows(job));
    cursorId = jobs[jobs.length - 1].id;
  }
}

export type InventoryExportRow = {
  inventoryMovementId: string;
  movementType: string;
  isStockAdjustment: boolean;
  timestamp: string;
  createdByStaffId: string;
  variantId: string;
  productId: string;
  sku: string;
  variantName: string;
  quantityChange: number;
  unitCost: string;
  referenceType: string;
  referenceId: string;
  note: string;
};

export const inventoryExportColumns: CsvColumn<InventoryExportRow>[] = [
  { header: "inventoryMovementId", value: (row) => row.inventoryMovementId },
  { header: "movementType", value: (row) => row.movementType },
  { header: "isStockAdjustment", value: (row) => row.isStockAdjustment },
  { header: "timestamp", value: (row) => row.timestamp },
  { header: "createdByStaffId", value: (row) => row.createdByStaffId },
  { header: "variantId", value: (row) => row.variantId },
  { header: "productId", value: (row) => row.productId },
  { header: "sku", value: (row) => row.sku },
  { header: "variantName", value: (row) => row.variantName },
  { header: "quantityChange", value: (row) => row.quantityChange },
  { header: "unitCost", value: (row) => row.unitCost },
  { header: "referenceType", value: (row) => row.referenceType },
  { header: "referenceId", value: (row) => row.referenceId },
  { header: "note", value: (row) => row.note },
];

export async function* streamInventoryExportRows(
  batchSize = INVENTORY_EXPORT_BATCH_SIZE,
): AsyncGenerator<InventoryExportRow[], void, void> {
  let cursorId: string | undefined;

  while (true) {
    const movements = await prisma.inventoryMovement.findMany({
      take: batchSize,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      orderBy: { id: "asc" },
      include: {
        variant: {
          select: {
            productId: true,
            sku: true,
            name: true,
          },
        },
      },
    });

    if (movements.length === 0) {
      return;
    }

    yield movements.map((movement) => ({
      inventoryMovementId: movement.id,
      movementType: movement.type,
      isStockAdjustment: movement.type === "ADJUSTMENT",
      timestamp: toIso(movement.createdAt),
      createdByStaffId: movement.createdByStaffId ?? "",
      variantId: movement.variantId,
      productId: movement.variant.productId,
      sku: movement.variant.sku,
      variantName: movement.variant.name ?? "",
      quantityChange: movement.quantity,
      unitCost: movement.unitCost === null ? "" : movement.unitCost.toString(),
      referenceType: movement.referenceType ?? "",
      referenceId: movement.referenceId ?? "",
      note: movement.note ?? "",
    }));

    cursorId = movements[movements.length - 1].id;
  }
}
