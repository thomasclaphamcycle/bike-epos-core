import { Prisma, SaleTenderMethod, WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName } from "../utils/customerName";
import {
  bikeServiceScheduleSelect,
  serializeBikeServiceSchedule,
  summarizeBikeServiceSchedules,
} from "./bikeServiceScheduleService";
import { toWorkshopExecutionStatus } from "./workshopStatusService";

type CreateCustomerBikeInput = {
  label?: string;
  make?: string;
  model?: string;
  year?: number | null;
  bikeType?: string | null;
  colour?: string;
  wheelSize?: string | null;
  frameSize?: string | null;
  groupset?: string | null;
  motorBrand?: string | null;
  motorModel?: string | null;
  batterySerial?: string | null;
  frameNumber?: string;
  serialNumber?: string;
  registrationNumber?: string;
  notes?: string;
};

type UpdateCustomerBikeInput = {
  label?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  bikeType?: string | null;
  colour?: string | null;
  wheelSize?: string | null;
  frameSize?: string | null;
  groupset?: string | null;
  motorBrand?: string | null;
  motorModel?: string | null;
  batterySerial?: string | null;
  frameNumber?: string | null;
  serialNumber?: string | null;
  registrationNumber?: string | null;
  notes?: string | null;
};

const CUSTOMER_BIKE_YEAR_MIN = 1900;
const CUSTOMER_BIKE_TYPES = [
  "ROAD",
  "MTB",
  "E_BIKE",
  "HYBRID",
  "GRAVEL",
  "COMMUTER",
  "BMX",
  "KIDS",
  "CARGO",
  "FOLDING",
  "OTHER",
] as const;

const CUSTOMER_BIKE_TYPE_SET = new Set<string>(CUSTOMER_BIKE_TYPES);
const CUSTOMER_BIKE_TYPE_ALIASES: Record<string, string> = {
  EBIKE: "E_BIKE",
  ELECTRIC: "E_BIKE",
  ELECTRIC_BIKE: "E_BIKE",
  MOUNTAIN: "MTB",
  MOUNTAIN_BIKE: "MTB",
};

const customerBikeSelect = Prisma.validator<Prisma.CustomerBikeSelect>()({
  id: true,
  customerId: true,
  label: true,
  make: true,
  model: true,
  year: true,
  bikeType: true,
  colour: true,
  wheelSize: true,
  frameSize: true,
  groupset: true,
  motorBrand: true,
  motorModel: true,
  batterySerial: true,
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

const customerBikeListSelect = Prisma.validator<Prisma.CustomerBikeSelect>()({
  ...customerBikeSelect,
  serviceSchedules: {
    orderBy: [{ isActive: "desc" }, { nextDueAt: "asc" }, { updatedAt: "desc" }],
    select: bikeServiceScheduleSelect,
  },
  workshopJobs: {
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true,
      closedAt: true,
    },
  },
});

const customerBikeHistorySelect = Prisma.validator<Prisma.CustomerBikeSelect>()({
  ...customerBikeSelect,
  serviceSchedules: {
    orderBy: [{ isActive: "desc" }, { nextDueAt: "asc" }, { updatedAt: "desc" }],
    select: bikeServiceScheduleSelect,
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
});

const customerBikeWorkshopJobSelect = Prisma.validator<Prisma.WorkshopJobSelect>()({
  id: true,
  customerId: true,
  customerName: true,
  bikeDescription: true,
  assignedStaffId: true,
  assignedStaffName: true,
  status: true,
  scheduledDate: true,
  scheduledStartAt: true,
  scheduledEndAt: true,
  durationMinutes: true,
  notes: true,
  depositRequiredPence: true,
  depositStatus: true,
  finalizedBasketId: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  closedAt: true,
  sale: {
    select: {
      id: true,
      subtotalPence: true,
      taxPence: true,
      totalPence: true,
      changeDuePence: true,
      createdAt: true,
      completedAt: true,
      receiptNumber: true,
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
          issuedAt: true,
          issuedByStaff: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      },
      tenders: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          method: true,
          amountPence: true,
          createdAt: true,
          createdByStaff: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      },
    },
  },
  lines: {
    select: {
      id: true,
      type: true,
      qty: true,
      unitPricePence: true,
    },
  },
  estimates: {
    orderBy: [{ version: "desc" }],
    select: {
      id: true,
      version: true,
      status: true,
      labourTotalPence: true,
      partsTotalPence: true,
      subtotalPence: true,
      lineCount: true,
      requestedAt: true,
      approvedAt: true,
      rejectedAt: true,
      supersededAt: true,
      decisionSource: true,
      createdAt: true,
      updatedAt: true,
      decisionByStaff: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
    },
  },
  jobNotes: {
    take: 1,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      note: true,
      visibility: true,
      createdAt: true,
      authorStaff: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
    },
  },
  _count: {
    select: {
      jobNotes: true,
    },
  },
});

