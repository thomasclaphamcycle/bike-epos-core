import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  confirmRotaSpreadsheetImport,
  previewRotaSpreadsheetImport,
  type LegacyRotaImportDelimiter,
} from "../src/services/rotaImportService";

type ParsedArgs = {
  filePath: string;
  apply: boolean;
  delimiter: LegacyRotaImportDelimiter;
};

const DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL or TEST_DATABASE_URL is required.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: DATABASE_URL,
  }),
});

const usage = () => {
  console.log(
    "Usage: ts-node --transpile-only scripts/import_rota_spreadsheet.ts --file <export.csv|export.tsv> [--apply] [--delimiter auto|comma|tab|semicolon]",
  );
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let filePath = "";
  let apply = false;
  let delimiter: LegacyRotaImportDelimiter = "auto";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file" && argv[index + 1]) {
      filePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      apply = false;
      continue;
    }
    if (arg === "--delimiter" && argv[index + 1]) {
      const rawDelimiter = argv[index + 1].toLowerCase();
      index += 1;
      if (rawDelimiter === "comma") {
        delimiter = ",";
      } else if (rawDelimiter === "tab") {
        delimiter = "\t";
      } else if (rawDelimiter === "semicolon") {
        delimiter = ";";
      } else {
        delimiter = "auto";
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
  }

  if (!filePath) {
    usage();
    throw new Error("--file is required.");
  }

  return { filePath, apply, delimiter };
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const absoluteFilePath = path.resolve(args.filePath);
  const spreadsheetText = fs.readFileSync(absoluteFilePath, "utf8");
  const fileName = path.basename(absoluteFilePath);

  const preview = await previewRotaSpreadsheetImport({
    spreadsheetText,
    fileName,
    delimiter: args.delimiter,
    db: prisma,
  });

  if (!args.apply) {
    console.log("[rota-import] mode=dry-run");
    console.log(`[rota-import] file=${absoluteFilePath}`);
    console.log(`[rota-import] period=${preview.period.startsOn}..${preview.period.endsOn}`);
    console.log(`[rota-import] weekBlocks=${preview.summary.weekBlocks}`);
    console.log(`[rota-import] parsedAssignments=${preview.summary.parsedAssignments}`);
    console.log("[rota-import] createdAssignments=0");
    console.log("[rota-import] updatedAssignments=0");
    console.log(`[rota-import] skippedCells=${preview.summary.skippedCells}`);
    if (preview.warnings.length) {
      console.log("[rota-import] warnings:");
      for (const warning of preview.warnings) {
        console.log(`- ${warning}`);
      }
    } else {
      console.log("[rota-import] warnings: none");
    }
    return;
  }

  const result = await confirmRotaSpreadsheetImport({
    spreadsheetText,
    fileName,
    delimiter: args.delimiter,
    previewKey: preview.previewKey,
    db: prisma,
  });

  console.log("[rota-import] mode=apply");
  console.log(`[rota-import] file=${absoluteFilePath}`);
  console.log(`[rota-import] period=${result.period.startsOn}..${result.period.endsOn}`);
  console.log(`[rota-import] weekBlocks=${result.summary.weekBlocks}`);
  console.log(`[rota-import] parsedAssignments=${result.summary.parsedAssignments}`);
  console.log(`[rota-import] createdAssignments=${result.createdAssignments}`);
  console.log(`[rota-import] updatedAssignments=${result.updatedAssignments}`);
  console.log(`[rota-import] skippedCells=${result.summary.skippedCells}`);
  if (result.warnings.length) {
    console.log("[rota-import] warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  } else {
    console.log("[rota-import] warnings: none");
  }
};

run()
  .catch((error) => {
    console.error(`[rota-import] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
