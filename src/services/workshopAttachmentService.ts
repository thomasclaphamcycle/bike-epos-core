import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  Prisma,
  WorkshopAttachmentVisibility,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { getPublicWorkshopPortalContext } from "./workshopEstimateService";

type CreateWorkshopAttachmentInput = {
  uploadedByStaffId?: string | null;
  filename?: string;
  fileDataUrl?: string;
  visibility?: string;
};

type DbClient = Prisma.TransactionClient | typeof prisma;

const WORKSHOP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const WORKSHOP_ATTACHMENT_ROOT_DIR = path.join(process.cwd(), "uploads", "workshop-attachments");

const allowedMimeTypes = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

const attachmentInclude = Prisma.validator<Prisma.WorkshopAttachmentInclude>()({
  uploadedByStaff: {
    select: {
      id: true,
      username: true,
      name: true,
    },
  },
});

type WorkshopAttachmentRecord = Prisma.WorkshopAttachmentGetPayload<{
  include: typeof attachmentInclude;
}>;

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseVisibilityOrThrow = (value: string | undefined): WorkshopAttachmentVisibility => {
  const normalized = normalizeOptionalText(value)?.toUpperCase() ?? "INTERNAL";

  if (normalized !== "INTERNAL" && normalized !== "CUSTOMER") {
    throw new HttpError(
      400,
      "visibility must be INTERNAL or CUSTOMER",
      "INVALID_WORKSHOP_ATTACHMENT_VISIBILITY",
    );
  }

  return normalized;
};

const ensureWorkshopJobExistsTx = async (
  tx: DbClient,
  workshopJobId: string,
) => {
  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: { id: true },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return job;
};

const ensureUploadedByStaffExistsTx = async (
  tx: DbClient,
  uploadedByStaffId: string | null,
) => {
  if (!uploadedByStaffId) {
    return null;
  }

  const user = await tx.user.findUnique({
    where: { id: uploadedByStaffId },
    select: { id: true },
  });

  if (!user) {
    throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
  }

  return user;
};

const sanitizeFilename = (value: string | undefined, fallbackExtension: string) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return `attachment.${fallbackExtension}`;
  }

  const basename = path.basename(normalized).replace(/[^A-Za-z0-9._-]+/g, "_");
  const trimmed = basename.replace(/^_+|_+$/g, "");
  return trimmed.length > 0 ? trimmed : `attachment.${fallbackExtension}`;
};

const parseAttachmentDataUrlOrThrow = (fileDataUrl: string | undefined) => {
  const normalized = normalizeOptionalText(fileDataUrl);
  if (!normalized) {
    throw new HttpError(
      400,
      "fileDataUrl is required",
      "INVALID_WORKSHOP_ATTACHMENT",
    );
  }

  const match = normalized.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new HttpError(
      400,
      "fileDataUrl must be a supported base64 data URL",
      "INVALID_WORKSHOP_ATTACHMENT",
    );
  }

  const mimeType = match[1].toLowerCase();
  const extension = allowedMimeTypes.get(mimeType);
  if (!extension) {
    throw new HttpError(
      400,
      "Attachments must be PNG, JPEG, WEBP, or PDF files",
      "INVALID_WORKSHOP_ATTACHMENT_TYPE",
    );
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > WORKSHOP_ATTACHMENT_MAX_BYTES) {
    throw new HttpError(
      400,
      "Attachments must be between 1 byte and 10MB",
      "INVALID_WORKSHOP_ATTACHMENT_SIZE",
    );
  }

  return {
    buffer,
    mimeType,
    extension,
  };
};

const buildAttachmentApiPath = (workshopJobId: string, attachmentId: string) =>
  `/api/workshop/jobs/${workshopJobId}/attachments/${attachmentId}/file`;

const buildPublicAttachmentApiPath = (token: string, attachmentId: string) =>
  `/api/public/workshop/${encodeURIComponent(token)}/attachments/${attachmentId}/file`;

