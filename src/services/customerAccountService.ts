import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { logger } from "../utils/logger";
import { getCustomerDisplayName } from "../utils/customerName";
import { buildCustomerBikeDisplayName } from "./customerBikeService";
import { listStoreInfoSettings } from "./configurationService";
import { sendEmailMessage } from "./emailService";
import { toWorkshopExecutionStatus } from "./workshopStatusService";

const DEFAULT_ACCESS_TOKEN_TTL_MINUTES = 20;
const GENERIC_ACCESS_LINK_MESSAGE =
  "If we recognised that email address, a secure sign-in link has been sent.";

const parseAccessTokenTtlMinutes = () => {
  const raw = process.env.CUSTOMER_ACCESS_TOKEN_TTL_MINUTES?.trim();
  if (!raw) {
    return DEFAULT_ACCESS_TOKEN_TTL_MINUTES;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 24 * 60) {
    return DEFAULT_ACCESS_TOKEN_TTL_MINUTES;
  }

  return parsed;
};

const CUSTOMER_ACCESS_TOKEN_TTL_MINUTES = parseAccessTokenTtlMinutes();

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeEmailOrThrow = (value: unknown) => {
  if (typeof value !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_CUSTOMER_EMAIL");
  }

  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpError(400, "email must be a valid email address", "INVALID_CUSTOMER_EMAIL");
  }

  return normalized;
};

const createSecureToken = () => crypto.randomBytes(24).toString("base64url");

const hashAccessToken = (token: string) =>
  crypto.createHash("sha256").update(token, "utf8").digest("hex");

const resolveAccessTokenExpiryDate = () =>
  new Date(Date.now() + CUSTOMER_ACCESS_TOKEN_TTL_MINUTES * 60 * 1000);

const sanitizeReturnPath = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/api/")) {
    return null;
  }

  return trimmed.length > 0 ? trimmed : null;
};

const resolvePublicAppUrl = (path: string) => {
  const baseUrl =
    normalizeOptionalText(process.env.PUBLIC_APP_URL)
    ?? normalizeOptionalText(process.env.APP_BASE_URL)
    ?? `http://localhost:${normalizeOptionalText(process.env.PORT) ?? "3100"}`;

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
};

const formatPortalMoneyLabel = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatAccessExpiryLabel = (value: Date) =>
  value.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const customerAccountSessionSelect = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  lastAccessLinkSentAt: true,
  lastLoginAt: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      bikes: {
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 6,
        select: {
          id: true,
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
        },
      },
      workshopJobs: {
        select: {
          id: true,
          status: true,
          closedAt: true,
          completedAt: true,
        },
      },
      _count: {
        select: {
          bikes: true,
        },
      },
    },
  },
} satisfies Prisma.CustomerAccountSelect;

