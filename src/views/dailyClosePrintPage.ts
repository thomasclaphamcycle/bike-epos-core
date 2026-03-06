type DailyCloseSummary = {
  date: string;
  location: {
    id: string;
    code: string | null;
    name: string;
  };
  sales: {
    count: number;
    grossPence: number;
    tenderTotalsPence: {
      CASH: number;
      CARD: number;
      BANK_TRANSFER: number;
      VOUCHER: number;
    };
  };
  refunds: {
    count: number;
    totalPence: number;
    tenderTotalsPence: {
      CASH: number;
      CARD: number;
      VOUCHER: number;
      OTHER: number;
    };
  };
  netSalesPence: number;
  cashMovements: {
    floatPence: number;
    paidInPence: number;
    paidOutPence: number;
    cashSalesPence: number;
    cashRefundsPence: number;
    expectedCashInDrawerPence: number;
  };
  receipts: {
    count: number;
  };
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const moneyCell = (value: number) => `<td style="text-align:right;">${escapeHtml(formatMoney(value))}</td>`;

export const renderDailyClosePrintPage = (input: { summary: DailyCloseSummary }) => {
  const summary = input.summary;
  const locationLabel = summary.location.code
    ? `${summary.location.name} (${summary.location.code})`
    : summary.location.name;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Daily Close ${escapeHtml(summary.date)}</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        padding: 24px;
        color: #111827;
        background: #f3f4f6;
      }
      .sheet {
        max-width: 900px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 10px;
        padding: 20px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 16px;
      }
      .header h1 {
        margin: 0 0 4px;
        font-size: 22px;
      }
      .muted {
        color: #6b7280;
        font-size: 13px;
      }
      h2 {
        margin: 20px 0 10px;
        font-size: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th, td {
        border: 1px solid #d1d5db;
        padding: 8px;
        text-align: left;
      }
      th {
        background: #f9fafb;
      }
      .totals-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 10px;
        margin-top: 10px;
      }
      .totals-grid .card {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 10px;
        background: #f9fafb;
      }
      @media print {
        body {
          background: #fff;
          padding: 0;
        }
        .sheet {
          border: 0;
          border-radius: 0;
          max-width: none;
          margin: 0;
          padding: 0;
        }
        .print-btn {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="header">
        <div>
          <h1>Daily Close Report</h1>
          <div class="muted">Date: ${escapeHtml(summary.date)}</div>
          <div class="muted">Location: ${escapeHtml(locationLabel)}</div>
        </div>
        <button class="print-btn" type="button" onclick="window.print()">Print</button>
      </div>

      <div class="totals-grid">
        <div class="card"><strong>Sales Count:</strong> ${summary.sales.count}</div>
        <div class="card"><strong>Receipts:</strong> ${summary.receipts.count}</div>
        <div class="card"><strong>Gross Sales:</strong> ${formatMoney(summary.sales.grossPence)}</div>
        <div class="card"><strong>Refunds:</strong> ${formatMoney(summary.refunds.totalPence)}</div>
        <div class="card"><strong>Net Sales:</strong> ${formatMoney(summary.netSalesPence)}</div>
        <div class="card"><strong>Expected Cash:</strong> ${formatMoney(summary.cashMovements.expectedCashInDrawerPence)}</div>
      </div>

      <h2>Sales Tenders</h2>
      <table>
        <thead><tr><th>Method</th><th>Total</th></tr></thead>
        <tbody>
          <tr><td>Cash</td>${moneyCell(summary.sales.tenderTotalsPence.CASH)}</tr>
          <tr><td>Card</td>${moneyCell(summary.sales.tenderTotalsPence.CARD)}</tr>
          <tr><td>Bank Transfer</td>${moneyCell(summary.sales.tenderTotalsPence.BANK_TRANSFER)}</tr>
          <tr><td>Voucher</td>${moneyCell(summary.sales.tenderTotalsPence.VOUCHER)}</tr>
        </tbody>
      </table>

      <h2>Refund Tenders</h2>
      <table>
        <thead><tr><th>Method</th><th>Total</th></tr></thead>
        <tbody>
          <tr><td>Cash</td>${moneyCell(summary.refunds.tenderTotalsPence.CASH)}</tr>
          <tr><td>Card</td>${moneyCell(summary.refunds.tenderTotalsPence.CARD)}</tr>
          <tr><td>Voucher</td>${moneyCell(summary.refunds.tenderTotalsPence.VOUCHER)}</tr>
          <tr><td>Other</td>${moneyCell(summary.refunds.tenderTotalsPence.OTHER)}</tr>
        </tbody>
      </table>

      <h2>Cash Movement Summary</h2>
      <table>
        <thead><tr><th>Metric</th><th>Total</th></tr></thead>
        <tbody>
          <tr><td>Float In</td>${moneyCell(summary.cashMovements.floatPence)}</tr>
          <tr><td>Paid In</td>${moneyCell(summary.cashMovements.paidInPence)}</tr>
          <tr><td>Paid Out</td>${moneyCell(summary.cashMovements.paidOutPence)}</tr>
          <tr><td>Cash Sales</td>${moneyCell(summary.cashMovements.cashSalesPence)}</tr>
          <tr><td>Cash Refunds</td>${moneyCell(summary.cashMovements.cashRefundsPence)}</tr>
          <tr><td><strong>Expected Cash In Drawer</strong></td>${moneyCell(summary.cashMovements.expectedCashInDrawerPence)}</tr>
        </tbody>
      </table>
    </div>
  </body>
</html>`;
};
