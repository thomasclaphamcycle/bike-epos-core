import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = "30" | "90" | "365";

type ProductSalesRow = {
  productId: string;
  productName: string;
  brandName: string | null;
  categoryName: string | null;
  quantitySold: number;
  grossRevenuePence: number;
  saleCount: number;
  variantCountSold: number;
  averageUnitPricePence: number;
  lastSoldAt: string | null;
};

type ProductCategoryRow = {
  categoryName: string;
  quantitySold: number;
  grossRevenuePence: number;
  productCount: number;
  averageUnitPricePence: number;
};

type ProductSalesResponse = {
  summary: {
    productCount: number;
    categoryCount: number;
    totalQuantitySold: number;
    totalRevenuePence: number;
    topCategoryName: string | null;
    topCategoryRevenuePence: number;
  };
  topSellingProducts: ProductSalesRow[];
  lowestSellingProducts: ProductSalesRow[];
  products: ProductSalesRow[];
  categoryBreakdown: ProductCategoryRow[];
  categoryBreakdownSupported: boolean;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

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

export const ProductSalesAnalyticsPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [report, setReport] = useState<ProductSalesResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));
      const payload = await apiGet<ProductSalesResponse>(`/api/reports/sales/products?from=${from}&to=${to}&take=10`);
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load product sales analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const bestSeller = useMemo(() => report?.topSellingProducts[0] ?? null, [report]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Product Sales Analytics</h1>
            <p className="muted-text">
              Manager-facing product sales totals over a selected date range. This first version stays table-based and focused on product-level demand.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last 365 days</option>
              </select>
            </label>
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Tracked Products</span>
            <strong className="metric-value">{report?.summary.productCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Products with sales in range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Units Sold</span>
            <strong className="metric-value">{report?.summary.totalQuantitySold ?? 0}</strong>
            <span className="dashboard-metric-detail">Across all sold products</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Gross Product Revenue</span>
            <strong className="metric-value">{formatMoney(report?.summary.totalRevenuePence ?? 0)}</strong>
            <span className="dashboard-metric-detail">Line-item gross only</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Best Seller</span>
            <strong className="metric-value">{bestSeller?.productName ?? "-"}</strong>
            <span className="dashboard-metric-detail">
              {bestSeller ? `${bestSeller.quantitySold} units | ${formatMoney(bestSeller.grossRevenuePence)}` : "No data"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Top Category</span>
            <strong className="metric-value">{report?.summary.topCategoryName ?? "-"}</strong>
            <span className="dashboard-metric-detail">
              {report?.summary.topCategoryName
                ? `${formatMoney(report?.summary.topCategoryRevenuePence ?? 0)} across ${report?.summary.categoryCount ?? 0} categories`
                : "No category data yet"}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Top Selling Products</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units</th>
                  <th>Revenue</th>
                  <th>Sales</th>
                  <th>Avg Unit</th>
                  <th>Last Sold</th>
                </tr>
              </thead>
              <tbody>
                {report?.topSellingProducts.length ? report.topSellingProducts.map((row) => (
                  <tr key={row.productId}>
                    <td>
                      <div className="table-primary">{row.productName}</div>
                      <div className="table-secondary">
                        {[row.categoryName || "Uncategorized", row.brandName || "No brand"].join(" · ")}
                      </div>
                    </td>
                    <td>{row.quantitySold}</td>
                    <td>{formatMoney(row.grossRevenuePence)}</td>
                    <td>{row.saleCount}</td>
                    <td>{formatMoney(row.averageUnitPricePence)}</td>
                    <td>{row.lastSoldAt ? new Date(row.lastSoldAt).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No product sales found for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Lowest Selling Products</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units</th>
                  <th>Revenue</th>
                  <th>Sales</th>
                  <th>Avg Unit</th>
                </tr>
              </thead>
              <tbody>
                {report?.lowestSellingProducts.length ? report.lowestSellingProducts.map((row) => (
                  <tr key={row.productId}>
                    <td>
                      <div className="table-primary">{row.productName}</div>
                      <div className="table-secondary">{row.categoryName || "Uncategorized"}</div>
                    </td>
                    <td>{row.quantitySold}</td>
                    <td>{formatMoney(row.grossRevenuePence)}</td>
                    <td>{row.saleCount}</td>
                    <td>{formatMoney(row.averageUnitPricePence)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>No lowest-selling products available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted-text">This view is based on products with recorded sales in the selected range only.</p>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Product Totals</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units</th>
                  <th>Revenue</th>
                  <th>Sales</th>
                  <th>Variants Sold</th>
                  <th>Last Sold</th>
                </tr>
              </thead>
              <tbody>
                {report?.products.length ? report.products.map((row) => (
                  <tr key={row.productId}>
                    <td>
                      <div className="table-primary">{row.productName}</div>
                      <div className="table-secondary">
                        {[row.categoryName || "Uncategorized", row.brandName || "No brand"].join(" · ")}
                      </div>
                    </td>
                    <td>{row.quantitySold}</td>
                    <td>{formatMoney(row.grossRevenuePence)}</td>
                    <td>{row.saleCount}</td>
                    <td>{row.variantCountSold}</td>
                    <td>{row.lastSoldAt ? new Date(row.lastSoldAt).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No product totals available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Category Breakdown</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Products Sold</th>
                  <th>Units</th>
                  <th>Revenue</th>
                  <th>Avg Unit</th>
                </tr>
              </thead>
              <tbody>
                {report?.categoryBreakdown.length ? report.categoryBreakdown.map((row) => (
                  <tr key={row.categoryName}>
                    <td>{row.categoryName}</td>
                    <td>{row.productCount}</td>
                    <td>{row.quantitySold}</td>
                    <td>{formatMoney(row.grossRevenuePence)}</td>
                    <td>{formatMoney(row.averageUnitPricePence)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>
                      {report?.categoryBreakdownSupported
                        ? "No category sales found for this range."
                        : "Category breakdown is not supported on this branch."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
