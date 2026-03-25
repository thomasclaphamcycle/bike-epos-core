import { HireAssetStatus, HireBookingStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName } from "../utils/customerName";
import { createAuditEventTx, type AuditActor } from "./auditService";

type CreateHireAssetInput = {
  variantId?: string;
  assetTag?: string;
  displayName?: string;
  notes?: string;
};

type CreateHireBookingInput = {
  hireAssetId?: string;
  customerId?: string;
  startsAt?: string;
  dueBackAt?: string;
  hirePricePence?: number;
  depositPence?: number;
  notes?: string;
};

type CheckoutHireBookingInput = {
  depositHeldPence?: number;
};

type ReturnHireBookingInput = {
  notes?: string;
  depositOutcome?: "RETURNED" | "KEPT";
};

type ListHireAssetFilters = {
  status?: HireAssetStatus;
  q?: string;
  take?: number;
  skip?: number;
};

type ListHireBookingFilters = {
  status?: HireBookingStatus;
  take?: number;
  skip?: number;
};

const normalizeOptionalText = (value: string | undefined | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseTake = (take: number | undefined): number | undefined => {
  if (take === undefined) {
    return undefined;
  }
  if (!Number.isInteger(take) || take < 1 || take > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_HIRE_QUERY");
  }
  return take;
};

const parseSkip = (skip: number | undefined): number | undefined => {
  if (skip === undefined) {
    return undefined;
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new HttpError(400, "skip must be an integer >= 0", "INVALID_HIRE_QUERY");
  }
  return skip;
};

const parseCurrencyPence = (
  value: number | undefined,
  field: "hirePricePence" | "depositPence" | "depositHeldPence",
  code: string,
) => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`, code);
  }
  return value;
};

const parseRequiredDate = (value: string | undefined, field: "startsAt" | "dueBackAt", code: string) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new HttpError(400, `${field} is required`, code);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${field} must be a valid date-time`, code);
  }
  return parsed;
};

const assertUuidOrThrow = (value: string | undefined, message: string, code: string) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized || !isUuid(normalized)) {
    throw new HttpError(400, message, code);
  }
  return normalized;
};

const hireAssetInclude = {
  variant: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      option: true,
      retailPricePence: true,
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
        },
      },
    },
  },
  bookings: {
    where: {
      status: {
        in: ["RESERVED", "CHECKED_OUT"],
      },
    },
    select: {
      id: true,
      status: true,
      startsAt: true,
      dueBackAt: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: [{ startsAt: "asc" }],
  },
} satisfies Prisma.HireAssetInclude;

const hireBookingInclude = {
  hireAsset: {
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          option: true,
          retailPricePence: true,
          product: {
            select: {
              id: true,
              name: true,
              brand: true,
            },
          },
        },
      },
    },
  },
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
} satisfies Prisma.HireBookingInclude;

const mapHireAsset = (asset: Prisma.HireAssetGetPayload<{ include: typeof hireAssetInclude }>) => ({
  id: asset.id,
  assetTag: asset.assetTag,
  displayName: asset.displayName,
  notes: asset.notes,
  status: asset.status,
  createdAt: asset.createdAt,
  updatedAt: asset.updatedAt,
  variant: {
    id: asset.variant.id,
    sku: asset.variant.sku,
    barcode: asset.variant.barcode,
    variantName: asset.variant.name ?? asset.variant.option ?? null,
    retailPricePence: asset.variant.retailPricePence,
    productId: asset.variant.product.id,
    productName: asset.variant.product.name,
    brand: asset.variant.product.brand,
  },
  activeBooking: asset.bookings[0]
    ? {
        id: asset.bookings[0].id,
        status: asset.bookings[0].status,
        startsAt: asset.bookings[0].startsAt,
        dueBackAt: asset.bookings[0].dueBackAt,
        customer: {
          id: asset.bookings[0].customer.id,
          name: getCustomerDisplayName(asset.bookings[0].customer),
        },
      }
    : null,
});

