import { Prisma, WorkshopJobLineType, WorkshopServicePricingMode } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import {
  createWorkshopJobLineRecordTx,
  configureWorkshopJobServicePricingTx,
  rebalanceWorkshopJobServicePricingTx,
} from "./workshopService";
import { invalidateCurrentWorkshopEstimateTx } from "./workshopEstimateService";
import {
  assertWorkshopScheduleAllowed,
  resolveWorkshopSchedulePatch,
} from "./workshopCalendarService";

type WorkshopServiceTemplateClient = Prisma.TransactionClient | typeof prisma;

type WorkshopServiceTemplateLineInput = {
  type?: string;
  productId?: string | null;
  variantId?: string | null;
  description?: string;
  qty?: number;
  unitPricePence?: number | null;
  isOptional?: boolean;
  sortOrder?: number;
};

type SaveWorkshopServiceTemplateInput = {
  name?: string;
  description?: string | null;
  category?: string | null;
  defaultDurationMinutes?: number | null;
  pricingMode?: string;
  targetTotalPricePence?: number | null;
  isActive?: boolean;
  lines?: WorkshopServiceTemplateLineInput[];
  actor?: AuditActor;
};

type ApplyWorkshopServiceTemplateInput = {
  templateId?: string;
  selectedOptionalLineIds?: string[];
  actor?: AuditActor;
};

type NormalizedWorkshopServiceTemplateLine = {
  type: WorkshopJobLineType;
  productId: string | null;
  variantId: string | null;
  description: string;
  qty: number;
  unitPricePence: number | null;
  isOptional: boolean;
  sortOrder: number;
};

type TemplateDurationEffect = {
  templateDefaultDurationMinutes: number | null;
  appliedDurationMinutes: number | null;
  durationUpdated: boolean;
  timedScheduleUpdated: boolean;
  reason:
    | "template_has_no_default_duration"
    | "job_duration_already_set"
    | "unscheduled_duration_set"
    | "scheduled_duration_backfilled";
};

const templateLineInclude = Prisma.validator<Prisma.WorkshopServiceTemplateLineInclude>()({
  product: {
    select: {
      id: true,
      name: true,
    },
  },
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
      retailPricePence: true,
    },
  },
});

type WorkshopServiceTemplateLineRecord = Prisma.WorkshopServiceTemplateLineGetPayload<{
  include: typeof templateLineInclude;
}>;

type WorkshopServiceTemplateRecord = Prisma.WorkshopServiceTemplateGetPayload<{
  include: {
    lines: {
      include: typeof templateLineInclude;
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }];
    };
  };
}>;

const normalizeOptionalText = (value: string | undefined | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeNullableText = (value: string | undefined | null) =>
  normalizeOptionalText(value) ?? null;

const normalizeTemplateId = (value: string | undefined, field = "template id") => {
  const normalized = normalizeOptionalText(value);
  if (!normalized || !isUuid(normalized)) {
    throw new HttpError(400, `Invalid ${field}`, "INVALID_WORKSHOP_SERVICE_TEMPLATE_ID");
  }
  return normalized;
};

const parseTemplateLineType = (value: string | undefined) => {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "LABOUR" || normalized === "PART") {
    return normalized as WorkshopJobLineType;
  }
  throw new HttpError(
    400,
    "template line type must be LABOUR or PART",
    "INVALID_WORKSHOP_SERVICE_TEMPLATE_LINE",
  );
};

const parseOptionalPrice = (value: number | null | undefined) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(
      400,
      "unitPricePence must be a non-negative integer or null",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }
  return value;
};

const parseOptionalDuration = (value: number | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(
      400,
      "defaultDurationMinutes must be a positive integer or null",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }
  return value;
};

