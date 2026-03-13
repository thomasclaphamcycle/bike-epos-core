import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";

type WorkflowState = "DRAFT" | "COUNTING" | "REVIEW" | "COMPLETED" | "CANCELLED";
type StocktakeStatus = "OPEN" | "POSTED" | "CANCELLED";

type LocationRow = {
  id: string;
  name: string;
  isDefault: boolean;
};

type LocationListResponse = {
  locations: LocationRow[];
};

type VariantSearchRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  product?: {
    id: string;
    name: string;
    brand: string | null;
  };
};

type VariantListResponse = {
  variants: VariantSearchRow[];
};

type StocktakeLine = {
  id: string;
  stocktakeId: string;
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  countedQty: number;
  expectedQty: number | null;
  varianceQty: number | null;
  currentOnHand?: number;
  deltaNeeded?: number;
  hasLiveDrift?: boolean;
  createdAt: string;
  updatedAt: string;
};

type StocktakeSession = {
  id: string;
  locationId: string;
  location: LocationRow;
  status: StocktakeStatus;
  workflowState: WorkflowState;
  startedAt: string;
  reviewRequestedAt: string | null;
  postedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  lines?: StocktakeLine[];
};

type StocktakeListResponse = {
  stocktakes: StocktakeSession[];
};

type StocktakeScanResponse = {
  stocktake: StocktakeSession;
  scannedLine: {
    variantId: string;
    sku: string;
    variantName: string | null;
    productId: string;
    productName: string;
    countedQty: number;
    quantityDelta: number;
  };
};

type StocktakeBulkResponse = {
  stocktake: StocktakeSession;
  appliedCount: number;
};

type RecentScan = {
  code: string;
  sku: string;
  productName: string;
  countedQty: number;
  quantityDelta: number;
};

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

const formatSignedQuantity = (quantity: number | null | undefined) => {
  if (quantity === null || quantity === undefined) {
    return "-";
  }
  return quantity > 0 ? `+${quantity}` : `${quantity}`;
};

const getWorkflowBadgeClass = (state: WorkflowState) => {
  switch (state) {
    case "COMPLETED":
      return "stock-badge stock-good";
    case "REVIEW":
      return "stock-badge stock-state-low";
    case "CANCELLED":
      return "stock-badge stock-state-negative";
    case "COUNTING":
      return "stock-badge stock-muted";
    case "DRAFT":
    default:
      return "stock-badge stock-state-zero";
  }
};

const getSignedQuantityClass = (quantity: number | null | undefined) => {
  if (quantity === null || quantity === undefined || quantity === 0) {
    return "";
  }
  return quantity < 0 ? "movement-negative" : "movement-positive";
};