const toStaffAttachmentResponse = (attachment: WorkshopAttachmentRecord) => ({
  id: attachment.id,
  workshopJobId: attachment.workshopJobId,
  filename: attachment.filename,
  mimeType: attachment.mimeType,
  fileSizeBytes: attachment.fileSizeBytes,
  visibility: attachment.visibility,
  createdAt: attachment.createdAt,
  updatedAt: attachment.updatedAt,
  isImage: attachment.mimeType.startsWith("image/"),
  filePath: buildAttachmentApiPath(attachment.workshopJobId, attachment.id),
  uploadedByStaff: attachment.uploadedByStaff
    ? {
        id: attachment.uploadedByStaff.id,
        username: attachment.uploadedByStaff.username,
        name: attachment.uploadedByStaff.name,
      }
    : null,
});

const toPublicAttachmentResponse = (
  token: string,
  attachment: WorkshopAttachmentRecord,
) => ({
  id: attachment.id,
  filename: attachment.filename,
  mimeType: attachment.mimeType,
  fileSizeBytes: attachment.fileSizeBytes,
  createdAt: attachment.createdAt,
  updatedAt: attachment.updatedAt,
  isImage: attachment.mimeType.startsWith("image/"),
  filePath: buildPublicAttachmentApiPath(token, attachment.id),
});

const ensureAttachmentAbsolutePathExists = async (storagePath: string) => {
  const absolutePath = path.resolve(WORKSHOP_ATTACHMENT_ROOT_DIR, storagePath);
  const normalizedRoot = `${path.resolve(WORKSHOP_ATTACHMENT_ROOT_DIR)}${path.sep}`;
  if (!absolutePath.startsWith(normalizedRoot)) {
    throw new HttpError(404, "Attachment file not found", "WORKSHOP_ATTACHMENT_NOT_FOUND");
  }

  try {
    await fs.access(absolutePath);
  } catch {
    throw new HttpError(404, "Attachment file not found", "WORKSHOP_ATTACHMENT_NOT_FOUND");
  }

  return absolutePath;
};

export const listWorkshopAttachmentsForJob = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  await ensureWorkshopJobExistsTx(prisma, workshopJobId);

  const attachments = await prisma.workshopAttachment.findMany({
    where: { workshopJobId },
    include: attachmentInclude,
    orderBy: [{ createdAt: "desc" }],
  });

  return {
    workshopJobId,
    attachments: attachments.map(toStaffAttachmentResponse),
  };
};

export const createWorkshopAttachmentForJob = async (
  workshopJobId: string,
  input: CreateWorkshopAttachmentInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const uploadedByStaffId = normalizeOptionalText(input.uploadedByStaffId) ?? null;
  const visibility = parseVisibilityOrThrow(input.visibility);
  const { buffer, mimeType, extension } = parseAttachmentDataUrlOrThrow(input.fileDataUrl);
  const filename = sanitizeFilename(input.filename, extension);
  const storageFilename = `${randomUUID()}.${extension}`;
  await fs.mkdir(WORKSHOP_ATTACHMENT_ROOT_DIR, { recursive: true });
  const absolutePath = path.join(WORKSHOP_ATTACHMENT_ROOT_DIR, storageFilename);
  await fs.writeFile(absolutePath, buffer);

  try {
    const created = await prisma.$transaction(async (tx) => {
      await ensureWorkshopJobExistsTx(tx, workshopJobId);
      await ensureUploadedByStaffExistsTx(tx, uploadedByStaffId);

      const attachment = await tx.workshopAttachment.create({
        data: {
          workshopJobId,
          uploadedByStaffId,
          filename,
          mimeType,
          storagePath: storageFilename,
          fileSizeBytes: buffer.byteLength,
          visibility,
        },
        include: attachmentInclude,
      });

      await createAuditEventTx(
        tx,
        {
          action: "WORKSHOP_ATTACHMENT_UPLOADED",
          entityType: "WORKSHOP_JOB",
          entityId: workshopJobId,
          metadata: {
            attachmentId: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            visibility: attachment.visibility,
            fileSizeBytes: attachment.fileSizeBytes,
          },
        },
        auditActor,
      );

      return attachment;
    });

    return {
      attachment: toStaffAttachmentResponse(created),
    };
  } catch (error) {
    await fs.rm(absolutePath, { force: true }).catch(() => {});
    throw error;
  }
};