const customerAccountDashboardSelect = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  lastAccessLinkSentAt: true,
  lastLoginAt: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      bikes: {
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
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
          updatedAt: true,
          createdAt: true,
          workshopJobs: {
            select: {
              id: true,
              status: true,
              closedAt: true,
              completedAt: true,
              updatedAt: true,
            },
          },
        },
      },
      workshopJobs: {
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 16,
        select: {
          id: true,
          status: true,
          customerId: true,
          bikeId: true,
          bikeDescription: true,
          scheduledDate: true,
          scheduledStartAt: true,
          scheduledEndAt: true,
          durationMinutes: true,
          depositRequiredPence: true,
          depositStatus: true,
          manageToken: true,
          manageTokenExpiresAt: true,
          completedAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          bike: {
            select: {
              id: true,
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
            },
          },
          sale: {
            select: {
              totalPence: true,
              createdAt: true,
            },
          },
          checkoutOutcome: {
            select: {
              saleTotalPence: true,
              depositPaidPence: true,
              creditPence: true,
              outstandingPence: true,
            },
          },
          estimates: {
            where: {
              supersededAt: null,
            },
            orderBy: [{ version: "desc" }],
            take: 1,
            select: {
              id: true,
              version: true,
              status: true,
              subtotalPence: true,
              labourTotalPence: true,
              partsTotalPence: true,
              lineCount: true,
              requestedAt: true,
              approvedAt: true,
              rejectedAt: true,
              customerQuoteToken: true,
              customerQuoteTokenExpiresAt: true,
            },
          },
          conversation: {
            select: {
              updatedAt: true,
              _count: {
                select: {
                  messages: {
                    where: {
                      customerVisible: true,
                    },
                  },
                },
              },
              messages: {
                where: {
                  customerVisible: true,
                },
                orderBy: [{ createdAt: "desc" }],
                take: 1,
                select: {
                  body: true,
                  createdAt: true,
                  direction: true,
                  channel: true,
                },
              },
            },
          },
          lines: {
            orderBy: [{ createdAt: "asc" }],
            take: 3,
            select: {
              type: true,
              description: true,
              qty: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CustomerAccountSelect;

const buildCustomerBikeLabel = (input: {
  label: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  bikeType: string | null;
  colour: string | null;
  wheelSize: string | null;
  frameSize: string | null;
  groupset: string | null;
  motorBrand: string | null;
  motorModel: string | null;
}) => buildCustomerBikeDisplayName(input);

const buildCurrentQuotePath = (estimate: {
  customerQuoteToken: string | null;
  customerQuoteTokenExpiresAt: Date | null;
}) => {
  if (!estimate.customerQuoteToken || !estimate.customerQuoteTokenExpiresAt) {
    return null;
  }
  if (estimate.customerQuoteTokenExpiresAt.getTime() < Date.now()) {
    return null;
  }

  return `/quote/${encodeURIComponent(estimate.customerQuoteToken)}`;
};

const buildManagePath = (job: {
  manageToken: string | null;
  manageTokenExpiresAt: Date | null;
}) => {
  if (!job.manageToken || !job.manageTokenExpiresAt) {
    return null;
  }
  if (job.manageTokenExpiresAt.getTime() < Date.now()) {
    return null;
  }

  return `/bookings/${encodeURIComponent(job.manageToken)}`;
};

const buildCustomerProgress = (input: {
  rawStatus: string;
  closedAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledDate: Date | null;
  estimate: {
    status: string;
    subtotalPence: number;
  } | null;
  hasActionableQuote: boolean;
  finalSummary: {
    totalPence: number;
  } | null;
}) => {
  const hasSchedule = Boolean(input.scheduledStartAt || input.scheduledDate);

  if (input.closedAt || input.rawStatus === "CANCELLED") {
    return {
      stage: "CLOSED",
      label: "Closed",
      headline: "This workshop job is now closed",
      detail: "If you still need help with this bike, please contact the shop directly.",
      nextStep: "The workshop can help if anything needs to be revisited.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "COMPLETED") {
    return {
      stage: "COLLECTED",
      label: "Collected",
      headline: "Your bike has been collected",
      detail: input.finalSummary
        ? `Final total: ${formatPortalMoneyLabel(input.finalSummary.totalPence)}`
        : "The workshop has marked this job as collected.",
      nextStep: "You can revisit this repair from your customer account whenever you need it.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "READY_FOR_COLLECTION") {
    return {
      stage: "READY_FOR_COLLECTION",
      label: "Ready for collection",
      headline: "Your bike is ready to collect",
      detail: input.finalSummary
        ? `Collection total: ${formatPortalMoneyLabel(input.finalSummary.totalPence)}`
        : "The workshop has finished the current work and says your bike is ready.",
      nextStep:
        "Please contact the shop if you need to confirm collection timing or have any final questions.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "WAITING_FOR_APPROVAL" || input.estimate?.status === "PENDING_APPROVAL") {
    return {
      stage: "AWAITING_APPROVAL",
      label: "Awaiting approval",
      headline: "The workshop is waiting for your go-ahead",
      detail: input.estimate
        ? `Please review the current quote total of ${formatPortalMoneyLabel(
            input.estimate.subtotalPence,
          )} before work continues.`
        : "The workshop is waiting for approval before continuing with the next stage of work.",
      nextStep: input.hasActionableQuote
        ? "Open the approval view to approve or reject the current estimate."
        : "Contact the shop if you need a fresh approval link.",
      needsCustomerAction: input.hasActionableQuote,
    };
  }

  if (input.rawStatus === "WAITING_FOR_PARTS") {
    return {
      stage: "WAITING",
      label: "Waiting on parts",
      headline: "The workshop is waiting on parts",
      detail: "Your bike stays on the job while the shop waits for the required parts to arrive.",
      nextStep: "The workshop will update you here as soon as the parts arrive or the plan changes.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "ON_HOLD") {
    return {
      stage: "WAITING",
      label: "Waiting on an update",
      headline: "This job is temporarily paused",
      detail: "The workshop is waiting on something before work can continue.",
      nextStep: "You can keep an eye on the next update from your customer account.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "IN_PROGRESS" || input.rawStatus === "BIKE_ARRIVED") {
    return {
      stage: "IN_PROGRESS",
      label: "In progress",
      headline: "Your bike is with the workshop",
      detail: hasSchedule
        ? "The bike is in an active workshop slot and work is underway."
        : "The workshop has your bike and is progressing the job.",
      nextStep: "The workshop will update you here if anything changes or if they need your approval.",
      needsCustomerAction: false,
    };
  }

  if (hasSchedule) {
    return {
      stage: "SCHEDULED",
      label: "Scheduled",
      headline: "Your bike is booked into the workshop",
      detail: "The workshop has reserved time for your bike.",
      nextStep: "Check the scheduled time and contact the shop if you need to discuss timing.",
      needsCustomerAction: false,
    };
  }

  return {
    stage: "BOOKED",
    label: "Booked in",
    headline: "Your bike is booked in with the workshop",
    detail: "The job is open and the workshop will update you when work starts or timing is confirmed.",
    nextStep: "Your customer account will keep the next workshop step visible in one place.",
    needsCustomerAction: false,
  };
};

const buildCollectionSummary = (input: {
  rawStatus: string;
  closedAt: Date | null;
  completedAt: Date | null;
  finalSummary: {
    totalPence: number;
  } | null;
  checkoutOutcome: {
    saleTotalPence: number;
    depositPaidPence: number;
    outstandingPence: number;
  } | null;
  depositRequiredPence: number;
  depositStatus: "NOT_REQUIRED" | "REQUIRED" | "PAID";
}) => {
  const totalPence = input.checkoutOutcome?.saleTotalPence ?? input.finalSummary?.totalPence ?? null;
  const outstandingPence = input.checkoutOutcome?.outstandingPence ?? null;
  const depositPaidPence =
    input.checkoutOutcome?.depositPaidPence
    ?? (input.depositStatus === "PAID" ? input.depositRequiredPence : 0);
  const paidPence =
    totalPence !== null && outstandingPence !== null
      ? Math.max(0, totalPence - outstandingPence)
      : depositPaidPence > 0
        ? depositPaidPence
        : 0;

  if (input.closedAt || input.rawStatus === "CANCELLED") {
    return {
      state: "CLOSED",
      headline: "Collection closed",
      detail: "This workshop job is closed, so there is nothing left to collect.",
      nextStep: "Contact the shop directly if anything needs to be revisited.",
      totalPence,
      outstandingPence,
      paidPence,
      depositPaidPence,
      depositRequiredPence: input.depositRequiredPence,
      depositStatus: input.depositStatus,
    };
  }

  if (input.rawStatus === "COMPLETED" || input.completedAt) {
    return {
      state: "COLLECTED",
      headline: "Bike collected",
      detail:
        totalPence !== null
          ? `Final total ${formatPortalMoneyLabel(totalPence)} settled and the bike has been handed back.`
          : "The workshop has marked this job as collected.",
      nextStep: "You can keep this repair in your account for future reference.",
      totalPence,
      outstandingPence: 0,
      paidPence: totalPence ?? paidPence,
      depositPaidPence,
      depositRequiredPence: input.depositRequiredPence,
      depositStatus: input.depositStatus,
    };
  }

  if (input.rawStatus === "READY_FOR_COLLECTION") {
    if (totalPence !== null && outstandingPence !== null && outstandingPence > 0) {
      return {
        state: "READY_PAYMENT_DUE",
        headline: "Ready to collect",
        detail: `Final total ${formatPortalMoneyLabel(totalPence)}. ${formatPortalMoneyLabel(
          outstandingPence,
        )} remains to pay at collection.`,
        nextStep: "Bring payment when you collect, or contact the shop if you need to discuss timing.",
        totalPence,
        outstandingPence,
        paidPence,
        depositPaidPence,
        depositRequiredPence: input.depositRequiredPence,
        depositStatus: input.depositStatus,
      };
    }

    if (totalPence !== null) {
      return {
        state: "READY_TO_COLLECT",
        headline: "Ready to collect",
        detail: `Final total ${formatPortalMoneyLabel(totalPence)} with no payment left outstanding.`,
        nextStep: "You can now arrange collection with the shop.",
        totalPence,
        outstandingPence: 0,
        paidPence: totalPence,
        depositPaidPence,
        depositRequiredPence: input.depositRequiredPence,
        depositStatus: input.depositStatus,
      };
    }

    return {
      state: "READY_PENDING_CHECKOUT",
      headline: "Ready to collect",
      detail:
        depositPaidPence > 0
          ? `Deposit received (${formatPortalMoneyLabel(depositPaidPence)}). The workshop will confirm anything left to pay when you collect.`
          : "The workshop has finished the bike and will confirm any final payment at collection.",
      nextStep: "You do not need to approve anything else. Contact the shop if you need collection timing.",
      totalPence: null,
      outstandingPence: null,
      paidPence,
      depositPaidPence,
      depositRequiredPence: input.depositRequiredPence,
      depositStatus: input.depositStatus,
    };
  }

  if (input.rawStatus === "WAITING_FOR_APPROVAL") {
    return {
      state: "AWAITING_APPROVAL",
      headline: "Collection is on hold",
      detail: "The workshop cannot complete or hand back the bike until the current quoted work is approved or declined.",
      nextStep: "Review the latest quote first. Collection timing becomes clear once the workshop can continue.",
      totalPence,
      outstandingPence,
      paidPence,
      depositPaidPence,
      depositRequiredPence: input.depositRequiredPence,
      depositStatus: input.depositStatus,
    };
  }

  return {
    state: "IN_WORKSHOP",
    headline: "Not ready for collection yet",
    detail: "The bike is still moving through the workshop, so collection and final payment are not ready yet.",
    nextStep: "Follow the repair progress here and wait for a ready-to-collect update from the shop.",
    totalPence,
    outstandingPence,
    paidPence,
    depositPaidPence,
    depositRequiredPence: input.depositRequiredPence,
    depositStatus: input.depositStatus,
  };
};

const summarizeWorkLines = (
  lines: Array<{
    description: string;
    qty: number;
  }>,
) => {
  if (lines.length === 0) {
    return "Workshop visit";
  }

  const descriptions = lines.map((line) =>
    line.qty > 1 ? `${line.description} x${line.qty}` : line.description,
  );
  if (descriptions.length === 1) {
    return descriptions[0];
  }
  if (descriptions.length === 2) {
    return `${descriptions[0]} and ${descriptions[1]}`;
  }

  return `${descriptions[0]}, ${descriptions[1]}, and ${descriptions.length - 2} more item(s)`;
};

const toExecutionStatusLabel = (status: ReturnType<typeof toWorkshopExecutionStatus>) => {
  switch (status) {
    case "BOOKED":
      return "Booked in";
    case "IN_PROGRESS":
      return "In progress";
    case "READY":
      return "Ready for collection";
    case "COLLECTED":
      return "Collected";
    case "CLOSED":
      return "Closed";
  }
};

const buildNextAction = (
  activeJobs: Array<{
    id: string;
    bikeDisplayName: string;
    customerProgress: {
      needsCustomerAction: boolean;
      headline: string;
      nextStep: string;
    };
    collection: {
      state: string;
      headline: string;
      nextStep: string;
    };
    links: {
      quotePath: string | null;
      managePath: string | null;
      primaryPath: string | null;
    };
  }>,
) => {
  const approvalJob = activeJobs.find((job) => job.customerProgress.needsCustomerAction);
  if (approvalJob) {
    return {
      kind: "APPROVAL_NEEDED",
      title: "Approval needed",
      detail: `${approvalJob.bikeDisplayName}: ${approvalJob.customerProgress.headline}`,
      path: approvalJob.links.quotePath ?? approvalJob.links.primaryPath ?? "/account",
      actionLabel: "Review estimate",
    };
  }

  const readyJob = activeJobs.find((job) =>
    ["READY_PENDING_CHECKOUT", "READY_PAYMENT_DUE", "READY_TO_COLLECT"].includes(job.collection.state),
  );
  if (readyJob) {
    return {
      kind: "READY_TO_COLLECT",
      title: "Ready to collect",
      detail: `${readyJob.bikeDisplayName}: ${readyJob.collection.headline}`,
      path: readyJob.links.primaryPath ?? "/account",
      actionLabel: "View collection details",
    };
  }

  const activeJob = activeJobs[0];
  if (activeJob) {
    return {
      kind: "IN_PROGRESS",
      title: "Latest workshop update",
      detail: `${activeJob.bikeDisplayName}: ${activeJob.customerProgress.nextStep}`,
      path: activeJob.links.primaryPath ?? "/account",
      actionLabel: "Open workshop job",
    };
  }

  return null;
};

const toPublicSessionResponse = (
  account: Prisma.CustomerAccountGetPayload<{ select: typeof customerAccountSessionSelect }>,
) => {
  const activeJobCount = account.customer.workshopJobs.filter((job) => {
    const status = toWorkshopExecutionStatus({
      status: job.status,
      closedAt: job.closedAt,
    });
    return status !== "COLLECTED" && status !== "CLOSED";
  }).length;

  return {
    authenticated: true as const,
    account: {
      id: account.id,
      email: account.email,
      status: account.status,
      createdAt: account.createdAt,
      lastAccessLinkSentAt: account.lastAccessLinkSentAt,
      lastLoginAt: account.lastLoginAt,
    },
    customer: {
      id: account.customer.id,
      firstName: account.customer.firstName,
      lastName: account.customer.lastName,
      displayName: getCustomerDisplayName(account.customer, "Workshop customer"),
      email: account.customer.email,
      phone: account.customer.phone,
    },
    stats: {
      bikeCount: account.customer._count.bikes,
      activeJobCount,
    },
    bikes: account.customer.bikes.map((bike) => ({
      id: bike.id,
      displayName: buildCustomerBikeLabel(bike),
    })),
  };
};

export const ensureCustomerAccountForCustomerTx = async (
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    email: string | null | undefined;
  },
) => {
  const normalizedEmail = normalizeOptionalText(input.email)?.toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  try {
    return await tx.customerAccount.upsert({
      where: { customerId: input.customerId },
      create: {
        customerId: input.customerId,
        email: normalizedEmail,
      },
      update: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        customerId: true,
        email: true,
        status: true,
      },
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== "P2002") {
      throw error;
    }

    const existingByEmail = await tx.customerAccount.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        customerId: true,
        email: true,
        status: true,
      },
    });

    if (existingByEmail && existingByEmail.customerId === input.customerId) {
      return existingByEmail;
    }

    throw new HttpError(
      409,
      "Customer account email is already linked elsewhere",
      "CUSTOMER_ACCOUNT_EMAIL_CONFLICT",
    );
  }
};

export const requestCustomerAccessLink = async (input: {
  email?: unknown;
  returnTo?: unknown;
}) => {
  const email = normalizeEmailOrThrow(input.email);
  const redirectPath = sanitizeReturnPath(input.returnTo);
  let prepared:
    | {
        token: string;
        email: string;
        customerName: string;
        expiresAt: Date;
      }
    | null = null;

  await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { email },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });

    if (!customer?.email) {
      return;
    }

    const account = await ensureCustomerAccountForCustomerTx(tx, {
      customerId: customer.id,
      email: customer.email,
    });
    if (!account || account.status !== "ACTIVE") {
      return;
    }

    const now = new Date();
    await tx.customerAccessToken.updateMany({
      where: {
        customerAccountId: account.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        revokedAt: now,
      },
    });

    const token = createSecureToken();
    const expiresAt = resolveAccessTokenExpiryDate();
    await tx.customerAccessToken.create({
      data: {
        customerAccountId: account.id,
        tokenHash: hashAccessToken(token),
        tokenLastEight: token.slice(-8),
        redirectPath,
        expiresAt,
      },
    });

    await tx.customerAccount.update({
      where: { id: account.id },
      data: {
        lastAccessLinkSentAt: now,
      },
    });

    prepared = {
      token,
      email: customer.email,
      customerName: getCustomerDisplayName(customer, "Workshop customer"),
      expiresAt,
    };
  });

  if (prepared) {
    const store = await listStoreInfoSettings();
    const accountLink = resolvePublicAppUrl(`/account/access/${encodeURIComponent(prepared.token)}`);
    const fromEmail =
      normalizeOptionalText(process.env.EMAIL_FROM)
      ?? normalizeOptionalText(store.email)
      ?? "no-reply@corepos.local";
    const fromName =
      normalizeOptionalText(process.env.EMAIL_FROM_NAME)
      ?? normalizeOptionalText(store.businessName)
      ?? normalizeOptionalText(store.name)
      ?? "CorePOS";

    try {
      await sendEmailMessage({
        to: prepared.email,
        from: {
          email: fromEmail,
          name: fromName,
        },
        subject: `${fromName}: your secure customer sign-in link`,
        text: [
          `Hello ${prepared.customerName},`,
          "",
          "Use this secure link to access your CorePOS customer account for workshop bookings, approvals, progress updates, and collection readiness:",
          accountLink,
          "",
          `This link expires on ${formatAccessExpiryLabel(prepared.expiresAt)}.`,
          "If you did not request this link, you can ignore this email.",
        ].join("\n"),
        html: [
          `<p>Hello ${prepared.customerName},</p>`,
          "<p>Use this secure link to access your CorePOS customer account for workshop bookings, approvals, progress updates, and collection readiness:</p>",
          `<p><a href="${accountLink}">${accountLink}</a></p>`,
          `<p>This link expires on ${formatAccessExpiryLabel(prepared.expiresAt)}.</p>`,
          "<p>If you did not request this link, you can ignore this email.</p>",
        ].join(""),
      });
    } catch (error) {
      logger.error("customer_account.access_link_email_failed", error, {
        customerEmail: prepared.email,
      });
    }

    return {
      ok: true as const,
      message: GENERIC_ACCESS_LINK_MESSAGE,
      ...(process.env.NODE_ENV !== "production"
        ? {
            devMagicLinkUrl: accountLink,
          }
        : {}),
    };
  }

  return {
    ok: true as const,
    message: GENERIC_ACCESS_LINK_MESSAGE,
  };
};

export const consumeCustomerAccessLink = async (tokenValue: unknown) => {
  if (typeof tokenValue !== "string" || tokenValue.trim().length === 0) {
    throw new HttpError(400, "token is required", "CUSTOMER_ACCESS_TOKEN_REQUIRED");
  }

  const token = tokenValue.trim();
  const tokenHash = hashAccessToken(token);

  return prisma.$transaction(async (tx) => {
    const accessToken = await tx.customerAccessToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        redirectPath: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        customerAccount: {
          select: {
            id: true,
            email: true,
            status: true,
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (!accessToken) {
      throw new HttpError(404, "Access link not found", "CUSTOMER_ACCESS_LINK_NOT_FOUND");
    }

    if (accessToken.customerAccount.status !== "ACTIVE") {
      throw new HttpError(403, "Customer account is disabled", "CUSTOMER_ACCOUNT_DISABLED");
    }

    if (accessToken.revokedAt) {
      throw new HttpError(410, "This access link has been replaced by a newer link", "CUSTOMER_ACCESS_LINK_REVOKED");
    }

    if (accessToken.consumedAt) {
      throw new HttpError(409, "This access link has already been used", "CUSTOMER_ACCESS_LINK_USED");
    }

    if (accessToken.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, "This access link has expired", "CUSTOMER_ACCESS_LINK_EXPIRED");
    }

    const consumedAt = new Date();
    await tx.customerAccessToken.update({
      where: { id: accessToken.id },
      data: {
        consumedAt,
      },
    });

    await tx.customerAccount.update({
      where: { id: accessToken.customerAccount.id },
      data: {
        lastLoginAt: consumedAt,
      },
    });

    return {
      redirectPath: accessToken.redirectPath ?? "/account",
      account: {
        id: accessToken.customerAccount.id,
        email: accessToken.customerAccount.email,
        customerId: accessToken.customerAccount.customer.id,
      },
    };
  });
};

export const getCustomerAccountSession = async (customerAccountId: string) => {
  const account = await prisma.customerAccount.findUnique({
    where: { id: customerAccountId },
    select: customerAccountSessionSelect,
  });

  if (!account || account.status !== "ACTIVE") {
    throw new HttpError(401, "Customer authentication required", "CUSTOMER_AUTH_REQUIRED");
  }

  return toPublicSessionResponse(account);
};

export const getCustomerAccountDashboard = async (customerAccountId: string) => {
  const account = await prisma.customerAccount.findUnique({
    where: { id: customerAccountId },
    select: customerAccountDashboardSelect,
  });

  if (!account || account.status !== "ACTIVE") {
    throw new HttpError(401, "Customer authentication required", "CUSTOMER_AUTH_REQUIRED");
  }

  const customerName = getCustomerDisplayName(account.customer, "Workshop customer");
  const jobCards = account.customer.workshopJobs.map((job) => {
    const executionStatus = toWorkshopExecutionStatus({
      status: job.status,
      closedAt: job.closedAt,
    });
    const currentEstimate = job.estimates[0] ?? null;
    const quotePath = currentEstimate ? buildCurrentQuotePath(currentEstimate) : null;
    const managePath = buildManagePath(job);
    const finalSummary = job.sale
      ? {
          totalPence: job.sale.totalPence,
        }
      : null;
    const bikeDisplayName = job.bike
      ? buildCustomerBikeLabel(job.bike)
      : normalizeOptionalText(job.bikeDescription) ?? "Bike";
    const customerProgress = buildCustomerProgress({
      rawStatus: job.status,
      closedAt: job.closedAt,
      scheduledStartAt: job.scheduledStartAt,
      scheduledDate: job.scheduledDate,
      estimate: currentEstimate
        ? {
            status: currentEstimate.status,
            subtotalPence: currentEstimate.subtotalPence,
          }
        : null,
      hasActionableQuote: Boolean(quotePath && currentEstimate?.status === "PENDING_APPROVAL"),
      finalSummary,
    });
    const collection = buildCollectionSummary({
      rawStatus: job.status,
      closedAt: job.closedAt,
      completedAt: job.completedAt,
      finalSummary,
      checkoutOutcome: job.checkoutOutcome
        ? {
            saleTotalPence: job.checkoutOutcome.saleTotalPence,
            depositPaidPence: job.checkoutOutcome.depositPaidPence,
            outstandingPence: job.checkoutOutcome.outstandingPence,
          }
        : null,
      depositRequiredPence: job.depositRequiredPence,
      depositStatus: job.depositStatus,
    });
    const latestMessage = job.conversation?.messages[0] ?? null;

    return {
      id: job.id,
      executionStatus,
      statusLabel: toExecutionStatusLabel(executionStatus),
      bikeId: job.bikeId,
      bikeDisplayName,
      scheduledDate: job.scheduledDate,
      scheduledStartAt: job.scheduledStartAt,
      scheduledEndAt: job.scheduledEndAt,
      durationMinutes: job.durationMinutes,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      customerProgress,
      collection,
      estimate: currentEstimate
        ? {
            id: currentEstimate.id,
            version: currentEstimate.version,
            status: currentEstimate.status,
            subtotalPence: currentEstimate.subtotalPence,
            labourTotalPence: currentEstimate.labourTotalPence,
            partsTotalPence: currentEstimate.partsTotalPence,
            lineCount: currentEstimate.lineCount,
            requestedAt: currentEstimate.requestedAt,
            approvedAt: currentEstimate.approvedAt,
            rejectedAt: currentEstimate.rejectedAt,
          }
        : null,
      conversation: job.conversation
        ? {
            updatedAt: job.conversation.updatedAt,
            messageCount: job.conversation._count.messages,
            latestMessage: latestMessage
              ? {
                  bodyPreview:
                    latestMessage.body.length > 140
                      ? `${latestMessage.body.slice(0, 137).trimEnd()}...`
                      : latestMessage.body,
                  createdAt: latestMessage.createdAt,
                  direction: latestMessage.direction,
                  channel: latestMessage.channel,
                }
              : null,
          }
        : null,
      workSummary: {
        headline: summarizeWorkLines(job.lines),
        lineCount: job.lines.length,
      },
      links: {
        quotePath,
        managePath,
        primaryPath: quotePath ?? managePath ?? "/account",
      },
    };
  });

  const activeJobs = jobCards.filter((job) => job.executionStatus !== "COLLECTED" && job.executionStatus !== "CLOSED");
  const recentHistory = jobCards
    .filter((job) => job.executionStatus === "COLLECTED" || job.executionStatus === "CLOSED")
    .slice(0, 6)
    .map((job) => ({
      id: job.id,
      bikeDisplayName: job.bikeDisplayName,
      statusLabel: job.statusLabel,
      completedAt: job.updatedAt,
      totalPence: job.collection.totalPence,
      summary: job.workSummary.headline,
    }));

  const bikes = account.customer.bikes.map((bike) => {
    const activeJobCount = bike.workshopJobs.filter((job) => {
      const status = toWorkshopExecutionStatus({
        status: job.status,
        closedAt: job.closedAt,
      });
      return status !== "COLLECTED" && status !== "CLOSED";
    }).length;
    const latestServiceAt = bike.workshopJobs
      .map((job) => job.completedAt ?? job.updatedAt)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

    return {
      id: bike.id,
      displayName: buildCustomerBikeLabel(bike),
      activeJobCount,
      latestServiceAt,
      createdAt: bike.createdAt,
      updatedAt: bike.updatedAt,
    };
  });

  const awaitingApprovalCount = activeJobs.filter((job) => job.customerProgress.needsCustomerAction).length;
  const readyToCollectCount = activeJobs.filter((job) =>
    ["READY_PENDING_CHECKOUT", "READY_PAYMENT_DUE", "READY_TO_COLLECT"].includes(job.collection.state),
  ).length;

  return {
    account: {
      id: account.id,
      email: account.email,
      status: account.status,
      createdAt: account.createdAt,
      lastAccessLinkSentAt: account.lastAccessLinkSentAt,
      lastLoginAt: account.lastLoginAt,
    },
    customer: {
      id: account.customer.id,
      firstName: account.customer.firstName,
      lastName: account.customer.lastName,
      displayName: customerName,
      email: account.customer.email,
      phone: account.customer.phone,
      createdAt: account.customer.createdAt,
    },
    spotlight: {
      nextAction: buildNextAction(activeJobs),
      counts: {
        activeJobs: activeJobs.length,
        awaitingApproval: awaitingApprovalCount,
        readyToCollect: readyToCollectCount,
        bikes: bikes.length,
      },
    },
    activeJobs,
    bikes,
    recentHistory,
  };
};
