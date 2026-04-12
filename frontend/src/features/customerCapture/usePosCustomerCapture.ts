import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  buildCustomerCaptureEntryUrl,
  createBasketCustomerCaptureSession,
  createSaleCustomerCaptureSession,
  getCurrentBasketCustomerCaptureSession,
  getCurrentSaleCustomerCaptureSession,
  type CustomerCaptureSession,
} from "./customerCapture";
import {
  buildCaptureCompletionSummary,
  formatCaptureMatchOutcome,
  getCaptureTargetCustomer,
  getCaptureTargetId,
  type CaptureCompletionSummary,
  type PosCustomerCaptureBasket,
  type PosCustomerCaptureSale,
  type PosCustomerCaptureTarget,
} from "./posCustomerCapture";

type UsePosCustomerCaptureOptions = {
  target: PosCustomerCaptureTarget | null;
  loadBasket: (basketId: string) => Promise<PosCustomerCaptureBasket | null>;
  loadSale: (saleId: string) => Promise<PosCustomerCaptureSale | null>;
  success: (message: string) => void;
  error: (message: string) => void;
};

const getCaptureErrorMessage = (captureError: unknown, fallback: string) =>
  captureError instanceof Error ? captureError.message : fallback;

const isSameTarget = (
  left: PosCustomerCaptureTarget | null,
  right: PosCustomerCaptureTarget | null,
) => (
  left?.ownerType === right?.ownerType
  && getCaptureTargetId(left) === getCaptureTargetId(right)
);

export const usePosCustomerCapture = ({
  target,
  loadBasket,
  loadSale,
  success,
  error,
}: UsePosCustomerCaptureOptions) => {
  const mountedRef = useRef(true);
  const targetRef = useRef<PosCustomerCaptureTarget | null>(target);
  const captureTargetScopeRef = useRef<string | null>(null);
  const announcedCaptureCompletionRef = useRef<string | null>(null);

  const [captureSession, setCaptureSession] = useState<CustomerCaptureSession | null>(null);
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

  const isCaptureEligible = Boolean(
    target
      && !getCaptureTargetCustomer(target)?.id
      && (target.ownerType === "basket" || !target.sale.completedAt),
  );

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCurrentCaptureSession = async (
    targetContext: PosCustomerCaptureTarget,
    options?: {
      showLoading?: boolean;
      quiet?: boolean;
    },
  ) => {
    if (options?.showLoading !== false) {
      setCaptureSessionLoading(true);
    }

    try {
      const payload = targetContext.ownerType === "sale"
        ? await getCurrentSaleCustomerCaptureSession(targetContext.sale.id)
        : await getCurrentBasketCustomerCaptureSession(targetContext.basket.id);
      if (!mountedRef.current || !isSameTarget(targetContext, targetRef.current)) {
        return null;
      }
      setCaptureSession(payload.session);
      setCaptureStatusError(null);
      return payload.session;
    } catch (captureError) {
      if (!mountedRef.current || !isSameTarget(targetContext, targetRef.current)) {
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
        && isSameTarget(targetContext, targetRef.current)
        && options?.showLoading !== false
      ) {
        setCaptureSessionLoading(false);
      }
    }
  };

  const refreshTargetAfterCustomerCapture = async (
    targetContext: PosCustomerCaptureTarget,
    options?: {
      showToast?: boolean;
      completionSummary?: CaptureCompletionSummary | null;
    },
  ) => {
    const refreshed = targetContext.ownerType === "sale"
      ? await loadSale(targetContext.sale.id)
      : await loadBasket(targetContext.basket.id);
    if (!refreshed || !mountedRef.current) {
      return null;
    }

    const refreshedCustomer = targetContext.ownerType === "sale"
      ? refreshed.sale.customer
      : refreshed.basket.customer;

    if (refreshedCustomer?.id) {
      setCaptureSession(null);
      setCaptureStatusError(null);
      if (options?.completionSummary) {
        setCaptureCompletionSummary(options.completionSummary);
      }
      const announcementKey = `${targetContext.ownerType}:${getCaptureTargetId(targetContext)}:${refreshedCustomer.id}`;
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
          success("Customer details attached.");
        }
      }
    }

    return refreshed;
  };

  const createCustomerCaptureSession = async () => {
    if (!target) {
      error("Create or open a transaction before starting customer capture.");
      return;
    }
    if (getCaptureTargetCustomer(target)?.id) {
      error("This transaction already has a customer attached.");
      return;
    }
    if (target.ownerType === "sale" && target.sale.completedAt) {
      error("Customer capture is only available for active sales.");
      return;
    }

    setCreatingCaptureSession(true);
    setCaptureStatusError(null);
    try {
      const payload = target.ownerType === "sale"
        ? await createSaleCustomerCaptureSession(target.sale.id)
        : await createBasketCustomerCaptureSession(target.basket.id);
      if (!mountedRef.current || !isSameTarget(target, targetRef.current)) {
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
      if (!mountedRef.current || !isSameTarget(target, targetRef.current)) {
        return;
      }
      const message = getCaptureErrorMessage(captureError, "Failed to create capture link");
      setCaptureStatusError(message);
      error(message);
    } finally {
      if (mountedRef.current && isSameTarget(target, targetRef.current)) {
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
    if (!target) {
      return;
    }

    const nextSession = await loadCurrentCaptureSession(target, {
      showLoading: true,
      quiet: false,
    });
    if (nextSession?.status === "COMPLETED") {
      await refreshTargetAfterCustomerCapture(target, {
        showToast: true,
        completionSummary: buildCaptureCompletionSummary(target, nextSession),
      });
    }
  };

  useEffect(() => {
    const nextScope = target ? `${target.ownerType}:${getCaptureTargetId(target)}` : null;
    if (captureTargetScopeRef.current === nextScope) {
      return;
    }

    captureTargetScopeRef.current = nextScope;
    setCaptureSession(null);
    setCaptureStatusError(null);
    setCaptureSessionLoading(false);
    setCaptureQrImage(null);
    setCaptureQrBusy(false);
    announcedCaptureCompletionRef.current = null;
    if (
      captureCompletionSummary
      && (
        !target
        || captureCompletionSummary.ownerType !== target.ownerType
        || captureCompletionSummary.ownerId !== getCaptureTargetId(target)
      )
    ) {
      setCaptureCompletionSummary(null);
    }
  }, [target, captureCompletionSummary]);

  useEffect(() => {
    if (!target || !isCaptureEligible) {
      setCaptureSession(null);
      setCaptureStatusError(null);
      setCaptureSessionLoading(false);
      announcedCaptureCompletionRef.current = null;
      return;
    }

    void loadCurrentCaptureSession(target, {
      showLoading: true,
      quiet: true,
    });
  }, [target, isCaptureEligible]);

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
    if (!target || !isCaptureEligible) {
      return;
    }
    if (!captureSession || captureSession.status !== "ACTIVE") {
      return;
    }

    let cancelled = false;

    const syncCaptureState = async () => {
      const nextSession = await loadCurrentCaptureSession(target, {
        showLoading: false,
        quiet: true,
      });
      if (cancelled || !nextSession) {
        return;
      }

      if (nextSession.status === "COMPLETED") {
        await refreshTargetAfterCustomerCapture(target, {
          completionSummary: buildCaptureCompletionSummary(target, nextSession),
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
  }, [captureSession?.id, captureSession?.status, target, isCaptureEligible]);

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
    createCustomerCaptureSession,
    dismissCaptureCompletionSummary: () => setCaptureCompletionSummary(null),
    refreshCaptureStatus,
    refreshTargetAfterCustomerCapture,
  };
};
