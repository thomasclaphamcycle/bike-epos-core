import type { SaleReceiptPrint } from "../services/receiptService";
import { escapeHtml } from "../utils/escapeHtml";

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const formatDateTime = (value: Date | null) => (value ? new Date(value).toLocaleString() : "-");

type SaleReceiptPageInput = {
  receipt: SaleReceiptPrint;
};

export const renderSaleReceiptPage = ({ receipt }: SaleReceiptPageInput) => {
  const itemRows = receipt.sale.items
    .map((item) => {
      const description = item.sku
        ? `${escapeHtml(item.name)} <span class="muted">(${escapeHtml(item.sku)})</span>`
        : escapeHtml(item.name);
      return `<tr>
        <td>${item.qty}</td>
        <td>${description}</td>
        <td>${formatMoney(item.unitPricePence)}</td>
        <td>${formatMoney(item.lineTotalPence)}</td>
      </tr>`;
    })
    .join("");

  const paymentRows = receipt.sale.payments
    .map(
      (payment) => `<tr>
        <td>${escapeHtml(payment.method)}</td>
        <td>${formatMoney(payment.amountPence)}</td>
      </tr>`,
    )
    .join("");

  const taxRow =
    receipt.sale.taxPence > 0
      ? `<div><strong>Tax/VAT:</strong> ${formatMoney(receipt.sale.taxPence)}</div>`
      : "";

  const staffLabel = receipt.sale.staff.name
    ? `${receipt.sale.staff.name}${receipt.sale.staff.id ? ` (${receipt.sale.staff.id})` : ""}`
    : (receipt.sale.staff.id ?? "-");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sale Receipt ${escapeHtml(receipt.sale.id)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: "Courier New", Courier, monospace; background: #f5f5f5; color: #141414; }
    .page { max-width: 900px; margin: 16px auto; padding: 0 14px 24px; }
    .card { background: #fff; border: 1px solid #d3d3d3; border-radius: 8px; padding: 14px; }
    .top { display: flex; justify-content: space-between; gap: 10px; }
    .muted { color: #616161; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #dedede; padding: 6px 4px; text-align: left; font-size: 12px; }
    th { font-weight: 700; }
    .totals { margin-top: 10px; font-size: 13px; }
    .totals div { margin: 2px 0; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button, a { border: 1px solid #c9c9c9; border-radius: 6px; background: #fafafa; padding: 6px 10px; font-size: 12px; color: inherit; text-decoration: none; cursor: pointer; }
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
    <div class="card" data-testid="sale-receipt-print-card">
      <div class="top">
        <div>
          <div><strong>${escapeHtml(receipt.shop.name)}</strong></div>
          <div>${escapeHtml(receipt.shop.address)}</div>
          ${receipt.shop.vatNumber ? `<div><strong>VAT:</strong> ${escapeHtml(receipt.shop.vatNumber)}</div>` : ""}
          <div style="margin-top:8px;"><strong>Sale Receipt</strong></div>
          <div><strong>Sale ID:</strong> ${escapeHtml(receipt.sale.id)}</div>
          <div><strong>Receipt No:</strong> ${escapeHtml(receipt.sale.receiptNumber)}</div>
          <div><strong>Completed:</strong> ${escapeHtml(formatDateTime(receipt.sale.completedAt))}</div>
          <div><strong>Staff:</strong> ${escapeHtml(staffLabel)}</div>
        </div>
        <div class="actions">
          <button type="button" onclick="window.print()">Print</button>
          <a href="/pos">Back to POS</a>
        </div>
      </div>

      <div style="margin-top: 12px;">
        <strong>Line Items</strong>
        <table>
          <thead>
            <tr><th>Qty</th><th>Description</th><th>Unit</th><th>Total</th></tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="4" class="muted">No line items.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="totals">
        <div><strong>Subtotal:</strong> ${formatMoney(receipt.sale.subtotalPence)}</div>
        ${taxRow}
        <div><strong>Total:</strong> ${formatMoney(receipt.sale.totalPence)}</div>
      </div>

      <div style="margin-top: 12px;">
        <strong>Payment Summary</strong>
        <table>
          <thead>
            <tr><th>Method</th><th>Amount</th></tr>
          </thead>
          <tbody>
            ${paymentRows || '<tr><td colspan="2" class="muted">No captured payments.</td></tr>'}
          </tbody>
        </table>
      </div>

      ${
        receipt.workshop
          ? `<div style="margin-top: 12px;">
               <strong>Workshop Link</strong>
               <div>Workshop Job ID: ${escapeHtml(receipt.workshop.jobId)}</div>
               <div><a href="${escapeHtml(receipt.workshop.printUrl)}">Open Workshop Print View</a></div>
             </div>`
          : ""
      }

      <div class="muted" style="margin-top: 12px;">
        Receipt URL: <a href="${escapeHtml(receipt.sale.shortReceiptUrl)}">${escapeHtml(receipt.sale.shortReceiptUrl)}</a>
      </div>
      ${receipt.shop.footerText ? `<div class="muted" style="margin-top: 10px;">${escapeHtml(receipt.shop.footerText)}</div>` : ""}
    </div>
  </div>
</body>
</html>`;
};
