import type { DetailedReceipt } from "../services/receiptService";
import { escapeHtml } from "../utils/escapeHtml";

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatDate = (value: Date | null) => (value ? new Date(value).toISOString() : "-");

type ReceiptPageInput = {
  receipt: DetailedReceipt;
};

export const renderReceiptPage = ({ receipt }: ReceiptPageInput) => {
  const itemRows = receipt.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.sku ?? "-")}</td><td>${item.qty}</td><td>${formatMoney(item.unitPricePence)}</td><td>${formatMoney(item.lineTotalPence)}</td></tr>`,
    )
    .join("");

  const tenderRows = receipt.tenders
    .map(
      (tender) =>
        `<tr><td>${escapeHtml(tender.method)}</td><td>${formatMoney(tender.amountPence)}</td><td>${escapeHtml(formatDate(tender.createdAt))}</td></tr>`,
    )
    .join("");

  const paymentRows = receipt.payments
    .map(
      (payment) =>
        `<tr><td>${escapeHtml(payment.id)}</td><td>${escapeHtml(payment.method)}</td><td>${escapeHtml(payment.status)}</td><td>${formatMoney(payment.amountPence)}</td><td>${escapeHtml(formatDate(payment.createdAt))}</td></tr>`,
    )
    .join("");

  const taxRow =
    receipt.totals.taxPence > 0
      ? `<div><strong>Tax/VAT:</strong> ${formatMoney(receipt.totals.taxPence)}</div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt ${escapeHtml(receipt.receiptNumber)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: "Courier New", Courier, monospace; background: #f4f4f4; color: #141414; }
    .page { max-width: 760px; margin: 18px auto; padding: 0 12px 24px; }
    .card { background: #fff; border: 1px solid #d3d3d3; border-radius: 8px; padding: 14px; }
    .top { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 10px; }
    .muted { color: #5f5f5f; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #dcdcdc; text-align: left; padding: 6px 4px; font-size: 12px; }
    th { font-weight: 700; }
    .totals { margin-top: 10px; font-size: 13px; }
    .totals div { margin: 2px 0; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button, a { border: 1px solid #c5c5c5; border-radius: 6px; background: #fafafa; padding: 6px 10px; font-size: 12px; color: inherit; text-decoration: none; cursor: pointer; }
    @media print {
      body { background: #fff; }
      .page { margin: 0; max-width: none; padding: 0; }
      .card { border: none; border-radius: 0; padding: 0; }
      .actions { display: none; }
      a { text-decoration: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="top">
        <div>
          <div><strong>${escapeHtml(receipt.shop.name)}</strong></div>
          <div>${escapeHtml(receipt.shop.address)}</div>
          ${receipt.shop.vatNumber ? `<div><strong>VAT:</strong> ${escapeHtml(receipt.shop.vatNumber)}</div>` : ""}
          <div style="margin-top:8px;"><strong>Receipt:</strong> ${escapeHtml(receipt.receiptNumber)}</div>
          <div><strong>Type:</strong> ${escapeHtml(receipt.type)}</div>
          <div><strong>Issued:</strong> ${escapeHtml(formatDate(receipt.issuedAt))}</div>
          <div><strong>Created:</strong> ${escapeHtml(formatDate(receipt.createdAt))}</div>
          <div><strong>Completed:</strong> ${escapeHtml(formatDate(receipt.completedAt))}</div>
          <div><strong>Staff:</strong> ${escapeHtml(receipt.staff.id ?? "-")}${receipt.staff.name ? ` (${escapeHtml(receipt.staff.name)})` : ""}</div>
          <div><strong>Customer:</strong> ${receipt.customer ? `${escapeHtml(receipt.customer.name)}${receipt.customer.phone ? ` (${escapeHtml(receipt.customer.phone)})` : ""}` : "-"}</div>
          ${receipt.saleId ? `<div><strong>Sale:</strong> ${escapeHtml(receipt.saleId)}</div>` : ""}
          ${receipt.refundId ? `<div><strong>Refund:</strong> ${escapeHtml(receipt.refundId)}</div>` : ""}
        </div>
        <div class="actions">
          <button type="button" onclick="window.print()">Print</button>
          <a href="/pos">Back to POS</a>
        </div>
      </div>

      <div>
        <strong>Items</strong>
        <table>
          <thead>
            <tr><th>Description</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Line</th></tr>
          </thead>
          <tbody>
            ${itemRows || "<tr><td colspan=\"5\" class=\"muted\">No items.</td></tr>"}
          </tbody>
        </table>
      </div>

      <div class="totals">
        <div><strong>Subtotal:</strong> ${formatMoney(receipt.totals.subtotalPence)}</div>
        ${taxRow}
        <div><strong>Total:</strong> ${formatMoney(receipt.totals.totalPence)}</div>
        <div><strong>Change Due:</strong> ${formatMoney(receipt.totals.changeDuePence)}</div>
      </div>

      <div style="margin-top: 12px;">
        <strong>Tenders</strong>
        <table>
          <thead>
            <tr><th>Method</th><th>Amount</th><th>Created</th></tr>
          </thead>
          <tbody>
            ${tenderRows || "<tr><td colspan=\"3\" class=\"muted\">No tenders.</td></tr>"}
          </tbody>
        </table>
      </div>

      <div style="margin-top: 12px;">
        <strong>Payments</strong>
        <table>
          <thead>
            <tr><th>ID</th><th>Method</th><th>Status</th><th>Amount</th><th>Created</th></tr>
          </thead>
          <tbody>
            ${paymentRows || "<tr><td colspan=\"5\" class=\"muted\">No payments.</td></tr>"}
          </tbody>
        </table>
      </div>

      ${receipt.refund ? `<div class="totals"><div><strong>Refund Reason:</strong> ${escapeHtml(receipt.refund.reason)}</div></div>` : ""}
      ${receipt.shop.footerText ? `<div class="muted" style="margin-top: 12px;">${escapeHtml(receipt.shop.footerText)}</div>` : ""}
    </div>
  </div>
</body>
</html>`;
};
