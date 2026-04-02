import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAppConfig } from "../config/appConfig";
import { formatCurrencyFromPence } from "../utils/currency";
import { reportSeverityBadgeClass, type ReportSeverity } from "../utils/reportSeverity";

type RangePreset = "30" | "90" | "365";

type BusinessIntelligenceResponse = {
  generatedAt: string;
  filters: {
    from: string;
    to: string;
    dayCount: number;
    take: number;
    label: string;
  };
  limitations: string[];
  headline: {
    actualNetSalesPence: number;
    retailNetSalesPence: number;
    workshopNetSalesPence: number;
    hireBookedValuePence: number;
    completedWorkshopJobs: number;
    activeCustomers: number;
    inventoryValuePence: number;
  };
  finance: {
    salesSummary: {
      grossSalesPence: number;
      refundsPence: number;
      revenuePence: number;
      transactions: number;
      refundCount: number;
      averageSaleValuePence: number;
    };
    tradingMix: {
      retailGrossSalesPence: number;
      retailRefundsPence: number;
      retailNetSalesPence: number;
      workshopGrossSalesPence: number;
      workshopRefundsPence: number;
      workshopNetSalesPence: number;
      retailTransactions: number;
      workshopTransactions: number;
      retailRevenueSharePercent: number | null;
      workshopRevenueSharePercent: number | null;
    };
    topCategory: {
      categoryName: string | null;
      revenuePence: number;
      revenueSharePercent: number | null;
    };
    bestTradingDay: {
      date: string;
      totalNetSalesPence: number;
      retailNetSalesPence: number;
      workshopNetSalesPence: number;
    } | null;
    dailyMix: Array<{
      date: string;
      retailNetSalesPence: number;
      workshopNetSalesPence: number;
      totalNetSalesPence: number;
      hireBookedValuePence: number;
      hireBookingsStarted: number;
      completedWorkshopJobs: number;
    }>;
  };
  workshop: {
    summary: {
      completedJobs: number;
      revenuePence: number;
      averageTurnaroundDays: number | null;
      medianTurnaroundDays: number | null;
      averageApprovalHours: number | null;
      quoteApprovalRequestedCount: number;
      quoteApprovedCount: number;
      quoteRejectedCount: number;
      quotePendingCount: number;
      quoteConversionRate: number | null;
      openJobs: number;
      dueTodayCount: number;
      overdueCount: number;
      waitingForApprovalCount: number;
      waitingForPartsCount: number;
      readyForCollectionCount: number;
      stalledJobsCount: number;
    };
    bestWorkshopDay: {
      date: string;
      completedWorkshopJobs: number;
      workshopNetSalesPence: number;
    } | null;
    technicianRows: Array<{
      technicianKey: string;
      staffId: string | null;
      staffName: string;
      completedJobs: number;
      activeJobs: number;
      waitingForApprovalJobs: number;
      waitingForPartsJobs: number;
      readyForCollectionJobs: number;
      averageCompletionDays: number | null;
    }>;
    stalledRows: Array<{
      jobId: string;
      customerName: string;
      bikeDescription: string | null;
      rawStatus: string;
      assignedStaffName: string | null;
      scheduledDate: string | null;
      scheduledStartAt: string | null;
      createdAt: string;
      updatedAt: string;
      ageDays: number;
      stageAgeDays: number | null;
      stageAgeBasis: "QUOTE_REQUESTED_AT" | "JOB_UPDATED_AT" | "JOB_CREATED_AT" | null;
      stallReason: string;
      severity: ReportSeverity;
    }>;
  };
  hire: {
    summary: {
      bookingCount: number;
      bookedValuePence: number;
      averageBookingValuePence: number;
      averageHireLengthDays: number | null;
      activeNowCount: number;
      overdueNowCount: number;
      cancelledCount: number;
      returnedCount: number;
      activeFleetCount: number;
      maintenanceAssetCount: number;
      onlineBookableAssetCount: number;
      dueTodayCount: number;
      pickupsNext7Days: number;
      returnsNext7Days: number;
      depositHeldPence: number;
      utilisationPercent: number | null;
      cancellationRatePercent: number | null;
    };
    topAssets: Array<{
      hireAssetId: string;
      assetTag: string;
      displayName: string | null;
      productName: string;
      bookingCount: number;
      bookedValuePence: number;
      bookedDays: number;
      utilisationPercent: number | null;
    }>;
  };
  inventory: {
    summary: {
      stockValuePence: number;
      stockUnitsOnHand: number;
      missingCostVariantCount: number;
      trackedProductCount: number;
      productsWithSales: number;
      deadStockCandidatesInRangeCount: number;
      fastMoverCount: number;
      normalMoverCount: number;
      slowMoverCount: number;
      deadStockCount: number;
      topValueProductName: string | null;
      topValuePence: number;
    };
    fastMovingProducts: Array<{
      productId: string;
      productName: string;
      currentOnHand: number;
      quantitySold: number;
      grossRevenuePence: number;
      velocityPer30Days: number;
      sellThroughRate: number;
      lastSoldAt: string | null;
    }>;
    slowMovingProducts: Array<{
      productId: string;
      productName: string;
      currentOnHand: number;
      quantitySold: number;
      grossRevenuePence: number;
      velocityPer30Days: number;
      sellThroughRate: number;
      lastSoldAt: string | null;
    }>;
    deadStockCandidates: Array<{
      productId: string;
      productName: string;
      currentOnHand: number;
      quantitySold: number;
      grossRevenuePence: number;
      velocityPer30Days: number;
      sellThroughRate: number;
      lastSoldAt: string | null;
    }>;
  };
  customers: {
    summary: {
      customerCount: number;
      activeCustomerCount: number;
      repeatCustomerCount: number;
      repeatRatePercent: number | null;
      highValueCustomerCount: number;
      workshopActiveCustomerCount: number;
      customersWithCreditCount: number;
      totalCreditBalancePence: number;
      averageSpendPence: number;
    };
    topCustomers: Array<{
      customerId: string;
      customerName: string;
      saleCount: number;
      totalSpendPence: number;
      averageOrderValuePence: number;
      activeWorkshopJobs: number;
      creditBalancePence: number;
      lastActivityAt: string | null;
    }>;
    workshopActiveCustomers: Array<{
      customerId: string;
      customerName: string;
      activeWorkshopJobs: number;
      recentWorkshopJobs: number;
      totalWorkshopJobs: number;
      lastWorkshopAt: string | null;
    }>;
  };
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

const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;

const formatDays = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)}d`;

const formatHours = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)}h`;

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

