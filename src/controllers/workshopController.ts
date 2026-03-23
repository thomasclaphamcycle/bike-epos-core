import { Request, Response } from "express";
import {
  CancellationOutcome,
  PaymentMethod,
  WorkshopNotificationEventType,
  WorkshopJobNoteVisibility,
} from "@prisma/client";
import {
  assertRoleAtLeast,
  getRequestStaffActorId,
  getRequestAuditActor,
  getRequestStaffRole,
} from "../middleware/staffRole";
import { normalizeDateKeyOrThrow } from "../services/rotaService";
import { getWorkshopDashboard } from "../services/workshopDashboardService";
import { getWorkshopAvailability } from "../services/workshopAvailabilityService";
import { resolveRequestLocation } from "../services/locationService";
import { getWorkshopCalendar } from "../services/workshopCalendarService";
import {
  createOnlineWorkshopBooking,
  getWorkshopBookingByManageToken,
  payWorkshopBookingDepositByManageToken,
  updateWorkshopBookingByManageToken,
} from "../services/workshopBookingService";
import { checkoutWorkshopJobToSale } from "../services/workshopCheckoutService";
import {
  cancelWorkshopBookingByManageToken,
  cancelWorkshopJobById,
} from "../services/workshopMoneyService";
import {
  addWorkshopJobNote,
  assignWorkshopJob,
  changeWorkshopJobStatus,
  getWorkshopJobNotes,
  setWorkshopJobApprovalStatus,
  updateWorkshopJobSchedule,
} from "../services/workshopWorkflowService";
import {
  getPublicWorkshopConversation,
  getWorkshopConversationForJob,
  postPublicWorkshopConversationReply,
  postWorkshopConversationMessageForJob,
} from "../services/workshopConversationService";
import {
  createWorkshopAttachmentForJob,
  deleteWorkshopAttachmentForJob,
  getPublicWorkshopAttachmentFile,
  getWorkshopAttachmentFileForJob,
  listPublicWorkshopAttachments,
  listWorkshopAttachmentsForJob,
} from "../services/workshopAttachmentService";
import {
  addWorkshopJobLine,
  attachCustomerToWorkshopJob,
  closeWorkshopJob,
  createWorkshopJob,
  deleteWorkshopJobLine,
  finalizeWorkshopJob,
  getWorkshopJobById,
  listWorkshopJobs,
  updateWorkshopJobLine,
  updateWorkshopJob,
} from "../services/workshopService";
import {
  createWorkshopEstimateCustomerQuoteLink,
  getPublicWorkshopEstimateQuote,
  saveWorkshopEstimate,
  submitPublicWorkshopEstimateQuoteDecision,
} from "../services/workshopEstimateService";
import {
  listWorkshopNotificationsForJob,
  resendWorkshopNotificationForJob,
} from "../services/notificationService";
import { HttpError } from "../utils/http";

const parsePaymentMethod = (
  value: string | undefined,
  fieldName: "method" | "paymentMethod",
): PaymentMethod | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "CASH" && value !== "CARD" && value !== "OTHER") {
    throw new HttpError(
      400,
      `${fieldName} must be one of CASH, CARD, OTHER`,
      "INVALID_PAYMENT_METHOD",
    );
  }

  return value;
};

const parseWorkshopNoteVisibility = (value: string | undefined): WorkshopJobNoteVisibility => {
  if (value === undefined) {
    return "INTERNAL";
  }

  if (value !== "INTERNAL" && value !== "CUSTOMER") {
    throw new HttpError(
      400,
      "visibility must be INTERNAL or CUSTOMER",
      "INVALID_NOTE_VISIBILITY",
    );
  }

  return value;
};

const parseCancellationOutcome = (
  value: string | undefined,
): CancellationOutcome | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (
    value !== "REFUND_DEPOSIT" &&
    value !== "FORFEIT_DEPOSIT" &&
    value !== "CONVERT_TO_CREDIT" &&
    value !== "NO_DEPOSIT"
  ) {
    throw new HttpError(
      400,
      "outcome must be REFUND_DEPOSIT, FORFEIT_DEPOSIT, CONVERT_TO_CREDIT, or NO_DEPOSIT",
      "INVALID_CANCELLATION_OUTCOME",
    );
  }

  return value;
};

