import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ReorderSuggestionRow, reorderUrgencyRank, toReorderSuggestionRow } from "../utils/reordering";

type LocationRow = {
  id: string;
  name: string;
  isDefault: boolean;
};

type LocationListResponse = {
  locations: LocationRow[];
};

type InventoryLocationRow = {
  variantId: string;
  productId: string;
  productName: string;
  brand: string | null;
  sku: string;
  variantName: string | null;
  totalOnHand: number;
  locations: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    onHand: number;
  }>;
};

type InventoryLocationSummaryResponse = {
  summary: {
    variantCount: number;
  };
  locations: LocationRow[];
  rows: InventoryLocationRow[];
};

type InventorySearchRow = {
  variantId: string;
  sku: string;
  barcode: string | null;
  variantName: string | null;
  productId: string;
  productName: string;
  brand: string | null;
  isActive: boolean;
  onHand: number;
};

type InventorySearchResponse = {
  locationId: string | null;
  rows: InventorySearchRow[];
};

type VelocityRow = {
  productId: string;
  productName: string;
  currentOnHand: number;
  quantitySold: number;
  velocityPer30Days: number;
  sellThroughRate: number;
  lastSoldAt: string | null;
};

type VelocityResponse = {
  filters: {
    from: string;
    to: string;
    rangeDays: number;
  };
  products: VelocityRow[];
};

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  supplier: {
    name: string;
  };
  totals: {
    quantityRemaining: number;
  };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

type TransferCandidate = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  sourceLocationId: string;
  sourceLocation: string;
  sourceOnHand: number;
  targetLocationId: string;
  targetLocation: string;
  targetOnHand: number;
  urgency: "Transfer Now" | "Rebalance";
  suggestedQuantity: number;
};

type StockTransferLine = {
  id: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  variantName: string | null;
  productId: string;
  productName: string;
  quantity: number;
};

type StockTransfer = {
  id: string;
  status: "DRAFT" | "SENT" | "RECEIVED" | "CANCELLED";
  notes: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  fromLocation: LocationRow;
  toLocation: LocationRow;
  totals: {
    lineCount: number;
    quantity: number;
  };
  lines: StockTransferLine[];
};

type StockTransferListResponse = {
  transfers: StockTransfer[];
};

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const daysOverdue = (expectedAt: string | null) => {
  if (!expectedAt) {
    return null;
  }
  const diffMs = Date.now() - new Date(expectedAt).getTime();
  return diffMs > 0 ? Math.floor(diffMs / 86_400_000) : null;
};

const formatTransferStatus = (status: StockTransfer["status"]) =>
  status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getSuggestedQuantity = (sourceOnHand: number, targetOnHand: number) =>
  Math.max(1, Math.min(sourceOnHand, Math.ceil((sourceOnHand - targetOnHand) / 2)));

