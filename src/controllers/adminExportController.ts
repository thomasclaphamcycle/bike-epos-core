import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

const PAGE_SIZE = 250;

const setCsvHeaders = (res: Response, filename: string) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200);
};

const escapeCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
};

const writeCsvRow = (res: Response, values: unknown[]) => {
  res.write(`${values.map((value) => escapeCsvCell(value)).join(",")}\n`);
};

export const exportSalesCsvHandler = async (_req: Request, res: Response) => {
  setCsvHeaders(res, "sales_export.csv");
  writeCsvRow(res, [
    "saleId",
    "status",
    "createdAt",
    "completedAt",
    "staffId",
    "staffName",
    "customerId",
    "receiptNumber",
    "lineId",
    "variantId",
    "sku",
    "description",
    "quantity",
    "unitPricePence",
    "lineTotalPence",
    "subtotalPence",
    "taxPence",
    "totalPence",
    "paymentsSummary",
  ]);

  let cursor: string | undefined;
  while (true) {
    const sales = await prisma.sale.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ id: "asc" }],
      include: {
        createdByStaff: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
        receipt: {
          select: {
            receiptNumber: true,
          },
        },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                name: true,
                product: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        payments: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            method: true,
            amountPence: true,
            purpose: true,
            status: true,
          },
        },
      },
    });

    if (sales.length === 0) {
      break;
    }

    for (const sale of sales) {
      const paymentsSummary = sale.payments
        .map((payment) => `${payment.method}:${payment.amountPence}:${payment.purpose}:${payment.status}`)
        .join("|");

      if (sale.items.length === 0) {
        writeCsvRow(res, [
          sale.id,
          sale.completedAt ? "COMPLETED" : "DRAFT",
          sale.createdAt.toISOString(),
          sale.completedAt?.toISOString() ?? "",
          sale.createdByStaff?.id ?? "",
          sale.createdByStaff?.name ?? sale.createdByStaff?.username ?? "",
          sale.customerId ?? "",
          sale.receipt?.receiptNumber ?? "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          sale.subtotalPence,
          sale.taxPence,
          sale.totalPence,
          paymentsSummary,
        ]);
        continue;
      }

      for (const line of sale.items) {
        const description = [line.variant.product.name, line.variant.name]
          .filter((part) => Boolean(part))
          .join(" - ");

        writeCsvRow(res, [
          sale.id,
          sale.completedAt ? "COMPLETED" : "DRAFT",
          sale.createdAt.toISOString(),
          sale.completedAt?.toISOString() ?? "",
          sale.createdByStaff?.id ?? "",
          sale.createdByStaff?.name ?? sale.createdByStaff?.username ?? "",
          sale.customerId ?? "",
          sale.receipt?.receiptNumber ?? "",
          line.id,
          line.variantId,
          line.variant.sku,
          description,
          line.quantity,
          line.unitPricePence,
          line.lineTotalPence,
          sale.subtotalPence,
          sale.taxPence,
          sale.totalPence,
          paymentsSummary,
        ]);
      }
    }

    if (sales.length < PAGE_SIZE) {
      break;
    }
    cursor = sales[sales.length - 1].id;
  }

  res.end();
};

export const exportWorkshopCsvHandler = async (_req: Request, res: Response) => {
  setCsvHeaders(res, "workshop_export.csv");
  writeCsvRow(res, [
    "jobId",
    "status",
    "customerId",
    "customerName",
    "bikeDescription",
    "scheduledDate",
    "createdAt",
    "updatedAt",
    "linkedSaleId",
    "lineId",
    "lineType",
    "lineDescription",
    "quantity",
    "unitPricePence",
    "lineTotalPence",
  ]);

  let cursor: string | undefined;
  while (true) {
    const jobs = await prisma.workshopJob.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ id: "asc" }],
      include: {
        sale: {
          select: {
            id: true,
          },
        },
        lines: {
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });

    if (jobs.length === 0) {
      break;
    }

    for (const job of jobs) {
      if (job.lines.length === 0) {
        writeCsvRow(res, [
          job.id,
          job.status,
          job.customerId ?? "",
          job.customerName ?? "",
          job.bikeDescription ?? "",
          job.scheduledDate?.toISOString() ?? "",
          job.createdAt.toISOString(),
          job.updatedAt.toISOString(),
          job.sale?.id ?? "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
        continue;
      }

      for (const line of job.lines) {
        writeCsvRow(res, [
          job.id,
          job.status,
          job.customerId ?? "",
          job.customerName ?? "",
          job.bikeDescription ?? "",
          job.scheduledDate?.toISOString() ?? "",
          job.createdAt.toISOString(),
          job.updatedAt.toISOString(),
          job.sale?.id ?? "",
          line.id,
          line.type,
          line.description,
          line.qty,
          line.unitPricePence,
          line.qty * line.unitPricePence,
        ]);
      }
    }

    if (jobs.length < PAGE_SIZE) {
      break;
    }
    cursor = jobs[jobs.length - 1].id;
  }

  res.end();
};

