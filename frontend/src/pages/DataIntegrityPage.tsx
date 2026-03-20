import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import {
  isWorkshopAwaitingApproval,
  isWorkshopWaitingForParts,
} from "../utils/workshopStatus";
import { toReorderSuggestionRow } from "../utils/reordering";

type VelocityRow = {
  productId: string;
  productName: string;
  currentOnHand: number;
  quantitySold: number;
  velocityPer30Days: number;
};

type VelocityResponse = {
  filters: { rangeDays: number };
  products: VelocityRow[];
};

type VariantRow = {
  id: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  costPricePence: number | null;
};

type VariantListResponse = {
  variants: VariantRow[];
};

type WorkshopDashboardResponse = {
  jobs: Array<{
    id: string;
    status: string;
    partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
  }>;
};

type PurchaseOrderListResponse = {
  purchaseOrders: Array<{
    id: string;
    status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
    expectedAt: string | null;
    totals: { quantityRemaining: number };
  }>;
};

type IntegrityRow = {
  key: string;
  label: string;
  count: number;
  detail: string;
  path: string;
};

const emptyVelocity: VelocityResponse = { filters: { rangeDays: 30 }, products: [] };

export const DataIntegrityPage = () => {
  const { error } = useToasts();
  const [velocity, setVelocity] = useState<VelocityResponse>(emptyVelocity);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [workshop, setWorkshop] = useState<WorkshopDashboardResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderListResponse["purchaseOrders"]>([]);
  const [loading, setLoading] = useState(false);

  const loadPage = async () => {
    setLoading(true);
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    const fromKey = from.toISOString().slice(0, 10);
    const toKey = today.toISOString().slice(0, 10);

    const [velocityResult, variantResult, workshopResult, poResult] = await Promise.allSettled([
      apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${fromKey}&to=${toKey}&take=100`),
      apiGet<VariantListResponse>("/api/variants?take=250&skip=0&active=1"),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=150"),
      apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=100&skip=0"),
    ]);

    if (velocityResult.status === "fulfilled") {
      setVelocity(velocityResult.value);
    } else {
      setVelocity(emptyVelocity);
      error(velocityResult.reason instanceof Error ? velocityResult.reason.message : "Failed to load stock integrity signals");
    }

    if (variantResult.status === "fulfilled") {
      setVariants(variantResult.value.variants || []);
    } else {
      setVariants([]);
      error(variantResult.reason instanceof Error ? variantResult.reason.message : "Failed to load variant integrity signals");
    }

    if (workshopResult.status === "fulfilled") {
      setWorkshop(workshopResult.value);
    } else {
      setWorkshop(null);
      error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workflow integrity signals");
    }

    if (poResult.status === "fulfilled") {
      setPurchaseOrders(poResult.value.purchaseOrders || []);
    } else {
      setPurchaseOrders([]);
      error(poResult.reason instanceof Error ? poResult.reason.message : "Failed to load purchasing integrity signals");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stockRows = useMemo<IntegrityRow[]>(() => {
    const suggestions = velocity.products.map((row) => toReorderSuggestionRow(row, velocity.filters.rangeDays));
    return [
      {
        key: "negative",
        label: "Negative stock",
        count: suggestions.filter((row) => row.currentOnHand < 0).length,
        detail: "Inventory that already slipped below zero.",
        path: "/management/stock-exceptions",
      },
      {
        key: "zero-with-sales",
        label: "Zero stock with recent sales",
        count: suggestions.filter((row) => row.currentOnHand === 0 && row.quantitySold > 0).length,
        detail: "Demand exists, but current stock is at zero.",
        path: "/management/stock-exceptions",
      },
      {
        key: "reorder-now",
        label: "Reorder-now pressure",
        count: suggestions.filter((row) => row.urgency === "Reorder Now").length,
        detail: "Low coverage based on recent sales and current on hand.",
        path: "/management/reordering",
      },
    ];
  }, [velocity]);

  const pricingRows = useMemo<IntegrityRow[]>(() => {
    const missingPrice = variants.filter((variant) => variant.retailPricePence <= 0).length;
    const atOrBelowCost = variants.filter((variant) =>
      variant.costPricePence !== null && variant.retailPricePence > 0 && variant.retailPricePence <= variant.costPricePence).length;
    const lowMargin = variants.filter((variant) => {
      if (variant.costPricePence === null || variant.retailPricePence <= 0 || variant.retailPricePence <= variant.costPricePence) {
        return false;
      }
      const marginPct = ((variant.retailPricePence - variant.costPricePence) / variant.retailPricePence) * 100;
      return marginPct > 0 && marginPct <= 10;
    }).length;
    return [
      { key: "missing-price", label: "Missing retail price", count: missingPrice, detail: "Variants not ready for normal selling.", path: "/management/pricing" },
      { key: "below-cost", label: "Retail at or below cost", count: atOrBelowCost, detail: "Visible margin problem requiring action.", path: "/management/pricing" },
      { key: "low-margin", label: "Very low margin", count: lowMargin, detail: "Apparent margin at 10% or lower.", path: "/management/pricing" },
    ];
  }, [variants]);

  const dataQualityRows = useMemo<IntegrityRow[]>(() => [
    {
      key: "missing-barcode",
      label: "Missing barcode",
      count: variants.filter((variant) => !variant.barcode).length,
      detail: "Weak POS and lookup readiness.",
      path: "/management/product-data",
    },
    {
      key: "missing-cost",
      label: "Missing cost",
      count: variants.filter((variant) => variant.costPricePence === null).length,
      detail: "Purchasing and margin visibility is incomplete.",
      path: "/management/product-data",
    },
    {
      key: "weak-identity",
      label: "Weak variant naming",
      count: variants.filter((variant) => !variant.name && !variant.option).length,
      detail: "Variants need stronger identity before confident operational use.",
      path: "/management/product-data",
    },
  ], [variants]);

  const workflowRows = useMemo<IntegrityRow[]>(() => {
    const waitingForApproval = (workshop?.jobs || []).filter(isWorkshopAwaitingApproval).length;
    const waitingForParts = (workshop?.jobs || []).filter(isWorkshopWaitingForParts).length;
    const partialPo = purchaseOrders.filter((po) => po.status === "PARTIALLY_RECEIVED" && po.totals.quantityRemaining > 0).length;
    const overduePo = purchaseOrders.filter((po) =>
      po.status !== "RECEIVED"
      && po.status !== "CANCELLED"
      && po.totals.quantityRemaining > 0
      && po.expectedAt
      && new Date(po.expectedAt).getTime() < Date.now()).length;
    return [
      { key: "waiting-approval", label: "Jobs waiting for approval", count: waitingForApproval, detail: "Open work blocked on customer decision.", path: "/management/communications" },
      { key: "waiting-parts", label: "Jobs waiting for parts", count: waitingForParts, detail: "Operational bottlenecks caused by parts shortage.", path: "/management/workshop-ageing" },
      { key: "partial-receiving", label: "Partially received purchase orders", count: partialPo, detail: "Goods-in flow still incomplete.", path: "/purchasing/receiving" },
      { key: "overdue-pos", label: "Overdue purchase orders", count: overduePo, detail: "Supplier follow-up still outstanding.", path: "/management/purchasing" },
    ];
  }, [purchaseOrders, workshop]);

  const totalIssues = stockRows.reduce((sum, row) => sum + row.count, 0)
    + pricingRows.reduce((sum, row) => sum + row.count, 0)
    + dataQualityRows.reduce((sum, row) => sum + row.count, 0)
    + workflowRows.reduce((sum, row) => sum + row.count, 0);

  const renderRows = (rows: IntegrityRow[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th>Count</th>
            <th>Meaning</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{row.count}</td>
              <td>{row.detail}</td>
              <td><Link to={row.path}>Open queue</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Data Integrity</h1>
            <p className="muted-text">
              Manager/admin investigation hub for operational data problems already visible through current stock, pricing, product-data, workshop, and purchasing signals.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/health">Ops health</Link>
            <button type="button" onClick={() => void loadPage()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Stock Problems</span>
            <strong className="metric-value">{stockRows.reduce((sum, row) => sum + row.count, 0)}</strong>
            <span className="dashboard-metric-detail">Negative, zero-with-sales, and reorder-now stock signals</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Pricing Problems</span>
            <strong className="metric-value">{pricingRows.reduce((sum, row) => sum + row.count, 0)}</strong>
            <span className="dashboard-metric-detail">Price, cost, and margin exceptions</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Data Quality Problems</span>
            <strong className="metric-value">{dataQualityRows.reduce((sum, row) => sum + row.count, 0)}</strong>
            <span className="dashboard-metric-detail">Variant data still incomplete for smooth operations</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workflow Consistency</span>
            <strong className="metric-value">{workflowRows.reduce((sum, row) => sum + row.count, 0)}</strong>
            <span className="dashboard-metric-detail">Open operational blockers and incomplete flows</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Total Attention Items</span>
            <strong className="metric-value">{totalIssues}</strong>
            <span className="dashboard-metric-detail">Cross-queue investigation count</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Stock Problems</h2>
            <Link to="/management/stock-exceptions">Stock exceptions</Link>
          </div>
          {renderRows(stockRows)}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Pricing Problems</h2>
            <Link to="/management/pricing">Pricing review</Link>
          </div>
          {renderRows(pricingRows)}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Data Quality Problems</h2>
            <Link to="/management/product-data">Product data</Link>
          </div>
          {renderRows(dataQualityRows)}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Workflow Consistency</h2>
            <Link to="/management/summary">Ops summary</Link>
          </div>
          {renderRows(workflowRows)}
        </section>
      </div>
    </div>
  );
};
