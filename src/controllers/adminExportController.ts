import { once } from "node:events";
import { Request, Response } from "express";
import type { CsvColumn } from "../utils/csv";
import { toCsv } from "../utils/csv";
import {
  inventoryExportColumns,
  salesExportColumns,
  streamInventoryExportRows,
  streamSalesExportRows,
  streamWorkshopExportRows,
  workshopExportColumns,
} from "../services/adminExportService";

const stripCsvHeader = (chunk: string) => {
  const newlineIndex = chunk.indexOf("\n");
  if (newlineIndex < 0) {
    return "";
  }
  return chunk.slice(newlineIndex + 1);
};

const writeChunk = async (res: Response, chunk: string) => {
  if (chunk.length === 0) {
    return;
  }
  if (!res.write(chunk)) {
    await once(res, "drain");
  }
};

const streamCsv = async <T>(
  res: Response,
  filename: string,
  columns: CsvColumn<T>[],
  source: AsyncGenerator<T[], void, void>,
) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200);

  let headerWritten = false;

  for await (const rows of source) {
    if (rows.length === 0) {
      continue;
    }

    const csvChunk = toCsv(rows, columns);
    const body = headerWritten ? stripCsvHeader(csvChunk) : csvChunk;
    if (body.length > 0) {
      await writeChunk(res, body.endsWith("\n") ? body : `${body}\n`);
      headerWritten = true;
    }
  }

  if (!headerWritten) {
    await writeChunk(res, toCsv([], columns));
  }

  res.end();
};

export const getAdminSalesExportHandler = async (_req: Request, res: Response) => {
  await streamCsv(res, "admin_sales_export.csv", salesExportColumns, streamSalesExportRows());
};

export const getAdminWorkshopExportHandler = async (_req: Request, res: Response) => {
  await streamCsv(
    res,
    "admin_workshop_export.csv",
    workshopExportColumns,
    streamWorkshopExportRows(),
  );
};

export const getAdminInventoryExportHandler = async (_req: Request, res: Response) => {
  await streamCsv(
    res,
    "admin_inventory_export.csv",
    inventoryExportColumns,
    streamInventoryExportRows(),
  );
};