const formatDateOnly = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "—";

const formatStatusLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const BusinessIntelligencePage = () => {
  const { error } = useToasts();
  const appConfig = useAppConfig();
  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [report, setReport] = useState<BusinessIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const currencyCode = appConfig.store.defaultCurrency;
  const formatMoney = (valuePence: number) => formatCurrencyFromPence(valuePence, currencyCode);

  const loadReport = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));
      const payload = await apiGet<BusinessIntelligenceResponse>(
        `/api/reports/business-intelligence?from=${from}&to=${to}&take=5`,
      );
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load business intelligence");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const recentTradingRows = useMemo(
    () => [...(report?.finance.dailyMix ?? [])].slice(-14).reverse(),
    [report?.finance.dailyMix],
  );

  const signalItems = useMemo(() => {
    if (!report) {
      return [];
    }

    const items: Array<{ label: string; detail: string; to: string }> = [];

    if (report.workshop.summary.quotePendingCount > 0) {
      items.push({
        label: "Workshop approvals waiting",
        detail: `${report.workshop.summary.quotePendingCount} estimate${report.workshop.summary.quotePendingCount === 1 ? "" : "s"} still need customer approval.`,
        to: "/reports/workshop",
      });
    }

    if (report.hire.summary.overdueNowCount > 0) {
      items.push({
        label: "Overdue rentals",
        detail: `${report.hire.summary.overdueNowCount} hire booking${report.hire.summary.overdueNowCount === 1 ? "" : "s"} are overdue right now.`,
        to: "/rental/returns",
      });
    }

    if (report.inventory.summary.deadStockCount > 0) {
      items.push({
        label: "Dead stock exposure",
        detail: `${report.inventory.summary.deadStockCount} current variant${report.inventory.summary.deadStockCount === 1 ? "" : "s"} are classed as dead stock.`,
        to: "/reports/inventory",
      });
    }

    if (report.customers.summary.repeatRatePercent !== null) {
      items.push({
        label: "Repeat customer rate",
        detail: `${formatPercent(report.customers.summary.repeatRatePercent)} of active customers have repeated in this range.`,
        to: "/customers",
      });
    }

    return items.slice(0, 4);
  }, [report]);

  return (
    <div
      className="page-shell"
      data-testid="business-intelligence-page"
      role="region"
      aria-labelledby="business-intelligence-heading"
      aria-busy={loading && !report ? "true" : "false"}
    >
      <section className="card" aria-labelledby="business-intelligence-heading">
        <div className="card-header-row">
          <div>
            <h1
              id="business-intelligence-heading"
              data-testid="business-intelligence-heading"
              role="heading"
              aria-level={1}
            >
              Business Intelligence
            </h1>
            <p className="muted-text">
              Owner-facing reporting across retail, workshop, hire, customers, and inventory using the signals CorePOS already records reliably today.
            </p>
            <p className="muted-text">{report?.filters.label ?? "Loading current reporting window..."}</p>
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
            <Link to="/management">Management</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card" data-testid="bi-card-net-sales">
            <span className="metric-label">Net Sales</span>
            <strong className="metric-value">{formatMoney(report?.headline.actualNetSalesPence ?? 0)}</strong>
            <span className="dashboard-metric-detail">
              Retail {formatMoney(report?.headline.retailNetSalesPence ?? 0)} and workshop {formatMoney(report?.headline.workshopNetSalesPence ?? 0)}.
            </span>
          </div>
          <div className="metric-card" data-testid="bi-card-hire-booked-value">
            <span className="metric-label">Hire Booked Value</span>
            <strong className="metric-value">{formatMoney(report?.headline.hireBookedValuePence ?? 0)}</strong>
            <span className="dashboard-metric-detail">Booking contract value, kept separate from settled sales revenue.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Completed Workshop Jobs</span>
            <strong className="metric-value">{report?.headline.completedWorkshopJobs ?? 0}</strong>
            <span className="dashboard-metric-detail">Closed jobs in the selected reporting range.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Active Customers</span>
            <strong className="metric-value">{report?.headline.activeCustomers ?? 0}</strong>
            <span className="dashboard-metric-detail">Customers with sales or open workshop activity.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Stock Value</span>
            <strong className="metric-value">{formatMoney(report?.headline.inventoryValuePence ?? 0)}</strong>
            <span className="dashboard-metric-detail">Current stock valuation snapshot, not sales for the selected window.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open Workshop Queue</span>
            <strong className="metric-value">{report?.workshop.summary.openJobs ?? 0}</strong>
            <span className="dashboard-metric-detail">
              {report ? `${report.workshop.summary.waitingForApprovalCount} awaiting approval and ${report.workshop.summary.readyForCollectionCount} ready for collection.` : "Loading current workshop queue."}
            </span>
          </div>
        </div>
      </section>

      {loading && !report ? (
        <div className="restricted-panel info-panel">Loading business intelligence...</div>
      ) : null}

      {signalItems.length ? (
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Signals To Act On</h2>
              <p className="muted-text">High-signal prompts grounded in the same report data shown below.</p>
            </div>
          </div>
          <div className="dashboard-summary-grid">
            {signalItems.map((item) => (
              <div key={item.label} className="metric-card">
                <span className="metric-label">{item.label}</span>
                <strong className="metric-value" style={{ fontSize: "1rem" }}>{item.detail}</strong>
                <span className="dashboard-metric-detail">
                  <Link to={item.to}>Open related area</Link>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Trading Mix</h2>
              <p className="muted-text">Retail and workshop are actual net sales. Hire remains clearly labelled as booking value.</p>
            </div>
            <div className="actions-inline">
              <Link to="/reports/financial">Financial detail</Link>
              <Link to="/reports/sales">Sales detail</Link>
            </div>
          </div>

          <div className="dashboard-summary-grid">
            <div className="metric-card">
              <span className="metric-label">Retail Share</span>
              <strong className="metric-value">{formatPercent(report?.finance.tradingMix.retailRevenueSharePercent)}</strong>
              <span className="dashboard-metric-detail">
                {formatMoney(report?.finance.tradingMix.retailNetSalesPence ?? 0)} across {report?.finance.tradingMix.retailTransactions ?? 0} completed sales.
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Workshop Share</span>
              <strong className="metric-value">{formatPercent(report?.finance.tradingMix.workshopRevenueSharePercent)}</strong>
              <span className="dashboard-metric-detail">
                {formatMoney(report?.finance.tradingMix.workshopNetSalesPence ?? 0)} across {report?.finance.tradingMix.workshopTransactions ?? 0} completed workshop sales.
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Average Sale</span>
              <strong className="metric-value">{formatMoney(report?.finance.salesSummary.averageSaleValuePence ?? 0)}</strong>
              <span className="dashboard-metric-detail">
                {report?.finance.salesSummary.transactions ?? 0} transactions and {report?.finance.salesSummary.refundCount ?? 0} refunds.
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Top Category</span>
              <strong className="metric-value">{report?.finance.topCategory.categoryName ?? "—"}</strong>
              <span className="dashboard-metric-detail">
                {formatMoney(report?.finance.topCategory.revenuePence ?? 0)} · {formatPercent(report?.finance.topCategory.revenueSharePercent)}
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Best Trading Day</span>
              <strong className="metric-value">{report?.finance.bestTradingDay ? formatMoney(report.finance.bestTradingDay.totalNetSalesPence) : "—"}</strong>
              <span className="dashboard-metric-detail">{report?.finance.bestTradingDay?.date ?? "No completed sales in this range."}</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Retail Net</th>
                  <th>Workshop Net</th>
                  <th>Hire Booked</th>
                  <th>Workshop Jobs</th>
                </tr>
              </thead>
              <tbody>
                {recentTradingRows.length ? recentTradingRows.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{formatMoney(row.retailNetSalesPence)}</td>
                    <td>{formatMoney(row.workshopNetSalesPence)}</td>
                    <td>{formatMoney(row.hireBookedValuePence)}</td>
                    <td>{row.completedWorkshopJobs}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>No trading rows are available for this range yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Trust Notes</h2>
              <p className="muted-text">These notes describe how the page stays conservative about what it claims.</p>
            </div>
          </div>
          <ul>
            {(report?.limitations ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Workshop Performance</h2>
              <p className="muted-text">Throughput, approval conversion, and queue pressure grounded in live workshop records.</p>
            </div>
            <div className="actions-inline">
              <Link to="/reports/workshop">Workshop report</Link>
              <Link to="/workshop">Workshop board</Link>
            </div>
          </div>
          <div className="dashboard-summary-grid">
            <div className="metric-card">
              <span className="metric-label">Turnaround</span>
              <strong className="metric-value">{formatDays(report?.workshop.summary.averageTurnaroundDays)}</strong>
              <span className="dashboard-metric-detail">Median {formatDays(report?.workshop.summary.medianTurnaroundDays)}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Approval Conversion</span>
              <strong className="metric-value">{formatPercent(report?.workshop.summary.quoteConversionRate)}</strong>
              <span className="dashboard-metric-detail">
                {report?.workshop.summary.quoteApprovedCount ?? 0} approved from {report?.workshop.summary.quoteApprovalRequestedCount ?? 0} requests.
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Waiting For Approval</span>
              <strong className="metric-value">{report?.workshop.summary.waitingForApprovalCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Current queue snapshot.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Waiting For Parts</span>
              <strong className="metric-value">{report?.workshop.summary.waitingForPartsCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Current queue snapshot.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Ready For Collection</span>
              <strong className="metric-value">{report?.workshop.summary.readyForCollectionCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Bikes customers could pick up now.</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Stage Age</th>
                </tr>
              </thead>
              <tbody>
                {report?.workshop.stalledRows.length ? report.workshop.stalledRows.map((row) => (
                  <tr key={row.jobId}>
                    <td>
                      <div className="table-primary">
                        <Link to={`/workshop/${row.jobId}`}>{row.customerName}</Link>
                      </div>
                      <div className="table-secondary">{row.bikeDescription || "Bike description not recorded"}</div>
                    </td>
                    <td>{row.stallReason}</td>
                    <td>
                      <span className={reportSeverityBadgeClass(row.severity)}>{formatStatusLabel(row.rawStatus)}</span>
                    </td>
                    <td>{row.stageAgeDays === null ? "—" : `${row.stageAgeDays}d`}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>No stalled workshop jobs in this range snapshot.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Hire Performance</h2>
              <p className="muted-text">Rental performance is commercial and operational together, with booking value kept separate from settled sales.</p>
            </div>
            <div className="actions-inline">
              <Link to="/rental/calendar">Rental calendar</Link>
              <Link to="/rental/returns">Rental returns</Link>
            </div>
          </div>
          <div className="dashboard-summary-grid">
            <div className="metric-card">
              <span className="metric-label">Bookings In Range</span>
              <strong className="metric-value">{report?.hire.summary.bookingCount ?? 0}</strong>
              <span className="dashboard-metric-detail">
                {formatMoney(report?.hire.summary.bookedValuePence ?? 0)} booked value.
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Utilisation</span>
              <strong className="metric-value">{formatPercent(report?.hire.summary.utilisationPercent)}</strong>
              <span className="dashboard-metric-detail">{report?.hire.summary.activeFleetCount ?? 0} live fleet assets.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Active / Overdue</span>
              <strong className="metric-value">
                {report ? `${report.hire.summary.activeNowCount} / ${report.hire.summary.overdueNowCount}` : "0 / 0"}
              </strong>
              <span className="dashboard-metric-detail">Currently checked out vs overdue right now.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Deposit Held</span>
              <strong className="metric-value">{formatMoney(report?.hire.summary.depositHeldPence ?? 0)}</strong>
              <span className="dashboard-metric-detail">Currently active deposit exposure.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Cancellation Rate</span>
              <strong className="metric-value">{formatPercent(report?.hire.summary.cancellationRatePercent)}</strong>
              <span className="dashboard-metric-detail">{report?.hire.summary.cancelledCount ?? 0} cancellations recorded in-range.</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Bookings</th>
                  <th>Booked Value</th>
                  <th>Booked Days</th>
                </tr>
              </thead>
              <tbody>
                {report?.hire.topAssets.length ? report.hire.topAssets.map((asset) => (
                  <tr key={asset.hireAssetId}>
                    <td>
                      <div className="table-primary">{asset.displayName || asset.productName}</div>
                      <div className="table-secondary">{asset.assetTag}</div>
                    </td>
                    <td>{asset.bookingCount}</td>
                    <td>{formatMoney(asset.bookedValuePence)}</td>
                    <td>{asset.bookedDays.toFixed(1)}d</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>No rental bookings were recorded in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Inventory Signals</h2>
              <p className="muted-text">Inventory stays actionable here: valuation, movement, and dead-stock exposure.</p>
            </div>
            <div className="actions-inline">
              <Link to="/reports/inventory">Inventory report</Link>
              <Link to="/management/reordering">Reordering</Link>
            </div>
          </div>
          <div className="dashboard-summary-grid">
            <div className="metric-card">
              <span className="metric-label">Fast Movers</span>
              <strong className="metric-value">{report?.inventory.summary.fastMoverCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Current 30/90-day classification snapshot.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Slow Movers</span>
              <strong className="metric-value">{report?.inventory.summary.slowMoverCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Current 30/90-day classification snapshot.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Dead Stock</span>
              <strong className="metric-value">{report?.inventory.summary.deadStockCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Current variants with stock on hand and no recent movement.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Top Stock Value</span>
              <strong className="metric-value">{report?.inventory.summary.topValueProductName ?? "—"}</strong>
              <span className="dashboard-metric-detail">{formatMoney(report?.inventory.summary.topValuePence ?? 0)}</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dead-Stock Candidate</th>
                  <th>On Hand</th>
                  <th>Sold</th>
                  <th>Last Sold</th>
                </tr>
              </thead>
              <tbody>
                {report?.inventory.deadStockCandidates.length ? report.inventory.deadStockCandidates.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.quantitySold}</td>
                    <td>{formatDateTime(row.lastSoldAt)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>No dead-stock candidates were surfaced for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Customer Signals</h2>
              <p className="muted-text">Repeat activity, workshop engagement, and credit exposure without speculative marketing scoring.</p>
            </div>
            <div className="actions-inline">
              <Link to="/customers">Customers</Link>
              <Link to="/management/communications">Communications</Link>
            </div>
          </div>
          <div className="dashboard-summary-grid">
            <div className="metric-card">
              <span className="metric-label">Repeat Rate</span>
              <strong className="metric-value">{formatPercent(report?.customers.summary.repeatRatePercent)}</strong>
              <span className="dashboard-metric-detail">{report?.customers.summary.repeatCustomerCount ?? 0} repeat customers in-range.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Workshop-Active Customers</span>
              <strong className="metric-value">{report?.customers.summary.workshopActiveCustomerCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Customers with open workshop work now.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Average Spend</span>
              <strong className="metric-value">{formatMoney(report?.customers.summary.averageSpendPence ?? 0)}</strong>
              <span className="dashboard-metric-detail">Average across customers with recorded sales in-range.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Credit Exposure</span>
              <strong className="metric-value">{formatMoney(report?.customers.summary.totalCreditBalancePence ?? 0)}</strong>
              <span className="dashboard-metric-detail">{report?.customers.summary.customersWithCreditCount ?? 0} customers with non-zero balance.</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Spend</th>
                  <th>Sales</th>
                  <th>Workshop</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {report?.customers.topCustomers.length ? report.customers.topCustomers.map((row) => (
                  <tr key={row.customerId}>
                    <td>
                      <Link to={`/customers/${row.customerId}`}>{row.customerName}</Link>
                    </td>
                    <td>{formatMoney(row.totalSpendPence)}</td>
                    <td>{row.saleCount}</td>
                    <td>{row.activeWorkshopJobs}</td>
                    <td>{formatDateTime(row.lastActivityAt)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>No customer activity was recorded in this range yet.</td>
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