const parsePricingMode = (value: string | undefined) => {
  const normalized = value?.trim().toUpperCase();
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized === "STANDARD_SERVICE" || normalized === "FIXED_PRICE_SERVICE") {
    return normalized as WorkshopServicePricingMode;
  }
  throw new HttpError(
    400,
    "pricingMode must be STANDARD_SERVICE or FIXED_PRICE_SERVICE",
    "INVALID_WORKSHOP_SERVICE_TEMPLATE",
  );
};

const parseOptionalTargetTotal = (value: number | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(
      400,
      "targetTotalPricePence must be a positive integer or null",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }
  return value;
};

const parseOptionalLineIds = (value: string[] | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HttpError(
      400,
      "selectedOptionalLineIds must be an array of ids",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE_APPLY",
    );
  }

  return value.map((lineId) => {
    const normalized = normalizeOptionalText(lineId);
    if (!normalized || !isUuid(normalized)) {
      throw new HttpError(
        400,
        "selectedOptionalLineIds must contain valid ids",
        "INVALID_WORKSHOP_SERVICE_TEMPLATE_APPLY",
      );
    }
    return normalized;
  });
};

const buildTemplateLineDescription = (
  input: { description?: string; type: WorkshopJobLineType },
  linkedPart: { productName: string; variantLabel: string } | null,
) => {
  const explicit = normalizeOptionalText(input.description);
  if (explicit) {
    return explicit;
  }

  if (linkedPart) {
    return [linkedPart.productName, linkedPart.variantLabel].filter(Boolean).join(" - ");
  }

  throw new HttpError(
    400,
    `${input.type} template lines require description`,
    "INVALID_WORKSHOP_SERVICE_TEMPLATE_LINE",
  );
};

