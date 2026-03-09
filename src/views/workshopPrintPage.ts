import { escapeHtml } from "../utils/escapeHtml";

type WorkshopPrintLine = {
  id: string;
  type: string;
  description: string;
  qty: number;
  unitPricePence: number;
  lineTotalPence: number;
};

type WorkshopPrintInput = {
  job: {
    id: string;
    status: string;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    bikeDescription: string | null;
    notes: string | null;
    scheduledDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  lines: WorkshopPrintLine[];
  totals: {
    subtotalPence: number;
  };
};

const formatMoney = (valuePence: number) => `£${(valuePence / 100).toFixed(2)}`;

const formatDateTime = (value: Date | null) => {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
};

export const renderWorkshopPrintPage = (input: WorkshopPrintInput) => {
  const job = input.job;
  const lineRows = input.lines
    .map(
      (line) => `
      <tr>
        <td>${escapeHtml(line.type)}</td>
        <td>${escapeHtml(line.description)}</td>
        <td>${line.qty}</td>
        <td>${formatMoney(line.unitPricePence)}</td>
        <td>${formatMoney(line.lineTotalPence)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Workshop Job ${escapeHtml(job.id)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1b1b1b; }
    h1 { margin: 0 0 8px; }
    .muted { color: #555; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(240px, 1fr)); gap: 8px 16px; margin: 16px 0; }
    .meta div { border: 1px solid #ddd; padding: 8px 10px; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .totals { margin-top: 12px; display: flex; justify-content: flex-end; }
    .totals div { min-width: 220px; border: 1px solid #ddd; padding: 10px; border-radius: 6px; }
    @media print {
      button { display: none; }
      body { margin: 8mm; }
    }
  </style>
</head>
<body>
  <h1>Workshop Job Card</h1>
  <div class="muted">Job ID: ${escapeHtml(job.id)}</div>
  <div class="meta">
    <div><strong>Status:</strong> ${escapeHtml(job.status)}</div>
    <div><strong>Promised Date:</strong> ${escapeHtml(formatDateTime(job.scheduledDate))}</div>
    <div><strong>Customer:</strong> ${escapeHtml(job.customerName ?? "-")}</div>
    <div><strong>Bike:</strong> ${escapeHtml(job.bikeDescription ?? "-")}</div>
    <div><strong>Email:</strong> ${escapeHtml(job.customerEmail ?? "-")}</div>
    <div><strong>Phone:</strong> ${escapeHtml(job.customerPhone ?? "-")}</div>
    <div><strong>Created:</strong> ${escapeHtml(formatDateTime(job.createdAt))}</div>
    <div><strong>Updated:</strong> ${escapeHtml(formatDateTime(job.updatedAt))}</div>
  </div>
  <div><strong>Notes:</strong> ${escapeHtml(job.notes ?? "-")}</div>

  <table>
    <thead>
      <tr>
        <th>Type</th>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="5">No line items</td></tr>`}
    </tbody>
  </table>

  <div class="totals">
    <div><strong>Subtotal:</strong> ${formatMoney(input.totals.subtotalPence)}</div>
  </div>

  <p>
    <button type="button" onclick="window.print()">Print</button>
  </p>
</body>
</html>`;
};