const parseOptionalIntegerQuery = (value: unknown, field: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_FILTER");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_FILTER");
  }
  return parsed;
};

const parseOptionalBooleanBody = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, "INVALID_WORKSHOP_SCHEDULE_UPDATE");
  }
  return value;
};

const parseWorkshopNotificationEventType = (
  value: unknown,
): WorkshopNotificationEventType => {
  if (value === "QUOTE_READY" || value === "JOB_READY_FOR_COLLECTION") {
    return value;
  }

  throw new HttpError(
    400,
    "eventType must be QUOTE_READY or JOB_READY_FOR_COLLECTION",
    "INVALID_NOTIFICATION_EVENT_TYPE",
  );
};

export const createWorkshopJobHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    customerId?: string | null;
    customerName?: string;
    bikeId?: string | null;
    bikeDescription?: string;
    scheduledStartAt?: string | null;
    scheduledEndAt?: string | null;
    durationMinutes?: number | null;
    notes?: string;
    status?: string;
  };

  if (body.customerId !== undefined && body.customerId !== null && typeof body.customerId !== "string") {
    throw new HttpError(400, "customerId must be a string or null", "INVALID_WORKSHOP_JOB");
  }
  if (body.customerName !== undefined && typeof body.customerName !== "string") {
    throw new HttpError(400, "customerName must be a string", "INVALID_WORKSHOP_JOB");
  }
  if (body.bikeId !== undefined && body.bikeId !== null && typeof body.bikeId !== "string") {
    throw new HttpError(400, "bikeId must be a string or null", "INVALID_WORKSHOP_JOB");
  }
  if (body.bikeDescription !== undefined && typeof body.bikeDescription !== "string") {
    throw new HttpError(400, "bikeDescription must be a string", "INVALID_WORKSHOP_JOB");
  }
  if (
    body.scheduledStartAt !== undefined &&
    body.scheduledStartAt !== null &&
    typeof body.scheduledStartAt !== "string"
  ) {
    throw new HttpError(400, "scheduledStartAt must be a string or null", "INVALID_WORKSHOP_JOB");
  }
  if (
    body.scheduledEndAt !== undefined &&
    body.scheduledEndAt !== null &&
    typeof body.scheduledEndAt !== "string"
  ) {
    throw new HttpError(400, "scheduledEndAt must be a string or null", "INVALID_WORKSHOP_JOB");
  }
  if (
    body.durationMinutes !== undefined &&
    body.durationMinutes !== null &&
    typeof body.durationMinutes !== "number"
  ) {
    throw new HttpError(400, "durationMinutes must be a number or null", "INVALID_WORKSHOP_JOB");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_WORKSHOP_JOB");
  }
  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_WORKSHOP_JOB");
  }

  const location = await resolveRequestLocation(req);
  const job = await createWorkshopJob({
    ...body,
    locationId: location.id,
  });
  res.status(201).json(job);
};

export const listWorkshopJobsHandler = async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const q =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const take = parseOptionalIntegerQuery(req.query.take, "take");
  const skip = parseOptionalIntegerQuery(req.query.skip, "skip");

  const location = await resolveRequestLocation(req);
  const result = await listWorkshopJobs({
    status,
    q,
    locationId: location.id,
    take,
    skip,
  });
  res.json(result);
};

export const getWorkshopJobHandler = async (req: Request, res: Response) => {
  const result = await getWorkshopJobById(req.params.id);
  res.json(result);
};

export const listWorkshopJobNotificationsHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await listWorkshopNotificationsForJob(req.params.id);
  res.json(result);
};

export const resendWorkshopJobNotificationHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    eventType?: unknown;
  };

  const result = await resendWorkshopNotificationForJob(req.params.id, {
    eventType: parseWorkshopNotificationEventType(body.eventType),
  });

  res.status(201).json(result);
};