const mapHireBooking = (booking: Prisma.HireBookingGetPayload<{ include: typeof hireBookingInclude }>) => ({
  id: booking.id,
  status: booking.status,
  depositStatus: booking.depositStatus,
  startsAt: booking.startsAt,
  dueBackAt: booking.dueBackAt,
  checkedOutAt: booking.checkedOutAt,
  returnedAt: booking.returnedAt,
  hirePricePence: booking.hirePricePence,
  depositPence: booking.depositPence,
  depositHeldPence: booking.depositHeldPence,
  notes: booking.notes,
  createdAt: booking.createdAt,
  updatedAt: booking.updatedAt,
  hireAsset: {
    id: booking.hireAsset.id,
    assetTag: booking.hireAsset.assetTag,
    displayName: booking.hireAsset.displayName,
    status: booking.hireAsset.status,
    variant: {
      id: booking.hireAsset.variant.id,
      sku: booking.hireAsset.variant.sku,
      barcode: booking.hireAsset.variant.barcode,
      variantName: booking.hireAsset.variant.name ?? booking.hireAsset.variant.option ?? null,
      retailPricePence: booking.hireAsset.variant.retailPricePence,
      productId: booking.hireAsset.variant.product.id,
      productName: booking.hireAsset.variant.product.name,
      brand: booking.hireAsset.variant.product.brand,
    },
  },
  customer: {
    id: booking.customer.id,
    name: getCustomerDisplayName(booking.customer),
    email: booking.customer.email,
    phone: booking.customer.phone,
  },
});

const getHireBookingOrThrowTx = async (tx: Prisma.TransactionClient, bookingId: string) => {
  const booking = await tx.hireBooking.findUnique({
    where: { id: bookingId },
    include: hireBookingInclude,
  });

  if (!booking) {
    throw new HttpError(404, "Hire booking not found", "HIRE_BOOKING_NOT_FOUND");
  }

  return booking;
};