export const exportInventoryCsvHandler = async (_req: Request, res: Response) => {
  setCsvHeaders(res, "inventory_export.csv");
  writeCsvRow(res, [
    "source",
    "id",
    "timestamp",
    "movementType",
    "variantId",
    "productId",
    "sku",
    "quantityDelta",
    "referenceType",
    "referenceId",
    "note",
    "createdByStaffId",
  ]);

  type InventoryMovementRow = {
    id: string;
    createdAt: Date;
    type: string;
    quantity: number;
    referenceType: string | null;
    referenceId: string | null;
    note: string | null;
    createdByStaffId: string | null;
    variantId: string;
    productId: string;
    sku: string;
  };

  type StockAdjustmentRow = {
    id: string;
    createdAt: Date;
    type: string;
    quantityDelta: number;
    referenceType: string;
    referenceId: string;
    note: string | null;
    createdByStaffId: string | null;
    variantId: string;
    productId: string;
    sku: string;
  };

  let movementCursor: string | undefined;
  while (true) {
    const movements: InventoryMovementRow[] = movementCursor
      ? await prisma.$queryRawUnsafe(
          `
          SELECT
            im.id,
            im."createdAt",
            im.type::text AS type,
            im.quantity,
            im."referenceType",
            im."referenceId",
            im.note,
            im."createdByStaffId",
            im."variantId",
            v."productId",
            v.sku
          FROM "InventoryMovement" im
          JOIN "Variant" v ON v.id = im."variantId"
          WHERE im.id > $1
          ORDER BY im.id ASC
          LIMIT $2
          `,
          movementCursor,
          PAGE_SIZE,
        )
      : await prisma.$queryRawUnsafe(
          `
          SELECT
            im.id,
            im."createdAt",
            im.type::text AS type,
            im.quantity,
            im."referenceType",
            im."referenceId",
            im.note,
            im."createdByStaffId",
            im."variantId",
            v."productId",
            v.sku
          FROM "InventoryMovement" im
          JOIN "Variant" v ON v.id = im."variantId"
          ORDER BY im.id ASC
          LIMIT $1
          `,
          PAGE_SIZE,
        );

    if (movements.length === 0) {
      break;
    }

    for (const movement of movements) {
      writeCsvRow(res, [
        "INVENTORY_MOVEMENT",
        movement.id,
        new Date(movement.createdAt).toISOString(),
        movement.type,
        movement.variantId,
        movement.productId,
        movement.sku,
        movement.quantity,
        movement.referenceType ?? "",
        movement.referenceId ?? "",
        movement.note ?? "",
        movement.createdByStaffId ?? "",
      ]);
    }

    if (movements.length < PAGE_SIZE) {
      break;
    }
    movementCursor = movements[movements.length - 1].id;
  }

  let ledgerCursor: string | undefined;
  while (true) {
    const adjustments: StockAdjustmentRow[] = ledgerCursor
      ? await prisma.$queryRawUnsafe(
          `
          SELECT
            sle.id,
            sle."createdAt",
            sle.type::text AS type,
            sle."quantityDelta",
            sle."referenceType",
            sle."referenceId",
            sle.note,
            sle."createdByStaffId",
            sle."variantId",
            v."productId",
            v.sku
          FROM "StockLedgerEntry" sle
          JOIN "Variant" v ON v.id = sle."variantId"
          WHERE sle.type = 'ADJUSTMENT'
            AND sle.id > $1
          ORDER BY sle.id ASC
          LIMIT $2
          `,
          ledgerCursor,
          PAGE_SIZE,
        )
      : await prisma.$queryRawUnsafe(
          `
          SELECT
            sle.id,
            sle."createdAt",
            sle.type::text AS type,
            sle."quantityDelta",
            sle."referenceType",
            sle."referenceId",
            sle.note,
            sle."createdByStaffId",
            sle."variantId",
            v."productId",
            v.sku
          FROM "StockLedgerEntry" sle
          JOIN "Variant" v ON v.id = sle."variantId"
          WHERE sle.type = 'ADJUSTMENT'
          ORDER BY sle.id ASC
          LIMIT $1
          `,
          PAGE_SIZE,
        );

    if (adjustments.length === 0) {
      break;
    }

    for (const adjustment of adjustments) {
      writeCsvRow(res, [
        "STOCK_ADJUSTMENT",
        adjustment.id,
        new Date(adjustment.createdAt).toISOString(),
        adjustment.type,
        adjustment.variantId,
        adjustment.productId,
        adjustment.sku,
        adjustment.quantityDelta,
        adjustment.referenceType,
        adjustment.referenceId,
        adjustment.note ?? "",
        adjustment.createdByStaffId ?? "",
      ]);
    }

    if (adjustments.length < PAGE_SIZE) {
      break;
    }
    ledgerCursor = adjustments[adjustments.length - 1].id;
  }

  res.end();
};
