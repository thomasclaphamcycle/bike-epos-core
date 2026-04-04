import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { HttpError } from "../utils/http";
import {
  listShopSettings,
  listStoreInfoSettings,
  updateStoreInfoSettings,
  type StoreInfoSettings,
} from "./configurationService";

type UploadStoreLogoInput = {
  fileDataUrl?: string;
};

const STORE_LOGO_MAX_BYTES = 5 * 1024 * 1024;
const STORE_LOGO_UPLOAD_ROOT_DIR = path.join(process.cwd(), "uploads", "store-logos");
const STORE_LOGO_UPLOAD_PUBLIC_PREFIX = "/uploads/store-logos/";

const allowedMimeTypes = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
]);

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseStoreLogoDataUrlOrThrow = (fileDataUrl: string | undefined) => {
  const normalized = normalizeOptionalText(fileDataUrl);
  if (!normalized) {
    throw new HttpError(400, "fileDataUrl is required", "INVALID_STORE_LOGO");
  }

  const match = normalized.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new HttpError(
      400,
      "fileDataUrl must be a supported base64 image data URL",
      "INVALID_STORE_LOGO",
    );
  }

  const mimeType = match[1].toLowerCase();
  const extension = allowedMimeTypes.get(mimeType);
  if (!extension) {
    throw new HttpError(
      400,
      "Store logos must be PNG, JPEG, or WEBP images",
      "INVALID_STORE_LOGO_TYPE",
    );
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > STORE_LOGO_MAX_BYTES) {
    throw new HttpError(
      400,
      "Store logos must be between 1 byte and 5MB",
      "INVALID_STORE_LOGO_SIZE",
    );
  }

  return {
    buffer,
    extension,
  };
};

const toAbsoluteManagedLogoPath = (publicPath: string) => {
  if (!publicPath.startsWith(STORE_LOGO_UPLOAD_PUBLIC_PREFIX)) {
    return null;
  }

  const relativePath = publicPath.slice(STORE_LOGO_UPLOAD_PUBLIC_PREFIX.length);
  if (!relativePath || relativePath.includes("..") || relativePath.includes("\\") || relativePath.includes("/")) {
    return null;
  }

  return path.join(STORE_LOGO_UPLOAD_ROOT_DIR, relativePath);
};

const removeManagedLogoIfExists = async (publicPath: string) => {
  const absolutePath = toAbsoluteManagedLogoPath(publicPath);
  if (!absolutePath) {
    return;
  }

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};

export const uploadStoreLogo = async (
  input: UploadStoreLogoInput,
): Promise<StoreInfoSettings> => {
  const { buffer, extension } = parseStoreLogoDataUrlOrThrow(input.fileDataUrl);
  const currentSettings = await listShopSettings();
  const previousUploadPath = currentSettings.store.uploadedLogoPath;

  await fs.mkdir(STORE_LOGO_UPLOAD_ROOT_DIR, { recursive: true });

  const filename = `store-logo-${randomUUID()}.${extension}`;
  const absolutePath = path.join(STORE_LOGO_UPLOAD_ROOT_DIR, filename);
  const publicPath = `${STORE_LOGO_UPLOAD_PUBLIC_PREFIX}${filename}`;

  await fs.writeFile(absolutePath, buffer);

  try {
    const store = await updateStoreInfoSettings({ uploadedLogoPath: publicPath });
    if (previousUploadPath && previousUploadPath !== publicPath) {
      await removeManagedLogoIfExists(previousUploadPath);
    }
    return store;
  } catch (error) {
    await removeManagedLogoIfExists(publicPath);
    throw error;
  }
};

export const removeStoreLogo = async (): Promise<StoreInfoSettings> => {
  const currentSettings = await listShopSettings();
  const previousUploadPath = currentSettings.store.uploadedLogoPath;

  if (!previousUploadPath) {
    return listStoreInfoSettings();
  }

  const store = await updateStoreInfoSettings({ uploadedLogoPath: "" });
  await removeManagedLogoIfExists(previousUploadPath);
  return store;
};
