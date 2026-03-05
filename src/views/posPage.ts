import { escapeHtml } from "../utils/escapeHtml";

type PosPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderPosPage = (input: PosPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>POS</title>
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
      --ok-bg: #edf9f0;
      --ok-text: #226634;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    .page {
      max-width: 1320px;
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
      gap: 12px;
      flex-wrap: wrap;
    }
    h1, h2, h3 {
      margin: 0 0 10px;
    }
    .muted {
      color: var(--muted);
      font-size: 14px;
    }
    .links {
      display: flex;
      gap: 10px;
      font-size: 14px;
      align-items: center;
      flex-wrap: wrap;
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
      min-width: 150px;
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
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .status {
      margin-top: 8px;
      font-size: 14px;
      color: var(--muted);
      min-height: 18px;
    }
    .status.error {
      color: var(--danger-text);
      background: var(--danger-bg);
      border: 1px solid #f3c9c9;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .status.ok {
      color: var(--ok-text);
      background: var(--ok-bg);
      border: 1px solid #bfe7c9;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .grid-two {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: 12px;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      margin-top: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 900px;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      font-size: 13px;
      vertical-align: middle;
      white-space: nowrap;
    }
    th {
      background: #f5f9fc;
      font-weight: 600;
      color: #2a3a49;
    }
    td input[type="number"] {
      width: 90px;
      box-sizing: border-box;
      padding: 6px 8px;
      font-size: 13px;
    }
    .receipt {
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: #fafcfe;
      padding: 12px;
      margin-top: 12px;
    }
    @media (max-width: 980px) {
      .page {
        padding: 12px;
      }
      .grid-two {
        grid-template-columns: 1fr;
      }
      table {
        min-width: 760px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="topbar">
        <div>
          <h1>POS</h1>
          <div class="muted">Search products, build basket, and checkout sales.</div>
        </div>
        <div class="controls">
          <div class="field">
            <label for="staff-role">X-Staff-Role</label>
            <select id="staff-role">
              <option value="STAFF">STAFF</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div class="field">
            <label for="staff-id">X-Staff-Id (optional)</label>
            <input id="staff-id" type="text" placeholder="staff-1" />
          </div>
          <div class="links">
            <a href="/inventory">Inventory</a>
            <a href="/catalog">Catalog</a>
            <a href="/purchasing">Purchasing</a>
            <a href="/workshop">Workshop</a>
            <a href="/till">Till</a>
            <a href="/admin">Admin</a>
            <a href="/reports">Reports</a>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-two">
      <div>
        <div class="card">
          <h2>Product Search</h2>
          <div class="controls">
            <div class="field" style="min-width: 280px;">
              <label for="search-q">Search / Scan</label>
              <input id="search-q" type="text" placeholder="SKU, barcode, product name" />
            </div>
            <button id="search-load" class="primary" type="button">Search</button>
          </div>
          <div class="muted" style="margin-top: 6px;">Barcode scan hint: numeric input with 8+ digits searches by barcode.</div>
          <div id="search-status" class="status">Search for products to add to basket.</div>
          <div id="search-table-wrap" class="table-wrap"></div>

          <div id="quick-panel" class="receipt" style="margin-top: 12px;">
            <div class="muted">Select a product result to view quick actions.</div>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>Basket</h2>
          <div class="controls">
            <button id="basket-new" class="primary" type="button">New Basket</button>
            <div class="field" style="min-width: 250px;">
              <label for="basket-id-input">Load Basket ID</label>
              <input id="basket-id-input" type="text" placeholder="basket uuid" />
            </div>
            <button id="basket-load" type="button">Load Basket</button>
          </div>
          <div id="basket-meta" class="muted" style="margin-top: 6px;"></div>
          <div id="basket-status" class="status">No basket loaded.</div>
          <div id="basket-table-wrap" class="table-wrap"></div>

          <h3 style="margin-top: 14px;">Customer</h3>
          <div class="controls">
            <div class="field" style="min-width: 260px;">
              <label for="customer-search">Customer Search</label>
              <input id="customer-search" type="text" placeholder="name, email, phone" />
            </div>
            <button id="customer-search-btn" type="button">Search</button>
            <button id="customer-clear-btn" type="button">Clear</button>
          </div>
          <div id="customer-status" class="status"></div>
          <div id="customer-meta" class="muted" style="margin-top: 6px;">No customer selected.</div>
          <div id="customer-results-wrap" class="table-wrap"></div>

          <h3 style="margin-top: 14px;">Checkout</h3>
          <div class="controls">
            <div class="field">
              <label for="checkout-amount">Amount (pence)</label>
              <input id="checkout-amount" type="number" min="1" step="1" />
            </div>
            <div class="field" style="min-width: 180px;">
              <label for="checkout-ref">Provider Ref</label>
              <input id="checkout-ref" type="text" placeholder="optional" />
            </div>
            <button id="checkout-btn" type="button">Checkout Only</button>
            <button id="pay-cash-btn" class="primary" type="button">Pay Cash</button>
            <button id="pay-card-btn" type="button">Pay Card</button>
            <button id="capture-card-btn" type="button">Capture Card Intent</button>
          </div>
          <div id="checkout-status" class="status"></div>

          <h3 style="margin-top: 14px;">Tender Checkout (M39)</h3>
          <div class="controls">
            <div class="field">
              <label for="tender-method">Method</label>
              <select id="tender-method" data-testid="tender-method">
                <option value="CASH">CASH</option>
                <option value="CARD">CARD</option>
                <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                <option value="VOUCHER">VOUCHER</option>
              </select>
            </div>
            <div class="field">
              <label for="tender-amount">Amount (pence)</label>
              <input id="tender-amount" type="number" min="1" step="1" data-testid="tender-amount" />
            </div>
            <button id="tender-add-btn" type="button" class="primary" data-testid="tender-add-btn">Add Tender</button>
            <button id="tender-add-cash-remaining" type="button">Cash Remaining</button>
            <button id="tender-add-card-remaining" type="button">Card Remaining</button>
            <button id="tender-refresh-btn" type="button">Refresh Tenders</button>
            <button id="tender-complete-btn" type="button" data-testid="tender-complete-btn">Complete Sale</button>
          </div>
          <div id="tender-status" class="status"></div>
          <div id="tender-summary" class="muted" style="margin-top: 6px;">No sale/tender summary yet.</div>
          <div id="tender-table-wrap" class="table-wrap"></div>
          <div id="sale-receipt"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);

      const roleInput = qs("#staff-role");
      const staffIdInput = qs("#staff-id");
      roleInput.value = ["STAFF", "MANAGER", "ADMIN"].includes("${initialRole}")
        ? "${initialRole}"
        : "STAFF";
      staffIdInput.value = "${initialStaffId}";

      const state = {
        searchRows: [],
        selectedProductId: null,
        basket: null,
        lastSale: null,
        tenderSummary: null,
        lastPaymentIntentId: null,
        customerResults: [],
        selectedCustomer: null,
      };

      const setStatus = (id, message, mode = "info") => {
        const el = qs("#" + id);
        if (!el) {
          return;
        }
        el.textContent = message;
        el.classList.remove("error", "ok");
        if (mode === "error") {
          el.classList.add("error");
        }
        if (mode === "ok") {
          el.classList.add("ok");
        }
      };

      const getHeaders = () => {
        const headers = { "X-Staff-Role": roleInput.value || "STAFF" };
        const staffId = (staffIdInput.value || "").trim();
        if (staffId) {
          headers["X-Staff-Id"] = staffId;
        }
        return headers;
      };

      const getErrorMessage = (payload, fallback) =>
        payload?.error?.message || payload?.error || fallback;

      const apiRequest = async (path, options = {}) => {
        const response = await fetch(path, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            ...getHeaders(),
            ...(options.headers || {}),
          },
        });

        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { raw: text };
        }

        if (!response.ok) {
          const error = new Error(
            getErrorMessage(payload, "Request failed (" + response.status + ")"),
          );
          error.status = response.status;
          error.payload = payload;
          throw error;
        }

        return payload;
      };

      const formatMoney = (pence) => "£" + ((Number(pence || 0) / 100).toFixed(2));
      const escapeHtml = (value) =>
        String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      const toSafeText = (value) => escapeHtml(value);

      const getCustomerDisplayName = (customer) => {
        if (!customer) {
          return "";
        }
        if (customer.name) {
          return customer.name;
        }
        return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
      };

      const renderSearchTable = () => {
        const wrap = qs("#search-table-wrap");
        if (!wrap) {
          return;
        }

        if (state.searchRows.length === 0) {
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No products loaded.</div>';
          return;
        }

        const rows = state.searchRows
          .map((row) =>
            '<tr>' +
            '<td>' + toSafeText(row.name || "") + '</td>' +
            '<td>' + toSafeText(row.sku || "") + '</td>' +
            '<td>' + toSafeText(row.barcode || "") + '</td>' +
            '<td>' + formatMoney(row.pricePence || 0) + '</td>' +
            '<td>' + Number(row.onHandQty || 0) + '</td>' +
            '<td><button type="button" class="select-product-btn" data-product-id="' + toSafeText(row.id) + '">Select</button></td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>Name</th><th>SKU</th><th>Barcode</th><th>Price</th><th>On Hand</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const renderQuickPanel = () => {
        const panel = qs("#quick-panel");
        if (!panel) {
          return;
        }

        const selected = state.searchRows.find((row) => row.id === state.selectedProductId);
        if (!selected) {
          panel.innerHTML = '<div class="muted">Select a product result to view quick actions.</div>';
          return;
        }

        panel.innerHTML =
          '<div><strong>' + toSafeText(selected.name || "") + '</strong></div>' +
          '<div class="muted" style="margin-top: 4px;">SKU: ' + toSafeText(selected.sku || "") + ' | Barcode: ' + toSafeText(selected.barcode || "-") + '</div>' +
          '<div class="muted" style="margin-top: 2px;">Price: ' + formatMoney(selected.pricePence || 0) + ' | On hand: ' + Number(selected.onHandQty || 0) + '</div>' +
          '<div class="controls" style="margin-top: 10px;">' +
          '<button type="button" class="primary quick-add-1" data-product-id="' + toSafeText(selected.id) + '">Add x1</button>' +
          '<input id="quick-qty-input" type="number" min="1" step="1" value="1" style="width: 110px;" />' +
          '<button type="button" class="quick-add-custom" data-product-id="' + toSafeText(selected.id) + '">Add Custom Qty</button>' +
          '</div>';
      };

      const renderCustomerPanel = () => {
        const meta = qs("#customer-meta");
        const wrap = qs("#customer-results-wrap");
        if (!meta || !wrap) {
          return;
        }

        if (state.selectedCustomer) {
          const label = getCustomerDisplayName(state.selectedCustomer) || state.selectedCustomer.id;
          const email = state.selectedCustomer.email || "-";
          const phone = state.selectedCustomer.phone || "-";
          meta.textContent = "Selected customer: " + label + " | Email: " + email + " | Phone: " + phone;
        } else {
          meta.textContent = "No customer selected.";
        }

        if (state.customerResults.length === 0) {
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No customer results.</div>';
          return;
        }

        const rows = state.customerResults
          .map((customer) =>
            '<tr>' +
            '<td>' + toSafeText(getCustomerDisplayName(customer) || customer.id) + '</td>' +
            '<td>' + toSafeText(customer.email || "") + '</td>' +
            '<td>' + toSafeText(customer.phone || "") + '</td>' +
            '<td><button type="button" class="select-customer-btn" data-customer-id="' + toSafeText(customer.id) + '">Select</button></td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const renderBasket = () => {
        const wrap = qs("#basket-table-wrap");
        const meta = qs("#basket-meta");
        if (!wrap || !meta) {
          return;
        }

        if (!state.basket) {
          meta.textContent = "";
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No basket loaded.</div>';
          qs("#checkout-amount").value = "";
          return;
        }

        meta.textContent = "Basket: " + state.basket.id + " | Status: " + state.basket.status;

        const items = Array.isArray(state.basket.items) ? state.basket.items : [];
        if (items.length === 0) {
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">Basket is empty.</div>';
        } else {
          const rows = items
            .map((item) =>
              '<tr>' +
              '<td>' + toSafeText(item.productName || "") + '</td>' +
              '<td>' + toSafeText(item.variantName || "") + '</td>' +
              '<td>' + toSafeText(item.sku || "") + '</td>' +
              '<td>' + formatMoney(item.unitPricePence || 0) + '</td>' +
              '<td>' + formatMoney(item.lineTotalPence || 0) + '</td>' +
              '<td><input type="number" min="1" step="1" value="' + Number(item.quantity || 1) + '" class="basket-qty" data-item-id="' + toSafeText(item.id) + '" /></td>' +
              '<td><button type="button" class="basket-update-btn" data-item-id="' + toSafeText(item.id) + '">Update</button></td>' +
              '<td><button type="button" class="basket-remove-btn" data-item-id="' + toSafeText(item.id) + '">Remove</button></td>' +
              '</tr>',
            )
            .join("");

          wrap.innerHTML =
            '<table>' +
            '<thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th>Unit</th><th>Line Total</th><th>Qty</th><th>Qty</th><th>Remove</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
            '</table>';
        }

        const totalPence = Number(state.basket.totals?.totalPence || 0);
        qs("#checkout-amount").value = totalPence > 0 ? String(totalPence) : "";
      };

      const renderReceipt = () => {
        const wrap = qs("#sale-receipt");
        if (!wrap) {
          return;
        }

        if (!state.lastSale) {
          wrap.innerHTML = "";
          return;
        }

        const sale = state.lastSale.sale || {};
        const customer = sale.customer || null;
        const customerLabel = customer
          ? (customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() || customer.id)
          : "Walk-in";
        const saleItems = Array.isArray(state.lastSale.saleItems) ? state.lastSale.saleItems : [];
        const rows = saleItems
          .map((item) =>
            '<tr>' +
            '<td>' + toSafeText(item.productName || "") + '</td>' +
            '<td>' + toSafeText(item.variantName || "") + '</td>' +
            '<td>' + (item.quantity || 0) + '</td>' +
            '<td>' + formatMoney(item.unitPricePence || 0) + '</td>' +
            '<td>' + formatMoney(item.lineTotalPence || 0) + '</td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<div class="receipt">' +
          '<div><strong>Sale ID:</strong> ' + toSafeText(sale.id || "") + '</div>' +
          '<div><strong>Basket ID:</strong> ' + toSafeText(sale.basketId || "") + '</div>' +
          '<div><strong>Customer:</strong> ' + toSafeText(customerLabel) + '</div>' +
          '<div><strong>Total:</strong> ' + formatMoney(sale.totalPence || 0) + '</div>' +
          '<div><strong>Change Due:</strong> ' + formatMoney(sale.changeDuePence || 0) + '</div>' +
          '<div><strong>Completed:</strong> ' + (sale.completedAt ? toSafeText(String(sale.completedAt)) : '-') + '</div>' +
          (sale.id
            ? '<div style="margin-top: 6px;"><a href="/sales/' + encodeURIComponent(sale.id) + '/receipt" target="_blank" rel="noopener">View Receipt</a></div>'
            : '') +
          '<div style="margin-top: 10px;" class="table-wrap">' +
          '<table>' +
          '<thead><tr><th>Product</th><th>Variant</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>' +
          '</div>' +
          '</div>';
      };

      const renderTenderPanel = () => {
        const wrap = qs("#tender-table-wrap");
        const summary = qs("#tender-summary");
        const completeBtn = qs("#tender-complete-btn");
        const amountInput = qs("#tender-amount");
        if (!wrap || !summary || !completeBtn || !(amountInput instanceof HTMLInputElement)) {
          return;
        }

        const saleId = state.lastSale?.sale?.id;
        if (!saleId || !state.tenderSummary) {
          summary.textContent = "No sale/tender summary yet.";
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No tenders.</div>';
          completeBtn.disabled = true;
          amountInput.value = "";
          return;
        }

        const tenderSummary = state.tenderSummary;
        const tenders = Array.isArray(tenderSummary.tenders) ? tenderSummary.tenders : [];
        const overTenderPence = Math.max(0, tenderSummary.tenderedPence - tenderSummary.totalPence);
        const canComplete =
          tenderSummary.tenderedPence >= tenderSummary.totalPence &&
          (overTenderPence === 0 || tenderSummary.cashTenderedPence >= overTenderPence);
        completeBtn.disabled = Boolean(tenderSummary.isCompleted) || !canComplete;

        if (!amountInput.value) {
          const suggested = tenderSummary.remainingPence > 0 ? tenderSummary.remainingPence : 0;
          if (suggested > 0) {
            amountInput.value = String(suggested);
          }
        }

        summary.textContent =
          "Total: " +
          formatMoney(tenderSummary.totalPence || 0) +
          " | Tendered: " +
          formatMoney(tenderSummary.tenderedPence || 0) +
          " | Remaining: " +
          formatMoney(tenderSummary.remainingPence || 0) +
          " | Change Due: " +
          formatMoney(tenderSummary.changeDuePence || 0);

        if (tenders.length === 0) {
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No tenders.</div>';
          return;
        }

        const rows = tenders
          .map((tender) =>
            '<tr>' +
            '<td>' + toSafeText(tender.method || "") + '</td>' +
            '<td>' + formatMoney(tender.amountPence || 0) + '</td>' +
            '<td>' + toSafeText(tender.createdAt || "") + '</td>' +
            '<td>' +
            (tenderSummary.isCompleted
              ? '-'
              : '<button type="button" class="tender-remove-btn" data-tender-id="' +
                toSafeText(tender.id) +
                '">Remove</button>') +
            '</td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>Method</th><th>Amount</th><th>Created</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const loadTenderSummary = async (saleId) => {
        if (!saleId) {
          state.tenderSummary = null;
          renderTenderPanel();
          return null;
        }

        try {
          const summary = await apiRequest(
            "/api/sales/" + encodeURIComponent(saleId) + "/tenders",
          );
          state.tenderSummary = summary;
          renderTenderPanel();
          return summary;
        } catch (error) {
          state.tenderSummary = null;
          renderTenderPanel();
          setStatus("tender-status", error.message || "Failed to load tenders", "error");
          return null;
        }
      };

      const addTender = async (methodOverride, amountOverride) => {
        const checkoutResult = await ensureSaleCheckedOut();
        const saleId = checkoutResult?.sale?.id;
        if (!saleId) {
          setStatus("tender-status", "No sale available for tenders.", "error");
          return;
        }

        const methodSelect = qs("#tender-method");
        const amountInput = qs("#tender-amount");
        if (!(methodSelect instanceof HTMLSelectElement) || !(amountInput instanceof HTMLInputElement)) {
          return;
        }

        const method = methodOverride || methodSelect.value;
        const rawAmount = amountOverride !== undefined ? String(amountOverride) : amountInput.value;
        const amountPence = Number.parseInt(rawAmount || "", 10);
        if (!Number.isInteger(amountPence) || amountPence <= 0) {
          setStatus("tender-status", "Tender amount must be a positive integer.", "error");
          return;
        }

        setStatus("tender-status", "Adding tender...");
        try {
          const result = await apiRequest(
            "/api/sales/" + encodeURIComponent(saleId) + "/tenders",
            {
              method: "POST",
              body: JSON.stringify({
                method,
                amountPence,
              }),
            },
          );
          state.tenderSummary = result.summary;
          renderTenderPanel();
          setStatus("tender-status", "Tender added.", "ok");
        } catch (error) {
          setStatus("tender-status", error.message || "Failed to add tender", "error");
        }
      };

      const addRemainingTender = async (method) => {
        const saleId = state.lastSale?.sale?.id;
        if (!saleId) {
          setStatus("tender-status", "Checkout a basket first.", "error");
          return;
        }

        const summary = state.tenderSummary || (await loadTenderSummary(saleId));
        const remaining = Number(summary?.remainingPence || 0);
        if (remaining <= 0) {
          setStatus("tender-status", "No remaining amount to tender.", "error");
          return;
        }

        await addTender(method, remaining);
      };

      const removeTender = async (tenderId) => {
        const saleId = state.lastSale?.sale?.id;
        if (!saleId) {
          return;
        }
        if (!tenderId) {
          return;
        }

        setStatus("tender-status", "Removing tender...");
        try {
          const summary = await apiRequest(
            "/api/sales/" + encodeURIComponent(saleId) + "/tenders/" + encodeURIComponent(tenderId),
            {
              method: "DELETE",
            },
          );
          state.tenderSummary = summary;
          renderTenderPanel();
          setStatus("tender-status", "Tender removed.", "ok");
        } catch (error) {
          setStatus("tender-status", error.message || "Failed to remove tender", "error");
        }
      };

      const completeSaleWithTenders = async () => {
        const saleId = state.lastSale?.sale?.id;
        if (!saleId) {
          setStatus("tender-status", "Checkout a basket first.", "error");
          return;
        }

        setStatus("tender-status", "Completing sale...");
        try {
          const completion = await apiRequest(
            "/api/sales/" + encodeURIComponent(saleId) + "/complete",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          );
          const salePayload = await apiRequest("/api/sales/" + encodeURIComponent(saleId));
          state.lastSale = salePayload;
          await loadTenderSummary(saleId);
          renderReceipt();
          setStatus(
            "tender-status",
            "Sale completed. Change due: " + formatMoney(completion.changeDuePence || 0),
            "ok",
          );
        } catch (error) {
          setStatus("tender-status", error.message || "Failed to complete sale", "error");
        }
      };

      const createBasket = async () => {
        setStatus("basket-status", "Creating basket...");
        try {
          const basket = await apiRequest("/api/baskets", {
            method: "POST",
            body: JSON.stringify({}),
          });
          state.basket = basket;
          state.lastSale = null;
          state.tenderSummary = null;
          state.lastPaymentIntentId = null;
          qs("#basket-id-input").value = basket.id;
          renderBasket();
          renderTenderPanel();
          renderReceipt();
          setStatus("basket-status", "Basket created.", "ok");
        } catch (error) {
          setStatus("basket-status", error.message || "Failed to create basket", "error");
        }
      };

      const loadBasket = async () => {
        const basketId = (qs("#basket-id-input").value || "").trim();
        if (!basketId) {
          setStatus("basket-status", "Enter a basket id.", "error");
          return;
        }

        setStatus("basket-status", "Loading basket...");
        try {
          const basket = await apiRequest("/api/baskets/" + encodeURIComponent(basketId));
          state.basket = basket;
          renderBasket();
          renderTenderPanel();
          setStatus("basket-status", "Basket loaded.", "ok");
        } catch (error) {
          setStatus("basket-status", error.message || "Failed to load basket", "error");
        }
      };

      const ensureOpenBasket = async () => {
        if (!state.basket || state.basket.status !== "OPEN") {
          await createBasket();
        }
      };

      const isBarcodeLike = (value) => /^[0-9]{8,}$/.test(value);

      const searchCatalog = async () => {
        const rawInput = (qs("#search-q").value || "").trim();
        if (!rawInput) {
          setStatus("search-status", "Enter search text.", "error");
          return;
        }

        setStatus("search-status", "Searching products...");
        try {
          const query = isBarcodeLike(rawInput)
            ? "barcode=" + encodeURIComponent(rawInput)
            : "q=" + encodeURIComponent(rawInput);
          const payload = await apiRequest("/api/products/search?" + query + "&take=50&skip=0");
          state.searchRows = Array.isArray(payload?.rows) ? payload.rows : [];
          state.selectedProductId = state.searchRows[0]?.id ?? null;
          renderSearchTable();
          renderQuickPanel();
          setStatus("search-status", "Loaded " + state.searchRows.length + " products.", "ok");
        } catch (error) {
          setStatus("search-status", error.message || "Search failed", "error");
        }
      };

      const attachSelectedCustomerToSale = async (saleId) => {
        if (!saleId || !state.selectedCustomer?.id) {
          return;
        }

        setStatus("customer-status", "Attaching customer to sale...");
        try {
          const updatedSale = await apiRequest(
            "/api/sales/" + encodeURIComponent(saleId) + "/customer",
            {
              method: "PATCH",
              body: JSON.stringify({
                customerId: state.selectedCustomer.id,
              }),
            },
          );
          state.lastSale = updatedSale;
          renderReceipt();
          setStatus("customer-status", "Customer attached to sale.", "ok");
        } catch (error) {
          setStatus("customer-status", error.message || "Failed to attach customer", "error");
        }
      };

      const searchCustomers = async () => {
        const query = (qs("#customer-search").value || "").trim();
        if (!query) {
          setStatus("customer-status", "Enter search text.", "error");
          return;
        }

        setStatus("customer-status", "Searching customers...");
        try {
          const payload = await apiRequest(
            "/api/customers/search?q=" + encodeURIComponent(query) + "&take=20",
          );
          state.customerResults = Array.isArray(payload?.customers) ? payload.customers : [];
          if (!state.selectedCustomer && state.customerResults.length > 0) {
            state.selectedCustomer = state.customerResults[0];
          }
          renderCustomerPanel();
          setStatus("customer-status", "Loaded " + state.customerResults.length + " customers.", "ok");
        } catch (error) {
          setStatus("customer-status", error.message || "Customer search failed", "error");
        }
      };

      const selectCustomer = async (customerId) => {
        if (!customerId) {
          return;
        }

        state.selectedCustomer =
          state.customerResults.find((customer) => customer.id === customerId) || null;
        renderCustomerPanel();

        const saleId = state.lastSale?.sale?.id;
        if (!saleId) {
          setStatus("customer-status", "Customer selected. It will attach after checkout.", "ok");
          return;
        }

        await attachSelectedCustomerToSale(saleId);
      };

      const clearSelectedCustomer = async () => {
        state.selectedCustomer = null;
        state.customerResults = [];
        renderCustomerPanel();

        const saleId = state.lastSale?.sale?.id;
        if (!saleId) {
          setStatus("customer-status", "Customer selection cleared.", "ok");
          return;
        }

        setStatus("customer-status", "Detaching customer...");
        try {
          const updatedSale = await apiRequest(
            "/api/sales/" + encodeURIComponent(saleId) + "/customer",
            {
              method: "PATCH",
              body: JSON.stringify({ customerId: null }),
            },
          );
          state.lastSale = updatedSale;
          renderReceipt();
          setStatus("customer-status", "Customer detached from sale.", "ok");
        } catch (error) {
          setStatus("customer-status", error.message || "Failed to detach customer", "error");
        }
      };

      const addProductToBasket = async (variantId, quantity) => {
        if (!Number.isInteger(quantity) || quantity <= 0) {
          setStatus("basket-status", "Add quantity must be a positive integer.", "error");
          return;
        }

        await ensureOpenBasket();
        if (!state.basket) {
          setStatus("basket-status", "No basket available.", "error");
          return;
        }

        setStatus("basket-status", "Adding item...");
        try {
          const basket = await apiRequest(
            "/api/baskets/" + encodeURIComponent(state.basket.id) + "/lines",
            {
              method: "POST",
              body: JSON.stringify({
                variantId,
                quantity,
              }),
            },
          );
          state.basket = basket;
          renderBasket();
          setStatus("basket-status", "Item added.", "ok");
        } catch (error) {
          setStatus("basket-status", error.message || "Failed to add item", "error");
        }
      };

      const updateBasketLine = async (itemId, quantityInput) => {
        if (!state.basket) {
          return;
        }

        const quantity = Number.parseInt(quantityInput.value || "", 10);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          setStatus("basket-status", "Quantity must be a positive integer.", "error");
          return;
        }

        setStatus("basket-status", "Updating item...");
        try {
          const basket = await apiRequest(
            "/api/baskets/" + encodeURIComponent(state.basket.id) + "/lines/" + encodeURIComponent(itemId),
            {
              method: "PATCH",
              body: JSON.stringify({ quantity }),
            },
          );
          state.basket = basket;
          renderBasket();
          setStatus("basket-status", "Item updated.", "ok");
        } catch (error) {
          setStatus("basket-status", error.message || "Failed to update item", "error");
        }
      };

      const removeBasketLine = async (itemId) => {
        if (!state.basket) {
          return;
        }

        setStatus("basket-status", "Removing item...");
        try {
          const basket = await apiRequest(
            "/api/baskets/" + encodeURIComponent(state.basket.id) + "/lines/" + encodeURIComponent(itemId),
            {
              method: "DELETE",
            },
          );
          state.basket = basket;
          renderBasket();
          setStatus("basket-status", "Item removed.", "ok");
        } catch (error) {
          setStatus("basket-status", error.message || "Failed to remove item", "error");
        }
      };

      const parseCheckoutAmount = () => {
        const amountRaw = (qs("#checkout-amount").value || "").trim();
        if (!amountRaw) {
          return Number(state.basket?.totals?.totalPence || 0);
        }
        const parsed = Number.parseInt(amountRaw, 10);
        return Number.isInteger(parsed) ? parsed : NaN;
      };

      const checkoutOnly = async () => {
        if (!state.basket) {
          setStatus("checkout-status", "No basket loaded.", "error");
          return null;
        }

        setStatus("checkout-status", "Checking out basket...");
        try {
          const result = await apiRequest(
            "/api/baskets/" + encodeURIComponent(state.basket.id) + "/checkout",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          );

          state.lastSale = result;
          await loadTenderSummary(result.sale?.id);
          if (result.sale?.id && state.selectedCustomer?.id) {
            await attachSelectedCustomerToSale(result.sale.id);
          }
          await loadBasket();
          renderReceipt();
          setStatus(
            "checkout-status",
            result.idempotent ? "Basket already checked out." : "Checkout complete.",
            "ok",
          );
          return result;
        } catch (error) {
          setStatus("checkout-status", error.message || "Checkout failed", "error");
          return null;
        }
      };

      const ensureSaleCheckedOut = async () => {
        if (!state.basket) {
          return null;
        }

        const currentSale = state.lastSale?.sale;
        if (currentSale?.basketId && currentSale.basketId === state.basket.id) {
          return state.lastSale;
        }

        return checkoutOnly();
      };

      const createIntentForSale = async (provider) => {
        const checkoutResult = await ensureSaleCheckedOut();
        if (!checkoutResult?.sale?.id) {
          return null;
        }

        const amountPence = parseCheckoutAmount();
        if (!Number.isInteger(amountPence) || amountPence <= 0) {
          setStatus("checkout-status", "Amount must be a positive integer (pence).", "error");
          return null;
        }

        const providerRef = (qs("#checkout-ref").value || "").trim();
        const payload = await apiRequest("/api/payments/intents", {
          method: "POST",
          body: JSON.stringify({
            saleId: checkoutResult.sale.id,
            amountPence,
            provider,
            externalRef: providerRef || undefined,
          }),
        });

        state.lastPaymentIntentId = payload.intent?.id || null;
        await loadTenderSummary(checkoutResult.sale.id);
        return payload;
      };

      const payCash = async () => {
        setStatus("checkout-status", "Creating cash payment intent...");
        try {
          const result = await createIntentForSale("CASH");
          if (!result) {
            return;
          }
          const paidLabel = result.salePayment?.paid ? "Sale is fully paid." : "Sale is partially paid.";
          await loadTenderSummary(state.lastSale?.sale?.id);
          setStatus(
            "checkout-status",
            "Cash intent captured: " + result.intent.id + ". " + paidLabel,
            "ok",
          );
        } catch (error) {
          setStatus("checkout-status", error.message || "Cash payment failed", "error");
        }
      };

      const payCard = async () => {
        setStatus("checkout-status", "Creating card payment intent...");
        try {
          const result = await createIntentForSale("CARD");
          if (!result) {
            return;
          }
          if (result.intent.status === "REQUIRES_ACTION") {
            setStatus(
              "checkout-status",
              "Card intent created (" + result.intent.id + "). Capture when terminal confirms.",
              "ok",
            );
            return;
          }
          await loadTenderSummary(state.lastSale?.sale?.id);
          setStatus("checkout-status", "Card intent status: " + result.intent.status, "ok");
        } catch (error) {
          setStatus("checkout-status", error.message || "Card payment intent failed", "error");
        }
      };

      const captureCardIntent = async () => {
        if (!state.lastPaymentIntentId) {
          setStatus("checkout-status", "No payment intent to capture.", "error");
          return;
        }

        setStatus("checkout-status", "Capturing card intent...");
        try {
          const result = await apiRequest(
            "/api/payments/intents/" + encodeURIComponent(state.lastPaymentIntentId) + "/capture",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          );
          const paidLabel = result.salePayment?.paid ? "Sale is fully paid." : "Sale is partially paid.";
          await loadTenderSummary(state.lastSale?.sale?.id);
          setStatus(
            "checkout-status",
            "Intent captured: " + result.intent.id + ". " + paidLabel,
            "ok",
          );
        } catch (error) {
          setStatus("checkout-status", error.message || "Intent capture failed", "error");
        }
      };

      qs("#search-load")?.addEventListener("click", () => {
        searchCatalog();
      });

      qs("#search-q")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchCatalog();
        }
      });

      qs("#search-table-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("select-product-btn")) {
          return;
        }

        const selectedId = target.getAttribute("data-product-id");
        if (!selectedId) {
          return;
        }

        state.selectedProductId = selectedId;
        renderQuickPanel();
      });

      qs("#quick-panel")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }

        const selectedId = target.getAttribute("data-product-id");
        if (!selectedId) {
          return;
        }

        if (target.classList.contains("quick-add-1")) {
          addProductToBasket(selectedId, 1);
          return;
        }

        if (target.classList.contains("quick-add-custom")) {
          const qtyInput = qs("#quick-qty-input");
          if (!(qtyInput instanceof HTMLInputElement)) {
            return;
          }
          const quantity = Number.parseInt(qtyInput.value || "", 10);
          addProductToBasket(selectedId, quantity);
        }
      });

      qs("#customer-search-btn")?.addEventListener("click", () => {
        searchCustomers();
      });

      qs("#customer-search")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchCustomers();
        }
      });

      qs("#customer-results-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("select-customer-btn")) {
          return;
        }

        const customerId = target.getAttribute("data-customer-id");
        if (customerId) {
          selectCustomer(customerId);
        }
      });

      qs("#customer-clear-btn")?.addEventListener("click", () => {
        clearSelectedCustomer();
      });

      qs("#basket-new")?.addEventListener("click", () => {
        createBasket();
      });
      qs("#basket-load")?.addEventListener("click", () => {
        loadBasket();
      });

      qs("#basket-table-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }

        const itemId = target.getAttribute("data-item-id");
        if (!itemId) {
          return;
        }

        if (target.classList.contains("basket-update-btn")) {
          const qtyInput = qs('.basket-qty[data-item-id="' + itemId + '"]');
          if (!(qtyInput instanceof HTMLInputElement)) {
            return;
          }
          updateBasketLine(itemId, qtyInput);
          return;
        }

        if (target.classList.contains("basket-remove-btn")) {
          removeBasketLine(itemId);
        }
      });

      qs("#checkout-btn")?.addEventListener("click", () => {
        checkoutOnly();
      });

      qs("#pay-cash-btn")?.addEventListener("click", () => {
        payCash();
      });

      qs("#pay-card-btn")?.addEventListener("click", () => {
        payCard();
      });

      qs("#capture-card-btn")?.addEventListener("click", () => {
        captureCardIntent();
      });

      qs("#tender-add-btn")?.addEventListener("click", () => {
        addTender();
      });

      qs("#tender-add-cash-remaining")?.addEventListener("click", () => {
        addRemainingTender("CASH");
      });

      qs("#tender-add-card-remaining")?.addEventListener("click", () => {
        addRemainingTender("CARD");
      });

      qs("#tender-refresh-btn")?.addEventListener("click", () => {
        loadTenderSummary(state.lastSale?.sale?.id);
      });

      qs("#tender-complete-btn")?.addEventListener("click", () => {
        completeSaleWithTenders();
      });

      qs("#tender-table-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("tender-remove-btn")) {
          return;
        }
        const tenderId = target.getAttribute("data-tender-id");
        if (!tenderId) {
          return;
        }
        removeTender(tenderId);
      });

      const initialize = async () => {
        renderSearchTable();
        renderQuickPanel();
        renderBasket();
        renderTenderPanel();
        renderCustomerPanel();
        renderReceipt();
        await createBasket();
      };

      initialize();
    })();
  </script>
</body>
</html>`;
};
