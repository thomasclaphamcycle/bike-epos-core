export const parseCookieHeader = (headerValue: string | undefined): Record<string, string> => {
  if (!headerValue) {
    return {};
  }

  const pairs = headerValue.split(";");
  const out: Record<string, string> = {};

  for (const rawPair of pairs) {
    const pair = rawPair.trim();
    if (!pair) {
      continue;
    }
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    out[key] = decodeURIComponent(value);
  }

  return out;
};
