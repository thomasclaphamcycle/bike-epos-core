import { Request, Response } from "express";
import {
  assertRoleAtLeast,
  getRequestAuditActor,
} from "../middleware/staffRole";
import {
  applyWorkshopServiceTemplateToJob,
  createWorkshopServiceTemplate,
  deleteWorkshopServiceTemplate,
  getWorkshopServiceTemplateById,
  listWorkshopServiceTemplates,
  updateWorkshopServiceTemplate,
} from "../services/workshopServiceTemplateService";
import { HttpError } from "../utils/http";

const parseOptionalBooleanQuery = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new HttpError(400, `${field} must be true or false`, "INVALID_FILTER");
};

const parseTemplateLines = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new HttpError(
      400,
      "lines must be an array",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE",
    );
  }

  return value.map((line) => {
    if (!line || typeof line !== "object") {
      throw new HttpError(
        400,
        "each template line must be an object",
        "INVALID_WORKSHOP_SERVICE_TEMPLATE_LINE",
      );
    }

    const body = line as Record<string, unknown>;
    return {
      type: typeof body.type === "string" ? body.type : undefined,
      productId:
        body.productId === null || typeof body.productId === "string"
          ? (body.productId as string | null | undefined)
          : undefined,
      variantId:
        body.variantId === null || typeof body.variantId === "string"
          ? (body.variantId as string | null | undefined)
          : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      qty: typeof body.qty === "number" ? body.qty : undefined,
      unitPricePence:
        body.unitPricePence === null || typeof body.unitPricePence === "number"
          ? (body.unitPricePence as number | null | undefined)
          : undefined,
      isOptional: typeof body.isOptional === "boolean" ? body.isOptional : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
    };
  });
};

const hasOwn = (body: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(body, key);

const parseTemplateSaveBody = (body: Record<string, unknown>) => {
  const parsed: {
    name?: string;
    description?: string | null;
    category?: string | null;
    defaultDurationMinutes?: number | null;
    pricingMode?: string;
    targetTotalPricePence?: number | null;
    isActive?: boolean;
    lines?: ReturnType<typeof parseTemplateLines>;
  } = {};

  if (hasOwn(body, "name")) {
    parsed.name = typeof body.name === "string" ? body.name : undefined;
  }

  if (hasOwn(body, "description")) {
    parsed.description =
      body.description === null || typeof body.description === "string"
        ? (body.description as string | null | undefined)
        : undefined;
  }

  if (hasOwn(body, "category")) {
    parsed.category =
      body.category === null || typeof body.category === "string"
        ? (body.category as string | null | undefined)
        : undefined;
  }

  if (hasOwn(body, "defaultDurationMinutes")) {
    parsed.defaultDurationMinutes =
      body.defaultDurationMinutes === null || typeof body.defaultDurationMinutes === "number"
        ? (body.defaultDurationMinutes as number | null | undefined)
        : undefined;
  }

  if (hasOwn(body, "pricingMode")) {
    parsed.pricingMode = typeof body.pricingMode === "string" ? body.pricingMode : undefined;
  }

  if (hasOwn(body, "targetTotalPricePence")) {
    parsed.targetTotalPricePence =
      body.targetTotalPricePence === null || typeof body.targetTotalPricePence === "number"
        ? (body.targetTotalPricePence as number | null | undefined)
        : undefined;
  }

  if (hasOwn(body, "isActive")) {
    parsed.isActive = typeof body.isActive === "boolean" ? body.isActive : undefined;
  }

  if (hasOwn(body, "lines")) {
    parsed.lines = body.lines === undefined ? undefined : parseTemplateLines(body.lines);
  }

  return parsed;
};

export const listWorkshopServiceTemplatesHandler = async (req: Request, res: Response) => {
  const includeInactive = parseOptionalBooleanQuery(req.query.includeInactive, "includeInactive");
  if (includeInactive) {
    assertRoleAtLeast(req, "MANAGER");
  }

  const result = await listWorkshopServiceTemplates({
    includeInactive,
  });
  res.json(result);
};

export const getWorkshopServiceTemplateHandler = async (req: Request, res: Response) => {
  const includeInactive = parseOptionalBooleanQuery(req.query.includeInactive, "includeInactive");
  if (includeInactive) {
    assertRoleAtLeast(req, "MANAGER");
  }

  const result = await getWorkshopServiceTemplateById(req.params.id, {
    includeInactive,
  });
  res.json(result);
};

export const createWorkshopServiceTemplateHandler = async (req: Request, res: Response) => {
  const result = await createWorkshopServiceTemplate({
    ...parseTemplateSaveBody((req.body ?? {}) as Record<string, unknown>),
    actor: getRequestAuditActor(req),
  });
  res.status(201).json(result);
};

export const patchWorkshopServiceTemplateHandler = async (req: Request, res: Response) => {
  const result = await updateWorkshopServiceTemplate(
    req.params.id,
    {
      ...parseTemplateSaveBody((req.body ?? {}) as Record<string, unknown>),
      actor: getRequestAuditActor(req),
    },
  );
  res.json(result);
};

export const deleteWorkshopServiceTemplateHandler = async (req: Request, res: Response) => {
  const result = await deleteWorkshopServiceTemplate(req.params.id, getRequestAuditActor(req));
  res.json(result);
};

export const applyWorkshopServiceTemplateHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    templateId?: unknown;
    selectedOptionalLineIds?: unknown;
  };

  if (body.templateId !== undefined && typeof body.templateId !== "string") {
    throw new HttpError(
      400,
      "templateId must be a string",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE_APPLY",
    );
  }
  if (body.selectedOptionalLineIds !== undefined && !Array.isArray(body.selectedOptionalLineIds)) {
    throw new HttpError(
      400,
      "selectedOptionalLineIds must be an array",
      "INVALID_WORKSHOP_SERVICE_TEMPLATE_APPLY",
    );
  }

  const result = await applyWorkshopServiceTemplateToJob(req.params.id, {
    templateId: body.templateId,
    selectedOptionalLineIds: (body.selectedOptionalLineIds as string[] | undefined),
    actor: getRequestAuditActor(req),
  });

  res.status(201).json(result);
};