export const InventoryStocktakesPage = () => {
  const { error, success } = useToasts();
  const variantSearchInputRef = useRef<HTMLInputElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSession, setSelectedSession] = useState<StocktakeSession | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | StocktakeStatus>("");
  const [createLocationId, setCreateLocationId] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);
  const [actioningSession, setActioningSession] = useState(false);

  const [variantSearch, setVariantSearch] = useState("");
  const debouncedVariantSearch = useDebouncedValue(variantSearch, 250);
  const [variantResults, setVariantResults] = useState<VariantSearchRow[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [savingLine, setSavingLine] = useState(false);
  const [deletingLineId, setDeletingLineId] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [scanQuantityDelta, setScanQuantityDelta] = useState("1");
  const [scanningLine, setScanningLine] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  const loadLocations = async () => {
    try {
      const payload = await apiGet<LocationListResponse>("/api/locations");
      const nextLocations = payload.locations || [];
      setLocations(nextLocations);
      setCreateLocationId((current) => {
        if (current && nextLocations.some((location) => location.id === current)) {
          return current;
        }
        return nextLocations.find((location) => location.isDefault)?.id ?? nextLocations[0]?.id ?? "";
      });
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load stock locations");
    }
  };

  const loadSessions = async (preferredSelectedId?: string) => {
    setLoadingSessions(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) {
        params.set("status", statusFilter);
      }
      params.set("take", "50");
      params.set("skip", "0");

      const payload = await apiGet<StocktakeListResponse>(`/api/stocktake/sessions?${params.toString()}`);
      const nextSessions = payload.stocktakes || [];
      setSessions(nextSessions);

      const requestedId = preferredSelectedId ?? selectedSessionId;
      const nextSelectedId =
        requestedId && nextSessions.some((session) => session.id === requestedId)
          ? requestedId
          : nextSessions[0]?.id ?? "";
      setSelectedSessionId(nextSelectedId);
      if (!nextSelectedId) {
        setSelectedSession(null);
      }
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load stocktake sessions");
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadSelectedSession = async (sessionId: string) => {
    if (!sessionId) {
      setSelectedSession(null);
      return;
    }

    setLoadingSessionDetail(true);
    try {
      const payload = await apiGet<StocktakeSession>(
        `/api/stocktake/sessions/${encodeURIComponent(sessionId)}?includePreview=true`,
      );
      setSelectedSession(payload);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load stocktake session");
      setSelectedSession(null);
    } finally {
      setLoadingSessionDetail(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadLocations(), loadSessions()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null);
      return;
    }
    void loadSelectedSession(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSession || selectedSession.status !== "OPEN" || !debouncedVariantSearch.trim()) {
      setVariantResults([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const payload = await apiGet<VariantListResponse>(
          `/api/variants?q=${encodeURIComponent(debouncedVariantSearch.trim())}&active=1&take=25&skip=0`,
        );
        if (cancelled) {
          return;
        }
        const nextVariants = payload.variants || [];
        setVariantResults(nextVariants);
        setSelectedVariantId((current) => {
          if (current && nextVariants.some((variant) => variant.id === current)) {
            return current;
          }
          return nextVariants[0]?.id ?? "";
        });
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to search variants");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedVariantSearch, error, selectedSession]);

  useEffect(() => {
    setRecentScans([]);
    setScanCode("");
    setBulkImportText("");
  }, [selectedSessionId]);

  const selectedLines = selectedSession?.lines ?? [];
  const selectedSessionIsOpen = selectedSession?.status === "OPEN";
  const canRequestReview =
    selectedSessionIsOpen &&
    selectedLines.length > 0 &&
    selectedSession?.workflowState !== "REVIEW" &&
    !actioningSession;
  const canFinalize = selectedSessionIsOpen && selectedLines.length > 0 && !actioningSession;
  const canCancel = selectedSessionIsOpen && !actioningSession;

  const sessionMetrics = useMemo(() => {
    const lines = selectedSession?.lines ?? [];
    return {
      countedUnits: lines.reduce((sum, line) => sum + line.countedQty, 0),
      varianceLines: lines.filter((line) => (line.varianceQty ?? 0) !== 0).length,
      liveAdjustmentLines: lines.filter((line) => (line.deltaNeeded ?? 0) !== 0).length,
      liveDriftLines: lines.filter((line) => line.hasLiveDrift).length,
    };
  }, [selectedSession]);

  const parsedScanQuantityDelta = useMemo(() => {
    if (!scanQuantityDelta.trim()) {
      return null;
    }

    const parsed = Number.parseInt(scanQuantityDelta, 10);
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  }, [scanQuantityDelta]);

  const bulkImportPreview = useMemo(() => {
    const lines = bulkImportText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedLines: Array<{ code: string; countedQty: number }> = [];
    const errors: string[] = [];

    lines.forEach((line, index) => {
      const commaParts = line.split(",").map((part) => part.trim()).filter(Boolean);
      const parts = commaParts.length >= 2 ? commaParts : line.split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        errors.push(`Line ${index + 1}: use "barcode qty" or "barcode,qty".`);
        return;
      }

      const code = parts[0];
      const countedQty = Number.parseInt(parts[1], 10);
      if (!Number.isInteger(countedQty) || countedQty < 0) {
        errors.push(`Line ${index + 1}: counted quantity must be a non-negative integer.`);
        return;
      }

      parsedLines.push({ code, countedQty });
    });

    return {
      parsedLines,
      errors,
    };
  }, [bulkImportText]);

  const createSession = async () => {
    if (!createLocationId) {
      error("Choose a stock location before creating a session.");
      return;
    }

    setCreatingSession(true);
    try {
      const payload = await apiPost<StocktakeSession>("/api/stocktake/sessions", {
        locationId: createLocationId,
        notes: createNotes.trim() || undefined,
      });
      setCreateNotes("");
      success("Stocktake session created.");
      await loadSessions(payload.id);
      await loadSelectedSession(payload.id);
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create stocktake session");
    } finally {
      setCreatingSession(false);
    }
  };

  const requestReview = async () => {
    if (!selectedSession) {
      return;
    }

    setActioningSession(true);
    try {
      const payload = await apiPost<StocktakeSession>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/review`,
      );
      setSelectedSession(payload);
      await loadSessions(selectedSession.id);
      success("Stocktake moved to review.");
    } catch (requestError) {
      error(requestError instanceof Error ? requestError.message : "Failed to request review");
    } finally {
      setActioningSession(false);
    }
  };

  const finalizeSession = async () => {
    if (!selectedSession) {
      return;
    }

    setActioningSession(true);
    try {
      const payload = await apiPost<StocktakeSession>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/finalize`,
      );
      setSelectedSession(payload);
      await loadSessions(selectedSession.id);
      success("Stocktake finalized and adjustments posted.");
    } catch (finalizeError) {
      error(finalizeError instanceof Error ? finalizeError.message : "Failed to finalize stocktake");
    } finally {
      setActioningSession(false);
    }
  };

  const cancelSession = async () => {
    if (!selectedSession) {
      return;
    }

    setActioningSession(true);
    try {
      const payload = await apiPost<StocktakeSession>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/cancel`,
      );
      setSelectedSession(payload);
      await loadSessions(selectedSession.id);
      success("Stocktake cancelled.");
    } catch (cancelError) {
      error(cancelError instanceof Error ? cancelError.message : "Failed to cancel stocktake");
    } finally {
      setActioningSession(false);
    }
  };

  const saveLine = async () => {
    if (!selectedSession) {
      return;
    }

    const parsedCountedQty = Number.parseInt(countedQty, 10);
    if (!selectedVariantId) {
      error("Choose a variant before saving a count.");
      return;
    }
    if (!Number.isInteger(parsedCountedQty) || parsedCountedQty < 0) {
      error("Counted quantity must be a non-negative whole number.");
      return;
    }

    setSavingLine(true);
    try {
      const payload = await apiPost<StocktakeSession>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/lines`,
        {
          variantId: selectedVariantId,
          countedQty: parsedCountedQty,
        },
      );
      setSelectedSession(payload);
      setCountedQty("");
      success("Stocktake line saved.");
      await loadSessions(selectedSession.id);
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save stocktake line");
    } finally {
      setSavingLine(false);
    }
  };

  const scanLine = async () => {
    if (!selectedSession) {
      return;
    }
    if (!scanCode.trim()) {
      error("Scan or enter a barcode or SKU first.");
      return;
    }
    if (parsedScanQuantityDelta === null || Number.isNaN(parsedScanQuantityDelta) || parsedScanQuantityDelta <= 0) {
      error("Scan quantity must be a positive whole number.");
      return;
    }

    setScanningLine(true);
    try {
      const payload = await apiPost<StocktakeScanResponse>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/scan`,
        {
          code: scanCode.trim(),
          quantityDelta: parsedScanQuantityDelta,
        },
      );
      setSelectedSession(payload.stocktake);
      setRecentScans((current) => [
        {
          code: scanCode.trim(),
          sku: payload.scannedLine.sku,
          productName: payload.scannedLine.productName,
          countedQty: payload.scannedLine.countedQty,
          quantityDelta: payload.scannedLine.quantityDelta,
        },
        ...current,
      ].slice(0, 8));
      setScanCode("");
      success(
        `${payload.scannedLine.productName} counted to ${payload.scannedLine.countedQty}.`,
      );
      await loadSessions(selectedSession.id);
      window.requestAnimationFrame(() => {
        scanInputRef.current?.focus();
      });
    } catch (scanError) {
      error(scanError instanceof Error ? scanError.message : "Failed to scan stocktake line");
    } finally {
      setScanningLine(false);
    }
  };

  const applyBulkImport = async () => {
    if (!selectedSession) {
      return;
    }
    if (bulkImportPreview.parsedLines.length === 0) {
      error("Add at least one barcode/SKU and counted quantity before importing.");
      return;
    }
    if (bulkImportPreview.errors.length > 0) {
      error("Fix the bulk import rows before applying them.");
      return;
    }

    setBulkImporting(true);
    try {
      const payload = await apiPost<StocktakeBulkResponse>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/bulk-lines`,
        {
          lines: bulkImportPreview.parsedLines,
        },
      );
      setSelectedSession(payload.stocktake);
      setBulkImportText("");
      success(`Applied ${payload.appliedCount} bulk stocktake count${payload.appliedCount === 1 ? "" : "s"}.`);
      await loadSessions(selectedSession.id);
      window.requestAnimationFrame(() => {
        scanInputRef.current?.focus();
      });
    } catch (bulkError) {
      error(bulkError instanceof Error ? bulkError.message : "Failed to import bulk counts");
    } finally {
      setBulkImporting(false);
    }
  };

  const adjustSavedLine = async (line: StocktakeLine, delta: number) => {
    if (!selectedSession) {
      return;
    }

    const nextCount = line.countedQty + delta;
    if (nextCount < 0) {
      error("Counted quantity cannot go below zero.");
      return;
    }

    setSavingLine(true);
    try {
      const payload = await apiPost<StocktakeSession>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/lines`,
        {
          variantId: line.variantId,
          countedQty: nextCount,
        },
      );
      setSelectedSession(payload);
      success(`${line.productName} counted quantity updated to ${nextCount}.`);
      await loadSessions(selectedSession.id);
    } catch (adjustError) {
      error(adjustError instanceof Error ? adjustError.message : "Failed to adjust counted line");
    } finally {
      setSavingLine(false);
    }
  };

  const deleteLine = async (lineId: string) => {
    if (!selectedSession) {
      return;
    }

    setDeletingLineId(lineId);
    try {
      const payload = await apiDelete<StocktakeSession>(
        `/api/stocktake/sessions/${encodeURIComponent(selectedSession.id)}/lines/${encodeURIComponent(lineId)}`,
      );
      setSelectedSession(payload);
      success("Stocktake line removed.");
      await loadSessions(selectedSession.id);
    } catch (deleteError) {
      error(deleteError instanceof Error ? deleteError.message : "Failed to remove stocktake line");
    } finally {
      setDeletingLineId("");
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Stocktakes</h1>
            <p className="muted-text">
              Session-based stock counting with expected snapshots, review, and controlled variance posting back into the stock adjustment ledger.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/inventory">Inventory</Link>
            <Link to="/inventory/locations">By location</Link>
            <button type="button" onClick={() => void loadSessions(selectedSessionId)} disabled={loadingSessions}>
              {loadingSessions ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="purchase-form-grid">
          <label>
            Stock Location
            <select value={createLocationId} onChange={(event) => setCreateLocationId(event.target.value)}>
              {locations.length === 0 ? <option value="">No locations</option> : null}
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}{location.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="purchase-form-wide">
            Notes
            <input
              value={createNotes}
              onChange={(event) => setCreateNotes(event.target.value)}
              placeholder="Optional session notes"
            />
          </label>

          <div className="actions-inline" style={{ alignSelf: "end" }}>
            <button type="button" className="primary" onClick={() => void createSession()} disabled={creatingSession || !createLocationId}>
              {creatingSession ? "Creating..." : "Create Session"}
            </button>
          </div>
        </div>
      </section>

      <div className="calendar-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Sessions</h2>
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | StocktakeStatus)}>
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="POSTED">Posted</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Location</th>
                  <th>Workflow</th>
                  <th>Lines</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{loadingSessions ? "Loading sessions..." : "No stocktake sessions found."}</td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      style={{
                        cursor: "pointer",
                        background: session.id === selectedSessionId ? "#f5f9fc" : undefined,
                      }}
                    >
                      <td>
                        <div className="table-primary mono-text">{session.id.slice(0, 8)}</div>
                        <div className="table-secondary">{session.notes || "No notes"}</div>
                      </td>
                      <td>{session.location.name}</td>
                      <td>
                        <span className={getWorkflowBadgeClass(session.workflowState)}>
                          {session.workflowState}
                        </span>
                      </td>
                      <td>{session.lineCount}</td>
                      <td>{formatDateTime(session.startedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Selected Session</h2>
              <p className="muted-text">
                Review uses the stored expected snapshot. Finalize posts live corrections to bring on-hand stock to the counted quantity.
              </p>
            </div>
            {selectedSession ? (
              <div className="actions-inline">
                <button type="button" onClick={() => void requestReview()} disabled={!canRequestReview}>
                  {actioningSession && selectedSession.workflowState !== "REVIEW" ? "Updating..." : "Request Review"}
                </button>
                <button type="button" className="primary" onClick={() => void finalizeSession()} disabled={!canFinalize}>
                  {actioningSession ? "Finalizing..." : "Finalize"}
                </button>
                <button type="button" onClick={() => void cancelSession()} disabled={!canCancel}>
                  Cancel
                </button>
              </div>
            ) : null}
          </div>

          {!selectedSession ? (
            <p className="muted-text">Choose a stocktake session to view counts and variances.</p>
          ) : loadingSessionDetail ? (
            <p>Loading stocktake detail...</p>
          ) : (
            <>
              <div className="detail-grid">
                <div>
                  <strong>ID:</strong>
                  <div className="mono-text">{selectedSession.id}</div>
                </div>
                <div>
                  <strong>Location:</strong>
                  <div>{selectedSession.location.name}</div>
                </div>
                <div>
                  <strong>Workflow:</strong>
                  <div>
                    <span className={getWorkflowBadgeClass(selectedSession.workflowState)}>
                      {selectedSession.workflowState}
                    </span>
                  </div>
                </div>
                <div>
                  <strong>Review Requested:</strong>
                  <div>{formatDateTime(selectedSession.reviewRequestedAt)}</div>
                </div>
                <div>
                  <strong>Posted:</strong>
                  <div>{formatDateTime(selectedSession.postedAt)}</div>
                </div>
                <div>
                  <strong>Notes:</strong>
                  <div>{selectedSession.notes || "-"}</div>
                </div>
              </div>

              <div className="management-stat-grid">
                <div className="management-stat-card">
                  <span className="metric-label">Counted Lines</span>
                  <strong className="metric-value">{selectedLines.length}</strong>
                </div>
                <div className="management-stat-card">
                  <span className="metric-label">Counted Units</span>
                  <strong className="metric-value">{sessionMetrics.countedUnits}</strong>
                </div>
                <div className="management-stat-card">
                  <span className="metric-label">Snapshot Variances</span>
                  <strong className="metric-value">{sessionMetrics.varianceLines}</strong>
                </div>
                <div className="management-stat-card">
                  <span className="metric-label">Live Corrections</span>
                  <strong className="metric-value">{sessionMetrics.liveAdjustmentLines}</strong>
                </div>
              </div>

              {sessionMetrics.liveDriftLines > 0 ? (
                <div className="restricted-panel warning-panel" style={{ marginBottom: "12px" }}>
                  {sessionMetrics.liveDriftLines} counted line{sessionMetrics.liveDriftLines === 1 ? "" : "s"} changed on-hand after the snapshot was taken. Review the live correction column before finalizing.
                </div>
              ) : null}

              {selectedSession.status === "OPEN" ? (
                <section>
                  <div className="card-header-row" style={{ marginBottom: "10px" }}>
                    <div>
                      <h3>Scan Mode</h3>
                      <p className="muted-text">
                        Scan the barcode or SKU and CorePOS increments the counted quantity on the matching line without touching the stored snapshot.
                      </p>
                    </div>
                  </div>

                  <div className="purchase-form-grid">
                    <label className="purchase-form-wide">
                      Scan Barcode / SKU
                      <input
                        ref={scanInputRef}
                        value={scanCode}
                        onChange={(event) => setScanCode(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") {
                            return;
                          }
                          event.preventDefault();
                          void scanLine();
                        }}
                        placeholder="scan barcode or SKU"
                        data-testid="stocktake-scan-code"
                      />
                    </label>

                    <label>
                      Scan Qty
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={scanQuantityDelta}
                        onChange={(event) => setScanQuantityDelta(event.target.value)}
                        placeholder="1"
                      />
                    </label>

                    <div className="actions-inline" style={{ alignSelf: "end" }}>
                      {[1, 5, 10].map((value) => (
                        <button key={value} type="button" onClick={() => setScanQuantityDelta(String(value))}>
                          +{value}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void scanLine()}
                        disabled={scanningLine || !scanCode.trim()}
                      >
                        {scanningLine ? "Scanning..." : "Count Scan"}
                      </button>
                    </div>
                  </div>

                  {recentScans.length > 0 ? (
                    <div className="table-wrap" style={{ marginBottom: "16px" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Recent Scan</th>
                            <th>Code</th>
                            <th>Change</th>
                            <th>Counted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentScans.map((scan, index) => (
                            <tr key={`${scan.sku}-${index}`}>
                              <td>
                                <div className="table-primary">{scan.productName}</div>
                                <div className="table-secondary mono-text">{scan.sku}</div>
                              </td>
                              <td className="mono-text">{scan.code}</td>
                              <td className={getSignedQuantityClass(scan.quantityDelta)}>{formatSignedQuantity(scan.quantityDelta)}</td>
                              <td>{scan.countedQty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div className="card-header-row" style={{ marginBottom: "10px" }}>
                    <div>
                      <h3>Bulk Count Import</h3>
                      <p className="muted-text">
                        Paste one count per line using <span className="mono-text">barcode qty</span> or <span className="mono-text">barcode,qty</span>. CorePOS applies them as absolute counted quantities.
                      </p>
                    </div>
                  </div>

                  <div className="purchase-form-grid" style={{ marginBottom: "18px" }}>
                    <label className="purchase-form-wide">
                      Bulk Count Lines
                      <textarea
                        value={bulkImportText}
                        onChange={(event) => setBulkImportText(event.target.value)}
                        placeholder={"DEMO-BC-C52 3\nDEMO-BC-PUMP,7"}
                        rows={5}
                        data-testid="stocktake-bulk-import"
                      />
                    </label>

                    <div className="actions-inline" style={{ alignSelf: "end" }}>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void applyBulkImport()}
                        disabled={bulkImporting || bulkImportPreview.parsedLines.length === 0 || bulkImportPreview.errors.length > 0}
                        data-testid="stocktake-bulk-apply"
                      >
                        {bulkImporting ? "Applying..." : `Apply ${bulkImportPreview.parsedLines.length || ""} Lines`}
                      </button>
                    </div>
                  </div>

                  {bulkImportPreview.parsedLines.length > 0 ? (
                    <p className="muted-text" style={{ marginTop: "-8px", marginBottom: "12px" }}>
                      Ready to apply {bulkImportPreview.parsedLines.length} bulk count line{bulkImportPreview.parsedLines.length === 1 ? "" : "s"}.
                    </p>
                  ) : null}

                  {bulkImportPreview.errors.length > 0 ? (
                    <div className="restricted-panel warning-panel" style={{ marginBottom: "12px" }}>
                      {bulkImportPreview.errors.join(" ")}
                    </div>
                  ) : null}

                  <div className="card-header-row" style={{ marginBottom: "10px" }}>
                    <div>
                      <h3>Add Or Update Count</h3>
                      <p className="muted-text">
                        Search a variant, record the counted quantity, and keep the same expected snapshot for that line.
                      </p>
                    </div>
                  </div>

                  <div className="purchase-form-grid">
                    <label className="purchase-form-wide">
                      Variant Search
                      <input
                        ref={variantSearchInputRef}
                        value={variantSearch}
                        onChange={(event) => setVariantSearch(event.target.value)}
                        placeholder="product, SKU, barcode"
                      />
                    </label>

                    <label>
                      Variant
                      <select value={selectedVariantId} onChange={(event) => setSelectedVariantId(event.target.value)}>
                        <option value="">Select variant</option>
                        {variantResults.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.sku} - {variant.product?.name || variant.id} {variant.option || variant.name || ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Counted Qty
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={countedQty}
                        onChange={(event) => setCountedQty(event.target.value)}
                        placeholder="0"
                      />
                    </label>

                    <div className="actions-inline" style={{ alignSelf: "end" }}>
                      <button type="button" className="primary" onClick={() => void saveLine()} disabled={savingLine || !selectedVariantId || countedQty.trim() === ""}>
                        {savingLine ? "Saving..." : "Save Count"}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}

              <div className="table-wrap">
                <table>
                  <thead>
                        <tr>
                          <th>Product</th>
                          <th>SKU</th>
                          <th>Counted</th>
                          <th>Expected Snapshot</th>
                      <th>Snapshot Variance</th>
                      <th>Current On Hand</th>
                      <th>Live Correction</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLines.length === 0 ? (
                      <tr>
                        <td colSpan={8}>No counted lines yet.</td>
                      </tr>
                    ) : (
                      selectedLines.map((line) => (
                        <tr key={line.id}>
                          <td>
                            <Link to={`/inventory/${line.variantId}`}>{line.productName}</Link>
                            <div className="table-secondary">{line.variantName || "-"}</div>
                            {line.hasLiveDrift ? (
                              <div className="table-secondary" style={{ color: "#8a6500" }}>
                                Snapshot differs from live on-hand
                              </div>
                            ) : null}
                          </td>
                          <td className="mono-text">{line.sku}</td>
                          <td className="numeric-cell" data-testid={`stocktake-line-count-${line.variantId}`}>{line.countedQty}</td>
                          <td className="numeric-cell">{line.expectedQty ?? "-"}</td>
                          <td className={`numeric-cell ${getSignedQuantityClass(line.varianceQty)}`}>
                            {formatSignedQuantity(line.varianceQty)}
                          </td>
                          <td className="numeric-cell">{line.currentOnHand ?? "-"}</td>
                          <td className={`numeric-cell ${getSignedQuantityClass(line.deltaNeeded)}`}>
                            {formatSignedQuantity(line.deltaNeeded)}
                          </td>
                          <td>
                            {selectedSession.status === "OPEN" ? (
                              <div className="actions-inline">
                                <button type="button" onClick={() => void adjustSavedLine(line, -1)} disabled={savingLine || line.countedQty <= 0}>
                                  -1
                                </button>
                                <button type="button" onClick={() => void adjustSavedLine(line, 1)} disabled={savingLine}>
                                  +1
                                </button>
                                <button type="button" onClick={() => void adjustSavedLine(line, 5)} disabled={savingLine}>
                                  +5
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteLine(line.id)}
                                  disabled={deletingLineId === line.id}
                                >
                                  {deletingLineId === line.id ? "Removing..." : "Remove"}
                                </button>
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