type CustomerBikeHistoryRecord = Prisma.CustomerBikeGetPayload<{
  select: typeof customerBikeHistorySelect;
}>;

type CustomerBikeWorkshopJobRecord = Prisma.WorkshopJobGetPayload<{
  select: typeof customerBikeWorkshopJobSelect;
}>;

type CustomerBikeSaleRecord = NonNullable<CustomerBikeWorkshopJobRecord["sale"]>;

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeOptionalBikeType = (value: string | undefined | null): string | undefined => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }

  const canonicalCandidate = normalized
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const canonical = CUSTOMER_BIKE_TYPE_ALIASES[canonicalCandidate] ?? canonicalCandidate;

  if (!CUSTOMER_BIKE_TYPE_SET.has(canonical)) {
    throw new HttpError(
      400,
      `bikeType must be one of ${CUSTOMER_BIKE_TYPES.join(", ")}`,
      "INVALID_CUSTOMER_BIKE_TYPE",
    );
  }

  return canonical;
};

const normalizeOptionalYear = (value: number | undefined | null): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const maxYear = new Date().getUTCFullYear() + 1;
  if (value < CUSTOMER_BIKE_YEAR_MIN || value > maxYear) {
    throw new HttpError(
      400,
      `year must be between ${CUSTOMER_BIKE_YEAR_MIN} and ${maxYear}`,
      "INVALID_CUSTOMER_BIKE_YEAR",
    );
  }

  return value;
};

const buildCustomerDisplayName = (customer: { firstName: string; lastName: string }) =>
  getCustomerDisplayName(customer, "");

