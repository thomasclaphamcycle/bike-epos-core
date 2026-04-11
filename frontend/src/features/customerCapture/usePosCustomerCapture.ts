import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  buildCustomerCaptureEntryUrl,
  createSaleCustomerCaptureSession,
  getCurrentSaleCustomerCaptureSession,
  type SaleCustomerCaptureSession,
} from "./customerCapture";
import {
  buildCaptureCompletionSummary,
  formatCaptureMatchOutcome,
  type CaptureCompletionSummary,
  type PosCustomerCaptureSale,
} from "./posCustomerCapture";

type UsePosCustomerCaptureOptions = {
  sale: PosCustomerCaptureSale | null;
  loadSale: (saleId: string) => Promise<PosCustomerCaptureSale | null>;
  success: (message: string) => void;
  error: (message: string) => void;
};

const getCaptureErrorMessage = (captureError: unknown, fallback: string) =>
  captureError instanceof Error ? captureError.message : fallback;

export const usePosCustomerCapture = ({
  sale,
  loadSale,
  success,
  error,
}: UsePosCustomerCaptureOptions) => {
  const mountedRef = useRef(true);
  const saleRef = useRef<PosCustomerCaptureSale | null>(sale);
  const captureSaleScopeRef = useRef<string | null>(null);
  const announcedCaptureCompletionRef = useRef<string | null>(null);

  const [captureSession, setCaptureSession] = useState<SaleCustomerCaptureSession | null>(null);
  const [captureSessionLoading, setCaptureSessionLoading] = useState(false);
  const [creatingCaptureSession, setCreatingCaptureSession] = useState(false);
  const [captureStatusError, setCaptureStatusError] = useState<string | null>(null);
  const [captureQrImage, setCaptureQrImage] = useState<string | null>(null);
  const [captureQrBusy, setCaptureQrBusy] = useState(false);
  const [captureCompletionSummary, setCaptureCompletionSummary] = useState<CaptureCompletionSummary | null>(null);

  const captureUrl = useMemo(() => {
    if (!captureSession) {
      return null;
    }

    return buildCustomerCaptureEntryUrl(captureSession.token);
  }, [captureSession]);

  const isCaptureEligible = Boolean(sale?.sale.id && !sale.sale.completedAt && !sale.sale.customer?.id);

  useEffect(() => {
    saleRef.current = sale;
  }, [sale]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCurrentCaptureSession = async (
    targetSaleId: string,
    options?: {
      showLoading?: boolean;
      quiet?: boolean;
    },
  ) => {
    if (options?.showLoading !== false) {
      setCaptureSessionLoading(true);
    }

    try {
      const payload = await getCurrentSaleCustomerCaptureSession(targetSaleId);
      if (!mountedRef.current || saleRef.current?.sale.id !== targetSaleId) {
        return null;
      }
      setCaptureSession(payload.session);
      setCaptureStatusError(null);
      return payload.session;
    } catch (captureError) {
      if (!mountedRef.current || saleRef.current?.sale.id !== targetSaleId) {
        return null;
      }
      const message = getCaptureErrorMessage(captureError, "Failed to load customer capture");
      setCaptureStatusError(message);
      if (!options?.quiet) {
        error(message);
      }
      return null;
    } finally {
      if (
        mountedRef.current
        && saleRef.current?.sale.id === targetSaleId
        && options?.showLoading !== false
      ) {
        setCaptureSessionLoading(false);
      }
    }
  };

  const refreshSaleAfterCustomerCapture = async (
    targetSaleId: string,
    options?: {
      showToast?: boolean;
      completionSummary?: CaptureCompletionSummary | null;
    },
  ) => {
    const refreshed = await loadSale(targetSaleId);
    if (!refreshed || !mountedRef.current) {
      return null;
    }

    if (refreshed.sale.customer?.id) {
      setCaptureSession(null);
      setCaptureStatusError(null);
      if (options?.completionSummary) {
        setCaptureCompletionSummary(options.completionSummary);
      }
      const announcementKey = `${targetSaleId}:${refreshed.sale.customer.id}`;
      if (options?.showToast !== false && announcedCaptureCompletionRef.current !== announcementKey) {
        announcedCaptureCompletionRef.current = announcementKey;
        if (options?.completionSummary) {
          success(
            formatCaptureMatchOutcome(
              options.completionSummary.matchType,
              options.completionSummary.customer.name,
            ),
          );
        } else {
          success("Customer details attached to sale.");
        }
      }
    }

    return refreshed;
  };

  const createCustomerCaptureSessionForSale = async () => {
    if (!sale?.sale.id) {
      error("Create a sale before starting customer capture.");
      return;
    }
    if (sale.sale.completedAt) {
      error("Customer capture is only available for active sales.");
      return;
    }
    if (sale.sale.customer?.id) {
      error("This sale already has a customer attached.");
      return;
    }

    setCreatingCaptureSession(true);
    setCaptureStatusError(null);
    try {
      const payload = await createSaleCustomerCaptureSession(sale.sale.id);
      if (!mountedRef.current || saleRef.current?.sale.id !== sale.sale.id) {
        return;
      }
      setCaptureSession(payload.session);
      setCaptureCompletionSummary(null);
      announcedCaptureCompletionRef.current = null;
      success(
        payload.replacedActiveSessionCount > 0
          ? "New customer capture link ready. The previous link has been replaced."
          : "Customer capture link ready.",
      );
    } catch (captureError) {
      if (!mountedRef.current || saleRef.current?.sale.id !== sale.sale.id) {
        return;
      }
      const message = getCaptureErrorMessage(captureError, "Failed to create capture link");
      setCaptureStatusError(message);
      error(message);
    } finally {
      if (mountedRef.current && saleRef.current?.sale.id === sale?.sale.id) {
        setCreatingCaptureSession(false);
      }
    }
  };

  const copyCaptureUrl = async () => {
    if (!captureUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(captureUrl);
      success("Customer capture link copied.");
    } catch {
      error("Could not copy the customer capture link.");
    }
  };

  const refreshCaptureStatus = async () => {
    if (!sale?.sale.id) {
      return;
    }

    const nextSession = await loadCurrentCaptureSession(sale.sale.id, {
      showLoading: true,
      quiet: false,
    });
    if (nextSession?.status === "COMPLETED") {
      await refreshSaleAfterCustomerCapture(sale.sale.id, {
        showToast: true,
        completionSummary: buildCaptureCompletionSummary(sale.sale.id, nextSession),
      });
    }
  };

  useEffect(() => {
    const nextSaleId = sale?.sale.id ?? null;
    if (captureSaleScopeRef.current === nextSaleId) {
      return;
    }

    captureSaleScopeRef.current = nextSaleId;
    setCaptureSession(null);
    setCaptureStatusError(null);
    setCaptureSessionLoading(false);
    setCaptureQrImage(null);
    setCaptureQrBusy(false);
    announcedCaptureCompletionRef.current = null;
    if (captureCompletionSummary && captureCompletionSummary.saleId !== nextSaleId) {
      setCaptureCompletionSummary(null);
    }
  }, [sale?.sale.id, captureCompletionSummary]);

  useEffect(() => {
    if (!sale?.sale.id || sale.sale.completedAt || sale.sale.customer?.id) {
      setCaptureSession(null);
      setCaptureStatusError(null);
      setCaptureSessionLoading(false);
      announcedCaptureCompletionRef.current = null;
      return;
    }

    void loadCurrentCaptureSession(sale.sale.id, {
      showLoading: true,
      quiet: true,
    });
  }, [sale?.sale.id, sale?.sale.completedAt, sale?.sale.customer?.id]);

  useEffect(() => {
    if (!captureUrl || captureSession?.status !== "ACTIVE") {
      setCaptureQrImage(null);
      setCaptureQrBusy(false);
      return;
    }

    let cancelled = false;
    setCaptureQrBusy(true);

    void QRCode.toDataURL(captureUrl, {
      margin: 1,
      width: 240,
    })
      .then((nextImage) => {
        if (!cancelled) {
          setCaptureQrImage(nextImage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCaptureQrImage(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCaptureQrBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [captureSession?.status, captureUrl]);

  useEffect(() => {
    if (!sale?.sale.id || sale.sale.completedAt || sale.sale.customer?.id) {
      return;
    }
    if (!captureSession || captureSession.status !== "ACTIVE") {
      return;
    }

    let cancelled = false;

    const syncCaptureState = async () => {
      const nextSession = await loadCurrentCaptureSession(sale.sale.id, {
        showLoading: false,
        quiet: true,
      });
      if (cancelled || !nextSession) {
        return;
      }

      if (nextSession.status === "COMPLETED") {
        await refreshSaleAfterCustomerCapture(sale.sale.id, {
          completionSummary: buildCaptureCompletionSummary(sale.sale.id, nextSession),
        });
      }
    };

    const intervalId = window.setInterval(() => {
      void syncCaptureState();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [captureSession?.id, captureSession?.status, sale?.sale.completedAt, sale?.sale.customer?.id, sale?.sale.id]);

  return {
    captureCompletionSummary,
    captureQrBusy,
    captureQrImage,
    captureSession,
    captureSessionLoading,
    captureStatusError,
    captureUrl,
    creatingCaptureSession,
    isCaptureEligible,
    copyCaptureUrl,
    createCustomerCaptureSession: createCustomerCaptureSessionForSale,
    dismissCaptureCompletionSummary: () => setCaptureCompletionSummary(null),
    refreshCaptureStatus,
    refreshSaleAfterCustomerCapture,
  };
};
