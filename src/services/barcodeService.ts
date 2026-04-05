import { BarcodeType, Prisma } from "@prisma/client";
import { HttpError } from "../utils/http";

const INTERNAL_BARCODE_PREFIX = "CP-";
const INTERNAL_BARCODE_WIDTH = 6;
const INTERNAL_BARCODE_PATTERN = /^CP-(\d{6})$/i;

type VariantBarcodeRegistryInput = {
  manufacturerBarcode: string | null;
  internalBarcode: string | null;
  preferredBarcode: string | null;
};

const toInternalBarcodeSequence = (value: string | null | undefined) => {
  if (!value) {
    return 0;
  }

  const match = value.trim().toUpperCase().match(INTERNAL_BARCODE_PATTERN);
  const sequence = match?.[1];
  return sequence ? Number.parseInt(sequence, 10) : 0;
};

const toBarcodeConflictError = () =>
  new HttpError(409, "Barcode already exists", "BARCODE_EXISTS");

export const formatInternalBarcodeValue = (sequence: number) =>
  `${INTERNAL_BARCODE_PREFIX}${String(sequence).padStart(INTERNAL_BARCODE_WIDTH, "0")}`;

export const getPreferredVariantBarcode = (input: {
  manufacturerBarcode?: string | null;
  internalBarcode?: string | null;
}) => input.manufacturerBarcode || input.internalBarcode || null;

export const ensureBarcodeCodeAvailableTx = async (
  tx: Prisma.TransactionClient,
  code: string,
  exceptVariantId?: string,
) => {
  const existingVariant = await tx.variant.findFirst({
    where: {
      OR: [
        { barcode: code },
        { manufacturerBarcode: code },
        { internalBarcode: code },
      ],
      ...(exceptVariantId
        ? {
            NOT: {
              id: exceptVariantId,
            },
          }
        : {}),
    },
    select: { id: true },
  });

  if (existingVariant) {
    throw toBarcodeConflictError();
  }

  const existingRegistryBarcode = await tx.barcode.findUnique({
    where: { code },
    select: { variantId: true },
  });

  if (existingRegistryBarcode && existingRegistryBarcode.variantId !== exceptVariantId) {
    throw toBarcodeConflictError();
  }
};

export const generateNextInternalBarcodeTx = async (
  tx: Prisma.TransactionClient,
  exceptVariantId?: string,
) => {
  const [maxPreferred, maxManufacturer, maxInternal, maxRegistry] = await Promise.all([
    tx.variant.findFirst({
      where: {
        barcode: {
          startsWith: INTERNAL_BARCODE_PREFIX,
        },
      },
      orderBy: { barcode: "desc" },
      select: { barcode: true },
    }),
    tx.variant.findFirst({
      where: {
        manufacturerBarcode: {
          startsWith: INTERNAL_BARCODE_PREFIX,
        },
      },
      orderBy: { manufacturerBarcode: "desc" },
      select: { manufacturerBarcode: true },
    }),
    tx.variant.findFirst({
      where: {
        internalBarcode: {
          startsWith: INTERNAL_BARCODE_PREFIX,
        },
      },
      orderBy: { internalBarcode: "desc" },
      select: { internalBarcode: true },
    }),
    tx.barcode.findFirst({
      where: {
        code: {
          startsWith: INTERNAL_BARCODE_PREFIX,
        },
      },
      orderBy: { code: "desc" },
      select: { code: true },
    }),
  ]);

  const startSequence = Math.max(
    toInternalBarcodeSequence(maxPreferred?.barcode),
    toInternalBarcodeSequence(maxManufacturer?.manufacturerBarcode),
    toInternalBarcodeSequence(maxInternal?.internalBarcode),
    toInternalBarcodeSequence(maxRegistry?.code),
  );

  for (let offset = 1; offset < 10_000; offset += 1) {
    const candidate = formatInternalBarcodeValue(startSequence + offset);
    try {
      await ensureBarcodeCodeAvailableTx(tx, candidate, exceptVariantId);
      return candidate;
    } catch (error) {
      if (error instanceof HttpError && error.code === "BARCODE_EXISTS") {
        continue;
      }
      throw error;
    }
  }

  throw new HttpError(
    500,
    "Could not generate an internal barcode",
    "INTERNAL_BARCODE_GENERATION_FAILED",
  );
};

export const syncVariantBarcodeRegistryTx = async (
  tx: Prisma.TransactionClient,
  variantId: string,
  input: VariantBarcodeRegistryInput,
) => {
  const preferredBarcode = input.preferredBarcode;
  const desiredEntries = new Map<string, { type: BarcodeType; isPrimary: boolean }>();

  if (input.manufacturerBarcode) {
    desiredEntries.set(input.manufacturerBarcode, {
      type: BarcodeType.EAN,
      isPrimary: preferredBarcode === input.manufacturerBarcode,
    });
  }

  if (input.internalBarcode) {
    desiredEntries.set(input.internalBarcode, {
      type: BarcodeType.INTERNAL,
      isPrimary: preferredBarcode === input.internalBarcode,
    });
  }

  const existingEntries = await tx.barcode.findMany({
    where: { variantId },
    orderBy: { createdAt: "asc" },
  });

  const handledIds = new Set<string>();
  for (const [code, desired] of desiredEntries.entries()) {
    const existing = existingEntries.find((entry) => entry.code === code);
    if (existing) {
      handledIds.add(existing.id);
      if (existing.type !== desired.type || existing.isPrimary !== desired.isPrimary) {
        await tx.barcode.update({
          where: { id: existing.id },
          data: {
            type: desired.type,
            isPrimary: desired.isPrimary,
          },
        });
      }
      continue;
    }

    await tx.barcode.create({
      data: {
        variantId,
        code,
        type: desired.type,
        isPrimary: desired.isPrimary,
      },
    });
  }

  const obsoleteIds = existingEntries
    .filter((entry) => !desiredEntries.has(entry.code) && !handledIds.has(entry.id))
    .map((entry) => entry.id);

  if (obsoleteIds.length > 0) {
    await tx.barcode.deleteMany({
      where: {
        id: {
          in: obsoleteIds,
        },
      },
    });
  }
};
