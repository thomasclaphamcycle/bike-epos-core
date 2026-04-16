import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = 7 | 30 | 90;
type MovementType = "CASH_IN" | "CASH_OUT";
type CashMovementReason = "BANK_DEPOSIT" | "SAFE_DROP" | "SUPPLIER_PAYMENT" | "PETTY_EXPENSE" | "OTHER";

type CashSession = {
  id: string;
  businessDate: string;
  openedAt: string;
  closedAt: string | null;
  openedByStaffId: string | null;
  closedByStaffId: string | null;
  openingFloatPence: number;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
};

type CashSessionSummaryResponse = {
  session: CashSession | null;
  totals?: {
    openingFloatPence: number;
    paidInPence: number;
    paidOutPence: number;
    cashSalesPence: number;
    cashRefundsPence: number;
    expectedCashPence: number;
    countedCashPence: number | null;
    variancePence: number | null;
  };
};

type CashSessionListResponse = {
  sessions: CashSession[];
};

type CashMovement = {
  id: string;
  sessionId: string | null;
  locationId: string;
  type: string;
  dbType: string;
  reason: CashMovementReason | null;
  amountPence: number;
  note: string | null;
  ref: string;
  receiptImageUrl?: string | null;
  relatedSaleId: string | null;
  relatedRefundId: string | null;
  createdAt: string;
  createdByStaffId: string | null;
};

type CashMovementListResponse = {
  movements: CashMovement[];
};

type CashMovementCreateResponse = {
  movement: CashMovement;
  summary: CashSessionSummaryResponse;
};

type ReceiptTokenResponse = {
  token: string;
  expiresAt: string;
  cashMovementId: string;
  uploadApiPath: string;
  uploadPagePath: string;
};

type ReceiptPreview = {
  url: string;
  label: string;
};

const CASH_OUT_REASON_OPTIONS: Array<{ value: CashMovementReason; label: string }> = [
  { value: "BANK_DEPOSIT", label: "Bank deposit" },
  { value: "SAFE_DROP", label: "Safe drop" },
  { value: "SUPPLIER_PAYMENT", label: "Supplier payment" },
  { value: "PETTY_EXPENSE", label: "Petty expense" },
  { value: "OTHER", label: "Other" },
];

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const formatMoney = (pence: number | null | undefined) =>
  pence === null || pence === undefined ? "-" : `£${(pence / 100).toFixed(2)}`;

const toISODate = (value: Date) => value.toISOString().slice(0, 10);

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const normalizeRangePreset = (value: string): RangePreset => {
  if (value === "7") {
    return 7;
  }
  if (value === "90") {
    return 90;
  }
  return 30;
};

const buildHistoryRange = (preset: RangePreset) => {
  const today = new Date();
  const to = toISODate(today);
  const from = toISODate(shiftDays(today, -(preset - 1)));

  if (!DATE_ONLY_REGEX.test(from) || !DATE_ONLY_REGEX.test(to)) {
    throw new Error("Failed to build valid cash history range");
  }

  return { from, to };
};

const getPublicAppOrigin = () => {
  const configuredOrigin = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim();
  return configuredOrigin ? configuredOrigin.replace(/\/$/, "") : window.location.origin;
};

const getBackendAssetOrigin = () => {
  const configuredProxyTarget = import.meta.env.VITE_API_PROXY_TARGET?.trim();
  if (configuredProxyTarget) {
    return configuredProxyTarget.replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:3100";
  }
  return window.location.origin;
};

const toPublicAssetUrl = (value: string | null | undefined, origin: string) => {
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith("/")) {
    return `${origin}${value}`;
  }
  return `${origin}/${value.replace(/^\/+/, "")}`;
};

const toPence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  return Math.round(Number(normalized) * 100);
};