export const patchWorkshopJobHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    customerName?: string;
    bikeId?: string | null;
    bikeDescription?: string;
    scheduledStartAt?: string | null;
    scheduledEndAt?: string | null;
    durationMinutes?: number | null;
    notes?: string;
    status?: string;
  };

  if (body.customerName !== undefined && typeof body.customerName !== "string") {
    throw new HttpError(400, "customerName must be a string", "INVALID_WORKSHOP_JOB_UPDATE");
  }
  if (body.bikeId !== undefined && body.bikeId !== null && typeof body.bikeId !== "string") {
    throw new HttpError(400, "bikeId must be a string or null", "INVALID_WORKSHOP_JOB_UPDATE");
  }
  if (body.bikeDescription !== undefined && typeof body.bikeDescription !== "string") {
    throw new HttpError(
      400,
      "bikeDescription must be a string",
      "INVALID_WORKSHOP_JOB_UPDATE",
    );
  }
  if (
    body.scheduledStartAt !== undefined &&
    body.scheduledStartAt !== null &&
    typeof body.scheduledStartAt !== "string"
  ) {
    throw new HttpError(
      400,
      "scheduledStartAt must be a string or null",
      "INVALID_WORKSHOP_JOB_UPDATE",
    );
  }
  if (
    body.scheduledEndAt !== undefined &&
    body.scheduledEndAt !== null &&
    typeof body.scheduledEndAt !== "string"
  ) {
    throw new HttpError(
      400,
      "scheduledEndAt must be a string or null",
      "INVALID_WORKSHOP_JOB_UPDATE",
    );
  }
  if (
    body.durationMinutes !== undefined &&
    body.durationMinutes !== null &&
    typeof body.durationMinutes !== "number"
  ) {
    throw new HttpError(
      400,
      "durationMinutes must be a number or null",
      "INVALID_WORKSHOP_JOB_UPDATE",
    );
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_WORKSHOP_JOB_UPDATE");
  }
  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_WORKSHOP_JOB_UPDATE");
  }

  const job = await updateWorkshopJob(req.params.id, body);
  res.json(job);
};

export const attachWorkshopJobCustomerHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { customerId?: string | null };
  if (!Object.prototype.hasOwnProperty.call(body, "customerId")) {
    throw new HttpError(
      400,
      "customerId is required and must be a uuid or null",
      "INVALID_CUSTOMER_ID",
    );
  }

  if (body.customerId !== null && typeof body.customerId !== "string") {
    throw new HttpError(
      400,
      "customerId is required and must be a uuid or null",
      "INVALID_CUSTOMER_ID",
    );
  }

  const result = await attachCustomerToWorkshopJob(req.params.id, body.customerId ?? null);
  res.json(result);
};

export const addWorkshopJobLineHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    type?: string;
    productId?: string | null;
    variantId?: string | null;
    description?: string;
    qty?: number;
    unitPricePence?: number;
  };

  if (body.type !== undefined && typeof body.type !== "string") {
    throw new HttpError(400, "type must be a string", "INVALID_WORKSHOP_LINE");
  }
  if (body.productId !== undefined && body.productId !== null && typeof body.productId !== "string") {
    throw new HttpError(400, "productId must be a string or null", "INVALID_WORKSHOP_LINE");
  }
  if (body.variantId !== undefined && body.variantId !== null && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string or null", "INVALID_WORKSHOP_LINE");
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    throw new HttpError(400, "description must be a string", "INVALID_WORKSHOP_LINE");
  }
  if (body.qty !== undefined && typeof body.qty !== "number") {
    throw new HttpError(400, "qty must be a number", "INVALID_WORKSHOP_LINE");
  }
  if (body.unitPricePence !== undefined && typeof body.unitPricePence !== "number") {
    throw new HttpError(400, "unitPricePence must be a number", "INVALID_WORKSHOP_LINE");
  }

  const result = await addWorkshopJobLine(req.params.id, body);
  res.status(201).json(result);
};

export const patchWorkshopJobLineHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    description?: string;
    qty?: number;
    unitPricePence?: number;
    productId?: string | null;
    variantId?: string | null;
  };

  if (body.description !== undefined && typeof body.description !== "string") {
    throw new HttpError(400, "description must be a string", "INVALID_WORKSHOP_LINE_UPDATE");
  }
  if (body.qty !== undefined && typeof body.qty !== "number") {
    throw new HttpError(400, "qty must be a number", "INVALID_WORKSHOP_LINE_UPDATE");
  }
  if (body.unitPricePence !== undefined && typeof body.unitPricePence !== "number") {
    throw new HttpError(400, "unitPricePence must be a number", "INVALID_WORKSHOP_LINE_UPDATE");
  }
  if (body.productId !== undefined && body.productId !== null && typeof body.productId !== "string") {
    throw new HttpError(400, "productId must be a string or null", "INVALID_WORKSHOP_LINE_UPDATE");
  }
  if (body.variantId !== undefined && body.variantId !== null && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string or null", "INVALID_WORKSHOP_LINE_UPDATE");
  }

  const result = await updateWorkshopJobLine(req.params.id, req.params.lineId, body);
  res.json(result);
};

