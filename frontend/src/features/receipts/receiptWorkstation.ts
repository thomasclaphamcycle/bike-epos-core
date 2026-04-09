const RECEIPT_WORKSTATION_STORAGE_KEY = "corepos.receiptWorkstationKey";

export const getStoredReceiptWorkstationKey = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(RECEIPT_WORKSTATION_STORAGE_KEY)?.trim().toUpperCase();
  return value || null;
};

export const setStoredReceiptWorkstationKey = (value: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!value || !value.trim()) {
    window.localStorage.removeItem(RECEIPT_WORKSTATION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(RECEIPT_WORKSTATION_STORAGE_KEY, value.trim().toUpperCase());
};
