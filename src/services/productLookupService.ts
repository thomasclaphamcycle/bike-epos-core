import { Barcode } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";

export type BarcodeLookupResult = Barcode & {
  variant: {
    id: string;
    name: string | null;
    sku: string;
    retailPricePence: number;
    product: {
      id: string;
      name: string;
    };
  };
};

export const findBarcodeOrThrow = async (code: string): Promise<BarcodeLookupResult> => {
  const barcode = await prisma.barcode.findUnique({
    where: { code },
    include: {
      variant: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!barcode) {
    throw new HttpError(404, "Barcode not found", "BARCODE_NOT_FOUND");
  }

  return barcode;
};
