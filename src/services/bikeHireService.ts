import {
  HireAssetStatus,
  HireBookingStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName } from "../utils/customerName";
import { createAuditEventTx, type AuditActor } from "./auditService";

type CreateHireAssetInput = {
  variantId?: string;
  assetTag?: string;
  displayName?: string;
  notes?: string;
  storageLocation?: string;
  isOnlineBookable?: boolean;
};

type UpdateHireAssetInput = {
  displayName?: string;
  notes?: string;
  storageLocation?: string;
  isOnlineBookable?: boolean;
  status?: "AVAILABLE" | "MAINTENANCE" | "RETIRED";
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
  pickupNotes?: string;
};

type ReturnHireBookingInput = {
  returnNotes?: string;
  damageNotes?: string;
  depositOutcome?: "RETURNED" | "KEPT";
  markAssetMaintenance?: boolean;
};

type CancelHireBookingInput = {
  cancellationReason?: string;
};

type ListHireAssetFilters = {
  status?: HireAssetStatus;
  q?: string;
  take?: number;
  skip?: number;
  availableFrom?: string;
  availableTo?: string;
  onlineBookable?: boolean;
};

type HireBookingView =
  | "PICKUPS"
  | "ACTIVE"
  | "RETURNS"
  | "OVERDUE"
  | "HISTORY"
  | "TODAY";

type ListHireBookingFilters = {
  status?: HireBookingStatus;
  customerId?: string;
  hireAssetId?: string;
  q?: string;
  from?: string;
  to?: string;
  view?: HireBookingView;
  take?: number;
  skip?: number;
};

const BLOCKING_BOOKING_STATUSES: HireBookingStatus[] = ["RESERVED", "CHECKED_OUT"];
const MANUAL_BLOCKING_STATUSES: HireAssetStatus[] = ["MAINTENANCE", "RETIRED"];

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
  field:
    | "hirePricePence"
    | "depositPence"
    | "depositHeldPence",
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

