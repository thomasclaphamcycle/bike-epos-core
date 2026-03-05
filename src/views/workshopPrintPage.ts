import { escapeHtml } from "../utils/escapeHtml";

type WorkshopPrintPayload = {
  shop: {
    name: string;
    address: string;
    vatNumber: string | null;
  };
  job: {
    id: string;
    title: string | null;
    notes: string | null;
    statusV1: string;
    promisedAt: Date | null;
    createdAt: Date;
    saleId: string | null;
    lines: Array<{
      id: string;
      type: "PART" | "LABOUR";
      description: string;
      qty: number;
      unitPricePence: number;
      lineTotalPence: number;
      variantSku: string | null;
      productName: string | null;
      variantName: string | null;
    }>;
    totals: {
      subtotalPence: number;
      taxPence: number;
      totalPence: number;
    };
    partsStatus: "OK" | "SHORT";
  };
  customer: {
    id: string | null;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  sale: {
    id: string;
    completedAt: Date | null;
    receiptNumber: string | null;
    receiptUrl: string | null;
  } | null;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const formatDateTime = (value: Date | null) => (value ? new Date(value).toLocaleString() : "-");

export const renderWorkshopPrintPage = (payload: WorkshopPrintPayload) => {
  const lineRows = payload.job.lines
    .map((line) => {
      const detail = line.type === "PART"
        ? [line.productName, line.variantName, line.variantSku].filter(Boolean).join(" / ")
        : "Labour";
      return `<tr>
        <td>${escapeHtml(line.type)}</td>
        <td>${escapeHtml(line.description)}</td>
        <td>${escapeHtml(detail || "-")}</td>
        <td>${line.qty}</td>
        <td>${formatMoney(line.unitPricePence)}</td>
        <td>${formatMoney(line.lineTotalPence)}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Workshop Job ${escapeHtml(payload.job.id)}</title>
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
    <div class="card" data-testid="workshop-print-card">
      <div class="top">
        <div>
          <div><strong>${escapeHtml(payload.shop.name)}</strong></div>
          <div>${escapeHtml(payload.shop.address)}</div>
          ${payload.shop.vatNumber ? `<div><strong>VAT:</strong> ${escapeHtml(payload.shop.vatNumber)}</div>` : ""}
          <div style="margin-top:8px;"><strong>Workshop Job Estimate</strong></div>
          <div><strong>Job ID:</strong> ${escapeHtml(payload.job.id)}</div>
          <div><strong>Status:</strong> ${escapeHtml(payload.job.statusV1)}</div>
          <div><strong>Parts Status:</strong> ${escapeHtml(payload.job.partsStatus)}</div>
          <div><strong>Promised:</strong> ${escapeHtml(formatDateTime(payload.job.promisedAt))}</div>
          <div><strong>Created:</strong> ${escapeHtml(formatDateTime(payload.job.createdAt))}</div>
        </div>
        <div class="actions">
          <button type="button" onclick="window.print()">Print</button>
          <a href="/workshop/${encodeURIComponent(payload.job.id)}">Back to Job</a>
        </div>
      </div>

      <div style="margin-top: 10px;">
        <div><strong>Customer</strong></div>
        <div>Name: ${escapeHtml(payload.customer?.name ?? "-")}</div>
        <div>Email: ${escapeHtml(payload.customer?.email ?? "-")}</div>
        <div>Phone: ${escapeHtml(payload.customer?.phone ?? "-")}</div>
      </div>

      <div style="margin-top: 10px;">
        <div><strong>Job Details</strong></div>
        <div>Title: ${escapeHtml(payload.job.title ?? "-")}</div>
        <div>Notes: ${escapeHtml(payload.job.notes ?? "-")}</div>
      </div>

      <div style="margin-top: 12px;">
        <strong>Line Items</strong>
        <table>
          <thead>
            <tr><th>Type</th><th>Description</th><th>Detail</th><th>Qty</th><th>Unit</th><th>Line</th></tr>
          </thead>
          <tbody>
            ${lineRows || '<tr><td colspan="6" class="muted">No line items.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="totals">
        <div><strong>Subtotal:</strong> ${formatMoney(payload.job.totals.subtotalPence)}</div>
        <div><strong>Tax:</strong> ${formatMoney(payload.job.totals.taxPence)}</div>
        <div><strong>Total:</strong> ${formatMoney(payload.job.totals.totalPence)}</div>
      </div>

      <div style="margin-top: 12px;">
        <strong>Linked Sale</strong>
        ${payload.sale
          ? `<div>Sale ID: ${escapeHtml(payload.sale.id)}</div>
             <div>Completed: ${escapeHtml(formatDateTime(payload.sale.completedAt))}</div>
             <div>Receipt: ${payload.sale.receiptUrl ? `<a href="${escapeHtml(payload.sale.receiptUrl)}">${escapeHtml(payload.sale.receiptNumber ?? "View receipt")}</a>` : "-"}</div>`
          : "<div class=\"muted\">No linked sale.</div>"}
      </div>
    </div>
  </div>
</body>
</html>`;
};
