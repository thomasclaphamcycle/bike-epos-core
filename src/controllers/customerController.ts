import { Request, Response } from "express";
import {
  createCustomer,
  getCustomerById,
  getCustomerTimeline,
  listCustomerSales,
  listCustomerWorkshopJobs,
  searchCustomers,
  updateCustomerCommunicationPreferences,
} from "../services/customerService";
import {
  createCustomerBike,
  getCustomerBikeHistory,
  getCustomerBikeWorkshopStartContext,
  listCustomerBikes,
  updateCustomerBike,
} from "../services/customerBikeService";
import {
  createBikeServiceSchedule,
  listBikeServiceSchedules,
  markBikeServiceScheduleServiced,
  updateBikeServiceSchedule,
} from "../services/bikeServiceScheduleService";
import { HttpError } from "../utils/http";

const assertOptionalBikeString = (
  value: unknown,
  field: string,
  code: string,
) => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, code);
  }
};

const assertOptionalBikeYear = (value: unknown, code: string) => {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || typeof value !== "number")) {
    throw new HttpError(400, "year must be an integer", code);
  }
};

const assertOptionalBikeScheduleInteger = (
  value: unknown,
  field: string,
  code: string,
) => {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || typeof value !== "number")) {
    throw new HttpError(400, `${field} must be an integer`, code);
  }
};

const assertOptionalBikeScheduleBoolean = (
  value: unknown,
  field: string,
  code: string,
) => {
  if (value !== undefined && value !== null && typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, code);
  }
};

const assertOptionalBikeScheduleDateString = (
  value: unknown,
  field: string,
  code: string,
) => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new HttpError(400, `${field} must be a date string`, code);
  }
};

export const createCustomerHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    phone?: unknown;
    notes?: unknown;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_CUSTOMER");
  }
  if (body.firstName !== undefined && typeof body.firstName !== "string") {
    throw new HttpError(400, "firstName must be a string", "INVALID_CUSTOMER");
  }
  if (body.lastName !== undefined && typeof body.lastName !== "string") {
    throw new HttpError(400, "lastName must be a string", "INVALID_CUSTOMER");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_CUSTOMER");
  }
  if (body.phone !== undefined && typeof body.phone !== "string") {
    throw new HttpError(400, "phone must be a string", "INVALID_CUSTOMER");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_CUSTOMER");
  }

  const customer = await createCustomer({
    name: body.name,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    notes: body.notes,
  });
  res.status(201).json(customer);
};

export const getCustomerHandler = async (req: Request, res: Response) => {
  const customer = await getCustomerById(req.params.id);
  res.json(customer);
};

export const updateCustomerCommunicationPreferencesHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    emailAllowed?: unknown;
    smsAllowed?: unknown;
    whatsappAllowed?: unknown;
  };

  if (typeof body.emailAllowed !== "boolean") {
    throw new HttpError(
      400,
      "emailAllowed must be a boolean",
      "INVALID_CUSTOMER_COMMUNICATION_PREFERENCES",
    );
  }
  if (typeof body.smsAllowed !== "boolean") {
    throw new HttpError(
      400,
      "smsAllowed must be a boolean",
      "INVALID_CUSTOMER_COMMUNICATION_PREFERENCES",
    );
  }
  if (typeof body.whatsappAllowed !== "boolean") {
    throw new HttpError(
      400,
      "whatsappAllowed must be a boolean",
      "INVALID_CUSTOMER_COMMUNICATION_PREFERENCES",
    );
  }

  const customer = await updateCustomerCommunicationPreferences(req.params.id, {
    emailAllowed: body.emailAllowed,
    smsAllowed: body.smsAllowed,
    whatsappAllowed: body.whatsappAllowed,
  });
  res.json(customer);
};

const parseSearchTake = (value: unknown) => {
  if (value === undefined) {
    return 20;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "take must be an integer", "INVALID_CUSTOMER_SEARCH");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpError(
      400,
      "take must be an integer between 1 and 100",
      "INVALID_CUSTOMER_SEARCH",
    );
  }
  return parsed;
};

