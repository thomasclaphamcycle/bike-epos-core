import { escapeHtml } from "../utils/escapeHtml";

type InventoryPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderInventoryPage = (input: InventoryPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Inventory</title>
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
      max-width: 1300px;
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
      min-width: 140px;
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
      min-height: 64px;
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
      grid-template-columns: 1.4fr 1fr;
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
      min-width: 980px;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      font-size: 13px;
      white-space: nowrap;
      vertical-align: middle;
    }
    th {
      background: #f5f9fc;
      font-weight: 600;
      color: #2a3a49;
    }
    td input[type="number"], td input[type="text"] {
      width: 120px;
      box-sizing: border-box;
      padding: 6px 8px;
      font-size: 13px;
    }
    .session-open {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 12px;
      margin-top: 10px;
      background: #fafcfe;
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
          <h1>Inventory</h1>
          <div class="muted">On-hand search, manual adjustments, and stocktake sessions.</div>
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
            <a href="/catalog">Catalog</a>
            <a href="/purchasing">Purchasing</a>
            <a href="/inventory/adjust">Adjustments</a>
            <a href="/pos">POS</a>
            <a href="/reports">Reports</a>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>On-hand Search</h2>
      <div class="controls">
        <div class="field" style="min-width: 260px;">
          <label for="onhand-q">Search</label>
          <input id="onhand-q" type="text" placeholder="SKU, barcode, product, brand" />
        </div>
        <div class="field">
          <label for="onhand-active">Active</label>
          <select id="onhand-active">
            <option value="1">Active</option>
            <option value="0">Inactive</option>
            <option value="">All</option>
          </select>
        </div>
        <div class="field">
          <label for="onhand-take">Page size</label>
          <select id="onhand-take">
            <option value="50">50</option>
            <option value="100" selected>100</option>
            <option value="200">200</option>
          </select>
        </div>
        <button id="onhand-load" class="primary" type="button">Load</button>
      </div>
      <div id="onhand-status" class="status">Loading on-hand rows...</div>
      <div id="onhand-table-wrap" class="table-wrap"></div>
      <div class="muted" style="margin-top: 8px;">Manual adjustment actions are MANAGER+.</div>
    </div>

    <div class="grid-two">
      <div class="card">
        <h2>Stocktake Sessions</h2>
        <div class="controls">
          <div class="field">
            <label for="session-location">Location</label>
            <select id="session-location"></select>
          </div>
          <div class="field" style="min-width: 220px;">
            <label for="session-notes">Notes</label>
            <input id="session-notes" type="text" placeholder="Optional notes" />
          </div>
          <button id="session-create" class="primary" type="button">Create Session</button>
        </div>

        <div class="controls" style="margin-top: 10px;">
          <div class="field">
            <label for="sessions-status-filter">Status</label>
            <select id="sessions-status-filter">
              <option value="">All</option>
              <option value="OPEN">OPEN</option>
              <option value="POSTED">POSTED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
          <button id="sessions-load" type="button">Reload Sessions</button>
        </div>

        <div id="sessions-status" class="status">Loading sessions...</div>
        <div id="sessions-table-wrap" class="table-wrap"></div>
      </div>

      <div class="card">
        <h2>Open Session</h2>
        <div id="open-session-status" class="status">Choose a session from the list.</div>
        <div id="open-session-wrap"></div>
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
        onHandRows: [],
        stocktakes: [],
        locations: [],
        openSession: null,
        sessionVariantOptions: [],
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
      const escapeHtml = (value) =>
        String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      const toSafeText = (value) => escapeHtml(value);

      const renderOnHandTable = () => {
        const wrap = qs("#onhand-table-wrap");
        if (!wrap) {
          return;
        }

        if (state.onHandRows.length === 0) {
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No rows found.</div>';
          return;
        }

        const rows = state.onHandRows
          .map((row) =>
            '<tr data-variant-id="' + toSafeText(row.variantId) + '">' +
            '<td>' + toSafeText(row.productName || "") + '</td>' +
            '<td>' + toSafeText(row.brand || "") + '</td>' +
            '<td>' + toSafeText(row.variantName || row.option || "") + '</td>' +
            '<td>' + toSafeText(row.sku || "") + '</td>' +
            '<td>' + toSafeText(row.barcode || "") + '</td>' +
            '<td>' + formatMoney(row.retailPricePence || 0) + '</td>' +
            '<td>' + (row.onHand ?? 0) + '</td>' +
            '<td><input type="number" step="1" data-field="qty" placeholder="+/-" /></td>' +
            '<td><input type="text" data-field="note" placeholder="reason" /></td>' +
            '<td><button type="button" class="adjust-btn" data-variant-id="' + toSafeText(row.variantId) + '">Adjust</button></td>' +
            '<td class="row-status" data-status-for="' + toSafeText(row.variantId) + '"></td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr>' +
          '<th>Product</th><th>Brand</th><th>Variant</th><th>SKU</th><th>Barcode</th><th>Retail</th><th>On Hand</th>' +
          '<th>Qty</th><th>Note</th><th>Action</th><th>Result</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';

        const adjustButtons = wrap.querySelectorAll(".adjust-btn");
        adjustButtons.forEach((button) => {
          button.disabled = !canManage();
        });
      };

      const setRowStatus = (variantId, message, isError = false) => {
        const cell = qs('[data-status-for="' + variantId + '"]');
        if (!cell) {
          return;
        }
        cell.textContent = message;
        cell.style.color = isError ? "#8b1f1f" : "#5a6672";
      };

      const loadOnHand = async () => {
        setStatus("onhand-status", "Loading on-hand rows...");

        const params = new URLSearchParams();
        const q = (qs("#onhand-q").value || "").trim();
        const active = qs("#onhand-active").value;
        const take = qs("#onhand-take").value || "100";

        params.set("take", take);
        params.set("skip", "0");
        if (q) {
          params.set("q", q);
        }
        if (active === "1" || active === "0") {
          params.set("active", active);
        }

        try {
          const payload = await apiRequest("/api/inventory/on-hand/search?" + params.toString());
          state.onHandRows = Array.isArray(payload?.rows) ? payload.rows : [];
          renderOnHandTable();
          setStatus("onhand-status", "Loaded " + state.onHandRows.length + " rows.", "ok");
        } catch (error) {
          setStatus("onhand-status", error.message || "Failed to load on-hand rows", "error");
        }
      };

      const adjustRow = async (button) => {
        if (!canManage()) {
          setStatus("onhand-status", "MANAGER+ role required for adjustments.", "error");
          return;
        }

        const variantId = button.getAttribute("data-variant-id");
        const row = button.closest("tr");
        if (!variantId || !row) {
          return;
        }

        const qtyInput = row.querySelector('input[data-field="qty"]');
        const noteInput = row.querySelector('input[data-field="note"]');
        const qtyRaw = qtyInput?.value || "";
        const quantity = Number.parseInt(qtyRaw, 10);
        const note = (noteInput?.value || "").trim();

        if (!Number.isInteger(quantity) || quantity === 0) {
          setRowStatus(variantId, "Qty must be non-zero integer", true);
          return;
        }

        setRowStatus(variantId, "Saving...");

        try {
          await apiRequest("/api/inventory/movements", {
            method: "POST",
            body: JSON.stringify({
              variantId,
              type: "ADJUSTMENT",
              quantity,
              note: note || undefined,
              referenceType: "INVENTORY_UI_ADJUST",
              referenceId: "inventory_ui_" + Date.now(),
            }),
          });

          const fresh = await apiRequest("/api/inventory/on-hand?variantId=" + encodeURIComponent(variantId));
          const idx = state.onHandRows.findIndex((x) => x.variantId === variantId);
          if (idx >= 0) {
            state.onHandRows[idx].onHand = fresh.onHand;
          }
          renderOnHandTable();
          setRowStatus(variantId, "Saved");
          setStatus("onhand-status", "Adjustment recorded.", "ok");
        } catch (error) {
          setRowStatus(variantId, error.message || "Adjustment failed", true);
        }
      };

      const renderLocationOptions = () => {
        const select = qs("#session-location");
        if (!select) {
          return;
        }

        if (state.locations.length === 0) {
          select.innerHTML = '<option value="">No locations</option>';
          return;
        }

        select.innerHTML = state.locations
          .map((location) =>
            '<option value="' + toSafeText(location.id) + '">' + toSafeText(location.name + (location.isDefault ? " (Default)" : "")) + '</option>',
          )
          .join("");
      };

      const loadLocations = async () => {
        try {
          const payload = await apiRequest("/api/locations");
          state.locations = Array.isArray(payload?.locations) ? payload.locations : [];
          renderLocationOptions();
        } catch (error) {
          state.locations = [];
          renderLocationOptions();
          setStatus("sessions-status", error.message || "Failed to load locations", "error");
        }
      };

      const renderSessionsTable = () => {
        const wrap = qs("#sessions-table-wrap");
        if (!wrap) {
          return;
        }

        if (state.stocktakes.length === 0) {
          wrap.innerHTML = '<div style="padding: 12px;" class="muted">No stocktake sessions.</div>';
          return;
        }

        const rows = state.stocktakes
          .map((session) => {
            const actions =
              '<button type="button" class="open-session-btn" data-session-id="' + toSafeText(session.id) + '">Open</button>' +
              '<button type="button" class="finalize-session-btn" data-session-id="' + toSafeText(session.id) + '" ' +
              ((session.status === "OPEN" && canManage()) ? '' : 'disabled') + '>Finalize</button>' +
              '<button type="button" class="cancel-session-btn" data-session-id="' + toSafeText(session.id) + '" ' +
              ((session.status === "OPEN" && canManage()) ? '' : 'disabled') + '>Cancel</button>';

            return (
              '<tr>' +
              '<td>' + toSafeText(session.id) + '</td>' +
              '<td>' + toSafeText(session.location?.name || "") + '</td>' +
              '<td><span class="pill">' + toSafeText(session.status) + '</span></td>' +
              '<td>' + (session.lineCount ?? 0) + '</td>' +
              '<td>' + new Date(session.startedAt).toLocaleString() + '</td>' +
              '<td>' + (session.postedAt ? new Date(session.postedAt).toLocaleString() : '-') + '</td>' +
              '<td>' + actions + '</td>' +
              '</tr>'
            );
          })
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>ID</th><th>Location</th><th>Status</th><th>Lines</th><th>Started</th><th>Posted</th><th>Actions</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const loadSessions = async () => {
        setStatus("sessions-status", "Loading stocktake sessions...");
        const params = new URLSearchParams();
        const status = qs("#sessions-status-filter").value;
        if (status) {
          params.set("status", status);
        }
        params.set("take", "50");
        params.set("skip", "0");

        try {
          const payload = await apiRequest("/api/stocktake/sessions?" + params.toString());
          state.stocktakes = Array.isArray(payload?.stocktakes) ? payload.stocktakes : [];
          renderSessionsTable();
          setStatus("sessions-status", "Loaded " + state.stocktakes.length + " sessions.", "ok");
        } catch (error) {
          setStatus("sessions-status", error.message || "Failed to load sessions", "error");
        }
      };

      const createSession = async () => {
        if (!canManage()) {
          setStatus("sessions-status", "MANAGER+ role required to create sessions.", "error");
          return;
        }

        const locationId = qs("#session-location").value;
        const notes = (qs("#session-notes").value || "").trim();
        if (!locationId) {
          setStatus("sessions-status", "Choose a location.", "error");
          return;
        }

        setStatus("sessions-status", "Creating stocktake session...");
        try {
          const session = await apiRequest("/api/stocktake/sessions", {
            method: "POST",
            body: JSON.stringify({
              locationId,
              notes: notes || undefined,
            }),
          });
          setStatus("sessions-status", "Session created.", "ok");
          qs("#session-notes").value = "";
          await loadSessions();
          await openSession(session.id);
        } catch (error) {
          setStatus("sessions-status", error.message || "Failed to create session", "error");
        }
      };

      const searchVariantsForSession = async () => {
        const q = (qs("#session-line-q")?.value || "").trim();
        if (!q) {
          setStatus("open-session-status", "Enter text to search variants.", "error");
          return;
        }

        try {
          const payload = await apiRequest(
            "/api/variants?q=" + encodeURIComponent(q) + "&active=1&take=25&skip=0",
          );
          state.sessionVariantOptions = Array.isArray(payload?.variants) ? payload.variants : [];
          renderOpenSession();
        } catch (error) {
          setStatus("open-session-status", error.message || "Variant search failed", "error");
        }
      };

      const upsertSessionLine = async () => {
        if (!state.openSession) {
          return;
        }
        if (!canManage()) {
          setStatus("open-session-status", "MANAGER+ role required to edit lines.", "error");
          return;
        }

        const variantId = qs("#session-line-variant").value;
        const countedQtyRaw = qs("#session-line-counted").value;
        const countedQty = Number.parseInt(countedQtyRaw, 10);

        if (!variantId) {
          setStatus("open-session-status", "Choose a variant for the line.", "error");
          return;
        }
        if (!Number.isInteger(countedQty) || countedQty < 0) {
          setStatus("open-session-status", "Counted qty must be a non-negative integer.", "error");
          return;
        }

        setStatus("open-session-status", "Saving stocktake line...");
        try {
          await apiRequest("/api/stocktake/sessions/" + encodeURIComponent(state.openSession.id) + "/lines", {
            method: "POST",
            body: JSON.stringify({
              variantId,
              countedQty,
            }),
          });
          setStatus("open-session-status", "Line saved.", "ok");
          await openSession(state.openSession.id);
        } catch (error) {
          setStatus("open-session-status", error.message || "Failed to save line", "error");
        }
      };

      const finalizeSession = async (sessionId) => {
        if (!canManage()) {
          setStatus("sessions-status", "MANAGER+ role required to finalize sessions.", "error");
          return;
        }

        setStatus("sessions-status", "Finalizing session...");
        try {
          await apiRequest("/api/stocktake/sessions/" + encodeURIComponent(sessionId) + "/finalize", {
            method: "POST",
            body: JSON.stringify({}),
          });
          setStatus("sessions-status", "Session finalized.", "ok");
          await loadSessions();
          await loadOnHand();
          if (state.openSession?.id === sessionId) {
            await openSession(sessionId);
          }
        } catch (error) {
          setStatus("sessions-status", error.message || "Failed to finalize session", "error");
        }
      };

      const cancelSession = async (sessionId) => {
        if (!canManage()) {
          setStatus("sessions-status", "MANAGER+ role required to cancel sessions.", "error");
          return;
        }

        setStatus("sessions-status", "Cancelling session...");
        try {
          await apiRequest("/api/stocktake/sessions/" + encodeURIComponent(sessionId) + "/cancel", {
            method: "POST",
            body: JSON.stringify({}),
          });
          setStatus("sessions-status", "Session cancelled.", "ok");
          await loadSessions();
          if (state.openSession?.id === sessionId) {
            await openSession(sessionId);
          }
        } catch (error) {
          setStatus("sessions-status", error.message || "Failed to cancel session", "error");
        }
      };

      const openSession = async (sessionId) => {
        setStatus("open-session-status", "Loading session...");
        try {
          const payload = await apiRequest(
            "/api/stocktake/sessions/" + encodeURIComponent(sessionId) + "?includePreview=true",
          );
          state.openSession = payload;
          if (!Array.isArray(state.sessionVariantOptions)) {
            state.sessionVariantOptions = [];
          }
          renderOpenSession();
          setStatus("open-session-status", "Session loaded.", "ok");
        } catch (error) {
          state.openSession = null;
          renderOpenSession();
          setStatus("open-session-status", error.message || "Failed to load session", "error");
        }
      };

      const renderOpenSession = () => {
        const wrap = qs("#open-session-wrap");
        if (!wrap) {
          return;
        }

        if (!state.openSession) {
          wrap.innerHTML = '<div class="muted">No session selected.</div>';
          return;
        }

        const session = state.openSession;
        const lines = Array.isArray(session.lines) ? session.lines : [];

        const lineRows =
          lines.length === 0
            ? '<tr><td colspan="7" class="muted">No lines yet.</td></tr>'
            : lines
                .map((line) =>
                  '<tr>' +
                  '<td>' + toSafeText(line.variantId) + '</td>' +
                  '<td>' + toSafeText(line.productName || "") + '</td>' +
                  '<td>' + toSafeText(line.sku || "") + '</td>' +
                  '<td>' + toSafeText(line.variantName || "") + '</td>' +
                  '<td>' + (line.countedQty ?? 0) + '</td>' +
                  '<td>' + (line.currentOnHand ?? 0) + '</td>' +
                  '<td>' + (line.deltaNeeded ?? 0) + '</td>' +
                  '</tr>',
                )
                .join("");

        const variantOptions = state.sessionVariantOptions
          .map((variant) =>
            '<option value="' +
            toSafeText(variant.id) +
            '">' +
            toSafeText(variant.sku || variant.id) +
            ' — ' +
            toSafeText(variant.product?.name || "") +
            ' ' +
            toSafeText(variant.option || variant.name || "") +
            '</option>',
          )
          .join("");

        wrap.innerHTML =
          '<div class="session-open">' +
          '<div><strong>ID:</strong> ' + toSafeText(session.id) + '</div>' +
          '<div><strong>Status:</strong> <span class="pill">' + toSafeText(session.status) + '</span></div>' +
          '<div><strong>Location:</strong> ' + toSafeText(session.location?.name || "") + '</div>' +
          '<div style="margin-top: 10px;" class="controls">' +
          '<div class="field" style="min-width: 180px;"><label for="session-line-q">Variant search</label><input id="session-line-q" type="text" placeholder="sku/product/barcode" /></div>' +
          '<button id="session-line-search" type="button">Search Variants</button>' +
          '<div class="field" style="min-width: 220px;"><label for="session-line-variant">Variant</label><select id="session-line-variant"><option value="">Select variant</option>' + variantOptions + '</select></div>' +
          '<div class="field"><label for="session-line-counted">Counted qty</label><input id="session-line-counted" type="number" min="0" step="1" /></div>' +
          '<button id="session-line-save" class="primary" type="button" ' + (canManage() && session.status === "OPEN" ? "" : "disabled") + '>Save Line</button>' +
          '</div>' +
          '<div class="table-wrap" style="margin-top: 10px;">' +
          '<table><thead><tr><th>Variant ID</th><th>Product</th><th>SKU</th><th>Variant</th><th>Counted</th><th>On Hand</th><th>Delta</th></tr></thead><tbody>' +
          lineRows +
          '</tbody></table>' +
          '</div>' +
          '</div>';

        qs("#session-line-search")?.addEventListener("click", () => {
          searchVariantsForSession();
        });
        qs("#session-line-save")?.addEventListener("click", () => {
          upsertSessionLine();
        });
      };

      qs("#onhand-load")?.addEventListener("click", () => {
        loadOnHand();
      });
      qs("#onhand-table-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("adjust-btn")) {
          return;
        }
        adjustRow(target);
      });

      qs("#session-create")?.addEventListener("click", () => {
        createSession();
      });
      qs("#sessions-load")?.addEventListener("click", () => {
        loadSessions();
      });

      qs("#sessions-table-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }

        const sessionId = target.getAttribute("data-session-id");
        if (!sessionId) {
          return;
        }

        if (target.classList.contains("open-session-btn")) {
          openSession(sessionId);
          return;
        }

        if (target.classList.contains("finalize-session-btn")) {
          finalizeSession(sessionId);
          return;
        }

        if (target.classList.contains("cancel-session-btn")) {
          cancelSession(sessionId);
        }
      });

      const refreshRoleSensitiveState = () => {
        const createButton = qs("#session-create");
        if (createButton) {
          createButton.disabled = !canManage();
        }
        renderOnHandTable();
        renderSessionsTable();
        renderOpenSession();
      };

      roleInput.addEventListener("change", () => {
        refreshRoleSensitiveState();
        loadLocations();
      });
      staffIdInput.addEventListener("change", () => {
        loadLocations();
      });

      const initialize = async () => {
        refreshRoleSensitiveState();
        await loadLocations();
        await loadOnHand();
        await loadSessions();
      };

      initialize();
    })();
  </script>
</body>
</html>`;
};
