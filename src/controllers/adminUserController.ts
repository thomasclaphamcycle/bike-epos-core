import { Request, Response } from "express";
import {
  getRequestAuditActor,
  getRequestStaffActorId,
  getRequestStaffRole,
} from "../middleware/staffRole";
import {
  adminCreateUser,
  adminListUsers,
  adminResetUserPin,
  adminResetUserPassword,
  adminSetUserPin,
  adminUpdateUser,
} from "../services/adminUserService";
import { HttpError } from "../utils/http";

export const adminCreateUserHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    email?: unknown;
    role?: unknown;
    tempPassword?: unknown;
    pin?: unknown;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_ADMIN_USER_CREATE");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_ADMIN_USER_CREATE");
  }
  if (body.role !== undefined && typeof body.role !== "string") {
    throw new HttpError(400, "role must be a string", "INVALID_ADMIN_USER_CREATE");
  }
  if (body.tempPassword !== undefined && typeof body.tempPassword !== "string") {
    throw new HttpError(400, "tempPassword must be a string", "INVALID_ADMIN_USER_CREATE");
  }
  if (body.pin !== undefined && typeof body.pin !== "string") {
    throw new HttpError(400, "pin must be a string", "INVALID_ADMIN_USER_CREATE");
  }

  const user = await adminCreateUser(
    {
      name: body.name,
      email: body.email,
      role: body.role,
      tempPassword: body.tempPassword,
      pin: body.pin,
    },
    getRequestAuditActor(req),
  );

  res.status(201).json({ user });
};

export const adminListUsersHandler = async (_req: Request, res: Response) => {
  const result = await adminListUsers();
  res.json(result);
};

export const adminUpdateUserHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    role?: unknown;
    isActive?: unknown;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_ADMIN_USER_UPDATE");
  }
  if (body.role !== undefined && typeof body.role !== "string") {
    throw new HttpError(400, "role must be a string", "INVALID_ADMIN_USER_UPDATE");
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_ADMIN_USER_UPDATE");
  }

  const user = await adminUpdateUser(
    req.params.id,
    {
      ...(Object.prototype.hasOwnProperty.call(body, "name") ? { name: body.name } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "role") ? { role: body.role } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "isActive")
        ? { isActive: body.isActive }
        : {}),
    },
    getRequestStaffActorId(req),
    getRequestAuditActor(req),
  );

  res.json({ user });
};

export const adminResetUserPasswordHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { tempPassword?: unknown };
  if (body.tempPassword !== undefined && typeof body.tempPassword !== "string") {
    throw new HttpError(
      400,
      "tempPassword must be a string",
      "INVALID_ADMIN_PASSWORD_RESET",
    );
  }

  const user = await adminResetUserPassword(
    req.params.id,
    {
      tempPassword: body.tempPassword,
    },
    getRequestStaffActorId(req),
    getRequestAuditActor(req),
  );

  res.json({ user });
};

export const adminResetUserPinHandler = async (req: Request, res: Response) => {
  const user = await adminResetUserPin(
    req.params.id,
    getRequestStaffActorId(req),
    getRequestStaffRole(req),
    getRequestAuditActor(req),
  );

  res.json({ user });
};

export const adminSetUserPinHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { pin?: unknown };
  if (body.pin !== undefined && typeof body.pin !== "string") {
    throw new HttpError(400, "pin must be a string", "INVALID_ADMIN_PIN_SET");
  }

  const user = await adminSetUserPin(
    req.params.id,
    body.pin,
    getRequestStaffActorId(req),
    getRequestStaffRole(req),
    getRequestAuditActor(req),
  );

  res.json({ user });
};