export const CashOversightPage = () => {
  const { error, success } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>(30);
  const [currentSession, setCurrentSession] = useState<CashSessionSummaryResponse | null>(null);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(false);

  const [openingFloat, setOpeningFloat] = useState("0.00");
  const [openingRegister, setOpeningRegister] = useState(false);

  const [movementType, setMovementType] = useState<MovementType>("CASH_OUT");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState<CashMovementReason>("PETTY_EXPENSE");
  const [movementNotes, setMovementNotes] = useState("");
  const [creatingMovement, setCreatingMovement] = useState(false);

  const [countedAmount, setCountedAmount] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closingRegister, setClosingRegister] = useState(false);
  const [closeSummary, setCloseSummary] = useState<CashSessionSummaryResponse | null>(null);

  const [receiptToken, setReceiptToken] = useState<ReceiptTokenResponse | null>(null);
  const [receiptQrImage, setReceiptQrImage] = useState<string | null>(null);
  const [receiptQrBusy, setReceiptQrBusy] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(null);

  const publicAppOrigin = getPublicAppOrigin();
  const backendAssetOrigin = getBackendAssetOrigin();
  const receiptUploadUrl = receiptToken ? `${publicAppOrigin}${receiptToken.uploadPagePath}` : null;

  const loadCashManagement = async () => {
    setLoading(true);
    try {
      const { from, to } = buildHistoryRange(rangePreset);

      const [currentResult, historyResult, movementResult] = await Promise.allSettled([
        apiGet<CashSessionSummaryResponse>("/api/management/cash/register/current"),
        apiGet<CashSessionListResponse>(`/api/management/cash/register/history?from=${from}&to=${to}`),
        apiGet<CashMovementListResponse>(`/api/management/cash/movements?from=${from}&to=${to}`),
      ]);

      if (currentResult.status === "fulfilled") {
        setCurrentSession(currentResult.value);
      } else {
        setCurrentSession({ session: null });
      }

      if (historyResult.status === "fulfilled") {
        setSessions(historyResult.value.sessions ?? []);
      } else {
        setSessions([]);
      }

      if (movementResult.status === "fulfilled") {
        setMovements(movementResult.value.movements ?? []);
      } else {
        setMovements([]);
      }

      if (currentResult.status === "rejected") {
        throw currentResult.reason;
      }
      if (historyResult.status === "rejected") {
        error(historyResult.reason instanceof Error ? historyResult.reason.message : "Failed to load register history");
      }
      if (movementResult.status === "rejected") {
        error(
          movementResult.reason instanceof Error
            ? movementResult.reason.message
            : "Failed to load cash movements",
        );
      }
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load cash management");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCashManagement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  useEffect(() => {
    if (!receiptUploadUrl) {
      setReceiptQrImage(null);
      return;
    }

    let cancelled = false;
    setReceiptQrBusy(true);
    QRCode.toDataURL(receiptUploadUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: "#041334",
        light: "#ffffff",
      },
    })
      .then((result) => {
        if (!cancelled) {
          setReceiptQrImage(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReceiptQrImage(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReceiptQrBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [receiptUploadUrl]);

  useEffect(() => {
    if (!receiptPreview) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReceiptPreview(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [receiptPreview]);

  const currentSessionId = currentSession?.session?.id ?? null;
  const currentSessionOpen = Boolean(currentSession?.session);
  const currentBusinessDate = currentSession?.session?.businessDate
    ? new Date(currentSession.session.businessDate).toLocaleDateString()
    : null;
  const currentExpectedCash = currentSession?.totals?.expectedCashPence;

  const pettyExpenseWithoutReceipt = useMemo(
    () =>
      movements.filter(
        (movement) =>
          movement.dbType === "PAID_OUT" &&
          movement.reason === "PETTY_EXPENSE" &&
          !movement.receiptImageUrl,
      ),
    [movements],
  );

  const registerSummary = useMemo(
    () => [
      {
        label: "Register",
        value: currentSessionId ? currentSessionId.slice(0, 8) : "Closed",
        detail: currentSession?.session
          ? new Date(currentSession.session.businessDate).toLocaleDateString()
          : "Start till to take cash",
      },
      {
        label: "Expected cash",
        value: formatMoney(currentSession?.totals?.expectedCashPence),
        detail: "Computed by backend from float, movements, sales, and refunds",
      },
      {
        label: "Paid in / out",
        value: currentSession?.totals
          ? `${formatMoney(currentSession.totals.paidInPence)} / ${formatMoney(currentSession.totals.paidOutPence)}`
          : "-",
        detail: "Manual register movements",
      },
      {
        label: "Cash sales / refunds",
        value: currentSession?.totals
          ? `${formatMoney(currentSession.totals.cashSalesPence)} / ${formatMoney(currentSession.totals.cashRefundsPence)}`
          : "-",
        detail: "Linked to the current open register session",
      },
    ],
    [currentSession, currentSessionId],
  );

  const handleOpenRegister = async () => {
    const openingFloatPence = toPence(openingFloat);
    if (openingFloatPence === null) {
      error("Opening float must be a valid amount");
      return;
    }

    setOpeningRegister(true);
    try {
      const result = await apiPost<CashSessionSummaryResponse>("/api/management/cash/register/open", {
        openingFloatPence,
      });
      setCurrentSession(result);
      setCloseSummary(null);
      success("Register opened");
      await loadCashManagement();
    } catch (requestError) {
      error(requestError instanceof Error ? requestError.message : "Failed to open register");
    } finally {
      setOpeningRegister(false);
    }
  };

  const handleCreateMovement = async () => {
    if (!currentSessionOpen) {
      error("Start the till before recording cash movements");
      return;
    }

    const amountPence = toPence(movementAmount);
    if (amountPence === null || amountPence <= 0) {
      error("Amount must be a valid positive value");
      return;
    }
    if (movementType === "CASH_OUT" && !movementReason) {
      error("Reason is required for cash out");
      return;
    }
    if (movementReason === "OTHER" && !movementNotes.trim()) {
      error("Notes are required when reason is Other");
      return;
    }

    setCreatingMovement(true);
    try {
      const result = await apiPost<CashMovementCreateResponse>("/api/management/cash/movements", {
        type: movementType,
        amountPence,
        ...(movementType === "CASH_OUT" ? { reason: movementReason } : {}),
        ...(movementNotes.trim() ? { notes: movementNotes.trim() } : {}),
      });

      setCurrentSession(result.summary);
      setMovementAmount("");
      setMovementNotes("");
      success(movementType === "CASH_IN" ? "Cash in recorded" : "Cash out recorded");

      if (movementType === "CASH_OUT" && movementReason === "PETTY_EXPENSE") {
        const token = await apiPost<ReceiptTokenResponse>(
          `/api/management/cash/movements/${encodeURIComponent(result.movement.id)}/receipt-token`,
        );
        setReceiptToken(token);
      }

      await loadCashManagement();
    } catch (requestError) {
      error(requestError instanceof Error ? requestError.message : "Failed to record cash movement");
    } finally {
      setCreatingMovement(false);
    }
  };

  const handleCloseRegister = async () => {
    if (!currentSessionOpen) {
      error("No register is currently open");
      return;
    }

    const countedAmountPence = toPence(countedAmount);
    if (countedAmountPence === null || countedAmountPence < 0) {
      error("Counted amount must be a valid value");
      return;
    }

    setClosingRegister(true);
    try {
      const result = await apiPost<CashSessionSummaryResponse>("/api/management/cash/register/close", {
        countedAmountPence,
        ...(closeNotes.trim() ? { notes: closeNotes.trim() } : {}),
      });
      setCloseSummary(result);
      setCurrentSession({ session: null });
      setCountedAmount("");
      setCloseNotes("");
      success("Register closed");
      await loadCashManagement();
    } catch (requestError) {
      error(requestError instanceof Error ? requestError.message : "Failed to close register");
    } finally {
      setClosingRegister(false);
    }
  };

  const handleCreateReceiptToken = async (movementId: string) => {
    try {
      const token = await apiPost<ReceiptTokenResponse>(
        `/api/management/cash/movements/${encodeURIComponent(movementId)}/receipt-token`,
      );
      setReceiptToken(token);
      success("Receipt QR created");
    } catch (requestError) {
      error(requestError instanceof Error ? requestError.message : "Failed to create receipt QR");
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Cash Management</h1>
            <p className="muted-text">
              Start tills, record manual cash movement, blind close registers, and attach petty cash receipts.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={String(rangePreset)} onChange={(event) => setRangePreset(normalizeRangePreset(event.target.value))}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadCashManagement()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {currentSessionOpen ? (
          <div className="cash-register-banner cash-register-banner-open">
            <strong>Register OPEN</strong>
            <span>
              Session {currentSessionId?.slice(0, 8)}
              {currentBusinessDate ? ` — ${currentBusinessDate}` : ""}
              {currentExpectedCash !== undefined ? ` — Expected cash ${formatMoney(currentExpectedCash)}` : ""}
            </span>
          </div>
        ) : (
          <div className="cash-register-banner cash-register-banner-closed">
            <strong>Register CLOSED</strong>
            <span>Start a till to begin trading.</span>
          </div>
        )}

        <div className="dashboard-summary-grid">
          {registerSummary.map((item) => (
            <div key={item.label} className="metric-card">
              <span className="metric-label">{item.label}</span>
              <strong className="metric-value">{item.value}</strong>
              <span className="dashboard-metric-detail">{item.detail}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        {!currentSessionOpen ? (
          <section className="card cash-action-card">
            <div className="card-header-row">
              <h2>Start Till</h2>
            </div>
            <div className="cash-form-grid">
              <label>
                Opening float (£)
                <input
                  value={openingFloat}
                  onChange={(event) => setOpeningFloat(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </label>
              <button type="button" onClick={() => void handleOpenRegister()} disabled={openingRegister}>
                {openingRegister ? "Starting..." : "Start Till"}
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="card cash-action-card">
              <div className="card-header-row">
                <h2>Cash In / Cash Out</h2>
              </div>
              <div className="cash-form-grid cash-form-grid-wide">
                <label>
                  Type
                  <select value={movementType} onChange={(event) => setMovementType(event.target.value as MovementType)}>
                    <option value="CASH_IN">Cash in</option>
                    <option value="CASH_OUT">Cash out</option>
                  </select>
                </label>
                <label>
                  Amount (£)
                  <input
                    value={movementAmount}
                    onChange={(event) => setMovementAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
                {movementType === "CASH_OUT" ? (
                  <label>
                    Reason
                    <select
                      value={movementReason}
                      onChange={(event) => setMovementReason(event.target.value as CashMovementReason)}
                    >
                      {CASH_OUT_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="cash-notes-field">
                  Notes
                  <input
                    value={movementNotes}
                    onChange={(event) => setMovementNotes(event.target.value)}
                    placeholder={movementReason === "OTHER" ? "Required for Other" : "Optional"}
                  />
                </label>
                <button type="button" onClick={() => void handleCreateMovement()} disabled={creatingMovement}>
                  {creatingMovement ? "Saving..." : movementType === "CASH_IN" ? "Record Cash In" : "Record Cash Out"}
                </button>
              </div>
            </section>

            <section className="card cash-action-card">
              <div className="card-header-row">
                <h2>Blind Close</h2>
              </div>
              <div className="cash-form-grid cash-form-grid-wide">
                <label>
                  Counted amount (£)
                  <input
                    value={countedAmount}
                    onChange={(event) => setCountedAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
                <label className="cash-notes-field">
                  Close notes
                  <input
                    value={closeNotes}
                    onChange={(event) => setCloseNotes(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <button type="button" onClick={() => void handleCloseRegister()} disabled={closingRegister}>
                  {closingRegister ? "Closing..." : "Close Till"}
                </button>
              </div>

              {closeSummary?.session ? (
                <div className="cash-close-summary">
                  <div className="metric-card">
                    <span className="metric-label">Expected</span>
                    <strong className="metric-value">{formatMoney(closeSummary.totals?.expectedCashPence)}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">Counted</span>
                    <strong className="metric-value">{formatMoney(closeSummary.totals?.countedCashPence)}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">Difference</span>
                    <strong className="metric-value">{formatMoney(closeSummary.totals?.variancePence)}</strong>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        )}

        {receiptToken ? (
          <section className="card cash-qr-card">
            <div className="card-header-row">
              <h2>Scan QR to upload receipt</h2>
              <button type="button" onClick={() => setReceiptToken(null)}>
                Clear
              </button>
            </div>
            <p className="muted-text">
              Use a phone to upload the petty cash receipt. The token expires at{" "}
              {new Date(receiptToken.expiresAt).toLocaleTimeString()}.
            </p>
            <div className="cash-qr-layout">
              <div className="cash-qr-box">
                {receiptQrBusy ? <span>Generating QR...</span> : receiptQrImage ? <img src={receiptQrImage} alt="Receipt upload QR code" /> : <span>QR unavailable</span>}
              </div>
              <div className="cash-qr-copy">
                <code>{receiptUploadUrl}</code>
                <a href={receiptUploadUrl ?? receiptToken.uploadPagePath} target="_blank" rel="noreferrer">
                  Open upload page
                </a>
              </div>
            </div>
          </section>
        ) : null}

        {pettyExpenseWithoutReceipt.length > 0 ? (
          <section className="card">
            <div className="card-header-row">
              <h2>Petty Expenses Awaiting Receipt</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Amount</th>
                    <th>Notes</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {pettyExpenseWithoutReceipt.map((movement) => (
                    <tr key={movement.id}>
                      <td>{new Date(movement.createdAt).toLocaleString()}</td>
                      <td>{formatMoney(movement.amountPence)}</td>
                      <td>{movement.note ?? "-"}</td>
                      <td>
                        <button type="button" onClick={() => void handleCreateReceiptToken(movement.id)}>
                          Generate QR
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="card">
          <div className="card-header-row">
            <h2>Register History</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Business Date</th>
                  <th>Session</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th>Float</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No register sessions found in this range.</td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr key={session.id}>
                      <td>{new Date(session.businessDate).toLocaleDateString()}</td>
                      <td className="mono-text">{session.id.slice(0, 8)}</td>
                      <td>{session.status}</td>
                      <td>{new Date(session.openedAt).toLocaleString()}</td>
                      <td>{session.closedAt ? new Date(session.closedAt).toLocaleString() : "-"}</td>
                      <td>{formatMoney(session.openingFloatPence)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Cash Movements</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Amount</th>
                  <th>Notes</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No cash movements found in this range.</td>
                  </tr>
                ) : (
                  movements.map((movement) => (
                    (() => {
                      const resolvedReceiptUrl = toPublicAssetUrl(movement.receiptImageUrl, backendAssetOrigin);
                      const receiptLabel = `Receipt ${new Date(movement.createdAt).toLocaleString()}`;

                      return (
                        <tr key={movement.id}>
                          <td>{new Date(movement.createdAt).toLocaleString()}</td>
                          <td>{movement.dbType}</td>
                          <td>{movement.reason ?? "-"}</td>
                          <td>{formatMoney(movement.amountPence)}</td>
                          <td>{movement.note ?? "-"}</td>
                          <td>
                            {resolvedReceiptUrl ? (
                              <div className="cash-receipt-cell">
                                <button
                                  type="button"
                                  className="cash-receipt-trigger"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setReceiptPreview({
                                      url: resolvedReceiptUrl,
                                      label: receiptLabel,
                                    });
                                  }}
                                >
                                  Receipt
                                </button>
                                <span className="cash-receipt-badge">Attached</span>
                              </div>
                            ) : movement.dbType === "PAID_OUT" && movement.reason === "PETTY_EXPENSE" ? (
                              <button type="button" onClick={() => void handleCreateReceiptToken(movement.id)}>
                                Add receipt
                              </button>
                            ) : (
                              <span className="cash-receipt-empty">No receipt</span>
                            )}
                          </td>
                        </tr>
                      );
                    })()
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {receiptPreview ? (
        <div
          className="cash-receipt-overlay"
          role="presentation"
          onClick={() => setReceiptPreview(null)}
        >
          <div
            className="cash-receipt-modal"
            role="dialog"
            aria-modal="true"
            aria-label={receiptPreview.label}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="card-header-row">
              <div>
                <h2>Receipt Preview</h2>
                <p className="muted-text">{receiptPreview.label}</p>
              </div>
              <button type="button" onClick={() => setReceiptPreview(null)}>
                Close
              </button>
            </div>
            <div className="cash-receipt-preview">
              <img src={receiptPreview.url} alt={receiptPreview.label} />
            </div>
            <div className="cash-receipt-actions">
              <a href={receiptPreview.url} target="_blank" rel="noopener noreferrer">
                Open in new tab
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