export const deleteWorkshopJobLineHandler = async (req: Request, res: Response) => {
  const result = await deleteWorkshopJobLine(req.params.id, req.params.lineId);
  res.json(result);
};

export const finalizeWorkshopJobHandler = async (req: Request, res: Response) => {
  const result = await finalizeWorkshopJob(req.params.id);
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const closeWorkshopJobHandler = async (req: Request, res: Response) => {
  const result = await closeWorkshopJob(req.params.id, getRequestAuditActor(req));
  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getWorkshopAvailabilityHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  if (!from || !to) {
    throw new HttpError(400, "from and to are required", "INVALID_DATE_RANGE");
  }

  const availability = await getWorkshopAvailability(from, to);
  res.json(availability);
};

export const getWorkshopCalendarHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  if (!from || !to) {
    throw new HttpError(400, "from and to are required", "INVALID_DATE_RANGE");
  }

  const location = await resolveRequestLocation(req);
  const result = await getWorkshopCalendar({
    from,
    to,
    locationId: location.id,
  });

  res.json(result);
};

export const getWorkshopDashboardHandler = async (req: Request, res: Response) => {
  const staffDate = typeof req.query.staffDate === "string"
    ? normalizeDateKeyOrThrow(req.query.staffDate, "INVALID_WORKSHOP_STAFF_DATE")
    : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const source = typeof req.query.source === "string" ? req.query.source : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const includeCancelled =
    typeof req.query.includeCancelled === "string" ? req.query.includeCancelled : undefined;
  const assignedTo = typeof req.query.assignedTo === "string" ? req.query.assignedTo : undefined;
  const unassigned = typeof req.query.unassigned === "string" ? req.query.unassigned : undefined;
  const hasNotes = typeof req.query.hasNotes === "string" ? req.query.hasNotes : undefined;
  const limit = parseOptionalIntegerQuery(req.query.limit, "limit");

  const result = await getWorkshopDashboard({
    staffDate,
    status,
    source,
    from,
    to,
    search,
    includeCancelled,
    assignedTo,
    unassigned,
    hasNotes,
    limit,
  });

  res.json(result);
};

export const createOnlineWorkshopBookingHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    scheduledDate?: string;
    notes?: string;
  };

  const booking = await createOnlineWorkshopBooking(body);
  res.status(201).json(booking);
};

export const getWorkshopBookingByManageTokenHandler = async (
  req: Request,
  res: Response,
) => {
  const booking = await getWorkshopBookingByManageToken(req.params.token);
  res.json(booking);
};

export const updateWorkshopBookingByManageTokenHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    scheduledDate?: string;
    notes?: string;
    status?: string;
  };

  if (body.scheduledDate !== undefined && typeof body.scheduledDate !== "string") {
    throw new HttpError(400, "scheduledDate must be a string", "INVALID_BOOKING_UPDATE");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_BOOKING_UPDATE");
  }
  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_BOOKING_UPDATE");
  }

  const booking = await updateWorkshopBookingByManageToken(req.params.token, body);
  res.json(booking);
};

export const payWorkshopBookingDepositByManageTokenHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as { method?: string; providerRef?: string };

  if (body.method !== undefined && typeof body.method !== "string") {
    throw new HttpError(400, "method must be a string", "INVALID_PAYMENT");
  }
  if (body.providerRef !== undefined && typeof body.providerRef !== "string") {
    throw new HttpError(400, "providerRef must be a string", "INVALID_PAYMENT");
  }

  const result = await payWorkshopBookingDepositByManageToken(req.params.token, {
    method: parsePaymentMethod(body.method, "method"),
    providerRef: body.providerRef,
  }, getRequestAuditActor(req));

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const checkoutWorkshopJobHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    saleTotalPence?: number;
    paymentMethod?: string;
    amountPence?: number;
    providerRef?: string;
    allowUnpaidDepositOverride?: boolean;
  };

  if (body.paymentMethod !== undefined && typeof body.paymentMethod !== "string") {
    throw new HttpError(400, "paymentMethod must be a string", "INVALID_PAYMENT");
  }
  if (body.providerRef !== undefined && typeof body.providerRef !== "string") {
    throw new HttpError(400, "providerRef must be a string", "INVALID_PAYMENT");
  }
  if (
    body.allowUnpaidDepositOverride !== undefined &&
    typeof body.allowUnpaidDepositOverride !== "boolean"
  ) {
    throw new HttpError(
      400,
      "allowUnpaidDepositOverride must be a boolean",
      "INVALID_CHECKOUT",
    );
  }

  const result = await checkoutWorkshopJobToSale(req.params.id, {
    saleTotalPence: body.saleTotalPence,
    paymentMethod: parsePaymentMethod(body.paymentMethod, "paymentMethod"),
    amountPence: body.amountPence,
    providerRef: body.providerRef,
    allowUnpaidDepositOverride: body.allowUnpaidDepositOverride,
  }, getRequestAuditActor(req));

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const cancelWorkshopBookingByManageTokenHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    outcome?: string;
    notes?: string;
    refundReason?: string;
    idempotencyKey?: string;
  };

  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CANCELLATION");
  }
  if (body.refundReason !== undefined && typeof body.refundReason !== "string") {
    throw new HttpError(400, "refundReason must be a string", "INVALID_CANCELLATION");
  }
  if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") {
    throw new HttpError(400, "idempotencyKey must be a string", "INVALID_CANCELLATION");
  }

  const parsedOutcome = parseCancellationOutcome(body.outcome);
  const requiresManager =
    parsedOutcome === undefined ||
    parsedOutcome === "REFUND_DEPOSIT" ||
    parsedOutcome === "CONVERT_TO_CREDIT";

  if (requiresManager) {
    assertRoleAtLeast(req, "MANAGER");
  }

  const result = await cancelWorkshopBookingByManageToken(req.params.token, {
    outcome: parsedOutcome,
    notes: body.notes,
    refundReason: body.refundReason,
    idempotencyKey: body.idempotencyKey,
  }, getRequestAuditActor(req));

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const cancelWorkshopJobHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    outcome?: string;
    notes?: string;
    refundReason?: string;
    idempotencyKey?: string;
  };

  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CANCELLATION");
  }
  if (body.refundReason !== undefined && typeof body.refundReason !== "string") {
    throw new HttpError(400, "refundReason must be a string", "INVALID_CANCELLATION");
  }
  if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") {
    throw new HttpError(400, "idempotencyKey must be a string", "INVALID_CANCELLATION");
  }

  const parsedOutcome = parseCancellationOutcome(body.outcome);
  const requiresManager =
    parsedOutcome === undefined ||
    parsedOutcome === "REFUND_DEPOSIT" ||
    parsedOutcome === "CONVERT_TO_CREDIT";

  if (requiresManager) {
    assertRoleAtLeast(req, "MANAGER");
  }

  const result = await cancelWorkshopJobById(req.params.id, {
    outcome: parsedOutcome,
    notes: body.notes,
    refundReason: body.refundReason,
    idempotencyKey: body.idempotencyKey,
  }, getRequestAuditActor(req));

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const assignWorkshopJobHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    staffId?: string | null;
  };

  if (!Object.prototype.hasOwnProperty.call(body, "staffId")) {
    throw new HttpError(400, "staffId is required (string or null)", "INVALID_ASSIGNMENT");
  }
  if (body.staffId !== null && typeof body.staffId !== "string") {
    throw new HttpError(400, "staffId must be a string or null", "INVALID_ASSIGNMENT");
  }

  const result = await assignWorkshopJob(
    req.params.id,
    {
      staffId: body.staffId ?? null,
      actorRole: getRequestStaffRole(req),
      actorId: getRequestStaffActorId(req),
    },
    getRequestAuditActor(req),
  );

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const patchWorkshopJobScheduleHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    staffId?: string | null;
    scheduledStartAt?: string | null;
    scheduledEndAt?: string | null;
    durationMinutes?: number | null;
    clearSchedule?: boolean;
  };

  if (body.staffId !== undefined && body.staffId !== null && typeof body.staffId !== "string") {
    throw new HttpError(400, "staffId must be a string or null", "INVALID_WORKSHOP_SCHEDULE_UPDATE");
  }
  if (
    body.scheduledStartAt !== undefined &&
    body.scheduledStartAt !== null &&
    typeof body.scheduledStartAt !== "string"
  ) {
    throw new HttpError(
      400,
      "scheduledStartAt must be a string or null",
      "INVALID_WORKSHOP_SCHEDULE_UPDATE",
    );
  }
  if (
    body.scheduledEndAt !== undefined &&
    body.scheduledEndAt !== null &&
    typeof body.scheduledEndAt !== "string"
  ) {
    throw new HttpError(
      400,
      "scheduledEndAt must be a string or null",
      "INVALID_WORKSHOP_SCHEDULE_UPDATE",
    );
  }
  if (
    body.durationMinutes !== undefined &&
    body.durationMinutes !== null &&
    typeof body.durationMinutes !== "number"
  ) {
    throw new HttpError(
      400,
      "durationMinutes must be a number or null",
      "INVALID_WORKSHOP_SCHEDULE_UPDATE",
    );
  }

  const result = await updateWorkshopJobSchedule(
    req.params.id,
    {
      staffId: body.staffId,
      scheduledStartAt: body.scheduledStartAt,
      scheduledEndAt: body.scheduledEndAt,
      durationMinutes: body.durationMinutes,
      clearSchedule: parseOptionalBooleanBody(body.clearSchedule, "clearSchedule"),
      actorRole: getRequestStaffRole(req),
      actorId: getRequestStaffActorId(req),
    },
    getRequestAuditActor(req),
  );

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const addWorkshopJobNoteHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    visibility?: string;
    note?: string;
  };

  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_NOTE");
  }
  if (body.visibility !== undefined && typeof body.visibility !== "string") {
    throw new HttpError(400, "visibility must be a string", "INVALID_NOTE");
  }

  const visibility = parseWorkshopNoteVisibility(body.visibility);
  if (visibility === "CUSTOMER") {
    assertRoleAtLeast(req, "MANAGER");
  }

  const result = await addWorkshopJobNote(
    req.params.id,
    {
      note: body.note ?? "",
      visibility,
      authorStaffId: getRequestStaffActorId(req),
    },
    getRequestAuditActor(req),
  );

  res.status(201).json(result);
};