const parseOptionalFilterTake = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "take must be an integer", "INVALID_CUSTOMER_FILTER");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new HttpError(
      400,
      "take must be an integer between 1 and 200",
      "INVALID_CUSTOMER_FILTER",
    );
  }

  return parsed;
};

export const searchCustomersHandler = async (req: Request, res: Response) => {
  const query =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const take = parseSearchTake(req.query.take);
  const result = await searchCustomers(query, take);
  res.json(result);
};

export const listCustomersHandler = async (req: Request, res: Response) => {
  const query =
    typeof req.query.q === "string"
      ? req.query.q
      : typeof req.query.query === "string"
        ? req.query.query
        : undefined;
  const take = parseSearchTake(req.query.take);
  const result = await searchCustomers(query, take);
  res.json(result);
};

export const listCustomerSalesHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const take = parseOptionalFilterTake(req.query.take);
  const result = await listCustomerSales({
    customerId: req.params.id,
    from,
    to,
    take,
  });
  res.json(result);
};

export const listCustomerWorkshopJobsHandler = async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const take = parseOptionalFilterTake(req.query.take);
  const result = await listCustomerWorkshopJobs({
    customerId: req.params.id,
    from,
    to,
    take,
  });
  res.json(result);
};

export const listCustomerBikesHandler = async (req: Request, res: Response) => {
  const result = await listCustomerBikes(req.params.id);
  res.json(result);
};

export const getCustomerBikeHistoryHandler = async (req: Request, res: Response) => {
  const result = await getCustomerBikeHistory(req.params.bikeId);
  res.json(result);
};

export const getCustomerBikeWorkshopStartContextHandler = async (
  req: Request,
  res: Response,
) => {
  const result = await getCustomerBikeWorkshopStartContext(req.params.bikeId);
  res.json(result);
};

