import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type CreateCustomerBikeInput = {
  label?: string;
  make?: string;
  model?: string;
  colour?: string;
  frameNumber?: string;
  serialNumber?: string;
  registrationNumber?: string;
  notes?: string;
};

const customerBikeSelect = Prisma.validator<Prisma.CustomerBikeSelect>()({
  id: true,
  customerId: true,
  label: true,
  make: true,
  model: true,
  colour: true,
  frameNumber: true,
  serialNumber: true,
  registrationNumber: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
});

type CustomerBikeRecord = Prisma.CustomerBikeGetPayload<{
  select: typeof customerBikeSelect;
}>;

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildIdentifier = (input: {
  frameNumber?: string | null;
  serialNumber?: string | null;
  registrationNumber?: string | null;
}) => {
  const registration = normalizeOptionalText(input.registrationNumber);
  if (registration) {
    return registration;
  }

  const frameNumber = normalizeOptionalText(input.frameNumber);
  if (frameNumber) {
    return `Frame ${frameNumber}`;
  }

  const serialNumber = normalizeOptionalText(input.serialNumber);
  if (serialNumber) {
    return `Serial ${serialNumber}`;
  }

  return undefined;
};

export const buildCustomerBikeDisplayName = (input: {
  label?: string | null;
  make?: string | null;
  model?: string | null;
  colour?: string | null;
  frameNumber?: string | null;
  serialNumber?: string | null;
  registrationNumber?: string | null;
}) => {
  const label = normalizeOptionalText(input.label);
  const makeModel = [normalizeOptionalText(input.make), normalizeOptionalText(input.model)]
    .filter(Boolean)
    .join(" ");
  const colour = normalizeOptionalText(input.colour);
  const identifier = buildIdentifier(input);

  const primary = [label, makeModel || undefined].filter(Boolean).join(" · ");
  if (primary) {
    return [primary, colour, identifier].filter(Boolean).join(" | ");
  }

  const fallback = [makeModel || undefined, colour, identifier].filter(Boolean).join(" | ");
  if (fallback) {
    return fallback;
  }

  return "Customer bike";
};

const toCustomerBikeResponse = (bike: CustomerBikeRecord) => ({
  id: bike.id,
  customerId: bike.customerId,
  label: bike.label,
  make: bike.make,
  model: bike.model,
  colour: bike.colour,
  frameNumber: bike.frameNumber,
  serialNumber: bike.serialNumber,
  registrationNumber: bike.registrationNumber,
  notes: bike.notes,
  displayName: buildCustomerBikeDisplayName(bike),
  createdAt: bike.createdAt,
  updatedAt: bike.updatedAt,
});

const assertCustomerExistsTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  customerId: string,
) => {
  if (!isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });

  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  return customer;
};

const validateCustomerBikeIdentity = (input: {
  label?: string;
  make?: string;
  model?: string;
  colour?: string;
  frameNumber?: string;
  serialNumber?: string;
  registrationNumber?: string;
}) => {
  const hasIdentityField = [
    input.label,
    input.make,
    input.model,
    input.colour,
    input.frameNumber,
    input.serialNumber,
    input.registrationNumber,
  ].some((value) => value !== undefined);

  if (!hasIdentityField) {
    throw new HttpError(
      400,
      "At least one bike identity field is required",
      "INVALID_CUSTOMER_BIKE",
    );
  }
};

export const getCustomerBikeByIdTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  customerBikeId: string,
) => {
  if (!isUuid(customerBikeId)) {
    throw new HttpError(400, "Invalid customer bike id", "INVALID_CUSTOMER_BIKE_ID");
  }

  const bike = await tx.customerBike.findUnique({
    where: { id: customerBikeId },
    select: customerBikeSelect,
  });

  if (!bike) {
    throw new HttpError(404, "Bike record not found", "CUSTOMER_BIKE_NOT_FOUND");
  }

  return bike;
};

export const listCustomerBikes = async (customerId: string) => {
  await assertCustomerExistsTx(prisma, customerId);

  const bikes = await prisma.customerBike.findMany({
    where: { customerId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: customerBikeSelect,
  });

  return {
    customerId,
    bikes: bikes.map(toCustomerBikeResponse),
  };
};

export const createCustomerBike = async (
  customerId: string,
  input: CreateCustomerBikeInput,
) => {
  const label = normalizeOptionalText(input.label);
  const make = normalizeOptionalText(input.make);
  const model = normalizeOptionalText(input.model);
  const colour = normalizeOptionalText(input.colour);
  const frameNumber = normalizeOptionalText(input.frameNumber);
  const serialNumber = normalizeOptionalText(input.serialNumber);
  const registrationNumber = normalizeOptionalText(input.registrationNumber);
  const notes = normalizeOptionalText(input.notes) ?? null;

  validateCustomerBikeIdentity({
    label,
    make,
    model,
    colour,
    frameNumber,
    serialNumber,
    registrationNumber,
  });

  return prisma.$transaction(async (tx) => {
    await assertCustomerExistsTx(tx, customerId);

    const bike = await tx.customerBike.create({
      data: {
        customerId,
        label,
        make,
        model,
        colour,
        frameNumber,
        serialNumber,
        registrationNumber,
        notes,
      },
      select: customerBikeSelect,
    });

    return {
      bike: toCustomerBikeResponse(bike),
    };
  });
};

export const toWorkshopBikeResponse = (bike: CustomerBikeRecord | null) =>
  bike
    ? {
        ...toCustomerBikeResponse(bike),
      }
    : null;