export const getWorkshopJobNotesHandler = async (req: Request, res: Response) => {
  const result = await getWorkshopJobNotes(req.params.id);
  res.json(result);
};

export const getWorkshopJobConversationHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await getWorkshopConversationForJob(req.params.id);
  res.json(result);
};

export const listWorkshopJobAttachmentsHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await listWorkshopAttachmentsForJob(req.params.id);
  res.json(result);
};

export const postWorkshopJobAttachmentHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    filename?: unknown;
    fileDataUrl?: unknown;
    visibility?: unknown;
  };

  if (body.filename !== undefined && typeof body.filename !== "string") {
    throw new HttpError(400, "filename must be a string", "INVALID_WORKSHOP_ATTACHMENT");
  }
  if (body.fileDataUrl !== undefined && typeof body.fileDataUrl !== "string") {
    throw new HttpError(400, "fileDataUrl must be a string", "INVALID_WORKSHOP_ATTACHMENT");
  }
  if (body.visibility !== undefined && typeof body.visibility !== "string") {
    throw new HttpError(400, "visibility must be a string", "INVALID_WORKSHOP_ATTACHMENT");
  }

  const result = await createWorkshopAttachmentForJob(
    req.params.id,
    {
      filename: body.filename,
      fileDataUrl: body.fileDataUrl,
      visibility: body.visibility,
      uploadedByStaffId: getRequestStaffActorId(req) ?? null,
    },
    getRequestAuditActor(req),
  );

  res.status(201).json(result);
};

export const deleteWorkshopJobAttachmentHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await deleteWorkshopAttachmentForJob(
    req.params.id,
    req.params.attachmentId,
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const getWorkshopJobAttachmentFileHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await getWorkshopAttachmentFileForJob(req.params.id, req.params.attachmentId);
  res.type(result.attachment.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${result.attachment.filename.replace(/"/g, "")}"`,
  );
  res.sendFile(result.absolutePath);
};

export const postWorkshopJobConversationMessageHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    body?: unknown;
    channel?: unknown;
  };

  if (body.body !== undefined && typeof body.body !== "string") {
    throw new HttpError(400, "body must be a string", "INVALID_WORKSHOP_MESSAGE");
  }
  if (body.channel !== undefined && typeof body.channel !== "string") {
    throw new HttpError(400, "channel must be a string", "INVALID_WORKSHOP_MESSAGE");
  }

  const result = await postWorkshopConversationMessageForJob(
    req.params.id,
    {
      body: typeof body.body === "string" ? body.body : "",
      channel: typeof body.channel === "string" ? body.channel : undefined,
      authorStaffId: getRequestStaffActorId(req),
    },
    getRequestAuditActor(req),
  );

  res.status(201).json(result);
};

export const changeWorkshopJobStatusHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    status?: string;
  };

  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_STATUS");
  }

  const result = await changeWorkshopJobStatus(
    req.params.id,
    {
      status: body.status ?? "",
    },
    getRequestAuditActor(req),
  );

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const saveWorkshopEstimateHandler = async (req: Request, res: Response) => {
  const result = await saveWorkshopEstimate(req.params.id, {
    actor: getRequestAuditActor(req),
  });

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const setWorkshopJobApprovalStatusHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    status?: string;
  };

  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_APPROVAL_STATUS");
  }

  const result = await setWorkshopJobApprovalStatus(
    req.params.id,
    {
      status: body.status ?? "",
    },
    getRequestAuditActor(req),
  );

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const createWorkshopEstimateCustomerQuoteLinkHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await createWorkshopEstimateCustomerQuoteLink(req.params.id, {
    actor: getRequestAuditActor(req),
  });

  res.status(result.idempotent ? 200 : 201).json(result);
};

export const getPublicWorkshopEstimateQuoteHandler = async (req: Request, res: Response) => {
  const result = await getPublicWorkshopEstimateQuote(req.params.token);
  res.json(result);
};

export const getPublicWorkshopPortalHandler = async (req: Request, res: Response) => {
  const result = await getPublicWorkshopEstimateQuote(req.params.token);
  res.json(result);
};

export const getPublicWorkshopConversationHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await getPublicWorkshopConversation(req.params.token);
  res.json(result);
};

export const listPublicWorkshopAttachmentsHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await listPublicWorkshopAttachments(req.params.token);
  res.json(result);
};

export const getPublicWorkshopAttachmentFileHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await getPublicWorkshopAttachmentFile(req.params.token, req.params.attachmentId);
  res.type(result.attachment.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${result.attachment.filename.replace(/"/g, "")}"`,
  );
  res.sendFile(result.absolutePath);
};

export const postPublicWorkshopConversationReplyHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    body?: unknown;
  };

  if (body.body !== undefined && typeof body.body !== "string") {
    throw new HttpError(400, "body must be a string", "INVALID_WORKSHOP_MESSAGE");
  }

  const result = await postPublicWorkshopConversationReply(req.params.token, {
    body: typeof body.body === "string" ? body.body : "",
  });
  res.status(201).json(result);
};

export const submitPublicWorkshopEstimateQuoteDecisionHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    status?: unknown;
  };

  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_QUOTE_DECISION_STATUS");
  }

  const result = await submitPublicWorkshopEstimateQuoteDecision(req.params.token, {
    status: typeof body.status === "string" ? body.status : "",
  });
  res.status(result.portal.idempotent ? 200 : 201).json(result);
};

export const submitPublicWorkshopPortalDecisionHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    status?: unknown;
  };

  if (body.status !== undefined && typeof body.status !== "string") {
    throw new HttpError(400, "status must be a string", "INVALID_QUOTE_DECISION_STATUS");
  }

  const result = await submitPublicWorkshopEstimateQuoteDecision(req.params.token, {
    status: typeof body.status === "string" ? body.status : "",
  });
  res.status(result.portal.idempotent ? 200 : 201).json(result);
};
