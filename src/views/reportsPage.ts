const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type ReportsPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderReportsPage = (input: ReportsPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "MANAGER");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reports</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #ffffff;
      --text: #1d2329;
      --muted: #5a6672;
      --line: #d9e0e6;
      --accent: #0f6b8f;
      --danger-bg: #fff2f2;
      --danger-text: #8b1f1f;
      --warn-bg: #fff9e8;
      --warn-text: #7a5600;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    h1, h2 {
      margin: 0 0 10px;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .section-head h2 {
      margin: 0;
    }
    .muted {
      color: var(--muted);
      font-size: 14px;
    }
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: end;
    }
    .field {
      display: grid;
      gap: 6px;
      min-width: 140px;
    }
    .field label {
      font-size: 13px;
      color: var(--muted);
    }
    input, select, button {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 14px;
      background: #fff;
      color: var(--text);
    }
    button {
      cursor: pointer;
      background: #f8fbfd;
    }
    button.primary {
      background: var(--accent);
      color: #fff;
      border-color: #0b5b79;
    }
    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .tab-btn.active {
      background: var(--accent);
      color: #fff;
      border-color: #0b5b79;
    }
    .tab-panel {
      display: none;
    }
    .tab-panel.active {
      display: block;
    }
    .status {
      margin: 8px 0 12px;
      font-size: 14px;
      color: var(--muted);
      min-height: 20px;
    }
    .status.error {
      color: var(--danger-text);
      background: var(--danger-bg);
      border: 1px solid #f3c9c9;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .totals {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .total-box {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fafcfe;
    }
    .total-box .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .total-box .value {
      font-weight: 600;
      font-size: 16px;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      font-size: 13px;
      white-space: nowrap;
    }
    th {
      background: #f5f9fc;
      font-weight: 600;
      color: #2a3a49;
    }
    tr.missing-cost td {
      background: var(--warn-bg);
      color: var(--warn-text);
    }
    .note {
      font-size: 13px;
      color: var(--muted);
      margin: 8px 0 10px;
    }
    .empty {
      padding: 14px;
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 768px) {
      .page {
        padding: 12px;
      }
      table {
        min-width: 620px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="topbar">
        <div>
          <h1>Reports</h1>
          <div class="muted">Read-only reporting dashboard (M20). Manager access required.</div>
        </div>
        <div class="controls">
          <div class="field">
            <label for="staff-role">X-Staff-Role</label>
            <select id="staff-role">
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div class="field">
            <label for="staff-id">X-Staff-Id (optional)</label>
            <input id="staff-id" type="text" placeholder="manager-1" />
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="tabs">
        <button class="tab-btn active" data-tab="sales" type="button">Sales Daily</button>
        <button class="tab-btn" data-tab="workshop" type="button">Workshop Daily</button>
        <button class="tab-btn" data-tab="onhand" type="button">Inventory On-hand</button>
        <button class="tab-btn" data-tab="value" type="button">Inventory Value</button>
      </div>

      <section id="tab-sales" class="tab-panel active">
        <div class="section-head">
          <h2>Sales Daily</h2>
          <button id="sales-table-export" type="button">Export CSV</button>
        </div>
        <div class="controls">
          <div class="field">
            <label for="sales-from">From</label>
            <input id="sales-from" type="date" />
          </div>
          <div class="field">
            <label for="sales-to">To</label>
            <input id="sales-to" type="date" />
          </div>
          <button id="sales-load" class="primary" type="button">Load</button>
          <button id="sales-export" type="button">Export CSV</button>
        </div>
        <div class="note">Refunds are posted on refund day. Net may be negative.</div>
        <div id="sales-status" class="status">Choose a date range and click Load.</div>
        <div id="sales-totals" class="totals"></div>
        <div id="sales-table-wrap" class="table-wrap"></div>
      </section>

      <section id="tab-workshop" class="tab-panel">
        <div class="section-head">
          <h2>Workshop Daily</h2>
          <button id="workshop-table-export" type="button">Export CSV</button>
        </div>
        <div class="controls">
          <div class="field">
            <label for="workshop-from">From</label>
            <input id="workshop-from" type="date" />
          </div>
          <div class="field">
            <label for="workshop-to">To</label>
            <input id="workshop-to" type="date" />
          </div>
          <button id="workshop-load" class="primary" type="button">Load</button>
          <button id="workshop-export" type="button">Export CSV</button>
        </div>
        <div id="workshop-status" class="status">Choose a date range and click Load.</div>
        <div id="workshop-totals" class="totals"></div>
        <div id="workshop-table-wrap" class="table-wrap"></div>
      </section>

      <section id="tab-onhand" class="tab-panel">
        <div class="section-head">
          <h2>Inventory On-hand</h2>
          <button id="onhand-table-export" type="button">Export CSV</button>
        </div>
        <div class="controls">
          <div class="field">
            <label for="onhand-location">Location</label>
            <select id="onhand-location"></select>
          </div>
          <div class="field">
            <label for="onhand-filter">Filter (variant/name/barcode)</label>
            <input id="onhand-filter" type="text" placeholder="type to filter" />
          </div>
          <button id="onhand-load" class="primary" type="button">Load</button>
          <button id="onhand-export" type="button">Export CSV</button>
        </div>
        <div id="onhand-status" class="status">Select a location and click Load.</div>
        <div id="onhand-table-wrap" class="table-wrap"></div>
      </section>

      <section id="tab-value" class="tab-panel">
        <div class="section-head">
          <h2>Inventory Value</h2>
          <button id="value-table-export" type="button">Export CSV</button>
        </div>
        <div class="controls">
          <div class="field">
            <label for="value-location">Location</label>
            <select id="value-location"></select>
          </div>
          <button id="value-load" class="primary" type="button">Load</button>
          <button id="value-export" type="button">Export CSV</button>
        </div>
        <div id="value-status" class="status">Select a location and click Load.</div>
        <div id="value-totals" class="totals"></div>
        <div id="value-table-wrap" class="table-wrap"></div>
      </section>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);

      const state = {
        salesRows: [],
        workshopRows: [],
        onHandRows: [],
        onHandFilteredRows: [],
        valueRows: [],
      };

      const roleInput = qs("#staff-role");
      const staffIdInput = qs("#staff-id");
      roleInput.value = "${initialRole}" === "ADMIN" ? "ADMIN" : "MANAGER";
      staffIdInput.value = "${initialStaffId}";

      const today = new Date();
      const toDate = today.toISOString().slice(0, 10);
      const fromDateObj = new Date(today);
      fromDateObj.setUTCDate(fromDateObj.getUTCDate() - 6);
      const fromDate = fromDateObj.toISOString().slice(0, 10);
      qs("#sales-from").value = fromDate;
      qs("#sales-to").value = toDate;
      qs("#workshop-from").value = fromDate;
      qs("#workshop-to").value = toDate;

      const formatPence = (pence) => {
        const n = Number(pence || 0);
        const sign = n < 0 ? "-" : "";
        const abs = Math.abs(n);
        return sign + "£" + (abs / 100).toFixed(2);
      };

      const setStatus = (id, message, isError = false) => {
        const el = qs("#" + id);
        el.textContent = message;
        if (isError) {
          el.classList.add("error");
        } else {
          el.classList.remove("error");
        }
      };

      const getHeaders = () => {
        const headers = { "X-Staff-Role": roleInput.value || "MANAGER" };
        const staffId = staffIdInput.value.trim();
        if (staffId.length > 0) {
          headers["X-Staff-Id"] = staffId;
        }
        return headers;
      };

      const apiGet = async (path) => {
        const response = await fetch(path, {
          headers: getHeaders(),
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          const message =
            payload?.error?.message ||
            payload?.error ||
            "Request failed with status " + response.status;
          throw new Error(message);
        }
        return payload;
      };

      const parseDateInput = (value) => {
        if (!value || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
          return null;
        }
        const timestamp = Date.parse(value + "T00:00:00Z");
        if (Number.isNaN(timestamp)) {
          return null;
        }
        return timestamp;
      };

      const isValidDateRange = (from, to) => {
        const fromTs = parseDateInput(from);
        const toTs = parseDateInput(to);
        if (fromTs == null || toTs == null) {
          return false;
        }
        return fromTs <= toTs;
      };

      const exportButtonGroups = {
        sales: ["#sales-export", "#sales-table-export"],
        workshop: ["#workshop-export", "#workshop-table-export"],
        onhand: ["#onhand-export", "#onhand-table-export"],
        value: ["#value-export", "#value-table-export"],
      };

      const exportLoading = {
        sales: false,
        workshop: false,
        onhand: false,
        value: false,
      };

      const withExportButtons = (reportKey, callback) => {
        const selectors = exportButtonGroups[reportKey] || [];
        selectors.forEach((selector) => {
          const button = qs(selector);
          if (button) {
            callback(button);
          }
        });
      };

      const focusAndScroll = (selector) => {
        const el = qs(selector);
        if (!el) {
          return;
        }
        if (typeof el.focus === "function") {
          el.focus();
        }
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };

      const getDateRangeOrError = (fromSelector, toSelector, statusId, isExport) => {
        const from = qs(fromSelector).value;
        const to = qs(toSelector).value;
        const exportSuffix = isExport ? " before exporting." : ".";

        if (!from || !to) {
          setStatus(statusId, "Please provide both from and to dates" + exportSuffix, true);
          focusAndScroll(!from ? fromSelector : toSelector);
          return null;
        }

        if (!isValidDateRange(from, to)) {
          setStatus(
            statusId,
            "Please provide a valid date range (from must be on/before to)" + exportSuffix,
            true,
          );
          focusAndScroll(fromSelector);
          return null;
        }

        return { from, to };
      };

      const getLocationIdOrError = (selector, statusId, isExport) => {
        const locationId = qs(selector).value;
        const message = isExport ? "Select a location before exporting." : "Select a location first.";
        if (!locationId) {
          setStatus(statusId, message, true);
          focusAndScroll(selector);
          return null;
        }
        return locationId;
      };

      const updateExportButtonStates = () => {
        const canExportSales = isValidDateRange(qs("#sales-from").value, qs("#sales-to").value);
        const canExportWorkshop = isValidDateRange(qs("#workshop-from").value, qs("#workshop-to").value);
        const canExportOnHand = Boolean(qs("#onhand-location").value);
        const canExportValue = Boolean(qs("#value-location").value);

        withExportButtons("sales", (button) => {
          button.disabled = exportLoading.sales || !canExportSales;
          button.textContent = exportLoading.sales ? "Downloading..." : "Export CSV";
        });
        withExportButtons("workshop", (button) => {
          button.disabled = exportLoading.workshop || !canExportWorkshop;
          button.textContent = exportLoading.workshop ? "Downloading..." : "Export CSV";
        });
        withExportButtons("onhand", (button) => {
          button.disabled = exportLoading.onhand || !canExportOnHand;
          button.textContent = exportLoading.onhand ? "Downloading..." : "Export CSV";
        });
        withExportButtons("value", (button) => {
          button.disabled = exportLoading.value || !canExportValue;
          button.textContent = exportLoading.value ? "Downloading..." : "Export CSV";
        });
      };

      const getFilenameFromDisposition = (contentDisposition) => {
        if (!contentDisposition) {
          return null;
        }

        const utf8Match = contentDisposition.match(/filename\\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
          try {
            return decodeURIComponent(utf8Match[1].replace(/["']/g, ""));
          } catch {
            return utf8Match[1].replace(/["']/g, "");
          }
        }

        const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
        return basicMatch?.[1] ?? null;
      };

      const downloadCsvFromEndpoint = async ({ path, statusId, reportKey, fallbackFilename }) => {
        exportLoading[reportKey] = true;
        updateExportButtonStates();
        setStatus(statusId, "Downloading CSV...");
        try {
          const response = await fetch(path, {
            headers: getHeaders(),
          });

          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              throw new Error("Manager access required.");
            }
            if (response.status >= 500) {
              throw new Error("Export failed, try again.");
            }

            let message = "Request failed with status " + response.status;
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
              try {
                const payload = await response.json();
                message = payload?.error?.message || payload?.error || message;
              } catch {
                message = response.statusText || message;
              }
            } else {
              message = response.statusText || message;
            }
            throw new Error(message);
          }

          const contentType = (response.headers.get("content-type") || "").toLowerCase();
          const serverFilename = getFilenameFromDisposition(response.headers.get("content-disposition"));
          const csvByType =
            contentType.includes("csv") ||
            contentType.includes("application/octet-stream") ||
            contentType.includes("application/vnd.ms-excel");
          const csvByFilename = Boolean(serverFilename && serverFilename.toLowerCase().endsWith(".csv"));
          let csvByContent = false;

          if (!csvByType && !csvByFilename) {
            const firstLine = (await response.clone().text()).split(/\\r?\\n/, 1)[0]?.trim() ?? "";
            csvByContent = firstLine.includes(",") && !firstLine.toLowerCase().includes("<html");
          }

          if (!csvByType && !csvByFilename && !csvByContent) {
            throw new Error("Export failed, try again.");
          }

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = serverFilename || fallbackFilename || "report.csv";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setStatus(statusId, "CSV download started.");
        } catch (error) {
          setStatus(statusId, "Could not download CSV: " + error.message, true);
        } finally {
          exportLoading[reportKey] = false;
          updateExportButtonStates();
        }
      };

      const renderTable = (containerId, columns, rows, rowClassFn) => {
        const container = qs("#" + containerId);
        if (!Array.isArray(rows) || rows.length === 0) {
          container.innerHTML = '<div class="empty">No rows for current filters.</div>';
          return;
        }

        const thead = "<thead><tr>" + columns.map((c) => "<th>" + c.label + "</th>").join("") + "</tr></thead>";
        const bodyRows = rows
          .map((row) => {
            const className = rowClassFn ? rowClassFn(row) : "";
            const classAttr = className ? ' class="' + className + '"' : "";
            const tds = columns.map((c) => "<td>" + c.render(row) + "</td>").join("");
            return "<tr" + classAttr + ">" + tds + "</tr>";
          })
          .join("");
        container.innerHTML = "<table>" + thead + "<tbody>" + bodyRows + "</tbody></table>";
      };

      const renderSales = () => {
        const rows = state.salesRows;
        const totals = rows.reduce(
          (acc, row) => {
            acc.saleCount += Number(row.saleCount || 0);
            acc.grossPence += Number(row.grossPence || 0);
            acc.refundsPence += Number(row.refundsPence || 0);
            acc.netPence += Number(row.netPence || 0);
            return acc;
          },
          { saleCount: 0, grossPence: 0, refundsPence: 0, netPence: 0 },
        );

        qs("#sales-totals").innerHTML = [
          { label: "Sale Count", value: String(totals.saleCount) },
          { label: "Gross", value: formatPence(totals.grossPence) + " (" + totals.grossPence + "p)" },
          { label: "Refunds", value: formatPence(totals.refundsPence) + " (" + totals.refundsPence + "p)" },
          { label: "Net", value: formatPence(totals.netPence) + " (" + totals.netPence + "p)" },
        ]
          .map((entry) =>
            '<div class="total-box"><div class="label">' + entry.label + '</div><div class="value">' + entry.value + "</div></div>",
          )
          .join("");

        renderTable(
          "sales-table-wrap",
          [
            { label: "Date", render: (r) => r.date, get: (r) => r.date },
            { label: "Sale Count", render: (r) => String(r.saleCount ?? 0), get: (r) => String(r.saleCount ?? 0) },
            { label: "Gross (p)", render: (r) => String(r.grossPence ?? 0), get: (r) => String(r.grossPence ?? 0) },
            { label: "Refunds (p)", render: (r) => String(r.refundsPence ?? 0), get: (r) => String(r.refundsPence ?? 0) },
            { label: "Net (p)", render: (r) => String(r.netPence ?? 0), get: (r) => String(r.netPence ?? 0) },
          ],
          rows,
        );
      };

      const renderWorkshop = () => {
        const rows = state.workshopRows;
        const totals = rows.reduce(
          (acc, row) => {
            acc.jobCount += Number(row.jobCount || 0);
            acc.revenuePence += Number(row.revenuePence || 0);
            return acc;
          },
          { jobCount: 0, revenuePence: 0 },
        );

        qs("#workshop-totals").innerHTML = [
          { label: "Job Count", value: String(totals.jobCount) },
          { label: "Revenue", value: formatPence(totals.revenuePence) + " (" + totals.revenuePence + "p)" },
        ]
          .map((entry) =>
            '<div class="total-box"><div class="label">' + entry.label + '</div><div class="value">' + entry.value + "</div></div>",
          )
          .join("");

        renderTable(
          "workshop-table-wrap",
          [
            { label: "Date", render: (r) => r.date, get: (r) => r.date },
            { label: "Job Count", render: (r) => String(r.jobCount ?? 0), get: (r) => String(r.jobCount ?? 0) },
            { label: "Revenue (p)", render: (r) => String(r.revenuePence ?? 0), get: (r) => String(r.revenuePence ?? 0) },
          ],
          rows,
        );
      };

      const renderOnHand = () => {
        renderTable(
          "onhand-table-wrap",
          [
            { label: "Variant ID", render: (r) => r.variantId, get: (r) => r.variantId },
            { label: "Product", render: (r) => r.productName ?? "", get: (r) => r.productName ?? "" },
            { label: "Option/Name", render: (r) => r.option ?? "", get: (r) => r.option ?? "" },
            { label: "Barcode", render: (r) => r.barcode ?? "", get: (r) => r.barcode ?? "" },
            { label: "On Hand", render: (r) => String(r.onHand ?? 0), get: (r) => String(r.onHand ?? 0) },
          ],
          state.onHandFilteredRows,
        );
      };

      const renderValue = (response) => {
        const totalsHtml = [
          { label: "Total On Hand", value: String(response.totalOnHand ?? 0) },
          { label: "Total Value", value: formatPence(response.totalValuePence ?? 0) + " (" + (response.totalValuePence ?? 0) + "p)" },
          { label: "Missing Cost Rows", value: String(response.countMissingCost ?? 0) },
          { label: "Method", value: response.method ?? "" },
        ]
          .map((entry) =>
            '<div class="total-box"><div class="label">' + entry.label + '</div><div class="value">' + entry.value + "</div></div>",
          )
          .join("");
        qs("#value-totals").innerHTML = totalsHtml;

        renderTable(
          "value-table-wrap",
          [
            { label: "Variant ID", render: (r) => r.variantId, get: (r) => r.variantId },
            { label: "On Hand", render: (r) => String(r.onHand ?? 0), get: (r) => String(r.onHand ?? 0) },
            {
              label: "Avg Unit Cost (p)",
              render: (r) => (r.avgUnitCostPence === null ? "MISSING" : String(r.avgUnitCostPence)),
              get: (r) => (r.avgUnitCostPence === null ? "" : String(r.avgUnitCostPence)),
            },
            { label: "Value (p)", render: (r) => String(r.valuePence ?? 0), get: (r) => String(r.valuePence ?? 0) },
          ],
          state.valueRows,
          (row) => (row.avgUnitCostPence === null ? "missing-cost" : ""),
        );
      };

      const applyOnHandFilter = () => {
        const query = qs("#onhand-filter").value.trim().toLowerCase();
        if (!query) {
          state.onHandFilteredRows = [...state.onHandRows];
          renderOnHand();
          return;
        }
        state.onHandFilteredRows = state.onHandRows.filter((row) => {
          const haystack = [
            row.variantId ?? "",
            row.productName ?? "",
            row.option ?? "",
            row.barcode ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        });
        renderOnHand();
      };

      const loadLocations = async () => {
        const onHandSelect = qs("#onhand-location");
        const valueSelect = qs("#value-location");
        onHandSelect.innerHTML = "";
        valueSelect.innerHTML = "";
        setStatus("onhand-status", "Loading locations...");
        setStatus("value-status", "Loading locations...");
        try {
          const payload = await apiGet("/api/locations");
          const locations = Array.isArray(payload.locations) ? payload.locations : [];
          if (locations.length === 0) {
            setStatus("onhand-status", "No stock locations found.", true);
            setStatus("value-status", "No stock locations found.", true);
            return;
          }

          const options = locations
            .map((location) => {
              const label = location.isDefault ? location.name + " (default)" : location.name;
              return '<option value="' + location.id + '">' + label + "</option>";
            })
            .join("");
          onHandSelect.innerHTML = options;
          valueSelect.innerHTML = options;
          setStatus("onhand-status", "Select a location and click Load.");
          setStatus("value-status", "Select a location and click Load.");
          updateExportButtonStates();
        } catch (error) {
          setStatus("onhand-status", "Could not load locations: " + error.message, true);
          setStatus("value-status", "Could not load locations: " + error.message, true);
          updateExportButtonStates();
        }
      };

      const loadSales = async () => {
        const range = getDateRangeOrError("#sales-from", "#sales-to", "sales-status", false);
        if (!range) {
          return;
        }
        const from = range.from;
        const to = range.to;
        setStatus("sales-status", "Loading sales report...");
        try {
          const rows = await apiGet("/api/reports/sales/daily?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to));
          state.salesRows = Array.isArray(rows) ? rows : [];
          renderSales();
          setStatus("sales-status", "Loaded " + state.salesRows.length + " day rows.");
        } catch (error) {
          setStatus("sales-status", "Could not load sales report: " + error.message, true);
        }
      };

      const loadWorkshop = async () => {
        const range = getDateRangeOrError("#workshop-from", "#workshop-to", "workshop-status", false);
        if (!range) {
          return;
        }
        const from = range.from;
        const to = range.to;
        setStatus("workshop-status", "Loading workshop report...");
        try {
          const rows = await apiGet("/api/reports/workshop/daily?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to));
          state.workshopRows = Array.isArray(rows) ? rows : [];
          renderWorkshop();
          setStatus("workshop-status", "Loaded " + state.workshopRows.length + " day rows.");
        } catch (error) {
          setStatus("workshop-status", "Could not load workshop report: " + error.message, true);
        }
      };

      const loadOnHand = async () => {
        const locationId = getLocationIdOrError("#onhand-location", "onhand-status", false);
        if (!locationId) {
          return;
        }
        setStatus("onhand-status", "Loading on-hand report...");
        try {
          const rows = await apiGet("/api/reports/inventory/on-hand?locationId=" + encodeURIComponent(locationId));
          state.onHandRows = Array.isArray(rows) ? rows : [];
          applyOnHandFilter();
          setStatus("onhand-status", "Loaded " + state.onHandRows.length + " variants.");
        } catch (error) {
          setStatus("onhand-status", "Could not load inventory on-hand: " + error.message, true);
        }
      };

      const loadValue = async () => {
        const locationId = getLocationIdOrError("#value-location", "value-status", false);
        if (!locationId) {
          return;
        }
        setStatus("value-status", "Loading inventory value report...");
        try {
          const payload = await apiGet("/api/reports/inventory/value?locationId=" + encodeURIComponent(locationId));
          state.valueRows = Array.isArray(payload.breakdown) ? payload.breakdown : [];
          renderValue(payload);
          setStatus("value-status", "Loaded " + state.valueRows.length + " variants.");
        } catch (error) {
          setStatus("value-status", "Could not load inventory value: " + error.message, true);
        }
      };

      const exportSalesCsv = () => {
        const range = getDateRangeOrError("#sales-from", "#sales-to", "sales-status", true);
        if (!range) {
          return;
        }
        const params = new URLSearchParams();
        params.set("from", range.from);
        params.set("to", range.to);
        void downloadCsvFromEndpoint({
          path: "/api/reports/sales/daily.csv?" + params.toString(),
          statusId: "sales-status",
          reportKey: "sales",
          fallbackFilename: "sales_daily_" + range.from + "_" + range.to + ".csv",
        });
      };

      const exportWorkshopCsv = () => {
        const range = getDateRangeOrError("#workshop-from", "#workshop-to", "workshop-status", true);
        if (!range) {
          return;
        }
        const params = new URLSearchParams();
        params.set("from", range.from);
        params.set("to", range.to);
        void downloadCsvFromEndpoint({
          path: "/api/reports/workshop/daily.csv?" + params.toString(),
          statusId: "workshop-status",
          reportKey: "workshop",
          fallbackFilename: "workshop_daily_" + range.from + "_" + range.to + ".csv",
        });
      };

      const exportOnHandCsv = () => {
        const locationId = getLocationIdOrError("#onhand-location", "onhand-status", true);
        if (!locationId) {
          return;
        }
        const params = new URLSearchParams();
        params.set("locationId", locationId);
        void downloadCsvFromEndpoint({
          path: "/api/reports/inventory/on-hand.csv?" + params.toString(),
          statusId: "onhand-status",
          reportKey: "onhand",
          fallbackFilename: "inventory_on_hand.csv",
        });
      };

      const exportValueCsv = () => {
        const locationId = getLocationIdOrError("#value-location", "value-status", true);
        if (!locationId) {
          return;
        }
        const params = new URLSearchParams();
        params.set("locationId", locationId);
        void downloadCsvFromEndpoint({
          path: "/api/reports/inventory/value.csv?" + params.toString(),
          statusId: "value-status",
          reportKey: "value",
          fallbackFilename: "inventory_value.csv",
        });
      };

      const setupTabs = () => {
        const buttons = Array.from(document.querySelectorAll(".tab-btn"));
        const panels = Array.from(document.querySelectorAll(".tab-panel"));
        buttons.forEach((button) => {
          button.addEventListener("click", () => {
            const tab = button.getAttribute("data-tab");
            buttons.forEach((b) => b.classList.remove("active"));
            panels.forEach((panel) => panel.classList.remove("active"));
            button.classList.add("active");
            const panel = qs("#tab-" + tab);
            if (panel) {
              panel.classList.add("active");
            }
          });
        });
      };

      qs("#sales-load").addEventListener("click", loadSales);
      qs("#workshop-load").addEventListener("click", loadWorkshop);
      qs("#onhand-load").addEventListener("click", loadOnHand);
      qs("#value-load").addEventListener("click", loadValue);
      qs("#onhand-location").addEventListener("change", loadOnHand);
      qs("#value-location").addEventListener("change", loadValue);
      qs("#onhand-filter").addEventListener("input", applyOnHandFilter);
      qs("#sales-from").addEventListener("input", updateExportButtonStates);
      qs("#sales-to").addEventListener("input", updateExportButtonStates);
      qs("#workshop-from").addEventListener("input", updateExportButtonStates);
      qs("#workshop-to").addEventListener("input", updateExportButtonStates);
      qs("#onhand-location").addEventListener("change", updateExportButtonStates);
      qs("#value-location").addEventListener("change", updateExportButtonStates);

      qs("#sales-export").addEventListener("click", exportSalesCsv);
      qs("#sales-table-export").addEventListener("click", exportSalesCsv);
      qs("#workshop-export").addEventListener("click", exportWorkshopCsv);
      qs("#workshop-table-export").addEventListener("click", exportWorkshopCsv);
      qs("#onhand-export").addEventListener("click", exportOnHandCsv);
      qs("#onhand-table-export").addEventListener("click", exportOnHandCsv);
      qs("#value-export").addEventListener("click", exportValueCsv);
      qs("#value-table-export").addEventListener("click", exportValueCsv);

      setupTabs();
      loadLocations();
      updateExportButtonStates();
      renderSales();
      renderWorkshop();
      renderOnHand();
      renderValue({
        totalOnHand: 0,
        totalValuePence: 0,
        countMissingCost: 0,
        method: "PURCHASE_COST_AVG_V1",
        breakdown: [],
      });
    })();
  </script>
</body>
</html>`;
};
