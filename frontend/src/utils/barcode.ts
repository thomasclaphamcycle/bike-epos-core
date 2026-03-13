export const normalizeLookupToken = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

export const isExactLookupMatch = (candidate: string | null | undefined, input: string) => {
  const normalizedCandidate = normalizeLookupToken(candidate);
  const normalizedInput = normalizeLookupToken(input);
  return normalizedCandidate.length > 0 && normalizedCandidate === normalizedInput;
};

export const looksLikeScannerInput = (value: string | null | undefined) => {
  const normalized = normalizeLookupToken(value);
  return normalized.length >= 4 && !/\s/.test(normalized);
};