export const createCustomerBikeHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    label?: unknown;
    make?: unknown;
    model?: unknown;
    year?: unknown;
    bikeType?: unknown;
    colour?: unknown;
    wheelSize?: unknown;
    frameSize?: unknown;
    groupset?: unknown;
    motorBrand?: unknown;
    motorModel?: unknown;
    batterySerial?: unknown;
    frameNumber?: unknown;
    serialNumber?: unknown;
    registrationNumber?: unknown;
    notes?: unknown;
  };

  assertOptionalBikeString(body.label, "label", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.make, "make", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.model, "model", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeYear(body.year, "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.bikeType, "bikeType", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.colour, "colour", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.wheelSize, "wheelSize", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.frameSize, "frameSize", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.groupset, "groupset", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.motorBrand, "motorBrand", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.motorModel, "motorModel", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.batterySerial, "batterySerial", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.frameNumber, "frameNumber", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.serialNumber, "serialNumber", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.registrationNumber, "registrationNumber", "INVALID_CUSTOMER_BIKE");
  assertOptionalBikeString(body.notes, "notes", "INVALID_CUSTOMER_BIKE");

  const result = await createCustomerBike(req.params.id, {
    label: body.label as string | null | undefined,
    make: body.make as string | null | undefined,
    model: body.model as string | null | undefined,
    year: body.year as number | null | undefined,
    bikeType: body.bikeType as string | null | undefined,
    colour: body.colour as string | null | undefined,
    wheelSize: body.wheelSize as string | null | undefined,
    frameSize: body.frameSize as string | null | undefined,
    groupset: body.groupset as string | null | undefined,
    motorBrand: body.motorBrand as string | null | undefined,
    motorModel: body.motorModel as string | null | undefined,
    batterySerial: body.batterySerial as string | null | undefined,
    frameNumber: body.frameNumber as string | null | undefined,
    serialNumber: body.serialNumber as string | null | undefined,
    registrationNumber: body.registrationNumber as string | null | undefined,
    notes: body.notes as string | null | undefined,
  });

  res.status(201).json(result);
};

export const updateCustomerBikeHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    label?: unknown;
    make?: unknown;
    model?: unknown;
    year?: unknown;
    bikeType?: unknown;
    colour?: unknown;
    wheelSize?: unknown;
    frameSize?: unknown;
    groupset?: unknown;
    motorBrand?: unknown;
    motorModel?: unknown;
    batterySerial?: unknown;
    frameNumber?: unknown;
    serialNumber?: unknown;
    registrationNumber?: unknown;
    notes?: unknown;
  };

  assertOptionalBikeString(body.label, "label", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.make, "make", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.model, "model", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeYear(body.year, "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.bikeType, "bikeType", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.colour, "colour", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.wheelSize, "wheelSize", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.frameSize, "frameSize", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.groupset, "groupset", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.motorBrand, "motorBrand", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.motorModel, "motorModel", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.batterySerial, "batterySerial", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.frameNumber, "frameNumber", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.serialNumber, "serialNumber", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.registrationNumber, "registrationNumber", "INVALID_CUSTOMER_BIKE_UPDATE");
  assertOptionalBikeString(body.notes, "notes", "INVALID_CUSTOMER_BIKE_UPDATE");

  const result = await updateCustomerBike(req.params.bikeId, {
    label: body.label as string | null | undefined,
    make: body.make as string | null | undefined,
    model: body.model as string | null | undefined,
    year: body.year as number | null | undefined,
    bikeType: body.bikeType as string | null | undefined,
    colour: body.colour as string | null | undefined,
    wheelSize: body.wheelSize as string | null | undefined,
    frameSize: body.frameSize as string | null | undefined,
    groupset: body.groupset as string | null | undefined,
    motorBrand: body.motorBrand as string | null | undefined,
    motorModel: body.motorModel as string | null | undefined,
    batterySerial: body.batterySerial as string | null | undefined,
    frameNumber: body.frameNumber as string | null | undefined,
    serialNumber: body.serialNumber as string | null | undefined,
    registrationNumber: body.registrationNumber as string | null | undefined,
    notes: body.notes as string | null | undefined,
  });

  res.json(result);
};

const parseIncludeInactiveQuery = (value: unknown) => {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "includeInactive must be true or false",
      "INVALID_BIKE_SERVICE_SCHEDULE_QUERY",
    );
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new HttpError(
    400,
    "includeInactive must be true or false",
    "INVALID_BIKE_SERVICE_SCHEDULE_QUERY",
  );
};

export const listBikeServiceSchedulesHandler = async (req: Request, res: Response) => {
  const includeInactive = parseIncludeInactiveQuery(req.query.includeInactive);
  const result = await listBikeServiceSchedules(req.params.bikeId, {
    includeInactive,
  });
  res.json(result);
};

export const createBikeServiceScheduleHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    type?: unknown;
    title?: unknown;
    description?: unknown;
    intervalMonths?: unknown;
    intervalMileage?: unknown;
    lastServiceAt?: unknown;
    lastServiceMileage?: unknown;
    nextDueAt?: unknown;
    nextDueMileage?: unknown;
    isActive?: unknown;
  };

  assertOptionalBikeString(body.type, "type", "INVALID_BIKE_SERVICE_SCHEDULE");
  assertOptionalBikeString(body.title, "title", "INVALID_BIKE_SERVICE_SCHEDULE");
  assertOptionalBikeString(body.description, "description", "INVALID_BIKE_SERVICE_SCHEDULE");
  assertOptionalBikeScheduleInteger(
    body.intervalMonths,
    "intervalMonths",
    "INVALID_BIKE_SERVICE_SCHEDULE",
  );
  assertOptionalBikeScheduleInteger(
    body.intervalMileage,
    "intervalMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE",
  );
  assertOptionalBikeScheduleDateString(
    body.lastServiceAt,
    "lastServiceAt",
    "INVALID_BIKE_SERVICE_SCHEDULE",
  );
  assertOptionalBikeScheduleInteger(
    body.lastServiceMileage,
    "lastServiceMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE",
  );
  assertOptionalBikeScheduleDateString(
    body.nextDueAt,
    "nextDueAt",
    "INVALID_BIKE_SERVICE_SCHEDULE",
  );
  assertOptionalBikeScheduleInteger(
    body.nextDueMileage,
    "nextDueMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE",
  );
  assertOptionalBikeScheduleBoolean(
    body.isActive,
    "isActive",
    "INVALID_BIKE_SERVICE_SCHEDULE",
  );

  const result = await createBikeServiceSchedule(req.params.bikeId, {
    type: body.type as string | null | undefined,
    title: body.title as string | null | undefined,
    description: body.description as string | null | undefined,
    intervalMonths: body.intervalMonths as number | null | undefined,
    intervalMileage: body.intervalMileage as number | null | undefined,
    lastServiceAt: body.lastServiceAt as string | null | undefined,
    lastServiceMileage: body.lastServiceMileage as number | null | undefined,
    nextDueAt: body.nextDueAt as string | null | undefined,
    nextDueMileage: body.nextDueMileage as number | null | undefined,
    isActive: body.isActive as boolean | undefined,
  });

  res.status(201).json(result);
};

export const updateBikeServiceScheduleHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    type?: unknown;
    title?: unknown;
    description?: unknown;
    intervalMonths?: unknown;
    intervalMileage?: unknown;
    lastServiceAt?: unknown;
    lastServiceMileage?: unknown;
    nextDueAt?: unknown;
    nextDueMileage?: unknown;
    isActive?: unknown;
  };

  assertOptionalBikeString(body.type, "type", "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE");
  assertOptionalBikeString(body.title, "title", "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE");
  assertOptionalBikeString(
    body.description,
    "description",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );
  assertOptionalBikeScheduleInteger(
    body.intervalMonths,
    "intervalMonths",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );
  assertOptionalBikeScheduleInteger(
    body.intervalMileage,
    "intervalMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );
  assertOptionalBikeScheduleDateString(
    body.lastServiceAt,
    "lastServiceAt",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );
  assertOptionalBikeScheduleInteger(
    body.lastServiceMileage,
    "lastServiceMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );
  assertOptionalBikeScheduleDateString(
    body.nextDueAt,
    "nextDueAt",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );
  assertOptionalBikeScheduleInteger(
    body.nextDueMileage,
    "nextDueMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );
  assertOptionalBikeScheduleBoolean(
    body.isActive,
    "isActive",
    "INVALID_BIKE_SERVICE_SCHEDULE_UPDATE",
  );

  const result = await updateBikeServiceSchedule(req.params.bikeId, req.params.scheduleId, {
    type: body.type as string | null | undefined,
    title: body.title as string | null | undefined,
    description: body.description as string | null | undefined,
    intervalMonths: body.intervalMonths as number | null | undefined,
    intervalMileage: body.intervalMileage as number | null | undefined,
    lastServiceAt: body.lastServiceAt as string | null | undefined,
    lastServiceMileage: body.lastServiceMileage as number | null | undefined,
    nextDueAt: body.nextDueAt as string | null | undefined,
    nextDueMileage: body.nextDueMileage as number | null | undefined,
    isActive: body.isActive as boolean | undefined,
  });

  res.json(result);
};

export const markBikeServiceScheduleServicedHandler = async (
  req: Request,
  res: Response,
) => {
  const body = (req.body ?? {}) as {
    servicedAt?: unknown;
    servicedMileage?: unknown;
  };

  assertOptionalBikeScheduleDateString(
    body.servicedAt,
    "servicedAt",
    "INVALID_BIKE_SERVICE_SCHEDULE_SERVICE_MARK",
  );
  assertOptionalBikeScheduleInteger(
    body.servicedMileage,
    "servicedMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE_SERVICE_MARK",
  );

  const result = await markBikeServiceScheduleServiced(req.params.bikeId, req.params.scheduleId, {
    servicedAt: body.servicedAt as string | null | undefined,
    servicedMileage: body.servicedMileage as number | null | undefined,
  });

  res.json(result);
};

export const getCustomerTimelineHandler = async (req: Request, res: Response) => {
  const result = await getCustomerTimeline(req.params.id);
  res.json(result);
};