export const deleteWorkshopAttachmentForJob = async (
  workshopJobId: string,
  attachmentId: string,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (!isUuid(attachmentId)) {
    throw new HttpError(400, "Invalid attachment id", "INVALID_WORKSHOP_ATTACHMENT_ID");
  }

  const deleted = await prisma.$transaction(async (tx) => {
    await ensureWorkshopJobExistsTx(tx, workshopJobId);

    const attachment = await tx.workshopAttachment.findFirst({
      where: {
        id: attachmentId,
        workshopJobId,
      },
      include: attachmentInclude,
    });

    if (!attachment) {
      throw new HttpError(404, "Workshop attachment not found", "WORKSHOP_ATTACHMENT_NOT_FOUND");
    }

    await tx.workshopAttachment.delete({
      where: { id: attachment.id },
    });

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_ATTACHMENT_DELETED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          attachmentId: attachment.id,
          filename: attachment.filename,
          visibility: attachment.visibility,
        },
      },
      auditActor,
    );

    return attachment;
  });

  const absolutePath = path.join(WORKSHOP_ATTACHMENT_ROOT_DIR, deleted.storagePath);
  await fs.rm(absolutePath, { force: true }).catch(() => {});

  return {
    deleted: true,
    attachmentId,
  };
};

export const getWorkshopAttachmentFileForJob = async (
  workshopJobId: string,
  attachmentId: string,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (!isUuid(attachmentId)) {
    throw new HttpError(400, "Invalid attachment id", "INVALID_WORKSHOP_ATTACHMENT_ID");
  }

  const attachment = await prisma.workshopAttachment.findFirst({
    where: {
      id: attachmentId,
      workshopJobId,
    },
  });

  if (!attachment) {
    throw new HttpError(404, "Workshop attachment not found", "WORKSHOP_ATTACHMENT_NOT_FOUND");
  }

  return {
    attachment,
    absolutePath: await ensureAttachmentAbsolutePathExists(attachment.storagePath),
  };
};

export const listPublicWorkshopAttachments = async (tokenValue: string) => {
  const context = await getPublicWorkshopPortalContext(tokenValue);

  const attachments = await prisma.workshopAttachment.findMany({
    where: {
      workshopJobId: context.estimate.workshopJobId,
      visibility: "CUSTOMER",
    },
    include: attachmentInclude,
    orderBy: [{ createdAt: "desc" }],
  });

  return {
    workshopJobId: context.estimate.workshopJobId,
    attachments: attachments.map((attachment) =>
      toPublicAttachmentResponse(context.token, attachment),
    ),
  };
};

export const getPublicWorkshopAttachmentFile = async (
  tokenValue: string,
  attachmentId: string,
) => {
  if (!isUuid(attachmentId)) {
    throw new HttpError(400, "Invalid attachment id", "INVALID_WORKSHOP_ATTACHMENT_ID");
  }

  const context = await getPublicWorkshopPortalContext(tokenValue);

  const attachment = await prisma.workshopAttachment.findFirst({
    where: {
      id: attachmentId,
      workshopJobId: context.estimate.workshopJobId,
      visibility: "CUSTOMER",
    },
  });

  if (!attachment) {
    throw new HttpError(404, "Workshop attachment not found", "WORKSHOP_ATTACHMENT_NOT_FOUND");
  }

  return {
    attachment,
    absolutePath: await ensureAttachmentAbsolutePathExists(attachment.storagePath),
  };
};