const ensureTemplatePartLinkTx = async (
  tx: WorkshopServiceTemplateClient,
  input: {
    productId?: string | null;
    variantId?: string | null;
  },
) => {
  const normalizedProductId = normalizeOptionalText(input.productId ?? undefined) ?? null;
  const normalizedVariantId = normalizeOptionalText(input.variantId ?? undefined) ?? null;

  if (!normalizedProductId && !normalizedVariantId) {
    return null;
  }

  if (!normalizedProductId || !normalizedVariantId) {
    throw new HttpError(
      400,
      "PART template lines must provide both productId and variantId when linked to inventory",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE_LINE",
    );
  }

  const variant = await tx.variant.findUnique({
    where: { id: normalizedVariantId },
    select: {
      id: true,
      productId: true,
      sku: true,
      name: true,
      retailPricePence: true,
      product: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!variant || variant.productId !== normalizedProductId) {
    throw new HttpError(
      404,
      "Linked part variant was not found for this product",
      "WORKSHOP_SERVICE_TEMPLATE_VARIANT_NOT_FOUND",
    );
  }

  return {
    productId: variant.product.id,
    variantId: variant.id,
    productName: variant.product.name,
    variantLabel: variant.name ?? variant.sku,
    retailPricePence: variant.retailPricePence,
  };
};

const normalizeTemplateLinesInput = async (
  tx: WorkshopServiceTemplateClient,
  lines: WorkshopServiceTemplateLineInput[],
): Promise<NormalizedWorkshopServiceTemplateLine[]> => {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(
      400,
      "templates must include at least one line",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }

  return Promise.all(
    lines.map(async (line, index) => {
      const type = parseTemplateLineType(line.type);
      if (!Number.isInteger(line.qty) || (line.qty ?? 0) <= 0) {
        throw new HttpError(
          400,
          "template line qty must be a positive integer",
          "INVALID_WORKSHOP_SERVICE_TEMPLATE_LINE",
        );
      }

      const isOptional = line.isOptional === true;
      if (type === "LABOUR" && isOptional) {
        throw new HttpError(
          400,
          "LABOUR template lines cannot be optional",
          "INVALID_WORKSHOP_SERVICE_TEMPLATE_LINE",
        );
      }

      const linkedPart = type === "PART"
        ? await ensureTemplatePartLinkTx(tx, {
            productId: line.productId,
            variantId: line.variantId,
          })
        : null;

      if (type === "LABOUR" && (line.productId !== undefined || line.variantId !== undefined)) {
        throw new HttpError(
          400,
          "LABOUR template lines cannot link inventory items",
          "INVALID_WORKSHOP_SERVICE_TEMPLATE_LINE",
        );
      }

      const description = buildTemplateLineDescription({ description: line.description, type }, linkedPart);
      const sortOrder =
        Number.isInteger(line.sortOrder) && (line.sortOrder ?? -1) >= 0
          ? (line.sortOrder as number)
          : index;

      return {
        type,
        productId: linkedPart?.productId ?? null,
        variantId: linkedPart?.variantId ?? null,
        description,
        qty: line.qty as number,
        unitPricePence: parseOptionalPrice(line.unitPricePence),
        isOptional,
        sortOrder,
      };
    }),
  );
};

const assertTemplatePricingConfiguration = (input: {
  pricingMode: WorkshopServicePricingMode;
  targetTotalPricePence: number | null;
  lines: NormalizedWorkshopServiceTemplateLine[];
}) => {
  if (input.pricingMode === "STANDARD_SERVICE") {
    if (input.targetTotalPricePence !== null) {
      throw new HttpError(
        400,
        "STANDARD_SERVICE templates cannot set targetTotalPricePence",
        "INVALID_WORKSHOP_SERVICE_TEMPLATE",
      );
    }
    return;
  }

  if (input.targetTotalPricePence === null) {
    throw new HttpError(
      400,
      "FIXED_PRICE_SERVICE templates require targetTotalPricePence",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }

  const labourLines = input.lines.filter((line) => line.type === "LABOUR");
  if (labourLines.length !== 1) {
    throw new HttpError(
      400,
      "FIXED_PRICE_SERVICE templates must include exactly one labour line",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }

  if (labourLines[0].isOptional) {
    throw new HttpError(
      400,
      "The fixed-price labour line cannot be optional",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }

  if (labourLines[0].qty !== 1) {
    throw new HttpError(
      400,
      "FIXED_PRICE_SERVICE templates require the labour line qty to be 1",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }
};

const resolveTemplateLineUnitPrice = (line: WorkshopServiceTemplateLineRecord) =>
  line.unitPricePence ?? line.variant?.retailPricePence ?? 0;

const toTemplateLineResponse = (line: WorkshopServiceTemplateLineRecord) => {
  const resolvedUnitPricePence = resolveTemplateLineUnitPrice(line);
  return {
    id: line.id,
    templateId: line.templateId,
    type: line.type,
    productId: line.productId,
    productName: line.product?.name ?? null,
    variantId: line.variantId,
    variantSku: line.variant?.sku ?? null,
    variantName: line.variant?.name ?? null,
    description: line.description,
    qty: line.qty,
    unitPricePence: line.unitPricePence,
    resolvedUnitPricePence,
    lineTotalPence: resolvedUnitPricePence * line.qty,
    isOptional: line.isOptional,
    sortOrder: line.sortOrder,
    hasInventoryLink: Boolean(line.productId && line.variantId),
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
};

const toTemplateResponse = (template: WorkshopServiceTemplateRecord) => ({
  id: template.id,
  name: template.name,
  description: template.description,
  category: template.category,
  defaultDurationMinutes: template.defaultDurationMinutes,
  pricingMode: template.pricingMode,
  targetTotalPricePence: template.targetTotalPricePence,
  isActive: template.isActive,
  lineCount: template.lines.length,
  lines: template.lines.map(toTemplateLineResponse),
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

const getTemplateInclude = () =>
  ({
    lines: {
      include: templateLineInclude,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    },
  } satisfies Prisma.WorkshopServiceTemplateInclude);

const getTemplateByIdTx = async (
  tx: WorkshopServiceTemplateClient,
  templateId: string,
) => {
  const template = await tx.workshopServiceTemplate.findUnique({
    where: { id: templateId },
    include: getTemplateInclude(),
  });

  if (!template) {
    throw new HttpError(
      404,
      "Workshop service template not found",
      "WORKSHOP_SERVICE_TEMPLATE_NOT_FOUND",
    );
  }

  return template;
};

const applyTemplateDefaultDurationTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
  defaultDurationMinutes: number | null,
): Promise<TemplateDurationEffect> => {
  if (!defaultDurationMinutes) {
    return {
      templateDefaultDurationMinutes: null,
      appliedDurationMinutes: null,
      durationUpdated: false,
      timedScheduleUpdated: false,
      reason: "template_has_no_default_duration",
    };
  }

  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      assignedStaffId: true,
      scheduledDate: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      durationMinutes: true,
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  if (job.durationMinutes) {
    return {
      templateDefaultDurationMinutes: defaultDurationMinutes,
      appliedDurationMinutes: job.durationMinutes,
      durationUpdated: false,
      timedScheduleUpdated: false,
      reason: "job_duration_already_set",
    };
  }

  if (!job.scheduledStartAt && !job.scheduledEndAt) {
    await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        durationMinutes: defaultDurationMinutes,
      },
    });

    return {
      templateDefaultDurationMinutes: defaultDurationMinutes,
      appliedDurationMinutes: defaultDurationMinutes,
      durationUpdated: true,
      timedScheduleUpdated: false,
      reason: "unscheduled_duration_set",
    };
  }

  const scheduleResolution = await resolveWorkshopSchedulePatch(
    {
      durationMinutes: defaultDurationMinutes,
    },
    {
      scheduledDate: job.scheduledDate,
      scheduledStartAt: job.scheduledStartAt,
      scheduledEndAt: job.scheduledEndAt,
      durationMinutes: job.durationMinutes,
    },
    tx,
  );

  await assertWorkshopScheduleAllowed(
    {
      workshopJobId,
      staffId: job.assignedStaffId,
      scheduledStartAt: scheduleResolution.schedule.scheduledStartAt,
      scheduledEndAt: scheduleResolution.schedule.scheduledEndAt,
      durationMinutes: scheduleResolution.schedule.durationMinutes,
    },
    tx,
  );

  await tx.workshopJob.update({
    where: { id: workshopJobId },
    data: {
      scheduledDate: scheduleResolution.schedule.scheduledDate,
      scheduledStartAt: scheduleResolution.schedule.scheduledStartAt,
      scheduledEndAt: scheduleResolution.schedule.scheduledEndAt,
      durationMinutes: scheduleResolution.schedule.durationMinutes,
    },
  });

  return {
    templateDefaultDurationMinutes: defaultDurationMinutes,
    appliedDurationMinutes: scheduleResolution.schedule.durationMinutes,
    durationUpdated: true,
    timedScheduleUpdated: true,
    reason: "scheduled_duration_backfilled",
  };
};

export const listWorkshopServiceTemplates = async (input?: {
  includeInactive?: boolean;
}) => {
  const includeInactive = input?.includeInactive === true;
  const templates = await prisma.workshopServiceTemplate.findMany({
    where: includeInactive ? undefined : { isActive: true },
    include: getTemplateInclude(),
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return {
    templates: templates.map(toTemplateResponse),
  };
};

export const getWorkshopServiceTemplateById = async (
  templateId: string,
  input?: { includeInactive?: boolean },
) => {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const template = await prisma.workshopServiceTemplate.findUnique({
    where: { id: normalizedTemplateId },
    include: getTemplateInclude(),
  });

  if (!template || (!input?.includeInactive && !template.isActive)) {
    throw new HttpError(
      404,
      "Workshop service template not found",
      "WORKSHOP_SERVICE_TEMPLATE_NOT_FOUND",
    );
  }

  return {
    template: toTemplateResponse(template),
  };
};

export const createWorkshopServiceTemplate = async (
  input: SaveWorkshopServiceTemplateInput,
) => {
  const name = normalizeOptionalText(input.name);
  if (!name) {
    throw new HttpError(400, "name is required", "INVALID_WORKSHOP_SERVICE_TEMPLATE");
  }

  const description = normalizeNullableText(input.description);
  const category = normalizeNullableText(input.category);
  const defaultDurationMinutes = parseOptionalDuration(input.defaultDurationMinutes);
  const pricingMode = parsePricingMode(input.pricingMode) ?? "STANDARD_SERVICE";
  const targetTotalPricePence = parseOptionalTargetTotal(input.targetTotalPricePence) ?? null;
  const isActive = input.isActive ?? true;
  const lines = await normalizeTemplateLinesInput(prisma, input.lines ?? []);
  assertTemplatePricingConfiguration({
    pricingMode,
    targetTotalPricePence,
    lines,
  });

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.workshopServiceTemplate.create({
      data: {
        name,
        description,
        category,
        defaultDurationMinutes: defaultDurationMinutes ?? null,
        pricingMode,
        targetTotalPricePence,
        isActive,
        lines: {
          create: lines,
        },
      },
      include: getTemplateInclude(),
    });

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_SERVICE_TEMPLATE_CREATED",
        entityType: "WORKSHOP_SERVICE_TEMPLATE",
        entityId: created.id,
        metadata: {
          name: created.name,
          lineCount: created.lines.length,
          pricingMode: created.pricingMode,
          targetTotalPricePence: created.targetTotalPricePence,
          isActive: created.isActive,
        },
      },
      input.actor,
    );

    return created;
  });

  return {
    template: toTemplateResponse(template),
  };
};

export const updateWorkshopServiceTemplate = async (
  templateId: string,
  input: SaveWorkshopServiceTemplateInput,
) => {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "name") ||
    Object.prototype.hasOwnProperty.call(input, "description") ||
    Object.prototype.hasOwnProperty.call(input, "category") ||
    Object.prototype.hasOwnProperty.call(input, "defaultDurationMinutes") ||
    Object.prototype.hasOwnProperty.call(input, "isActive") ||
    Object.prototype.hasOwnProperty.call(input, "lines");

  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_WORKSHOP_SERVICE_TEMPLATE_UPDATE");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await getTemplateByIdTx(tx, normalizedTemplateId);
    const data: Prisma.WorkshopServiceTemplateUpdateInput = {};
    let nextPricingMode = existing.pricingMode;
    let nextTargetTotalPricePence = existing.targetTotalPricePence;

    if (Object.prototype.hasOwnProperty.call(input, "name")) {
      const name = normalizeOptionalText(input.name);
      if (!name) {
        throw new HttpError(400, "name cannot be empty", "INVALID_WORKSHOP_SERVICE_TEMPLATE_UPDATE");
      }
      data.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(input, "description")) {
      data.description = normalizeNullableText(input.description);
    }

    if (Object.prototype.hasOwnProperty.call(input, "category")) {
      data.category = normalizeNullableText(input.category);
    }

    if (Object.prototype.hasOwnProperty.call(input, "defaultDurationMinutes")) {
      data.defaultDurationMinutes = parseOptionalDuration(input.defaultDurationMinutes) ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "pricingMode")) {
      nextPricingMode = parsePricingMode(input.pricingMode) ?? "STANDARD_SERVICE";
      data.pricingMode = nextPricingMode;
      if (
        nextPricingMode === "STANDARD_SERVICE"
        && !Object.prototype.hasOwnProperty.call(input, "targetTotalPricePence")
      ) {
        nextTargetTotalPricePence = null;
        data.targetTotalPricePence = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, "targetTotalPricePence")) {
      nextTargetTotalPricePence = parseOptionalTargetTotal(input.targetTotalPricePence) ?? null;
      data.targetTotalPricePence = nextTargetTotalPricePence;
    }

    if (Object.prototype.hasOwnProperty.call(input, "isActive")) {
      if (typeof input.isActive !== "boolean") {
        throw new HttpError(
          400,
          "isActive must be a boolean",
          "INVALID_WORKSHOP_SERVICE_TEMPLATE_UPDATE",
        );
      }
      data.isActive = input.isActive;
    }

    const normalizedLines = Object.prototype.hasOwnProperty.call(input, "lines")
      ? await normalizeTemplateLinesInput(tx, input.lines ?? [])
      : null;

    if (normalizedLines) {
      assertTemplatePricingConfiguration({
        pricingMode: nextPricingMode,
        targetTotalPricePence: nextTargetTotalPricePence,
        lines: normalizedLines,
      });
      data.lines = {
        deleteMany: {},
        create: normalizedLines,
      };
    } else if (
      Object.prototype.hasOwnProperty.call(input, "pricingMode")
      || Object.prototype.hasOwnProperty.call(input, "targetTotalPricePence")
    ) {
      assertTemplatePricingConfiguration({
        pricingMode: nextPricingMode,
        targetTotalPricePence: nextTargetTotalPricePence,
        lines: existing.lines.map((line) => ({
          type: line.type,
          productId: line.productId,
          variantId: line.variantId,
          description: line.description,
          qty: line.qty,
          unitPricePence: line.unitPricePence,
          isOptional: line.isOptional,
          sortOrder: line.sortOrder,
        })),
      });
    }

    const updated = await tx.workshopServiceTemplate.update({
      where: { id: normalizedTemplateId },
      data,
      include: getTemplateInclude(),
    });

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_SERVICE_TEMPLATE_UPDATED",
        entityType: "WORKSHOP_SERVICE_TEMPLATE",
        entityId: updated.id,
        metadata: {
          previousName: existing.name,
          nextName: updated.name,
          lineCount: updated.lines.length,
          pricingMode: updated.pricingMode,
          targetTotalPricePence: updated.targetTotalPricePence,
          isActive: updated.isActive,
          replacedLines: Boolean(normalizedLines),
        },
      },
      input.actor,
    );

    return {
      template: toTemplateResponse(updated),
    };
  });
};

