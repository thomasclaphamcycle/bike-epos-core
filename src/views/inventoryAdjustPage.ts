const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type InventoryAdjustPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderInventoryAdjustPage = (input: InventoryAdjustPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Inventory Adjustments</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #ffffff;
      --text: #1d2329;
      --muted: #5a6672;
      --line: #d9e0e6;
      --accent: #0f6b8f;
      --ok: #226634;
      --err: #8b1f1f;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .page { max-width: 1100px; margin: 0 auto; padding: 20px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 150px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, select, button, textarea { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; background: #fff; color: var(--text); }
    button.primary { background: var(--accent); border-color: #0d5876; color: #fff; cursor: pointer; }
    button { cursor: pointer; }
    .status { margin-top: 8px; min-height: 18px; color: var(--muted); font-size: 13px; }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--err); }
    .muted { color: var(--muted); font-size: 13px; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; background: #fff; }
    table { width: 100%; border-collapse: collapse; min-width: 680px; }
    th, td { padding: 7px 9px; border-bottom: 1px solid var(--line); text-align: left; font-size: 13px; }
    th { background: #f5f9fc; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="controls" style="justify-content: space-between;">
        <div>
          <h1 style="margin: 0 0 6px;">Inventory Adjustments</h1>
          <div class="muted">Create manual ADJUSTMENT ledger movements.</div>
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
            <label for="staff-id">X-Staff-Id</label>
            <input id="staff-id" type="text" placeholder="staff-1" />
          </div>
          <div class="muted">
            <a href="/inventory">Inventory</a> |
            <a href="/pos">POS</a>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Variant Search</h2>
      <div class="controls">
        <div class="field" style="min-width: 280px;">
          <label for="search-q">Search / Barcode</label>
          <input id="search-q" type="text" placeholder="SKU, barcode, product" />
        </div>
        <button id="search-btn" class="primary" type="button">Search</button>
      </div>
      <div id="search-status" class="status">Search for a variant to adjust.</div>
      <div id="search-wrap" class="table-wrap"></div>
      <div id="selected-variant" class="muted" style="margin-top: 8px;">No variant selected.</div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Create Adjustment</h2>
      <div class="controls">
        <div class="field">
          <label for="quantity-delta">Quantity Delta</label>
          <input id="quantity-delta" type="number" step="1" placeholder="e.g. -2 or 5" />
        </div>
        <div class="field">
          <label for="reason">Reason</label>
          <select id="reason">
            <option value="COUNT_CORRECTION">COUNT_CORRECTION</option>
            <option value="DAMAGED">DAMAGED</option>
            <option value="SUPPLIER_ERROR">SUPPLIER_ERROR</option>
            <option value="THEFT">THEFT</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div class="field" style="min-width: 300px;">
          <label for="note">Note</label>
          <input id="note" type="text" placeholder="Optional" />
        </div>
        <button id="submit-adjustment" class="primary" type="button">Submit</button>
      </div>
      <div id="submit-status" class="status"></div>
      <div id="onhand-result" class="muted" style="margin-top: 8px;"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      qs("#staff-role").value = ["STAFF", "MANAGER", "ADMIN"].includes("${initialRole}")
        ? "${initialRole}"
        : "STAFF";
      qs("#staff-id").value = "${initialStaffId}";

      const state = {
        rows: [],
        selectedVariant: null,
      };

      const setStatus = (id, message, mode = "info") => {
        const el = qs("#" + id);
        if (!el) {
          return;
        }
        el.textContent = message || "";
        el.classList.remove("ok", "error");
        if (mode === "ok") {
          el.classList.add("ok");
        }
        if (mode === "error") {
          el.classList.add("error");
        }
      };

      const getHeaders = () => {
        const headers = {
          "Content-Type": "application/json",
          "X-Staff-Role": qs("#staff-role").value || "STAFF",
        };
        const staffId = (qs("#staff-id").value || "").trim();
        if (staffId) {
          headers["X-Staff-Id"] = staffId;
        }
        return headers;
      };

      const apiRequest = async (path, options = {}) => {
        const response = await fetch(path, {
          ...options,
          headers: {
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
          const message = payload?.error?.message || payload?.error || "Request failed";
          const error = new Error(message);
          error.payload = payload;
          throw error;
        }

        return payload;
      };

      const formatMoney = (pence) => "£" + ((Number(pence || 0) / 100).toFixed(2));
      const isBarcodeLike = (value) => /^[0-9]{8,}$/.test(value);

      const renderRows = () => {
        const wrap = qs("#search-wrap");
        const selected = qs("#selected-variant");
        if (!wrap || !selected) {
          return;
        }

        if (state.rows.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px;" class="muted">No search results.</div>';
        } else {
          const rowsHtml = state.rows
            .map((row) =>
              '<tr>' +
              '<td>' + (row.name || "") + '</td>' +
              '<td>' + (row.sku || "") + '</td>' +
              '<td>' + (row.barcode || "") + '</td>' +
              '<td>' + formatMoney(row.pricePence || 0) + '</td>' +
              '<td>' + Number(row.onHandQty || 0) + '</td>' +
              '<td><button type="button" class="pick-variant-btn" data-variant-id="' + row.id + '">Select</button></td>' +
              '</tr>',
            )
            .join("");

          wrap.innerHTML =
            '<table>' +
            '<thead><tr><th>Name</th><th>SKU</th><th>Barcode</th><th>Price</th><th>On Hand</th><th>Action</th></tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
            '</table>';
        }

        if (!state.selectedVariant) {
          selected.textContent = "No variant selected.";
        } else {
          selected.textContent =
            "Selected: " + (state.selectedVariant.name || "") +
            " | SKU: " + (state.selectedVariant.sku || "") +
            " | On hand: " + Number(state.selectedVariant.onHandQty || 0);
        }
      };

      const search = async () => {
        const raw = (qs("#search-q").value || "").trim();
        if (!raw) {
          setStatus("search-status", "Enter search text.", "error");
          return;
        }

        setStatus("search-status", "Searching...");
        try {
          const query = isBarcodeLike(raw)
            ? "barcode=" + encodeURIComponent(raw)
            : "q=" + encodeURIComponent(raw);
          const payload = await apiRequest("/api/products/search?" + query + "&take=50&skip=0");
          state.rows = Array.isArray(payload?.rows) ? payload.rows : [];
          state.selectedVariant = state.rows[0] || null;
          renderRows();
          setStatus("search-status", "Loaded " + state.rows.length + " variants.", "ok");
        } catch (error) {
          setStatus("search-status", error.message || "Search failed", "error");
        }
      };

      const submitAdjustment = async () => {
        if (!state.selectedVariant) {
          setStatus("submit-status", "Select a variant first.", "error");
          return;
        }

        const quantityDelta = Number.parseInt(qs("#quantity-delta").value || "", 10);
        if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
          setStatus("submit-status", "quantityDelta must be a non-zero integer.", "error");
          return;
        }

        const reason = qs("#reason").value;
        const note = (qs("#note").value || "").trim();

        setStatus("submit-status", "Saving adjustment...");
        try {
          const result = await apiRequest("/api/inventory/adjustments", {
            method: "POST",
            body: JSON.stringify({
              variantId: state.selectedVariant.id,
              quantityDelta,
              reason,
              note: note || undefined,
            }),
          });

          const onHand = Number(result?.onHand ?? 0);
          const idx = state.rows.findIndex((row) => row.id === state.selectedVariant.id);
          if (idx >= 0) {
            state.rows[idx].onHandQty = onHand;
          }
          state.selectedVariant.onHandQty = onHand;
          renderRows();

          qs("#quantity-delta").value = "";
          setStatus("submit-status", "Adjustment recorded.", "ok");
          qs("#onhand-result").textContent =
            "Updated on-hand for " + state.selectedVariant.sku + ": " + onHand;
        } catch (error) {
          setStatus("submit-status", error.message || "Failed to save adjustment", "error");
        }
      };

      qs("#search-btn")?.addEventListener("click", search);
      qs("#search-q")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          search();
        }
      });
      qs("#search-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("pick-variant-btn")) {
          return;
        }

        const variantId = target.getAttribute("data-variant-id");
        if (!variantId) {
          return;
        }

        state.selectedVariant = state.rows.find((row) => row.id === variantId) || null;
        renderRows();
      });
      qs("#submit-adjustment")?.addEventListener("click", submitAdjustment);

      renderRows();
    })();
  </script>
</body>
</html>`;
};
