import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ReorderSuggestionRow, reorderUrgencyRank, toReorderSuggestionRow } from "../utils/reordering";

type LocationRow = {
  id: string;
  name: string;
  isDefault: boolean;
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
  productName: string;
  variantName: string | null;
  sku: string;
  sourceLocation: string;
  sourceOnHand: number;
  targetLocation: string;
  targetOnHand: number;
  urgency: "Transfer Now" | "Rebalance";
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

export const TransferQueuePage = () => {
  const { error } = useToasts();
  const [locationsPayload, setLocationsPayload] = useState<InventoryLocationSummaryResponse | null>(null);
  const [velocityPayload, setVelocityPayload] = useState<VelocityResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const loadQueue = async () => {
    setLoading(true);
    const today = new Date();
    const to = formatDateKey(today);
    const from = formatDateKey(shiftDays(today, -89));

    const [locationResult, velocityResult, poResult] = await Promise.allSettled([
      apiGet<InventoryLocationSummaryResponse>("/api/reports/inventory/location-summary?active=1&take=200"),
      apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${from}&to=${to}&take=200`),
      apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=200&skip=0"),
    ]);

    if (locationResult.status === "fulfilled") {
      setLocationsPayload(locationResult.value);
    } else {
      setLocationsPayload(null);
      error(locationResult.reason instanceof Error ? locationResult.reason.message : "Failed to load location stock summary");
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

    setLoading(false);
  };

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          productName: row.productName,
          variantName: row.variantName,
          sku: row.sku,
          sourceLocation: source.name,
          sourceOnHand: source.onHand,
          targetLocation: target.name,
          targetOnHand: target.onHand,
          urgency: target.onHand <= 0 ? "Transfer Now" : "Rebalance",
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

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Transfer & Replenishment Queue</h1>
            <p className="muted-text">
              Manager-facing stock attention queue built from multi-location stock, reorder pressure, and purchasing context. This v1 is visibility-first and does not execute transfers.
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
            <span className="metric-label">Transfer Candidates</span>
            <strong className="metric-value">{transferCandidates.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Replenishment Attention</span>
            <strong className="metric-value">{replenishmentAttention.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue Open POs</span>
            <strong className="metric-value">{overduePurchaseOrders.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tracked Locations</span>
            <strong className="metric-value">{locationsPayload?.locations.length ?? 0}</strong>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
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
                  <th>Urgency</th>
                </tr>
              </thead>
              <tbody>
                {transferCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No location imbalance candidates found.</td>
                  </tr>
                ) : transferCandidates.map((row) => (
                  <tr key={row.variantId}>
                    <td>
                      <Link to={`/inventory/${row.variantId}`}>{row.productName}</Link>
                      <div className="table-secondary">{row.variantName || row.sku}</div>
                    </td>
                    <td>{row.sourceLocation} ({row.sourceOnHand})</td>
                    <td>{row.targetLocation} ({row.targetOnHand})</td>
                    <td>{row.urgency}</td>
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