export const deleteWorkshopServiceTemplate = async (
  templateId: string,
  actor?: AuditActor,
) => {
  const normalizedTemplateId = normalizeTemplateId(templateId);

  return prisma.$transaction(async (tx) => {
    const existing = await getTemplateByIdTx(tx, normalizedTemplateId);
    await tx.workshopServiceTemplate.delete({
      where: { id: normalizedTemplateId },
    });

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_SERVICE_TEMPLATE_DELETED",
        entityType: "WORKSHOP_SERVICE_TEMPLATE",
        entityId: normalizedTemplateId,
        metadata: {
          name: existing.name,
          lineCount: existing.lines.length,
        },
      },
      actor,
    );

    return { ok: true };
  });
};

export const applyWorkshopServiceTemplateToJob = async (
  workshopJobId: string,
  input: ApplyWorkshopServiceTemplateInput,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const templateId = normalizeTemplateId(input.templateId, "service template id");
  const selectedOptionalLineIds = parseOptionalLineIds(input.selectedOptionalLineIds);

  return prisma.$transaction(async (tx) => {
    const template = await getTemplateByIdTx(tx, templateId);
    if (!template.isActive) {
      throw new HttpError(
        409,
        "Inactive templates cannot be applied",
        "WORKSHOP_SERVICE_TEMPLATE_INACTIVE",
      );
    }

    const optionalLineIds = template.lines.filter((line) => line.isOptional).map((line) => line.id);
    const selectedOptionalLineSet = new Set(selectedOptionalLineIds ?? optionalLineIds);

    for (const requestedLineId of selectedOptionalLineSet) {
      if (!optionalLineIds.includes(requestedLineId)) {
        throw new HttpError(
          400,
          "selectedOptionalLineIds must reference optional template lines on this template",
          "INVALID_WORKSHOP_SERVICE_TEMPLATE_APPLY",
        );
      }
    }

    const linesToApply = template.lines.filter(
      (line) => !line.isOptional || selectedOptionalLineSet.has(line.id),
    );

    if (linesToApply.length === 0) {
      throw new HttpError(
        400,
        "Select at least one template line to apply",
        "INVALID_WORKSHOP_SERVICE_TEMPLATE_APPLY",
      );
    }

    const createdLines = [];
    let pricingAdjustmentLineId: string | null = null;
    for (const line of linesToApply) {
      const createdLine = await createWorkshopJobLineRecordTx(tx, workshopJobId, {
        type: line.type,
        productId: line.productId,
        variantId: line.variantId,
        description: line.description,
        qty: line.qty,
        unitPricePence: resolveTemplateLineUnitPrice(line),
      });
      if (
        template.pricingMode === "FIXED_PRICE_SERVICE"
        && !pricingAdjustmentLineId
        && createdLine.type === "LABOUR"
      ) {
        pricingAdjustmentLineId = createdLine.id;
      }
      createdLines.push(createdLine);
    }

    if (template.pricingMode === "FIXED_PRICE_SERVICE") {
      if (!pricingAdjustmentLineId || !template.targetTotalPricePence) {
        throw new HttpError(
          409,
          "Fixed-price service templates require a balancing labour line and target total",
          "WORKSHOP_SERVICE_TEMPLATE_FIXED_PRICE_INVALID",
        );
      }

      await configureWorkshopJobServicePricingTx(tx, workshopJobId, {
        pricingMode: "FIXED_PRICE_SERVICE",
        targetTotalPence: template.targetTotalPricePence,
        adjustmentLineId: pricingAdjustmentLineId,
      });
      await rebalanceWorkshopJobServicePricingTx(tx, workshopJobId);
    }

    const durationEffect = await applyTemplateDefaultDurationTx(
      tx,
      workshopJobId,
      template.defaultDurationMinutes ?? null,
    );

    await invalidateCurrentWorkshopEstimateTx(
      tx,
      workshopJobId,
      `Workshop service template applied: ${template.name}`,
    );

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_SERVICE_TEMPLATE_APPLIED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          templateId: template.id,
          templateName: template.name,
          lineCountApplied: createdLines.length,
          selectedOptionalLineIds: Array.from(selectedOptionalLineSet),
          pricingMode: template.pricingMode,
          targetTotalPricePence: template.targetTotalPricePence,
          pricingAdjustmentLineId,
          templateDefaultDurationMinutes: durationEffect.templateDefaultDurationMinutes,
          appliedDurationMinutes: durationEffect.appliedDurationMinutes,
          durationUpdated: durationEffect.durationUpdated,
          timedScheduleUpdated: durationEffect.timedScheduleUpdated,
          durationUpdateReason: durationEffect.reason,
        },
      },
      input.actor,
    );

    const persistedLines = await tx.workshopJobLine.findMany({
      where: {
        id: {
          in: createdLines.map((line) => line.id),
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
          },
        },
        variant: {
          select: {
            id: true,
            sku: true,
            name: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    return {
      jobId: workshopJobId,
      template: toTemplateResponse(template),
      appliedLineCount: createdLines.length,
      durationEffect,
      pricingEffect: {
        pricingMode: template.pricingMode,
        targetTotalPricePence: template.targetTotalPricePence,
        fixedPriceActivated: template.pricingMode === "FIXED_PRICE_SERVICE",
        adjustmentLineId: pricingAdjustmentLineId,
      },
      lines: persistedLines.map((line) => ({
        id: line.id,
        type: line.type,
        productId: line.productId,
        productName: line.product?.name ?? null,
        variantId: line.variantId,
        variantSku: line.variant?.sku ?? null,
        variantName: line.variant?.name ?? null,
        description: line.description,
        qty: line.qty,
        unitPricePence: line.unitPricePence,
        lineTotalPence: line.qty * line.unitPricePence,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
      })),
    };
  });
};
