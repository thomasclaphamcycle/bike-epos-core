import { useEffect, useMemo, useRef, useState } from "react";
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
  const detachedCaptureScopeRef = useRef<string | null>(null);
  const previousTargetCustomerIdRef = useRef<string | null>(getCaptureTargetCustomer(target)?.id ?? null);

  const [captureSession, setCaptureSession] = useState<CustomerCaptureSession | null>(null);
  const [captureSessionLoading, setCaptureSessionLoading] = useState(false);
  const [creatingCaptureSession, setCreatingCaptureSession] = useState(false);
  const [captureStatusError, setCaptureStatusError] = useState<string | null>(null);
  const [captureCompletionSummary, setCaptureCompletionSummary] = useState<CaptureCompletionSummary | null>(null);
  const [captureSessionLaunchMode, setCaptureSessionLaunchMode] = useState<"fresh" | "replaced" | null>(null);

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
    const currentScope = target ? `${target.ownerType}:${getCaptureTargetId(target)}` : null;
    const currentCustomerId = getCaptureTargetCustomer(target)?.id ?? null;
    const previousCustomerId = previousTargetCustomerIdRef.current;

    if (currentScope && previousCustomerId && !currentCustomerId) {
      detachedCaptureScopeRef.current = currentScope;
      setCaptureSession(null);
      setCaptureStatusError(null);
      setCaptureSessionLoading(false);
      setCaptureSessionLaunchMode(null);
      setCaptureCompletionSummary(null);
      announcedCaptureCompletionRef.current = null;
    } else if (currentCustomerId) {
      detachedCaptureScopeRef.current = null;
    }

    previousTargetCustomerIdRef.current = currentCustomerId;
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
      setCaptureSessionLaunchMode(null);
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
      detachedCaptureScopeRef.current = null;
      setCaptureSession(payload.session);
      setCaptureSessionLaunchMode(payload.replacedActiveSessionCount > 0 ? "replaced" : "fresh");
      setCaptureCompletionSummary(null);
      announcedCaptureCompletionRef.current = null;
      success(
        payload.replacedActiveSessionCount > 0
          ? "New tap request ready. The previous customer link will no longer work."
          : "Tap request ready. Ask the customer to tap their phone now.",
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
    detachedCaptureScopeRef.current = null;
    setCaptureSession(null);
    setCaptureStatusError(null);
    setCaptureSessionLoading(false);
    setCaptureSessionLaunchMode(null);
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
      setCaptureSessionLaunchMode(null);
      announcedCaptureCompletionRef.current = null;
      return;
    }

    const currentScope = `${target.ownerType}:${getCaptureTargetId(target)}`;
    if (detachedCaptureScopeRef.current === currentScope) {
      return;
    }

    void loadCurrentCaptureSession(target, {
      showLoading: true,
      quiet: true,
    });
  }, [target, isCaptureEligible]);

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
    captureSession,
    captureSessionLoading,
    captureSessionLaunchMode,
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