const buildWorkshopStartContext = (input: {
    bike: {
      id: string;
      customerId: string;
      label?: string | null;
      make?: string | null;
      model?: string | null;
      year?: number | null;
      bikeType?: string | null;
      colour?: string | null;
      wheelSize?: string | null;
      frameSize?: string | null;
      groupset?: string | null;
      motorBrand?: string | null;
      motorModel?: string | null;
      batterySerial?: string | null;
      frameNumber?: string | null;
      serialNumber?: string | null;
      registrationNumber?: string | null;
      notes?: string | null;
      createdAt?: Date;
    updatedAt?: Date;
  };
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
}) => {
  const customerName = buildCustomerDisplayName(input.customer);
  const bikeDescription = buildCustomerBikeDisplayName(input.bike);

  return {
    customer: {
      id: input.customer.id,
      name: customerName,
      email: input.customer.email,
      phone: input.customer.phone,
    },
    bike: {
      ...toCustomerBikeResponse(input.bike),
    },
    defaults: {
      customerId: input.customer.id,
      customerName,
      bikeId: input.bike.id,
      bikeDescription,
      status: "BOOKED" as const,
    },
    startPath: `/workshop/check-in?bikeId=${encodeURIComponent(input.bike.id)}`,
  };
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

const truncateText = (value: string, limit = 120) =>
  value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}...` : value;

const describeCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const buildBikeHistorySummaryText = (input: {
  bikeDescription?: string | null;
  jobNotes?: string | null;
  latestNote?: string | null;
  estimateLineCount?: number;
  liveLineCount: number;
}) => {
  const latestNote = normalizeOptionalText(input.latestNote);
  if (latestNote) {
    return truncateText(latestNote);
  }

  const checkInNotes = normalizeOptionalText(input.jobNotes);
  if (checkInNotes) {
    return truncateText(checkInNotes);
  }

  if (typeof input.estimateLineCount === "number" && input.estimateLineCount > 0) {
    return `Saved quote with ${describeCount(input.estimateLineCount, "line")} for this bike.`;
  }

  if (input.liveLineCount > 0) {
    return `${describeCount(input.liveLineCount, "workshop line")} recorded for this bike.`;
  }

  const bikeDescription = normalizeOptionalText(input.bikeDescription);
  if (bikeDescription) {
    return `Workshop record linked from ${bikeDescription}.`;
  }

  return "Workshop record linked to this bike.";
};

const buildPrimaryMoneySummary = (input: {
  saleTotalPence?: number | null;
  estimateSubtotalPence?: number | null;
  liveSubtotalPence: number;
}) => {
  if (typeof input.saleTotalPence === "number") {
    return {
      totalPence: input.saleTotalPence,
      source: "FINAL_SALE" as const,
    };
  }

  if (typeof input.estimateSubtotalPence === "number") {
    return {
      totalPence: input.estimateSubtotalPence,
      source: "ESTIMATE" as const,
    };
  }

  return {
    totalPence: input.liveSubtotalPence,
    source: "LIVE_TOTAL" as const,
  };
};

const SALE_TENDER_METHOD_LABELS: Record<SaleTenderMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  VOUCHER: "Voucher",
};

const buildStaffSummary = (
  staff:
    | {
        id: string;
        username: string;
        name: string | null;
      }
    | null
    | undefined,
) => (
  staff
    ? {
        id: staff.id,
        name: staff.name ?? staff.username,
      }
    : null
);

const buildTenderSummary = (tenders: CustomerBikeSaleRecord["tenders"]) => {
  if (tenders.length === 0) {
    return null;
  }

  const breakdown = new Map<SaleTenderMethod, number>();
  for (const tender of tenders) {
    breakdown.set(tender.method, (breakdown.get(tender.method) ?? 0) + tender.amountPence);
  }

  const methods = [...breakdown.entries()].map(([method, amountPence]) => ({
    method,
    label: SALE_TENDER_METHOD_LABELS[method],
    amountPence,
  }))
    .sort((left, right) => {
      const amountDelta = right.amountPence - left.amountPence;
      if (amountDelta !== 0) {
        return amountDelta;
      }

      return left.label.localeCompare(right.label);
    });

  return {
    totalTenderedPence: methods.reduce((sum, method) => sum + method.amountPence, 0),
    methods,
    summaryText: methods
      .map((method) => `${method.label} £${(method.amountPence / 100).toFixed(2)}`)
      .join(" + "),
  };
};

export const buildCustomerBikeDisplayName = (input: {
  label?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  bikeType?: string | null;
  colour?: string | null;
  wheelSize?: string | null;
  frameSize?: string | null;
  groupset?: string | null;
  motorBrand?: string | null;
  motorModel?: string | null;
  batterySerial?: string | null;
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
  year: bike.year,
  bikeType: bike.bikeType,
  colour: bike.colour,
  wheelSize: bike.wheelSize,
  frameSize: bike.frameSize,
  groupset: bike.groupset,
  motorBrand: bike.motorBrand,
  motorModel: bike.motorModel,
  batterySerial: bike.batterySerial,
  frameNumber: bike.frameNumber,
  serialNumber: bike.serialNumber,
  registrationNumber: bike.registrationNumber,
  notes: bike.notes,
  displayName: buildCustomerBikeDisplayName(bike),
  createdAt: bike.createdAt,
  updatedAt: bike.updatedAt,
});

const buildBikeServiceSummary = (
  jobs: Array<{
    id: string;
    status: WorkshopJobStatus;
    createdAt: Date;
    completedAt: Date | null;
    closedAt: Date | null;
  }>,
) => {
  const linkedJobCount = jobs.length;
  const completedJobCount = jobs.filter((job) => job.completedAt !== null).length;
  const openJobCount = jobs.filter((job) => {
    const status = toWorkshopExecutionStatus({
      status: job.status,
      closedAt: job.closedAt,
    });
    return status === "BOOKED" || status === "IN_PROGRESS" || status === "READY";
  }).length;

  const jobDates = jobs
    .map((job) => job.completedAt ?? job.createdAt)
    .sort((left, right) => right.getTime() - left.getTime());

  return {
    linkedJobCount,
    openJobCount,
    completedJobCount,
    firstJobAt: jobs.length > 0
      ? jobs
          .map((job) => job.createdAt)
          .sort((left, right) => left.getTime() - right.getTime())[0]
      : null,
    latestJobAt: jobDates[0] ?? null,
    latestCompletedAt: jobs
      .map((job) => job.completedAt)
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
  };
};

const isOpenWorkshopExecutionStatus = (
  status: ReturnType<typeof toWorkshopExecutionStatus>,
) => status === "BOOKED" || status === "IN_PROGRESS" || status === "READY";

const sortByNewestTimestamp = (left: Date | null, right: Date | null) =>
  (right?.getTime() ?? 0) - (left?.getTime() ?? 0);

const serializeBikeWorkshopHistoryEntry = (
  job: CustomerBikeWorkshopJobRecord,
  bike: CustomerBikeHistoryRecord,
) => {
  const latestEstimate = job.estimates[0] ?? null;
  const latestNote = job.jobNotes[0] ?? null;
  const labourTotalPence = job.lines
    .filter((line) => line.type === "LABOUR")
    .reduce((sum, line) => sum + (line.qty * line.unitPricePence), 0);
  const partsTotalPence = job.lines
    .filter((line) => line.type === "PART")
    .reduce((sum, line) => sum + (line.qty * line.unitPricePence), 0);
  const liveSubtotalPence = labourTotalPence + partsTotalPence;
  const primaryMoney = buildPrimaryMoneySummary({
    saleTotalPence: job.sale?.totalPence,
    estimateSubtotalPence: latestEstimate?.subtotalPence ?? null,
    liveSubtotalPence,
  });
  const executionStatus = toWorkshopExecutionStatus(job);
  const serviceSummaryText = buildBikeHistorySummaryText({
    bikeDescription: job.bikeDescription,
    jobNotes: job.notes,
    latestNote: latestNote?.note,
    estimateLineCount: latestEstimate?.lineCount,
    liveLineCount: job.lines.length,
  });

  return {
    id: job.id,
    reference: job.id.slice(0, 8).toUpperCase(),
    title: serviceSummaryText,
    jobPath: `/workshop/${job.id}`,
    customerId: job.customerId,
    customerName: job.customerName,
    bikeDescription: job.bikeDescription ?? buildCustomerBikeDisplayName(bike),
    serviceSummaryText,
    status: executionStatus,
    rawStatus: job.status,
    scheduledDate: job.scheduledDate,
    scheduledStartAt: job.scheduledStartAt,
    scheduledEndAt: job.scheduledEndAt,
    durationMinutes: job.durationMinutes,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    closedAt: job.closedAt,
    depositRequiredPence: job.depositRequiredPence,
    depositStatus: job.depositStatus,
    finalizedBasketId: job.finalizedBasketId,
    assignedTechnician: job.assignedStaffId || job.assignedStaffName
      ? {
          id: job.assignedStaffId,
          name: job.assignedStaffName,
        }
      : null,
    notes: {
      jobNotes: job.notes,
      noteCount: job._count.jobNotes,
      latestNote: latestNote
        ? {
            id: latestNote.id,
            note: latestNote.note,
            visibility: latestNote.visibility,
            createdAt: latestNote.createdAt,
            authorName: latestNote.authorStaff?.name ?? latestNote.authorStaff?.username ?? null,
          }
        : null,
    },
    liveTotals: {
      lineCount: job.lines.length,
      labourTotalPence,
      partsTotalPence,
      subtotalPence: liveSubtotalPence,
    },
    moneySummary: {
      labourTotalPence,
      partsTotalPence,
      liveSubtotalPence,
      estimateSubtotalPence: latestEstimate?.subtotalPence ?? null,
      finalTotalPence: job.sale?.totalPence ?? null,
      primaryTotalPence: primaryMoney.totalPence,
      primaryTotalSource: primaryMoney.source,
    },
    estimate: latestEstimate
      ? {
          id: latestEstimate.id,
          version: latestEstimate.version,
          status: latestEstimate.status,
          labourTotalPence: latestEstimate.labourTotalPence,
          partsTotalPence: latestEstimate.partsTotalPence,
          subtotalPence: latestEstimate.subtotalPence,
          lineCount: latestEstimate.lineCount,
          requestedAt: latestEstimate.requestedAt,
          approvedAt: latestEstimate.approvedAt,
          rejectedAt: latestEstimate.rejectedAt,
          supersededAt: latestEstimate.supersededAt,
          decisionSource: latestEstimate.decisionSource,
          createdAt: latestEstimate.createdAt,
          updatedAt: latestEstimate.updatedAt,
          isCurrent: latestEstimate.supersededAt === null,
          decisionByStaff: buildStaffSummary(latestEstimate.decisionByStaff),
        }
      : null,
    sale: job.sale
      ? {
          id: job.sale.id,
          subtotalPence: job.sale.subtotalPence,
          taxPence: job.sale.taxPence,
          totalPence: job.sale.totalPence,
          changeDuePence: job.sale.changeDuePence,
          createdAt: job.sale.createdAt,
          completedAt: job.sale.completedAt,
          receiptNumber: job.sale.receipt?.receiptNumber ?? job.sale.receiptNumber ?? null,
          receiptUrl: (job.sale.receipt?.receiptNumber ?? job.sale.receiptNumber)
            ? `/r/${encodeURIComponent(job.sale.receipt?.receiptNumber ?? job.sale.receiptNumber ?? "")}`
            : null,
          issuedAt: job.sale.receipt?.issuedAt ?? null,
          checkoutStaff:
            buildStaffSummary(job.sale.receipt?.issuedByStaff)
            ?? buildStaffSummary(job.sale.createdByStaff)
            ?? buildStaffSummary(job.sale.tenders[0]?.createdByStaff),
          paymentSummary: buildTenderSummary(job.sale.tenders),
        }
      : null,
  };
};

type BikeWorkshopHistoryEntry = ReturnType<typeof serializeBikeWorkshopHistoryEntry>;

const buildBikeHistoryMetrics = (
  entries: BikeWorkshopHistoryEntry[],
  serviceSummary: ReturnType<typeof buildBikeServiceSummary>,
) => {
  const completedHistory = entries
    .filter((entry) => entry.completedAt !== null)
    .sort((left, right) => sortByNewestTimestamp(left.completedAt, right.completedAt));
  const openWork = entries
    .filter((entry) => isOpenWorkshopExecutionStatus(entry.status))
    .sort((left, right) => {
      const statusRank = (entry: BikeWorkshopHistoryEntry) => {
        switch (entry.status) {
          case "READY":
            return 0;
          case "IN_PROGRESS":
            return 1;
          case "BOOKED":
            return 2;
          default:
            return 3;
        }
      };

      const rankDelta = statusRank(left) - statusRank(right);
      if (rankDelta !== 0) {
        return rankDelta;
      }

      return sortByNewestTimestamp(
        left.scheduledStartAt ?? left.scheduledDate ?? left.updatedAt,
        right.scheduledStartAt ?? right.scheduledDate ?? right.updatedAt,
      );
    });
  const finalizedSpendEntries = completedHistory.filter(
    (entry) => typeof entry.sale?.totalPence === "number",
  );

  return {
    completedHistory,
    openWork,
    metrics: {
      totalJobs: serviceSummary.linkedJobCount,
      completedJobs: serviceSummary.completedJobCount,
      openJobs: serviceSummary.openJobCount,
      lastServiceAt: serviceSummary.latestCompletedAt,
      lifetimeWorkshopSpendPence: finalizedSpendEntries.reduce(
        (sum, entry) => sum + (entry.sale?.totalPence ?? 0),
        0,
      ),
      finalizedSaleCount: finalizedSpendEntries.length,
      lastActivityAt: entries
        .map((entry) => entry.completedAt ?? entry.scheduledStartAt ?? entry.scheduledDate ?? entry.updatedAt)
        .sort(sortByNewestTimestamp)[0] ?? null,
    },
  };
};

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
    select: customerBikeListSelect,
  });

  return {
    customerId,
    bikes: bikes.map((bike) => ({
      ...toCustomerBikeResponse(bike),
      serviceSummary: buildBikeServiceSummary(bike.workshopJobs),
      serviceSchedules: bike.serviceSchedules.map((schedule) => serializeBikeServiceSchedule(schedule)),
      serviceScheduleSummary: summarizeBikeServiceSchedules(bike.serviceSchedules),
    })),
  };
};

export const createCustomerBike = async (
  customerId: string,
  input: CreateCustomerBikeInput,
) => {
  const label = normalizeOptionalText(input.label);
  const make = normalizeOptionalText(input.make);
  const model = normalizeOptionalText(input.model);
  const year = normalizeOptionalYear(input.year);
  const bikeType = normalizeOptionalBikeType(input.bikeType);
  const colour = normalizeOptionalText(input.colour);
  const wheelSize = normalizeOptionalText(input.wheelSize);
  const frameSize = normalizeOptionalText(input.frameSize);
  const groupset = normalizeOptionalText(input.groupset);
  const motorBrand = normalizeOptionalText(input.motorBrand);
  const motorModel = normalizeOptionalText(input.motorModel);
  const batterySerial = normalizeOptionalText(input.batterySerial);
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
        year,
        bikeType,
        colour,
        wheelSize,
        frameSize,
        groupset,
        motorBrand,
        motorModel,
        batterySerial,
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

export const updateCustomerBike = async (
  customerBikeId: string,
  input: UpdateCustomerBikeInput,
) => {
  const bike = await getCustomerBikeByIdTx(prisma, customerBikeId);

  const resolveUpdatedText = (
    value: string | null | undefined,
    currentValue: string | null,
  ) => (value !== undefined ? normalizeOptionalText(value) ?? null : currentValue);
  const resolveUpdatedBikeType = (
    value: string | null | undefined,
    currentValue: string | null,
  ) => (value !== undefined ? normalizeOptionalBikeType(value) ?? null : currentValue);

  const label = input.label !== undefined
    ? resolveUpdatedText(input.label, bike.label)
    : bike.label;
  const make = input.make !== undefined
    ? resolveUpdatedText(input.make, bike.make)
    : bike.make;
  const model = input.model !== undefined
    ? resolveUpdatedText(input.model, bike.model)
    : bike.model;
  const year = input.year !== undefined
    ? normalizeOptionalYear(input.year)
    : bike.year ?? undefined;
  const bikeType = input.bikeType !== undefined
    ? resolveUpdatedBikeType(input.bikeType, bike.bikeType)
    : bike.bikeType;
  const colour = input.colour !== undefined
    ? resolveUpdatedText(input.colour, bike.colour)
    : bike.colour;
  const wheelSize = input.wheelSize !== undefined
    ? resolveUpdatedText(input.wheelSize, bike.wheelSize)
    : bike.wheelSize;
  const frameSize = input.frameSize !== undefined
    ? resolveUpdatedText(input.frameSize, bike.frameSize)
    : bike.frameSize;
  const groupset = input.groupset !== undefined
    ? resolveUpdatedText(input.groupset, bike.groupset)
    : bike.groupset;
  const motorBrand = input.motorBrand !== undefined
    ? resolveUpdatedText(input.motorBrand, bike.motorBrand)
    : bike.motorBrand;
  const motorModel = input.motorModel !== undefined
    ? resolveUpdatedText(input.motorModel, bike.motorModel)
    : bike.motorModel;
  const batterySerial = input.batterySerial !== undefined
    ? resolveUpdatedText(input.batterySerial, bike.batterySerial)
    : bike.batterySerial;
  const frameNumber = input.frameNumber !== undefined
    ? resolveUpdatedText(input.frameNumber, bike.frameNumber)
    : bike.frameNumber;
  const serialNumber = input.serialNumber !== undefined
    ? resolveUpdatedText(input.serialNumber, bike.serialNumber)
    : bike.serialNumber;
  const registrationNumber = input.registrationNumber !== undefined
    ? resolveUpdatedText(input.registrationNumber, bike.registrationNumber)
    : bike.registrationNumber;
  const notes = input.notes !== undefined
    ? resolveUpdatedText(input.notes, bike.notes)
    : bike.notes;

  validateCustomerBikeIdentity({
    label: label ?? undefined,
    make: make ?? undefined,
    model: model ?? undefined,
    colour: colour ?? undefined,
    frameNumber: frameNumber ?? undefined,
    serialNumber: serialNumber ?? undefined,
    registrationNumber: registrationNumber ?? undefined,
  });

  const updatedBike = await prisma.customerBike.update({
    where: { id: customerBikeId },
    data: {
      label,
      make,
      model,
      year: year ?? null,
      bikeType,
      colour,
      wheelSize,
      frameSize,
      groupset,
      motorBrand,
      motorModel,
      batterySerial,
      frameNumber,
      serialNumber,
      registrationNumber,
      notes,
    },
    select: customerBikeSelect,
  });

  return {
    bike: toCustomerBikeResponse(updatedBike),
  };
};

export const toWorkshopBikeResponse = (bike: CustomerBikeRecord | null) =>
  bike
    ? {
        ...toCustomerBikeResponse(bike),
      }
    : null;

export const getCustomerBikeHistory = async (customerBikeId: string) => {
  if (!isUuid(customerBikeId)) {
    throw new HttpError(400, "Invalid customer bike id", "INVALID_CUSTOMER_BIKE_ID");
  }

  const bike = await prisma.customerBike.findUnique({
    where: { id: customerBikeId },
    select: customerBikeHistorySelect,
  });

  if (!bike) {
    throw new HttpError(404, "Bike record not found", "CUSTOMER_BIKE_NOT_FOUND");
  }

  const workshopJobs = await prisma.workshopJob.findMany({
    where: { bikeId: customerBikeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: customerBikeWorkshopJobSelect,
  });

  const serviceSummary = buildBikeServiceSummary(workshopJobs);
  const history = workshopJobs.map((job) => serializeBikeWorkshopHistoryEntry(job, bike));
  const shapedHistory = buildBikeHistoryMetrics(history, serviceSummary);

  return {
    bike: toCustomerBikeResponse(bike),
    customer: {
      id: bike.customer.id,
      name: buildCustomerDisplayName(bike.customer),
      email: bike.customer.email,
      phone: bike.customer.phone,
    },
    workshopStartContext: buildWorkshopStartContext({
      bike,
      customer: bike.customer,
    }),
    serviceSummary,
    metrics: shapedHistory.metrics,
    serviceSchedules: bike.serviceSchedules.map((schedule) => serializeBikeServiceSchedule(schedule)),
    serviceScheduleSummary: summarizeBikeServiceSchedules(bike.serviceSchedules),
    historyScope: "LINKED_BIKE_JOBS_ONLY",
    limitations: [
      "Only workshop jobs linked directly to this bike record are included. Legacy free-text workshop jobs without a bike link remain outside formal bike history.",
    ],
    completedHistory: shapedHistory.completedHistory,
    openWork: shapedHistory.openWork,
    history,
  };
};

export const getCustomerBikeWorkshopStartContext = async (
  customerBikeId: string,
) => {
  if (!isUuid(customerBikeId)) {
    throw new HttpError(400, "Invalid customer bike id", "INVALID_CUSTOMER_BIKE_ID");
  }

  const bike = await prisma.customerBike.findUnique({
    where: { id: customerBikeId },
    select: customerBikeHistorySelect,
  });

  if (!bike) {
    throw new HttpError(404, "Bike record not found", "CUSTOMER_BIKE_NOT_FOUND");
  }

  return buildWorkshopStartContext({
    bike,
    customer: bike.customer,
  });
};
