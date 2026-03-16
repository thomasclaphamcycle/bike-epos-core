export const normalizeLoginRedirectTarget = (target: string | null | undefined) => {
  if (typeof target !== "string") {
    return null;
  }

  const trimmed = target.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  return trimmed;
};