export const TransferQueuePage = () => {
  const { error, success } = useToasts();
  const [locationsPayload, setLocationsPayload] = useState<InventoryLocationSummaryResponse | null>(null);
  const [locationOptions, setLocationOptions] = useState<LocationRow[]>([]);
  const [velocityPayload, setVelocityPayload] = useState<VelocityResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingTransferId, setWorkingTransferId] = useState<string | null>(null);

  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [variantQuery, setVariantQuery] = useState("");
  const [variantMatches, setVariantMatches] = useState<InventorySearchRow[]>([]);
  const [variantSearchLoading, setVariantSearchLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<InventorySearchRow | null>(null);
  const [draftQuantity, setDraftQuantity] = useState("1");
  const [draftNotes, setDraftNotes] = useState("");
  const [creatingDraft, setCreatingDraft] = useState(false);

  const loadQueue = async () => {
    setLoading(true);
    const today = new Date();
    const to = formatDateKey(today);
    const from = formatDateKey(shiftDays(today, -89));

    const [locationSummaryResult, locationListResult, velocityResult, poResult, transferResult] = await Promise.allSettled([
      apiGet<InventoryLocationSummaryResponse>("/api/reports/inventory/location-summary?active=1&take=200"),
      apiGet<LocationListResponse>("/api/locations"),
      apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${from}&to=${to}&take=200`),
      apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0"),
      apiGet<StockTransferListResponse>("/api/stock-transfers?take=100"),
    ]);

    if (locationSummaryResult.status === "fulfilled") {
      setLocationsPayload(locationSummaryResult.value);
    } else {
      setLocationsPayload(null);
      error(locationSummaryResult.reason instanceof Error ? locationSummaryResult.reason.message : "Failed to load location stock summary");
    }

    if (locationListResult.status === "fulfilled") {
      setLocationOptions(locationListResult.value.locations || []);
    } else {
      setLocationOptions([]);
      error(locationListResult.reason instanceof Error ? locationListResult.reason.message : "Failed to load stock locations");
    }

    if (velocityResult.status === "fulfilled") {
      setVelocityPayload(velocityResult.value);
    } else {
      setVelocityPayload(null);
      error(velocityResult.reason instanceof Error ? velocityResult.reason.message : "Failed to load velocity signals");
    }

    if (poResult.status === "fulfilled") {
      setPurchaseOrders(poResult.value.purchaseOrders || []);
    } else {
      setPurchaseOrders([]);
      error(poResult.reason instanceof Error ? poResult.reason.message : "Failed to load purchasing queue");
    }

    if (transferResult.status === "fulfilled") {
      setTransfers(transferResult.value.transfers || []);
    } else {
      setTransfers([]);
      error(transferResult.reason instanceof Error ? transferResult.reason.message : "Failed to load stock transfers");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fromLocationId || variantQuery.trim().length < 2) {
      setVariantMatches([]);
      return;
    }

    let cancelled = false;

    const loadMatches = async () => {
      setVariantSearchLoading(true);
      try {
        const params = new URLSearchParams({
          locationId: fromLocationId,
          q: variantQuery.trim(),
          take: "10",
        });
        const payload = await apiGet<InventorySearchResponse>(`/api/inventory/on-hand/search?${params.toString()}`);
        if (!cancelled) {
          setVariantMatches(payload.rows || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setVariantMatches([]);
          error(loadError instanceof Error ? loadError.message : "Failed to search source stock");
        }
      } finally {
        if (!cancelled) {
          setVariantSearchLoading(false);
        }
      }
    };

    void loadMatches();

    return () => {
      cancelled = true;
    };
  }, [error, fromLocationId, variantQuery]);

  const transferCandidates = useMemo<TransferCandidate[]>(() => {
    const rows = locationsPayload?.rows ?? [];
    return rows
      .map((row) => {
        const sorted = [...row.locations].sort((left, right) => right.onHand - left.onHand);
        const source = sorted[0];
        const target = sorted[sorted.length - 1];
        if (!source || !target || source.id === target.id) {
          return null;
        }
        if (source.onHand <= 0 || target.onHand > 0) {
          return null;
        }
        return {
          variantId: row.variantId,
          productId: row.productId,
          productName: row.productName,
          variantName: row.variantName,
          sku: row.sku,
          barcode: null,
          sourceLocationId: source.id,
          sourceLocation: source.name,
          sourceOnHand: source.onHand,
          targetLocationId: target.id,
          targetLocation: target.name,
          targetOnHand: target.onHand,
          urgency: target.onHand <= 0 ? "Transfer Now" : "Rebalance",
          suggestedQuantity: getSuggestedQuantity(source.onHand, target.onHand),
        } satisfies TransferCandidate;
      })
      .filter((row): row is TransferCandidate => row !== null)
      .sort((left, right) => (
        (left.urgency === "Transfer Now" ? 1 : 0) - (right.urgency === "Transfer Now" ? 1 : 0) === 0
          ? left.targetOnHand - right.targetOnHand
          : (left.urgency === "Transfer Now" ? -1 : 1)
      ));
  }, [locationsPayload?.rows]);

  const replenishmentAttention = useMemo(() => {
    if (!velocityPayload) {
      return [] as ReorderSuggestionRow[];
    }
    return velocityPayload.products
      .map((row) => toReorderSuggestionRow(row, velocityPayload.filters.rangeDays))
      .filter((row) => row.urgency !== "Low")
      .sort((left, right) => (
        reorderUrgencyRank[right.urgency] - reorderUrgencyRank[left.urgency]
        || right.suggestedReorderQty - left.suggestedReorderQty
        || left.productName.localeCompare(right.productName)
      ))
      .slice(0, 20);
  }, [velocityPayload]);

  const overduePurchaseOrders = useMemo(
    () => purchaseOrders
      .filter((po) => po.status !== "RECEIVED" && po.status !== "CANCELLED")
      .filter((po) => po.totals.quantityRemaining > 0)
      .filter((po) => (daysOverdue(po.expectedAt) ?? -1) >= 0)
      .sort((left, right) => (daysOverdue(right.expectedAt) ?? 0) - (daysOverdue(left.expectedAt) ?? 0)),
    [purchaseOrders],
  );

  const openTransfers = useMemo(
    () => transfers.filter((transfer) => transfer.status === "DRAFT" || transfer.status === "SENT"),
    [transfers],
  );
  const recentTransfers = useMemo(
    () => transfers.filter((transfer) => transfer.status === "RECEIVED").slice(0, 10),
    [transfers],
  );

  const selectedVariantAvailable = selectedVariant?.onHand ?? 0;

  const resetDraftForm = () => {
    setVariantQuery("");
    setVariantMatches([]);
    setSelectedVariant(null);
    setDraftQuantity("1");
    setDraftNotes("");
  };

  const prefillFromCandidate = (candidate: TransferCandidate) => {
    setFromLocationId(candidate.sourceLocationId);
    setToLocationId(candidate.targetLocationId);
    setVariantQuery(candidate.sku);
    setVariantMatches([]);
    setSelectedVariant({
      variantId: candidate.variantId,
      sku: candidate.sku,
      barcode: candidate.barcode,
      variantName: candidate.variantName,
      productId: candidate.productId,
      productName: candidate.productName,
      brand: null,
      isActive: true,
      onHand: candidate.sourceOnHand,
    });
    setDraftQuantity(String(candidate.suggestedQuantity));
  };

  const createDraft = async () => {
    const parsedQuantity = Number.parseInt(draftQuantity, 10);
    if (!fromLocationId || !toLocationId) {
      error("Choose both source and target locations.");
      return;
    }
    if (fromLocationId === toLocationId) {
      error("Source and target locations must differ.");
      return;
    }
    if (!selectedVariant) {
      error("Choose a variant to transfer.");
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      error("Transfer quantity must be a positive integer.");
      return;
    }
    if (parsedQuantity > selectedVariantAvailable) {
      error("Transfer quantity cannot exceed the source on-hand stock shown.");
      return;
    }

    setCreatingDraft(true);
    try {
      const transfer = await apiPost<StockTransfer>("/api/stock-transfers", {
        fromLocationId,
        toLocationId,
        notes: draftNotes || undefined,
        lines: [
          {
            variantId: selectedVariant.variantId,
            quantity: parsedQuantity,
          },
        ],
      });
      success(`Transfer draft ${transfer.id.slice(0, 8)} created.`);
      resetDraftForm();
      await loadQueue();
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create transfer draft");
    } finally {
      setCreatingDraft(false);
    }
  };

  const runTransferAction = async (transferId: string, action: "send" | "receive" | "cancel") => {
    setWorkingTransferId(transferId);
    try {
      await apiPost<StockTransfer>(`/api/stock-transfers/${encodeURIComponent(transferId)}/${action}`);
      success(
        action === "send"
          ? "Transfer sent."
          : action === "receive"
            ? "Transfer received and stock moved."
            : "Transfer cancelled.",
      );
      await loadQueue();
    } catch (actionError) {
      error(actionError instanceof Error ? actionError.message : "Failed to update transfer");
    } finally {
      setWorkingTransferId(null);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Stock Transfers & Replenishment</h1>
            <p className="muted-text">
              Create draft transfers, send them for collection, and receive them to post stock cleanly between locations. Stock only moves when a sent transfer is received.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadQueue()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Transfers</span>
            <strong className="metric-value">{openTransfers.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Transfer Candidates</span>
            <strong className="metric-value">{transferCandidates.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue Open POs</span>
            <strong className="metric-value">{overduePurchaseOrders.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tracked Locations</span>
            <strong className="metric-value">{locationOptions.length}</strong>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Create Transfer Draft</h2>
              <p className="muted-text">
                Start a one-line transfer manually or prefill from the imbalance queue below. This keeps the first transfer workflow fast without hiding the stock impact.
              </p>
            </div>
            <Link to="/inventory/locations">Open inventory by location</Link>
          </div>

          <div className="job-meta-grid">
            <label>
              Source location
              <select value={fromLocationId} onChange={(event) => setFromLocationId(event.target.value)} data-testid="transfer-from-location">
                <option value="">Choose source</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}{location.isDefault ? " (Default)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Target location
              <select value={toLocationId} onChange={(event) => setToLocationId(event.target.value)} data-testid="transfer-to-location">
                <option value="">Choose target</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}{location.isDefault ? " (Default)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Find stock at source
              <input
                value={variantQuery}
                onChange={(event) => setVariantQuery(event.target.value)}
                placeholder={fromLocationId ? "Search by SKU, barcode, or product" : "Choose a source location first"}
                disabled={!fromLocationId}
                data-testid="transfer-variant-search"
              />
            </label>

            <label>
              Transfer quantity
              <input
                type="number"
                min="1"
                step="1"
                value={draftQuantity}
                onChange={(event) => setDraftQuantity(event.target.value)}
                data-testid="transfer-quantity"
              />
            </label>
          </div>

          <label className="inventory-adjustment-note">
            Transfer note
            <input
              value={draftNotes}
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder="Optional handover note"
            />
          </label>

          {selectedVariant ? (
            <p className="muted-text" data-testid="transfer-selected-variant">
              Selected: <strong>{selectedVariant.productName}</strong> {selectedVariant.variantName ? `(${selectedVariant.variantName}) ` : ""}from source on-hand {selectedVariant.onHand}.
            </p>
          ) : (
            <p className="muted-text">
              Select a source result below, or use “Prefill draft” from a transfer candidate.
            </p>
          )}

          <div className="actions-inline">
            <button type="button" onClick={() => void createDraft()} disabled={creatingDraft} data-testid="transfer-create-draft">
              {creatingDraft ? "Creating..." : "Create Draft"}
            </button>
            <button type="button" className="button-secondary" onClick={resetDraftForm}>
              Clear
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source Match</th>
                  <th>Barcode</th>
                  <th>On Hand</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!fromLocationId ? (
                  <tr>
                    <td colSpan={4}>Choose a source location to search transfer stock.</td>
                  </tr>
                ) : variantSearchLoading ? (
                  <tr>
                    <td colSpan={4}>Searching source stock...</td>
                  </tr>
                ) : variantMatches.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No source matches yet. Search by SKU, barcode, or product.</td>
                  </tr>
                ) : variantMatches.map((row) => (
                  <tr key={row.variantId}>
                    <td>
                      <Link to={`/inventory/${row.variantId}`}>{row.productName}</Link>
                      <div className="table-secondary">{row.variantName || row.sku}</div>
                    </td>
                    <td><span className="mono-text">{row.barcode || "-"}</span></td>
                    <td>{row.onHand}</td>
                    <td>
                      <button type="button" className="button-link" onClick={() => setSelectedVariant(row)}>
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Open Transfers</h2>
              <p className="muted-text">
                Draft transfers are editable only by replacing them. Sent transfers post stock only when received.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>Route</th>
                  <th>Lines</th>
                  <th>Status</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {openTransfers.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No open transfers. Use the draft form or prefill from the imbalance queue.</td>
                  </tr>
                ) : openTransfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>
                      <span className="mono-text">{transfer.id.slice(0, 8)}</span>
                      <div className="table-secondary">{new Date(transfer.createdAt).toLocaleString()}</div>
                    </td>
                    <td>{transfer.fromLocation.name} → {transfer.toLocation.name}</td>
                    <td>
                      {transfer.lines.map((line) => `${line.productName} x${line.quantity}`).join(", ")}
                    </td>
                    <td>{formatTransferStatus(transfer.status)}</td>
                    <td>
                      <div className="actions-inline">
                        {transfer.status === "DRAFT" ? (
                          <button
                            type="button"
                            className="button-link"
                            onClick={() => void runTransferAction(transfer.id, "send")}
                            disabled={workingTransferId === transfer.id}
                          >
                            Send
                          </button>
                        ) : null}
                        {transfer.status === "SENT" ? (
                          <button
                            type="button"
                            className="button-link"
                            onClick={() => void runTransferAction(transfer.id, "receive")}
                            disabled={workingTransferId === transfer.id}
                            data-testid={`transfer-receive-${transfer.id}`}
                          >
                            Receive
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="button-link"
                          onClick={() => void runTransferAction(transfer.id, "cancel")}
                          disabled={workingTransferId === transfer.id}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Location Imbalance</h2>
            <Link to="/inventory/locations">Open inventory by location</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Suggested Qty</th>
                  <th>Urgency</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {transferCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No location imbalance candidates found.</td>
                  </tr>
                ) : transferCandidates.map((row) => (
                  <tr key={`${row.variantId}:${row.sourceLocationId}:${row.targetLocationId}`}>
                    <td>
                      <Link to={`/inventory/${row.variantId}`}>{row.productName}</Link>
                      <div className="table-secondary">{row.variantName || row.sku}</div>
                    </td>
                    <td>{row.sourceLocation} ({row.sourceOnHand})</td>
                    <td>{row.targetLocation} ({row.targetOnHand})</td>
                    <td>{row.suggestedQuantity}</td>
                    <td>{row.urgency}</td>
                    <td>
                      <button type="button" className="button-link" onClick={() => prefillFromCandidate(row)}>
                        Prefill draft
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Replenishment Queue</h2>
            <Link to="/management/reordering">Open reordering</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Urgency</th>
                  <th>On Hand</th>
                  <th>Sold</th>
                  <th>Suggested Reorder</th>
                </tr>
              </thead>
              <tbody>
                {replenishmentAttention.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No replenishment candidates found.</td>
                  </tr>
                ) : replenishmentAttention.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.urgency}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.quantitySold}</td>
                    <td>{row.suggestedReorderQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent Received Transfers</h2>
            <span className="muted-text">Latest completed location moves.</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>Route</th>
                  <th>Received</th>
                  <th>Lines</th>
                </tr>
              </thead>
              <tbody>
                {recentTransfers.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No completed transfers yet.</td>
                  </tr>
                ) : recentTransfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td><span className="mono-text">{transfer.id.slice(0, 8)}</span></td>
                    <td>{transfer.fromLocation.name} → {transfer.toLocation.name}</td>
                    <td>{transfer.receivedAt ? new Date(transfer.receivedAt).toLocaleString() : "-"}</td>
                    <td>{transfer.lines.map((line) => `${line.productName} x${line.quantity}`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Overdue Purchasing Support</h2>
            <Link to="/management/purchasing">PO action centre</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchase Order</th>
                  <th>Supplier</th>
                  <th>Expected</th>
                  <th>Remaining Qty</th>
                </tr>
              </thead>
              <tbody>
                {overduePurchaseOrders.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No overdue open purchase orders.</td>
                  </tr>
                ) : overduePurchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td><Link to={`/purchasing/${po.id}`}>{po.id.slice(0, 8)}</Link></td>
                    <td>{po.supplier.name}</td>
                    <td>{po.expectedAt ? new Date(po.expectedAt).toLocaleDateString() : "-"}</td>
                    <td>{po.totals.quantityRemaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