export const listHireAssets = async (filters: ListHireAssetFilters = {}) => {
  const q = normalizeOptionalText(filters.q);
  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);

  const assets = await prisma.hireAsset.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(q
        ? {
            OR: [
              { assetTag: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              { variant: { sku: { contains: q, mode: "insensitive" } } },
              { variant: { barcode: { contains: q, mode: "insensitive" } } },
              { variant: { product: { name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: hireAssetInclude,
    orderBy: [{ createdAt: "desc" }],
    ...(take ? { take } : {}),
    ...(skip ? { skip } : {}),
  });

  return {
    filters: {
      status: filters.status ?? null,
      q: q ?? null,
      take: take ?? null,
      skip: skip ?? null,
    },
    assets: assets.map(mapHireAsset),
  };
};

export const createHireAsset = async (input: CreateHireAssetInput, auditActor?: AuditActor) => {
  const variantId = normalizeOptionalText(input.variantId);
  const assetTag = normalizeOptionalText(input.assetTag);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_HIRE_ASSET");
  }
  if (!assetTag) {
    throw new HttpError(400, "assetTag is required", "INVALID_HIRE_ASSET");
  }

  const displayName = normalizeOptionalText(input.displayName) ?? null;
  const notes = normalizeOptionalText(input.notes) ?? null;

  let asset;
  try {
    asset = await prisma.$transaction(async (tx) => {
      const variant = await tx.variant.findUnique({
        where: { id: variantId },
        select: { id: true },
      });
      if (!variant) {
        throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
      }

      const created = await tx.hireAsset.create({
        data: {
          variantId,
          assetTag,
          displayName,
          notes,
        },
        include: hireAssetInclude,
      });

      await createAuditEventTx(
        tx,
        {
          action: "HIRE_ASSET_CREATED",
          entityType: "HIRE_ASSET",
          entityId: created.id,
          metadata: {
            variantId,
            assetTag,
          },
        },
        auditActor,
      );

      return created;
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      throw new HttpError(409, "Asset tag already exists", "HIRE_ASSET_TAG_EXISTS");
    }
    throw error;
  }

  return mapHireAsset(asset);
};

export const listHireBookings = async (filters: ListHireBookingFilters = {}) => {
  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);

  const bookings = await prisma.hireBooking.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: hireBookingInclude,
    orderBy: [{ createdAt: "desc" }],
    ...(take ? { take } : {}),
    ...(skip ? { skip } : {}),
  });

  return {
    filters: {
      status: filters.status ?? null,
      take: take ?? null,
      skip: skip ?? null,
    },
    bookings: bookings.map(mapHireBooking),
  };
};

export const createHireBooking = async (input: CreateHireBookingInput, auditActor?: AuditActor) => {
  const hireAssetId = assertUuidOrThrow(input.hireAssetId, "hireAssetId must be a valid UUID", "INVALID_HIRE_BOOKING");
  const customerId = assertUuidOrThrow(input.customerId, "customerId must be a valid UUID", "INVALID_HIRE_BOOKING");
  const startsAt = parseRequiredDate(input.startsAt, "startsAt", "INVALID_HIRE_BOOKING");
  const dueBackAt = parseRequiredDate(input.dueBackAt, "dueBackAt", "INVALID_HIRE_BOOKING");
  if (startsAt >= dueBackAt) {
    throw new HttpError(400, "startsAt must be before dueBackAt", "INVALID_HIRE_BOOKING");
  }

  const hirePricePence = parseCurrencyPence(input.hirePricePence, "hirePricePence", "INVALID_HIRE_BOOKING") ?? 0;
  const depositPence = parseCurrencyPence(input.depositPence, "depositPence", "INVALID_HIRE_BOOKING") ?? 0;
  const notes = normalizeOptionalText(input.notes) ?? null;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;

  const booking = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
    }

    const asset = await tx.hireAsset.findUnique({
      where: { id: hireAssetId },
      include: hireAssetInclude,
    });
    if (!asset) {
      throw new HttpError(404, "Hire asset not found", "HIRE_ASSET_NOT_FOUND");
    }
    if (asset.status !== "AVAILABLE") {
      throw new HttpError(409, "Hire asset is not currently available", "HIRE_ASSET_UNAVAILABLE");
    }

    const created = await tx.hireBooking.create({
      data: {
        hireAssetId,
        customerId,
        startsAt,
        dueBackAt,
        hirePricePence,
        depositPence,
        notes,
        createdByStaffId: actorId,
      },
      include: hireBookingInclude,
    });

    await tx.hireAsset.update({
      where: { id: hireAssetId },
      data: {
        status: "RESERVED",
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_BOOKING_CREATED",
        entityType: "HIRE_BOOKING",
        entityId: created.id,
        metadata: {
          hireAssetId,
          customerId,
          dueBackAt: dueBackAt.toISOString(),
        },
      },
      auditActor,
    );

    return getHireBookingOrThrowTx(tx, created.id);
  });

  return mapHireBooking(booking);
};

