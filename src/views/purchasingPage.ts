const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type PurchasingPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderPurchasingPage = (input: PurchasingPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Purchasing</title>
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
    input, select, button, textarea {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 14px;
      background: #fff;
      color: var(--text);
    }
    textarea {
      resize: vertical;
      min-height: 60px;
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
      grid-template-columns: 1fr 1.4fr;
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
      min-width: 960px;
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
    td input[type="number"], td input[type="text"] {
      width: 110px;
      box-sizing: border-box;
      padding: 6px 8px;
      font-size: 13px;
    }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      font-size: 12px;
      color: #445a6d;
      background: #f5f9fc;
    }
    @media (max-width: 980px) {
      .page {
        padding: 12px;
      }
      .grid-two {
        grid-template-columns: 1fr;
      }
      table {
        min-width: 860px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="topbar">
        <div>
          <h1>Purchasing</h1>
          <div class="muted">Purchase orders, receiving, and inventory ledger integration.</div>
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
            <a href="/pos">POS</a>
            <a href="/reports">Reports</a>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Purchase Orders</h2>
      <div class="controls">
        <div class="field" style="min-width: 200px;">
          <label for="po-q">Search</label>
          <input id="po-q" type="text" placeholder="PO id, supplier, sku" />
        </div>
        <div class="field">
          <label for="po-status">Status</label>
          <select id="po-status">
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="SENT">SENT</option>
            <option value="PARTIALLY_RECEIVED">PARTIALLY_RECEIVED</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="RECEIVED_PARTIAL">RECEIVED_PARTIAL</option>
            <option value="RECEIVED_COMPLETE">RECEIVED_COMPLETE</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        <div class="field">
          <label for="po-supplier-filter">Supplier</label>
          <select id="po-supplier-filter"></select>
        </div>
        <div class="field">
          <label for="po-from">From</label>
          <input id="po-from" type="date" />
        </div>
        <div class="field">
          <label for="po-to">To</label>
          <input id="po-to" type="date" />
        </div>
        <button id="po-load" class="primary" type="button">Load</button>
      </div>
      <div id="po-status-msg" class="status">Loading purchase orders...</div>
      <div id="po-table-wrap" class="table-wrap"></div>
    </div>

    <div class="grid-two">
      <div class="card">
        <h2>Create Supplier</h2>
        <div class="controls">
          <div class="field">
            <label for="supplier-name">Name</label>
            <input id="supplier-name" type="text" placeholder="Supplier name" />
          </div>
          <div class="field">
            <label for="supplier-email">Email</label>
            <input id="supplier-email" type="text" placeholder="Optional" />
          </div>
          <div class="field">
            <label for="supplier-phone">Phone</label>
            <input id="supplier-phone" type="text" placeholder="Optional" />
          </div>
          <button id="supplier-create" class="primary" type="button">Create Supplier</button>
        </div>
        <div id="supplier-status" class="status"></div>

        <h2 style="margin-top: 18px;">Create Purchase Order</h2>
        <div class="controls">
          <div class="field">
            <label for="po-create-supplier">Supplier</label>
            <select id="po-create-supplier"></select>
          </div>
          <div class="field">
            <label for="po-create-ordered">Ordered At</label>
            <input id="po-create-ordered" type="date" />
          </div>
          <div class="field">
            <label for="po-create-expected">Expected At</label>
            <input id="po-create-expected" type="date" />
          </div>
          <div class="field" style="min-width: 220px;">
            <label for="po-create-notes">Notes</label>
            <input id="po-create-notes" type="text" placeholder="Optional" />
          </div>
          <button id="po-create" class="primary" type="button">Create PO</button>
        </div>
        <div id="po-create-status" class="status"></div>
      </div>

      <div class="card">
        <h2>Open Purchase Order</h2>
        <div id="open-po-status" class="status">Choose a purchase order from the list.</div>
        <div id="open-po-wrap"></div>
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
        suppliers: [],
        locations: [],
        purchaseOrders: [],
        openPo: null,
        variantOptions: [],
      };

      const canManage = () => roleInput.value === "MANAGER" || roleInput.value === "ADMIN";

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

      const toIsoFromDateInput = (value) => {
        if (!value) {
          return undefined;
        }
        return new Date(value + "T00:00:00.000Z").toISOString();
      };

      const renderSupplierOptions = () => {
        const filter = qs("#po-supplier-filter");
        const create = qs("#po-create-supplier");

        const allOption = '<option value="">All suppliers</option>';
        const defaultCreate = '<option value="">Select supplier</option>';

        if (state.suppliers.length === 0) {
          filter.innerHTML = allOption;
          create.innerHTML = defaultCreate;
          return;
        }

        const options = state.suppliers
          .map(
            (supplier) =>
              '<option value="' + supplier.id + '">' + supplier.name + "</option>",
          )
          .join("");

        filter.innerHTML = allOption + options;
        create.innerHTML = defaultCreate + options;
      };

      const renderPoTable = () => {
        const wrap = qs("#po-table-wrap");
        if (!wrap) {
          return;
        }

        if (state.purchaseOrders.length === 0) {
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No purchase orders found.</div>';
          return;
        }

        const rows = state.purchaseOrders
          .map((po) =>
            '<tr>' +
            '<td>' + po.id + '</td>' +
            '<td>' + (po.supplier?.name || "") + '</td>' +
            '<td><span class="pill">' + po.status + '</span></td>' +
            '<td>' + (po.totals?.quantityOrdered ?? 0) + '</td>' +
            '<td>' + (po.totals?.quantityReceived ?? 0) + '</td>' +
            '<td>' + (po.totals?.quantityRemaining ?? 0) + '</td>' +
            '<td>' + (po.createdAt ? new Date(po.createdAt).toLocaleString() : "") + '</td>' +
            '<td><button type="button" class="po-open-btn" data-po-id="' + po.id + '">Open</button></td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>ID</th><th>Supplier</th><th>Status</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Created</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const loadSuppliers = async () => {
        try {
          const payload = await apiRequest("/api/suppliers");
          state.suppliers = Array.isArray(payload?.suppliers) ? payload.suppliers : [];
          renderSupplierOptions();
        } catch (error) {
          state.suppliers = [];
          renderSupplierOptions();
          setStatus("po-status-msg", error.message || "Failed to load suppliers", "error");
        }
      };

      const loadLocations = async () => {
        try {
          const payload = await apiRequest("/api/locations");
          state.locations = Array.isArray(payload?.locations) ? payload.locations : [];
          renderOpenPo();
        } catch {
          state.locations = [];
          renderOpenPo();
        }
      };

      const loadPurchaseOrders = async () => {
        setStatus("po-status-msg", "Loading purchase orders...");
        const params = new URLSearchParams();

        const q = (qs("#po-q").value || "").trim();
        const status = qs("#po-status").value;
        const supplierId = qs("#po-supplier-filter").value;
        const from = qs("#po-from").value;
        const to = qs("#po-to").value;

        params.set("take", "50");
        params.set("skip", "0");
        if (q) {
          params.set("q", q);
        }
        if (status) {
          params.set("status", status);
        }
        if (supplierId) {
          params.set("supplierId", supplierId);
        }
        if (from) {
          params.set("from", from);
        }
        if (to) {
          params.set("to", to);
        }

        try {
          const payload = await apiRequest("/api/purchase-orders?" + params.toString());
          state.purchaseOrders = Array.isArray(payload?.purchaseOrders) ? payload.purchaseOrders : [];
          renderPoTable();
          setStatus("po-status-msg", "Loaded " + state.purchaseOrders.length + " purchase orders.", "ok");
        } catch (error) {
          setStatus("po-status-msg", error.message || "Failed to load purchase orders", "error");
        }
      };

      const createSupplier = async () => {
        if (!canManage()) {
          setStatus("supplier-status", "MANAGER+ role required.", "error");
          return;
        }

        const name = (qs("#supplier-name").value || "").trim();
        const email = (qs("#supplier-email").value || "").trim();
        const phone = (qs("#supplier-phone").value || "").trim();

        if (!name) {
          setStatus("supplier-status", "Supplier name is required.", "error");
          return;
        }

        setStatus("supplier-status", "Creating supplier...");
        try {
          await apiRequest("/api/suppliers", {
            method: "POST",
            body: JSON.stringify({
              name,
              email: email || undefined,
              phone: phone || undefined,
            }),
          });

          qs("#supplier-name").value = "";
          qs("#supplier-email").value = "";
          qs("#supplier-phone").value = "";

          setStatus("supplier-status", "Supplier created.", "ok");
          await loadSuppliers();
        } catch (error) {
          setStatus("supplier-status", error.message || "Supplier creation failed", "error");
        }
      };

      const createPurchaseOrder = async () => {
        if (!canManage()) {
          setStatus("po-create-status", "MANAGER+ role required.", "error");
          return;
        }

        const supplierId = qs("#po-create-supplier").value;
        const orderedAt = qs("#po-create-ordered").value;
        const expectedAt = qs("#po-create-expected").value;
        const notes = (qs("#po-create-notes").value || "").trim();

        if (!supplierId) {
          setStatus("po-create-status", "Choose a supplier.", "error");
          return;
        }

        setStatus("po-create-status", "Creating purchase order...");
        try {
          const po = await apiRequest("/api/purchase-orders", {
            method: "POST",
            body: JSON.stringify({
              supplierId,
              orderedAt: toIsoFromDateInput(orderedAt),
              expectedAt: toIsoFromDateInput(expectedAt),
              notes: notes || undefined,
            }),
          });

          setStatus("po-create-status", "Purchase order created.", "ok");
          qs("#po-create-notes").value = "";
          await loadPurchaseOrders();
          await openPo(po.id);
        } catch (error) {
          setStatus("po-create-status", error.message || "PO creation failed", "error");
        }
      };

      const openPo = async (poId) => {
        setStatus("open-po-status", "Loading purchase order...");
        try {
          const payload = await apiRequest("/api/purchase-orders/" + encodeURIComponent(poId));
          state.openPo = payload;
          renderOpenPo();
          setStatus("open-po-status", "Purchase order loaded.", "ok");
        } catch (error) {
          state.openPo = null;
          renderOpenPo();
          setStatus("open-po-status", error.message || "Failed to load purchase order", "error");
        }
      };

      const updateOpenPoStatus = async (status) => {
        if (!state.openPo) {
          return;
        }
        if (!canManage()) {
          setStatus("open-po-status", "MANAGER+ role required.", "error");
          return;
        }

        setStatus("open-po-status", "Updating purchase order...");
        try {
          if (status === "SUBMITTED") {
            await apiRequest("/api/purchase-orders/" + encodeURIComponent(state.openPo.id) + "/submit", {
              method: "POST",
              body: JSON.stringify({}),
            });
          } else if (status === "CANCELLED") {
            await apiRequest("/api/purchase-orders/" + encodeURIComponent(state.openPo.id) + "/cancel", {
              method: "POST",
              body: JSON.stringify({}),
            });
          } else {
            await apiRequest("/api/purchase-orders/" + encodeURIComponent(state.openPo.id), {
              method: "PATCH",
              body: JSON.stringify({ status }),
            });
          }
          await openPo(state.openPo.id);
          await loadPurchaseOrders();
          setStatus("open-po-status", "Purchase order updated.", "ok");
        } catch (error) {
          setStatus("open-po-status", error.message || "Status update failed", "error");
        }
      };

      const searchVariants = async () => {
        const q = (qs("#po-line-search").value || "").trim();
        if (!q) {
          setStatus("open-po-status", "Enter variant search text.", "error");
          return;
        }

        try {
          const payload = await apiRequest(
            "/api/variants?q=" + encodeURIComponent(q) + "&active=1&take=25&skip=0",
          );
          state.variantOptions = Array.isArray(payload?.variants) ? payload.variants : [];
          renderOpenPo();
          setStatus("open-po-status", "Variant search loaded.", "ok");
        } catch (error) {
          setStatus("open-po-status", error.message || "Variant search failed", "error");
        }
      };

      const addOpenPoLine = async () => {
        if (!state.openPo) {
          return;
        }
        if (!canManage()) {
          setStatus("open-po-status", "MANAGER+ role required.", "error");
          return;
        }

        const variantId = qs("#po-line-variant").value;
        const quantityRaw = qs("#po-line-qty").value;
        const unitCostRaw = qs("#po-line-cost").value;

        const quantityOrdered = Number.parseInt(quantityRaw, 10);
        const unitCostPence =
          unitCostRaw.trim().length > 0 ? Number.parseInt(unitCostRaw, 10) : undefined;

        if (!variantId) {
          setStatus("open-po-status", "Choose a variant.", "error");
          return;
        }
        if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) {
          setStatus("open-po-status", "Line quantity must be a positive integer.", "error");
          return;
        }
        if (unitCostPence !== undefined && (!Number.isInteger(unitCostPence) || unitCostPence < 0)) {
          setStatus("open-po-status", "Line unit cost must be >= 0.", "error");
          return;
        }

        setStatus("open-po-status", "Saving line...");
        try {
          await apiRequest("/api/purchase-orders/" + encodeURIComponent(state.openPo.id) + "/items", {
            method: "POST",
            body: JSON.stringify({
              lines: [
                {
                  variantId,
                  quantityOrdered,
                  unitCostPence,
                },
              ],
            }),
          });

          qs("#po-line-qty").value = "";
          qs("#po-line-cost").value = "";

          await openPo(state.openPo.id);
          await loadPurchaseOrders();
          setStatus("open-po-status", "Line saved.", "ok");
        } catch (error) {
          setStatus("open-po-status", error.message || "Line save failed", "error");
        }
      };

      const patchLine = async (lineId, quantityInput, unitCostInput) => {
        if (!state.openPo) {
          return;
        }
        if (!canManage()) {
          setStatus("open-po-status", "MANAGER+ role required.", "error");
          return;
        }

        const quantityOrdered = Number.parseInt(quantityInput.value || "", 10);
        const unitCostRaw = (unitCostInput.value || "").trim();

        if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) {
          setStatus("open-po-status", "Ordered qty must be a positive integer.", "error");
          return;
        }

        if (unitCostRaw.length > 0) {
          const parsed = Number.parseInt(unitCostRaw, 10);
          if (!Number.isInteger(parsed) || parsed < 0) {
            setStatus("open-po-status", "Unit cost must be >= 0.", "error");
            return;
          }
        }

        setStatus("open-po-status", "Updating line...");
        try {
          await apiRequest(
            "/api/purchase-orders/" + encodeURIComponent(state.openPo.id) + "/lines/" + encodeURIComponent(lineId),
            {
              method: "PATCH",
              body: JSON.stringify({
                quantityOrdered,
                unitCostPence: unitCostRaw.length > 0 ? Number.parseInt(unitCostRaw, 10) : null,
              }),
            },
          );
          await openPo(state.openPo.id);
          await loadPurchaseOrders();
          setStatus("open-po-status", "Line updated.", "ok");
        } catch (error) {
          setStatus("open-po-status", error.message || "Line update failed", "error");
        }
      };

      const receiveLine = async (lineId, quantityInput, costInput) => {
        if (!state.openPo) {
          return;
        }
        if (!canManage()) {
          setStatus("open-po-status", "MANAGER+ role required.", "error");
          return;
        }

        const locationId = qs("#po-receive-location").value;
        const quantity = Number.parseInt(quantityInput.value || "", 10);
        const costRaw = (costInput.value || "").trim();

        if (!locationId) {
          setStatus("open-po-status", "Choose a receive location.", "error");
          return;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          setStatus("open-po-status", "Receive qty must be a positive integer.", "error");
          return;
        }

        if (costRaw.length > 0) {
          const parsed = Number.parseInt(costRaw, 10);
          if (!Number.isInteger(parsed) || parsed < 0) {
            setStatus("open-po-status", "Receive unit cost must be >= 0.", "error");
            return;
          }
        }

        setStatus("open-po-status", "Receiving goods...");
        try {
          await apiRequest("/api/purchase-orders/" + encodeURIComponent(state.openPo.id) + "/receive", {
            method: "POST",
            body: JSON.stringify({
              locationId,
              lines: [
                {
                  purchaseOrderItemId: lineId,
                  quantity,
                  unitCostPence: costRaw.length > 0 ? Number.parseInt(costRaw, 10) : undefined,
                },
              ],
            }),
          });
          await openPo(state.openPo.id);
          await loadPurchaseOrders();
          setStatus("open-po-status", "Receiving posted.", "ok");
        } catch (error) {
          setStatus("open-po-status", error.message || "Receiving failed", "error");
        }
      };

      const renderOpenPo = () => {
        const wrap = qs("#open-po-wrap");
        if (!wrap) {
          return;
        }

        if (!state.openPo) {
          wrap.innerHTML = '<div class="muted">No purchase order selected.</div>';
          return;
        }

        const po = state.openPo;
        const lines = Array.isArray(po.items) ? po.items : [];

        const lineRows =
          lines.length === 0
            ? '<tr><td colspan="12" class="muted">No lines yet.</td></tr>'
            : lines
                .map((line) => {
                  const editable = canManage() && po.status === "DRAFT";
                  const receivable = canManage() && (po.status === "DRAFT" || po.status === "SUBMITTED" || po.status === "SENT" || po.status === "PARTIALLY_RECEIVED" || po.status === "RECEIVED_PARTIAL");

                  return (
                    '<tr>' +
                    '<td>' + line.id + '</td>' +
                    '<td>' + (line.productName || "") + '</td>' +
                    '<td>' + (line.sku || "") + '</td>' +
                    '<td>' + (line.quantityOrdered ?? 0) + '</td>' +
                    '<td>' + (line.quantityReceived ?? 0) + '</td>' +
                    '<td>' + (line.quantityRemaining ?? 0) + '</td>' +
                    '<td>' + formatMoney(line.unitCostPence || 0) + '</td>' +
                    '<td><input type="number" step="1" min="1" class="line-qty-input" data-line-id="' + line.id + '" value="' + (line.quantityOrdered ?? 1) + '" ' + (editable ? '' : 'disabled') + ' /></td>' +
                    '<td><input type="number" step="1" min="0" class="line-cost-input" data-line-id="' + line.id + '" value="' + (line.unitCostPence ?? "") + '" ' + (editable ? '' : 'disabled') + ' /></td>' +
                    '<td><button type="button" class="line-update-btn" data-line-id="' + line.id + '" ' + (editable ? '' : 'disabled') + '>Update</button></td>' +
                    '<td><input type="number" step="1" min="1" class="line-receive-qty" data-line-id="' + line.id + '" placeholder="qty" ' + (receivable ? '' : 'disabled') + ' /></td>' +
                    '<td><input type="number" step="1" min="0" class="line-receive-cost" data-line-id="' + line.id + '" placeholder="cost" ' + (receivable ? '' : 'disabled') + ' /></td>' +
                    '<td><button type="button" class="line-receive-btn" data-line-id="' + line.id + '" ' + (receivable ? '' : 'disabled') + '>Receive</button></td>' +
                    '</tr>'
                  );
                })
                .join("");

        const variantOptions = state.variantOptions
          .map((variant) =>
            '<option value="' + variant.id + '">' +
            (variant.sku || variant.id) +
            ' - ' +
            (variant.product?.name || "") +
            ' ' +
            (variant.option || variant.name || "") +
            '</option>',
          )
          .join("");

        const locationOptions =
          state.locations.length === 0
            ? '<option value="">No locations</option>'
            : state.locations
                .map((location) =>
                  '<option value="' + location.id + '">' + location.name + (location.isDefault ? " (Default)" : "") + '</option>',
                )
                .join("");

        wrap.innerHTML =
          '<div><strong>ID:</strong> ' + po.id + '</div>' +
          '<div><strong>Supplier:</strong> ' + (po.supplier?.name || "") + '</div>' +
          '<div><strong>Status:</strong> <span class="pill">' + po.status + '</span></div>' +
          '<div><strong>Notes:</strong> ' + (po.notes || "-") + '</div>' +
          '<div class="controls" style="margin-top: 10px;">' +
          '<button id="po-set-submit" type="button" ' + (canManage() && po.status === "DRAFT" ? "" : "disabled") + '>Submit</button>' +
          '<button id="po-set-cancel" type="button" ' + (canManage() && (po.status === "DRAFT" || po.status === "SUBMITTED" || po.status === "SENT") ? "" : "disabled") + '>Cancel</button>' +
          '<div class="field"><label for="po-receive-location">Receive Location</label><select id="po-receive-location">' + locationOptions + '</select></div>' +
          '</div>' +
          '<div class="controls" style="margin-top: 10px;">' +
          '<div class="field" style="min-width: 180px;"><label for="po-line-search">Variant Search</label><input id="po-line-search" type="text" placeholder="sku/product/barcode" /></div>' +
          '<button id="po-line-search-btn" type="button">Search Variants</button>' +
          '<div class="field" style="min-width: 230px;"><label for="po-line-variant">Variant</label><select id="po-line-variant"><option value="">Select variant</option>' + variantOptions + '</select></div>' +
          '<div class="field"><label for="po-line-qty">Ordered Qty</label><input id="po-line-qty" type="number" min="1" step="1" /></div>' +
          '<div class="field"><label for="po-line-cost">Unit Cost (p)</label><input id="po-line-cost" type="number" min="0" step="1" /></div>' +
          '<button id="po-line-add-btn" class="primary" type="button" ' + (canManage() && po.status === "DRAFT" ? "" : "disabled") + '>Add/Upsert Line</button>' +
          '</div>' +
          '<div class="table-wrap" style="margin-top: 10px;">' +
          '<table>' +
          '<thead><tr><th>Line ID</th><th>Product</th><th>SKU</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Unit Cost</th><th>Edit Qty</th><th>Edit Cost</th><th>Line</th><th>Receive Qty</th><th>Receive Cost</th><th>Receive</th></tr></thead>' +
          '<tbody>' + lineRows + '</tbody>' +
          '</table>' +
          '</div>';

        qs("#po-set-submit")?.addEventListener("click", () => {
          updateOpenPoStatus("SUBMITTED");
        });
        qs("#po-set-cancel")?.addEventListener("click", () => {
          updateOpenPoStatus("CANCELLED");
        });
        qs("#po-line-search-btn")?.addEventListener("click", () => {
          searchVariants();
        });
        qs("#po-line-add-btn")?.addEventListener("click", () => {
          addOpenPoLine();
        });
      };

      qs("#po-load")?.addEventListener("click", () => {
        loadPurchaseOrders();
      });

      qs("#po-table-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("po-open-btn")) {
          return;
        }
        const poId = target.getAttribute("data-po-id");
        if (!poId) {
          return;
        }
        openPo(poId);
      });

      qs("#supplier-create")?.addEventListener("click", () => {
        createSupplier();
      });
      qs("#po-create")?.addEventListener("click", () => {
        createPurchaseOrder();
      });

      qs("#open-po-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || !state.openPo) {
          return;
        }

        const lineId = target.getAttribute("data-line-id");
        if (!lineId) {
          return;
        }

        if (target.classList.contains("line-update-btn")) {
          const qtyInput = qs('.line-qty-input[data-line-id="' + lineId + '"]');
          const costInput = qs('.line-cost-input[data-line-id="' + lineId + '"]');
          if (!(qtyInput instanceof HTMLInputElement) || !(costInput instanceof HTMLInputElement)) {
            return;
          }
          patchLine(lineId, qtyInput, costInput);
          return;
        }

        if (target.classList.contains("line-receive-btn")) {
          const qtyInput = qs('.line-receive-qty[data-line-id="' + lineId + '"]');
          const costInput = qs('.line-receive-cost[data-line-id="' + lineId + '"]');
          if (!(qtyInput instanceof HTMLInputElement) || !(costInput instanceof HTMLInputElement)) {
            return;
          }
          receiveLine(lineId, qtyInput, costInput);
        }
      });

      const refreshRoleState = () => {
        const supplierCreateButton = qs("#supplier-create");
        const poCreateButton = qs("#po-create");
        if (supplierCreateButton) {
          supplierCreateButton.disabled = !canManage();
        }
        if (poCreateButton) {
          poCreateButton.disabled = !canManage();
        }
        renderPoTable();
        renderOpenPo();
      };

      roleInput.addEventListener("change", () => {
        refreshRoleState();
      });

      const initialize = async () => {
        refreshRoleState();
        await loadSuppliers();
        await loadLocations();
        await loadPurchaseOrders();
      };

      initialize();
    })();
  </script>
</body>
</html>`;
};