const parseRequiredDate = (
  value: string | undefined,
  field: "startsAt" | "dueBackAt",
  code: string,
) => {
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

const parseOptionalDate = (
  value: string | undefined,
  field: "availableFrom" | "availableTo" | "from" | "to",
  code: string,
) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
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

const getRequestedWindowOrThrow = (
  startsAt: Date | undefined,
  dueBackAt: Date | undefined,
  code: string,
) => {
  if ((startsAt && !dueBackAt) || (!startsAt && dueBackAt)) {
    throw new HttpError(
      400,
      "availableFrom and availableTo must be provided together",
      code,
    );
  }

  if (!startsAt || !dueBackAt) {
    return null;
  }

  if (startsAt >= dueBackAt) {
    throw new HttpError(400, "availableFrom must be before availableTo", code);
  }

  return {
    startsAt,
    dueBackAt,
  };
};

const bookingOverlapWhere = (startsAt: Date, dueBackAt: Date): Prisma.HireBookingWhereInput => ({
  status: {
    in: BLOCKING_BOOKING_STATUSES,
  },
  startsAt: {
    lt: dueBackAt,
  },
  dueBackAt: {
    gt: startsAt,
  },
});

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
        in: BLOCKING_BOOKING_STATUSES,
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
    orderBy: [
      { status: "asc" },
      { startsAt: "asc" },
    ],
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
      bookings: {
        where: {
          status: {
            in: BLOCKING_BOOKING_STATUSES,
          },
        },
        select: {
          id: true,
          status: true,
          startsAt: true,
          dueBackAt: true,
        },
        orderBy: [{ startsAt: "asc" }],
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

type HireAssetPayload = Prisma.HireAssetGetPayload<{
  include: typeof hireAssetInclude;
}>;

type HireBookingPayload = Prisma.HireBookingGetPayload<{
  include: typeof hireBookingInclude;
}>;

const getPrimaryAssetBooking = (bookings: HireAssetPayload["bookings"], now: Date) => {
  const liveBooking = bookings.find((booking) => booking.status === "CHECKED_OUT");
  if (liveBooking) {
    return liveBooking;
  }

  const startedReservation = bookings.find(
    (booking) => booking.status === "RESERVED" && booking.startsAt.getTime() <= now.getTime(),
  );
  if (startedReservation) {
    return startedReservation;
  }

  return bookings[0] ?? null;
};

const getEffectiveAssetStatus = (
  storedStatus: HireAssetStatus,
  bookings: HireAssetPayload["bookings"],
) => {
  if (MANUAL_BLOCKING_STATUSES.includes(storedStatus)) {
    return storedStatus;
  }

  if (bookings.some((booking) => booking.status === "CHECKED_OUT")) {
    return "ON_HIRE" satisfies HireAssetStatus;
  }

  if (bookings.some((booking) => booking.status === "RESERVED")) {
    return "RESERVED" satisfies HireAssetStatus;
  }

  return "AVAILABLE" satisfies HireAssetStatus;
};

const mapAssetBookingSummary = (
  booking: HireAssetPayload["bookings"][number],
) => ({
  id: booking.id,
  status: booking.status,
  startsAt: booking.startsAt,
  dueBackAt: booking.dueBackAt,
  customer: {
    id: booking.customer.id,
    name: getCustomerDisplayName(booking.customer),
  },
});

const buildAssetAvailability = (
  asset: HireAssetPayload,
  requestedWindow: { startsAt: Date; dueBackAt: Date } | null,
  now: Date,
) => {
  const overlappingNow = asset.bookings.find(
    (booking) =>
      booking.startsAt.getTime() <= now.getTime() &&
      booking.dueBackAt.getTime() > now.getTime(),
  );
  const nextBooking = asset.bookings.find((booking) => booking.startsAt.getTime() > now.getTime()) ?? null;
  const overlappingRequestedWindow = requestedWindow
    ? asset.bookings.find((booking) =>
        booking.startsAt.getTime() < requestedWindow.dueBackAt.getTime() &&
        booking.dueBackAt.getTime() > requestedWindow.startsAt.getTime())
    : null;

  return {
    availableNow:
      !MANUAL_BLOCKING_STATUSES.includes(asset.status) &&
      !overlappingNow,
    nextAvailableAt:
      MANUAL_BLOCKING_STATUSES.includes(asset.status)
        ? null
        : overlappingNow
          ? overlappingNow.dueBackAt
          : now,
    nextPickupAt: nextBooking?.startsAt ?? null,
    requestedWindow: requestedWindow
      ? {
          startsAt: requestedWindow.startsAt,
          dueBackAt: requestedWindow.dueBackAt,
          isAvailable:
            !MANUAL_BLOCKING_STATUSES.includes(asset.status) &&
            !overlappingRequestedWindow,
          blockedByBookingId: overlappingRequestedWindow?.id ?? null,
        }
      : null,
    activeBookingCount: asset.bookings.length,
    checkedOutCount: asset.bookings.filter((booking) => booking.status === "CHECKED_OUT").length,
    reservedCount: asset.bookings.filter((booking) => booking.status === "RESERVED").length,
  };
};

const mapHireAsset = (
  asset: HireAssetPayload,
  requestedWindow: { startsAt: Date; dueBackAt: Date } | null,
  now: Date,
) => {
  const primaryBooking = getPrimaryAssetBooking(asset.bookings, now);
  const currentBooking = asset.bookings.find((booking) => booking.status === "CHECKED_OUT") ?? null;
  const nextBooking =
    asset.bookings.find((booking) => booking.status === "RESERVED") ?? null;
  const availability = buildAssetAvailability(asset, requestedWindow, now);

  return {
    id: asset.id,
    assetTag: asset.assetTag,
    displayName: asset.displayName,
    notes: asset.notes,
    storageLocation: asset.storageLocation,
    isOnlineBookable: asset.isOnlineBookable,
    storedStatus: asset.status,
    status: getEffectiveAssetStatus(asset.status, asset.bookings),
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
    activeBooking: primaryBooking ? mapAssetBookingSummary(primaryBooking) : null,
    currentBooking: currentBooking ? mapAssetBookingSummary(currentBooking) : null,
    nextBooking: nextBooking ? mapAssetBookingSummary(nextBooking) : null,
    upcomingBookings: asset.bookings.slice(0, 4).map(mapAssetBookingSummary),
    availability,
  };
};

const getBookingOperationalState = (booking: HireBookingPayload, now: Date) => {
  const start = booking.startsAt.getTime();
  const due = booking.dueBackAt.getTime();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);
  const dayAfterTomorrowStart = new Date(tomorrowStart);
  dayAfterTomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const pickupToday =
    booking.status === "RESERVED" &&
    start >= todayStart.getTime() &&
    start < tomorrowStart.getTime();
  const pickupTomorrow =
    booking.status === "RESERVED" &&
    start >= tomorrowStart.getTime() &&
    start < dayAfterTomorrowStart.getTime();
  const dueToday =
    booking.status === "CHECKED_OUT" &&
    due >= todayStart.getTime() &&
    due < tomorrowStart.getTime();
  const dueTomorrow =
    booking.status === "CHECKED_OUT" &&
    due >= tomorrowStart.getTime() &&
    due < dayAfterTomorrowStart.getTime();
  const overdue = booking.status === "CHECKED_OUT" && due < now.getTime();

  let state:
    | "UPCOMING_PICKUP"
    | "ACTIVE"
    | "DUE_BACK_TODAY"
    | "OVERDUE"
    | "COMPLETED"
    | "CANCELLED";
  let label: string;
  let detail: string;

  if (booking.status === "CANCELLED") {
    state = "CANCELLED";
    label = "Cancelled";
    detail = booking.cancellationReason || "Booking cancelled before pickup.";
  } else if (booking.status === "RETURNED") {
    state = "COMPLETED";
    label = "Returned";
    detail = booking.damageNotes
      ? "Returned with issue notes recorded."
      : "Hire returned and closed.";
  } else if (overdue) {
    state = "OVERDUE";
    label = "Overdue";
    detail = "Bike is still on hire past the due-back time.";
  } else if (dueToday) {
    state = "DUE_BACK_TODAY";
    label = "Due back today";
    detail = "Bike is currently on hire and due back today.";
  } else if (booking.status === "CHECKED_OUT") {
    state = "ACTIVE";
    label = "On hire";
    detail = "Bike is currently checked out to the customer.";
  } else {
    state = "UPCOMING_PICKUP";
    label = pickupToday ? "Pickup today" : "Reserved";
    detail = pickupToday
      ? "Customer is expected to collect this bike today."
      : "Reservation is booked and awaiting pickup.";
  }

  return {
    state,
    label,
    detail,
    pickupToday,
    pickupTomorrow,
    dueToday,
    dueTomorrow,
    overdue,
    canCheckout: booking.status === "RESERVED",
    canReturn: booking.status === "CHECKED_OUT",
    canCancel: booking.status === "RESERVED",
  };
};

const mapHireBooking = (booking: HireBookingPayload, now: Date) => {
  const operational = getBookingOperationalState(booking, now);

  return {
    id: booking.id,
    status: booking.status,
    depositStatus: booking.depositStatus,
    startsAt: booking.startsAt,
    dueBackAt: booking.dueBackAt,
    checkedOutAt: booking.checkedOutAt,
    returnedAt: booking.returnedAt,
    cancelledAt: booking.cancelledAt,
    hirePricePence: booking.hirePricePence,
    depositPence: booking.depositPence,
    depositHeldPence: booking.depositHeldPence,
    notes: booking.notes,
    pickupNotes: booking.pickupNotes,
    returnNotes: booking.returnNotes,
    cancellationReason: booking.cancellationReason,
    damageNotes: booking.damageNotes,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    operational,
    financial: {
      hirePricePence: booking.hirePricePence,
      depositPence: booking.depositPence,
      depositHeldPence: booking.depositHeldPence,
      outstandingDepositPence: Math.max(booking.depositPence - booking.depositHeldPence, 0),
    },
    hireAsset: {
      id: booking.hireAsset.id,
      assetTag: booking.hireAsset.assetTag,
      displayName: booking.hireAsset.displayName,
      notes: booking.hireAsset.notes,
      storageLocation: booking.hireAsset.storageLocation,
      isOnlineBookable: booking.hireAsset.isOnlineBookable,
      storedStatus: booking.hireAsset.status,
      status: getEffectiveAssetStatus(booking.hireAsset.status, booking.hireAsset.bookings),
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
  };
};

const mapAssetListSummary = (assets: ReturnType<typeof mapHireAsset>[]) => ({
  total: assets.length,
  available: assets.filter((asset) => asset.status === "AVAILABLE").length,
  reserved: assets.filter((asset) => asset.status === "RESERVED").length,
  onHire: assets.filter((asset) => asset.status === "ON_HIRE").length,
  maintenance: assets.filter((asset) => asset.status === "MAINTENANCE").length,
  retired: assets.filter((asset) => asset.status === "RETIRED").length,
  onlineBookable: assets.filter((asset) => asset.isOnlineBookable).length,
  availableNow: assets.filter((asset) => asset.availability.availableNow).length,
});

const mapBookingListSummary = (bookings: ReturnType<typeof mapHireBooking>[]) => ({
  total: bookings.length,
  reserved: bookings.filter((booking) => booking.status === "RESERVED").length,
  checkedOut: bookings.filter((booking) => booking.status === "CHECKED_OUT").length,
  returned: bookings.filter((booking) => booking.status === "RETURNED").length,
  cancelled: bookings.filter((booking) => booking.status === "CANCELLED").length,
  overdue: bookings.filter((booking) => booking.operational.overdue).length,
  pickupsToday: bookings.filter((booking) => booking.operational.pickupToday).length,
  returnsToday: bookings.filter((booking) => booking.operational.dueToday).length,
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

const lockHireAssetTx = async (
  tx: Prisma.TransactionClient,
  hireAssetId: string,
) => {
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "HireAsset" WHERE id = ${hireAssetId} FOR UPDATE
  `;

  if (lockedRows.length === 0) {
    throw new HttpError(404, "Hire asset not found", "HIRE_ASSET_NOT_FOUND");
  }
};

const syncHireAssetStatusTx = async (
  tx: Prisma.TransactionClient,
  hireAssetId: string,
) => {
  const asset = await tx.hireAsset.findUnique({
    where: { id: hireAssetId },
    include: {
      bookings: {
        where: {
          status: {
            in: BLOCKING_BOOKING_STATUSES,
          },
        },
        select: {
          status: true,
        },
      },
    },
  });

  if (!asset) {
    throw new HttpError(404, "Hire asset not found", "HIRE_ASSET_NOT_FOUND");
  }

  if (MANUAL_BLOCKING_STATUSES.includes(asset.status)) {
    return asset.status;
  }

  const nextStatus = asset.bookings.some((booking) => booking.status === "CHECKED_OUT")
    ? "ON_HIRE"
    : asset.bookings.some((booking) => booking.status === "RESERVED")
      ? "RESERVED"
      : "AVAILABLE";

  if (nextStatus !== asset.status) {
    await tx.hireAsset.update({
      where: { id: asset.id },
      data: {
        status: nextStatus,
      },
    });
  }

  return nextStatus;
};

const buildHireAssetWhere = (
  q: string | undefined,
  requestedWindow: { startsAt: Date; dueBackAt: Date } | null,
  filters: Pick<ListHireAssetFilters, "onlineBookable" | "status">,
): Prisma.HireAssetWhereInput => {
  const and: Prisma.HireAssetWhereInput[] = [];

  if (q) {
    and.push({
      OR: [
        { assetTag: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { storageLocation: { contains: q, mode: "insensitive" } },
        { variant: { sku: { contains: q, mode: "insensitive" } } },
        { variant: { barcode: { contains: q, mode: "insensitive" } } },
        { variant: { product: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }

  if (filters.onlineBookable !== undefined) {
    and.push({
      isOnlineBookable: filters.onlineBookable,
    });
  }

  if (filters.status === "MAINTENANCE" || filters.status === "RETIRED") {
    and.push({
      status: filters.status,
    });
  } else if (filters.status === "ON_HIRE") {
    and.push({
      status: {
        notIn: MANUAL_BLOCKING_STATUSES,
      },
    });
    and.push({
      bookings: {
        some: {
          status: "CHECKED_OUT",
        },
      },
    });
  } else if (filters.status === "RESERVED") {
    and.push({
      status: {
        notIn: MANUAL_BLOCKING_STATUSES,
      },
    });
    and.push({
      bookings: {
        some: {
          status: "RESERVED",
        },
      },
    });
    and.push({
      NOT: {
        bookings: {
          some: {
            status: "CHECKED_OUT",
          },
        },
      },
    });
  } else if (filters.status === "AVAILABLE") {
    and.push({
      status: {
        notIn: MANUAL_BLOCKING_STATUSES,
      },
    });
    and.push({
      bookings: {
        none: {
          status: {
            in: BLOCKING_BOOKING_STATUSES,
          },
        },
      },
    });
  }

  if (requestedWindow) {
    and.push({
      status: {
        notIn: MANUAL_BLOCKING_STATUSES,
      },
    });
    and.push({
      bookings: {
        none: bookingOverlapWhere(requestedWindow.startsAt, requestedWindow.dueBackAt),
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
};

const buildHireBookingWhere = (
  filters: ListHireBookingFilters,
  from: Date | undefined,
  to: Date | undefined,
): Prisma.HireBookingWhereInput => {
  const and: Prisma.HireBookingWhereInput[] = [];
  const q = normalizeOptionalText(filters.q);

  if (filters.status) {
    and.push({
      status: filters.status,
    });
  }

  if (filters.customerId) {
    and.push({
      customerId: assertUuidOrThrow(
        filters.customerId,
        "customerId must be a valid UUID",
        "INVALID_HIRE_QUERY",
      ),
    });
  }

  if (filters.hireAssetId) {
    and.push({
      hireAssetId: assertUuidOrThrow(
        filters.hireAssetId,
        "hireAssetId must be a valid UUID",
        "INVALID_HIRE_QUERY",
      ),
    });
  }

  if (q) {
    and.push({
      OR: [
        { notes: { contains: q, mode: "insensitive" } },
        { pickupNotes: { contains: q, mode: "insensitive" } },
        { returnNotes: { contains: q, mode: "insensitive" } },
        { cancellationReason: { contains: q, mode: "insensitive" } },
        { damageNotes: { contains: q, mode: "insensitive" } },
        { hireAsset: { assetTag: { contains: q, mode: "insensitive" } } },
        { hireAsset: { displayName: { contains: q, mode: "insensitive" } } },
        { hireAsset: { variant: { sku: { contains: q, mode: "insensitive" } } } },
        { hireAsset: { variant: { product: { name: { contains: q, mode: "insensitive" } } } } },
        { customer: { firstName: { contains: q, mode: "insensitive" } } },
        { customer: { lastName: { contains: q, mode: "insensitive" } } },
        { customer: { email: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  if (from || to) {
    const rangeFilter: Prisma.HireBookingWhereInput = {};
    if (from) {
      rangeFilter.dueBackAt = { gte: from };
    }
    if (to) {
      rangeFilter.startsAt = { lte: to };
    }
    and.push(rangeFilter);
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  if (filters.view === "PICKUPS") {
    and.push({ status: "RESERVED" });
  }
  if (filters.view === "ACTIVE") {
    and.push({ status: { in: ["RESERVED", "CHECKED_OUT"] } });
  }
  if (filters.view === "RETURNS") {
    and.push({ status: "CHECKED_OUT" });
  }
  if (filters.view === "OVERDUE") {
    and.push({
      status: "CHECKED_OUT",
      dueBackAt: {
        lt: now,
      },
    });
  }
  if (filters.view === "HISTORY") {
    and.push({
      status: {
        in: ["RETURNED", "CANCELLED"],
      },
    });
  }
  if (filters.view === "TODAY") {
    and.push({
      OR: [
        {
          status: "RESERVED",
          startsAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
        {
          status: "CHECKED_OUT",
          dueBackAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
      ],
    });
  }

  return and.length > 0 ? { AND: and } : {};
};

const getBookingOrderBy = (view: HireBookingView | undefined): Prisma.HireBookingOrderByWithRelationInput[] => {
  switch (view) {
    case "PICKUPS":
      return [{ startsAt: "asc" }];
    case "ACTIVE":
      return [{ dueBackAt: "asc" }, { startsAt: "asc" }];
    case "RETURNS":
    case "OVERDUE":
    case "TODAY":
      return [{ dueBackAt: "asc" }];
    case "HISTORY":
      return [{ returnedAt: "desc" }, { cancelledAt: "desc" }, { updatedAt: "desc" }];
    default:
      return [{ createdAt: "desc" }];
  }
};

export const listHireAssets = async (filters: ListHireAssetFilters = {}) => {
  const q = normalizeOptionalText(filters.q);
  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);
  const availableFrom = parseOptionalDate(filters.availableFrom, "availableFrom", "INVALID_HIRE_QUERY");
  const availableTo = parseOptionalDate(filters.availableTo, "availableTo", "INVALID_HIRE_QUERY");
  const requestedWindow = getRequestedWindowOrThrow(
    availableFrom,
    availableTo,
    "INVALID_HIRE_QUERY",
  );
  const now = new Date();

  const assets = await prisma.hireAsset.findMany({
    where: buildHireAssetWhere(q, requestedWindow, filters),
    include: hireAssetInclude,
    orderBy: [{ assetTag: "asc" }],
    ...(take ? { take } : {}),
    ...(skip ? { skip } : {}),
  });

  const mappedAssets = assets.map((asset) => mapHireAsset(asset, requestedWindow, now));

  return {
    filters: {
      status: filters.status ?? null,
      q: q ?? null,
      take: take ?? null,
      skip: skip ?? null,
      availableFrom: requestedWindow?.startsAt ?? null,
      availableTo: requestedWindow?.dueBackAt ?? null,
      onlineBookable: filters.onlineBookable ?? null,
    },
    summary: mapAssetListSummary(mappedAssets),
    assets: mappedAssets,
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
  const storageLocation = normalizeOptionalText(input.storageLocation) ?? null;
  const isOnlineBookable = input.isOnlineBookable ?? false;
  const now = new Date();

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
          storageLocation,
          isOnlineBookable,
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
            storageLocation,
            isOnlineBookable,
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

  return mapHireAsset(asset, null, now);
};

export const updateHireAsset = async (
  hireAssetId: string,
  input: UpdateHireAssetInput,
  auditActor?: AuditActor,
) => {
  const validatedId = assertUuidOrThrow(hireAssetId, "Invalid hire asset id", "INVALID_HIRE_ASSET");
  const displayName = input.displayName !== undefined ? normalizeOptionalText(input.displayName) ?? null : undefined;
  const notes = input.notes !== undefined ? normalizeOptionalText(input.notes) ?? null : undefined;
  const storageLocation =
    input.storageLocation !== undefined
      ? normalizeOptionalText(input.storageLocation) ?? null
      : undefined;
  const isOnlineBookable = input.isOnlineBookable;
  const nextStatus = input.status;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;
  const now = new Date();

  const asset = await prisma.$transaction(async (tx) => {
    const current = await tx.hireAsset.findUnique({
      where: { id: validatedId },
      include: {
        bookings: {
          where: {
            status: {
              in: BLOCKING_BOOKING_STATUSES,
            },
          },
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!current) {
      throw new HttpError(404, "Hire asset not found", "HIRE_ASSET_NOT_FOUND");
    }

    if (
      (nextStatus === "MAINTENANCE" || nextStatus === "RETIRED") &&
      current.bookings.some((booking) => booking.status === "CHECKED_OUT")
    ) {
      throw new HttpError(
        409,
        "Checked-out bikes cannot be taken out of service until they are returned",
        "HIRE_ASSET_ACTIVE_HIRE",
      );
    }

    const updated = await tx.hireAsset.update({
      where: { id: current.id },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(storageLocation !== undefined ? { storageLocation } : {}),
        ...(isOnlineBookable !== undefined ? { isOnlineBookable } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
      },
      include: hireAssetInclude,
    });

    if (!nextStatus || nextStatus === "AVAILABLE") {
      await syncHireAssetStatusTx(tx, updated.id);
    }

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_ASSET_UPDATED",
        entityType: "HIRE_ASSET",
        entityId: updated.id,
        metadata: {
          updatedByStaffId: actorId,
          status: nextStatus ?? null,
          isOnlineBookable: isOnlineBookable ?? null,
        },
      },
      auditActor,
    );

    const refreshed = await tx.hireAsset.findUnique({
      where: { id: updated.id },
      include: hireAssetInclude,
    });

    if (!refreshed) {
      throw new HttpError(404, "Hire asset not found", "HIRE_ASSET_NOT_FOUND");
    }

    return refreshed;
  });

  return mapHireAsset(asset, null, now);
};

export const listHireBookings = async (filters: ListHireBookingFilters = {}) => {
  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);
  const from = parseOptionalDate(filters.from, "from", "INVALID_HIRE_QUERY");
  const to = parseOptionalDate(filters.to, "to", "INVALID_HIRE_QUERY");
  const now = new Date();

  if (from && to && from > to) {
    throw new HttpError(400, "from must be before to", "INVALID_HIRE_QUERY");
  }

  const bookings = await prisma.hireBooking.findMany({
    where: buildHireBookingWhere(filters, from, to),
    include: hireBookingInclude,
    orderBy: getBookingOrderBy(filters.view),
    ...(take ? { take } : {}),
    ...(skip ? { skip } : {}),
  });

  const mappedBookings = bookings.map((booking) => mapHireBooking(booking, now));

  return {
    filters: {
      status: filters.status ?? null,
      customerId: normalizeOptionalText(filters.customerId) ?? null,
      hireAssetId: normalizeOptionalText(filters.hireAssetId) ?? null,
      q: normalizeOptionalText(filters.q) ?? null,
      from: from ?? null,
      to: to ?? null,
      view: filters.view ?? null,
      take: take ?? null,
      skip: skip ?? null,
    },
    summary: mapBookingListSummary(mappedBookings),
    bookings: mappedBookings,
  };
};

export const createHireBooking = async (input: CreateHireBookingInput, auditActor?: AuditActor) => {
  const hireAssetId = assertUuidOrThrow(
    input.hireAssetId,
    "hireAssetId must be a valid UUID",
    "INVALID_HIRE_BOOKING",
  );
  const customerId = assertUuidOrThrow(
    input.customerId,
    "customerId must be a valid UUID",
    "INVALID_HIRE_BOOKING",
  );
  const startsAt = parseRequiredDate(input.startsAt, "startsAt", "INVALID_HIRE_BOOKING");
  const dueBackAt = parseRequiredDate(input.dueBackAt, "dueBackAt", "INVALID_HIRE_BOOKING");

  if (startsAt >= dueBackAt) {
    throw new HttpError(400, "startsAt must be before dueBackAt", "INVALID_HIRE_BOOKING");
  }

  const hirePricePence =
    parseCurrencyPence(input.hirePricePence, "hirePricePence", "INVALID_HIRE_BOOKING") ?? 0;
  const depositPence =
    parseCurrencyPence(input.depositPence, "depositPence", "INVALID_HIRE_BOOKING") ?? 0;
  const notes = normalizeOptionalText(input.notes) ?? null;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;
  const now = new Date();

  const booking = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
    }

    // Serialize booking creation per asset so the overlap check cannot race another reservation.
    await lockHireAssetTx(tx, hireAssetId);

    const asset = await tx.hireAsset.findUnique({
      where: { id: hireAssetId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!asset) {
      throw new HttpError(404, "Hire asset not found", "HIRE_ASSET_NOT_FOUND");
    }

    if (MANUAL_BLOCKING_STATUSES.includes(asset.status)) {
      throw new HttpError(
        409,
        "Hire asset is currently unavailable for booking",
        "HIRE_ASSET_UNAVAILABLE",
      );
    }

    const conflictingBooking = await tx.hireBooking.findFirst({
      where: {
        hireAssetId,
        ...bookingOverlapWhere(startsAt, dueBackAt),
      },
      select: {
        id: true,
      },
    });

    if (conflictingBooking) {
      throw new HttpError(
        409,
        "Hire asset is already booked for that date range",
        "HIRE_ASSET_ALREADY_BOOKED",
      );
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

    await syncHireAssetStatusTx(tx, hireAssetId);

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_BOOKING_CREATED",
        entityType: "HIRE_BOOKING",
        entityId: created.id,
        metadata: {
          hireAssetId,
          customerId,
          startsAt: startsAt.toISOString(),
          dueBackAt: dueBackAt.toISOString(),
        },
      },
      auditActor,
    );

    return getHireBookingOrThrowTx(tx, created.id);
  });

  return mapHireBooking(booking, now);
};

export const checkoutHireBooking = async (
  bookingId: string,
  input: CheckoutHireBookingInput,
  auditActor?: AuditActor,
) => {
  const validatedId = assertUuidOrThrow(
    bookingId,
    "Invalid hire booking id",
    "INVALID_HIRE_BOOKING_ID",
  );
  const depositHeldPence =
    parseCurrencyPence(
      input.depositHeldPence,
      "depositHeldPence",
      "INVALID_HIRE_BOOKING_CHECKOUT",
    ) ?? 0;
  const pickupNotes = normalizeOptionalText(input.pickupNotes) ?? null;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;
  const now = new Date();

  const booking = await prisma.$transaction(async (tx) => {
    const current = await getHireBookingOrThrowTx(tx, validatedId);

    if (current.status !== "RESERVED") {
      throw new HttpError(
        409,
        "Only reserved bookings can be checked out",
        "HIRE_BOOKING_NOT_RESERVED",
      );
    }
    if (current.depositPence > depositHeldPence) {
      throw new HttpError(
        409,
        "Required deposit has not been fully held",
        "HIRE_DEPOSIT_REQUIRED",
      );
    }
    if (MANUAL_BLOCKING_STATUSES.includes(current.hireAsset.status)) {
      throw new HttpError(
        409,
        "This hire bike is not available for checkout",
        "HIRE_ASSET_UNAVAILABLE",
      );
    }

    const updated = await tx.hireBooking.update({
      where: { id: current.id },
      data: {
        status: "CHECKED_OUT",
        checkedOutAt: new Date(),
        checkedOutByStaffId: actorId,
        depositHeldPence,
        depositStatus: depositHeldPence > 0 ? "HELD" : "NONE",
        ...(pickupNotes !== null ? { pickupNotes } : {}),
      },
      include: hireBookingInclude,
    });

    await syncHireAssetStatusTx(tx, current.hireAsset.id);

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

  return mapHireBooking(booking, now);
};

export const returnHireBooking = async (
  bookingId: string,
  input: ReturnHireBookingInput,
  auditActor?: AuditActor,
) => {
  const validatedId = assertUuidOrThrow(
    bookingId,
    "Invalid hire booking id",
    "INVALID_HIRE_BOOKING_ID",
  );
  const returnNotes = normalizeOptionalText(input.returnNotes) ?? null;
  const damageNotes = normalizeOptionalText(input.damageNotes) ?? null;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;
  const now = new Date();

  const booking = await prisma.$transaction(async (tx) => {
    const current = await getHireBookingOrThrowTx(tx, validatedId);

    if (current.status !== "CHECKED_OUT") {
      throw new HttpError(
        409,
        "Only checked-out bookings can be returned",
        "HIRE_BOOKING_NOT_CHECKED_OUT",
      );
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
        ...(returnNotes !== null ? { returnNotes } : {}),
        ...(damageNotes !== null ? { damageNotes } : {}),
      },
      include: hireBookingInclude,
    });

    if (input.markAssetMaintenance) {
      await tx.hireAsset.update({
        where: { id: current.hireAsset.id },
        data: {
          status: "MAINTENANCE",
        },
      });
    } else {
      await syncHireAssetStatusTx(tx, current.hireAsset.id);
    }

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_BOOKING_RETURNED",
        entityType: "HIRE_BOOKING",
        entityId: updated.id,
        metadata: {
          depositStatus: nextDepositStatus,
          markAssetMaintenance: Boolean(input.markAssetMaintenance),
          damageNotes: damageNotes ?? null,
        },
      },
      auditActor,
    );

    return getHireBookingOrThrowTx(tx, updated.id);
  });

  return mapHireBooking(booking, now);
};

export const cancelHireBooking = async (
  bookingId: string,
  input: CancelHireBookingInput = {},
  auditActor?: AuditActor,
) => {
  const validatedId = assertUuidOrThrow(
    bookingId,
    "Invalid hire booking id",
    "INVALID_HIRE_BOOKING_ID",
  );
  const cancellationReason = normalizeOptionalText(input.cancellationReason) ?? null;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;
  const now = new Date();

  const booking = await prisma.$transaction(async (tx) => {
    const current = await getHireBookingOrThrowTx(tx, validatedId);

    if (current.status === "CANCELLED") {
      throw new HttpError(409, "Booking is already cancelled", "HIRE_BOOKING_CANCELLED");
    }
    if (current.status === "RETURNED") {
      throw new HttpError(
        409,
        "Returned bookings cannot be cancelled",
        "HIRE_BOOKING_RETURNED",
      );
    }
    if (current.status === "CHECKED_OUT") {
      throw new HttpError(
        409,
        "Checked-out bookings must be returned, not cancelled",
        "HIRE_BOOKING_ACTIVE",
      );
    }

    const updated = await tx.hireBooking.update({
      where: { id: current.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByStaffId: actorId,
        ...(cancellationReason !== null ? { cancellationReason } : {}),
      },
      include: hireBookingInclude,
    });

    await syncHireAssetStatusTx(tx, current.hireAsset.id);

    await createAuditEventTx(
      tx,
      {
        action: "HIRE_BOOKING_CANCELLED",
        entityType: "HIRE_BOOKING",
        entityId: updated.id,
        metadata: {
          cancellationReason: cancellationReason ?? null,
        },
      },
      auditActor,
    );

    return getHireBookingOrThrowTx(tx, updated.id);
  });

  return mapHireBooking(booking, now);
};