export const checkoutHireBooking = async (
  bookingId: string,
  input: CheckoutHireBookingInput,
  auditActor?: AuditActor,
) => {
  const validatedId = assertUuidOrThrow(bookingId, "Invalid hire booking id", "INVALID_HIRE_BOOKING_ID");
  const depositHeldPence = parseCurrencyPence(
    input.depositHeldPence,
    "depositHeldPence",
    "INVALID_HIRE_BOOKING_CHECKOUT",
  ) ?? 0;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;

  const booking = await prisma.$transaction(async (tx) => {
    const current = await getHireBookingOrThrowTx(tx, validatedId);

    if (current.status !== "RESERVED") {
      throw new HttpError(409, "Only reserved bookings can be checked out", "HIRE_BOOKING_NOT_RESERVED");
    }
    if (current.depositPence > depositHeldPence) {
      throw new HttpError(409, "Required deposit has not been fully held", "HIRE_DEPOSIT_REQUIRED");
    }

    const updated = await tx.hireBooking.update({
      where: { id: current.id },
      data: {
        status: "CHECKED_OUT",
        checkedOutAt: new Date(),
        checkedOutByStaffId: actorId,
        depositHeldPence,
        depositStatus: depositHeldPence > 0 ? "HELD" : "NONE",
      },
      include: hireBookingInclude,
    });

    await tx.hireAsset.update({
      where: { id: current.hireAsset.id },
      data: {
        status: "ON_HIRE",
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_BOOKING_CHECKED_OUT",
        entityType: "HIRE_BOOKING",
        entityId: updated.id,
        metadata: {
          depositHeldPence,
        },
      },
      auditActor,
    );

    return getHireBookingOrThrowTx(tx, updated.id);
  });

  return mapHireBooking(booking);
};

export const returnHireBooking = async (
  bookingId: string,
  input: ReturnHireBookingInput,
  auditActor?: AuditActor,
) => {
  const validatedId = assertUuidOrThrow(bookingId, "Invalid hire booking id", "INVALID_HIRE_BOOKING_ID");
  const notes = normalizeOptionalText(input.notes);
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;

  const booking = await prisma.$transaction(async (tx) => {
    const current = await getHireBookingOrThrowTx(tx, validatedId);

    if (current.status !== "CHECKED_OUT") {
      throw new HttpError(409, "Only checked-out bookings can be returned", "HIRE_BOOKING_NOT_CHECKED_OUT");
    }

    const nextDepositStatus =
      current.depositHeldPence > 0
        ? input.depositOutcome === "KEPT"
          ? "KEPT"
          : "RETURNED"
        : "NONE";

    const updated = await tx.hireBooking.update({
      where: { id: current.id },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        returnedByStaffId: actorId,
        depositStatus: nextDepositStatus,
        ...(notes !== undefined ? { notes } : {}),
      },
      include: hireBookingInclude,
    });

    await tx.hireAsset.update({
      where: { id: current.hireAsset.id },
      data: {
        status: "AVAILABLE",
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_BOOKING_RETURNED",
        entityType: "HIRE_BOOKING",
        entityId: updated.id,
        metadata: {
          depositStatus: nextDepositStatus,
        },
      },
      auditActor,
    );

    return getHireBookingOrThrowTx(tx, updated.id);
  });

  return mapHireBooking(booking);
};

export const cancelHireBooking = async (bookingId: string, auditActor?: AuditActor) => {
  const validatedId = assertUuidOrThrow(bookingId, "Invalid hire booking id", "INVALID_HIRE_BOOKING_ID");

  const booking = await prisma.$transaction(async (tx) => {
    const current = await getHireBookingOrThrowTx(tx, validatedId);

    if (current.status === "CANCELLED") {
      throw new HttpError(409, "Booking is already cancelled", "HIRE_BOOKING_CANCELLED");
    }
    if (current.status === "RETURNED") {
      throw new HttpError(409, "Returned bookings cannot be cancelled", "HIRE_BOOKING_RETURNED");
    }
    if (current.status === "CHECKED_OUT") {
      throw new HttpError(409, "Checked-out bookings must be returned, not cancelled", "HIRE_BOOKING_ACTIVE");
    }

    const updated = await tx.hireBooking.update({
      where: { id: current.id },
      data: {
        status: "CANCELLED",
      },
      include: hireBookingInclude,
    });

    await tx.hireAsset.update({
      where: { id: current.hireAsset.id },
      data: {
        status: "AVAILABLE",
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_BOOKING_CANCELLED",
        entityType: "HIRE_BOOKING",
        entityId: updated.id,
      },
      auditActor,
    );

    return getHireBookingOrThrowTx(tx, updated.id);
  });

  return mapHireBooking(booking);
};
