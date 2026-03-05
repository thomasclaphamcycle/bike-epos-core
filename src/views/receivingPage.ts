export const renderReceivingPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receiving</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #fff;
      --line: #d8dfe6;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0c6f91;
      --ok: #226634;
      --danger: #8b1f1f;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .page { max-width: 1280px; margin: 0 auto; padding: 14px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 150px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, textarea, button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; }
    textarea { min-height: 70px; resize: vertical; }
    button { cursor: pointer; background: #f9fbfc; }
    button.primary { background: var(--accent); color: #fff; border-color: #09566f; }
    .status { margin-top: 6px; min-height: 18px; font-size: 13px; color: var(--muted); }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 960px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; vertical-align: middle; }
    th { background: #f1f7fb; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1 style="margin: 0 0 4px;" data-testid="receiving-heading">Receiving</h1>
      <div style="font-size: 13px; color: var(--muted);">Receive stock against submitted purchase orders.</div>
      <div class="controls" style="margin-top: 10px;">
        <button id="receiving-load" class="primary" type="button">Load Open Purchase Orders</button>
      </div>
      <div id="receiving-status" class="status"></div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Open Purchase Orders</h2>
      <div id="receiving-po-table" class="table-wrap"></div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Receive Purchase Order</h2>
      <div id="receiving-open-po-meta" class="status">Choose a purchase order.</div>
      <div class="field" style="margin-top: 8px;">
        <label for="receiving-notes">Receipt Notes</label>
        <textarea id="receiving-notes" placeholder="Optional notes for this receipt"></textarea>
      </div>
      <div id="receiving-line-table" class="table-wrap" style="margin-top: 8px;"></div>
      <div class="controls" style="margin-top: 8px;">
        <button id="receive-submit" class="primary" type="button">Post Receipt</button>
      </div>
      <div id="receiving-submit-status" class="status"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const state = {
        purchaseOrders: [],
        openPo: null,
      };

      const ELIGIBLE_STATUSES = new Set(["SUBMITTED", "RECEIVED_PARTIAL", "SENT", "PARTIALLY_RECEIVED"]);

      const setStatus = (id, message, mode) => {
        const el = qs("#" + id);
        if (!el) return;
        el.textContent = message || "";
        el.classList.remove("ok", "error");
        if (mode === "ok") el.classList.add("ok");
        if (mode === "error") el.classList.add("error");
      };

      const apiRequest = async (path, options = {}) => {
        const response = await fetch(path, {
          ...options,
          headers: {
            "Content-Type": "application/json",
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
          throw new Error(message);
        }

        return payload;
      };

      const renderPoTable = () => {
        const wrap = qs("#receiving-po-table");
        if (!wrap) return;

        if (!Array.isArray(state.purchaseOrders) || state.purchaseOrders.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No receivable purchase orders.</div>';
          return;
        }

        const rows = state.purchaseOrders
          .map((po) =>
            '<tr>' +
            '<td>' + po.id + '</td>' +
            '<td>' + (po.referenceCode || '-') + '</td>' +
            '<td>' + (po.supplier?.name || '-') + '</td>' +
            '<td>' + po.status + '</td>' +
            '<td>' + (po.totals?.quantityRemaining ?? 0) + '</td>' +
            '<td><button type="button" class="open-po-btn" data-po-id="' + po.id + '">Open</button></td>' +
            '</tr>',
          )
          .join('');

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>ID</th><th>Reference</th><th>Supplier</th><th>Status</th><th>Qty Remaining</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const renderOpenPo = () => {
        const meta = qs("#receiving-open-po-meta");
        const tableWrap = qs("#receiving-line-table");
        if (!meta || !tableWrap) return;

        if (!state.openPo) {
          meta.textContent = "Choose a purchase order.";
          tableWrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No purchase order selected.</div>';
          return;
        }

        const po = state.openPo;
        const lines = Array.isArray(po.lines) ? po.lines : [];
        meta.textContent = (po.referenceCode || po.id) + " · " + (po.supplier?.name || "") + " · " + po.status;

        const rows = lines
          .map((line) =>
            '<tr>' +
            '<td>' + line.id + '</td>' +
            '<td>' + (line.productName || '-') + '</td>' +
            '<td>' + (line.sku || '-') + '</td>' +
            '<td>' + (line.quantityOrdered ?? 0) + '</td>' +
            '<td>' + (line.quantityReceived ?? 0) + '</td>' +
            '<td>' + (line.quantityRemaining ?? 0) + '</td>' +
            '<td><input type="number" min="0" step="1" data-line-id="' + line.id + '" class="receive-qty" placeholder="0" /></td>' +
            '</tr>',
          )
          .join('');

        tableWrap.innerHTML =
          '<table>' +
          '<thead><tr><th>Line</th><th>Product</th><th>SKU</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Receive Qty</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const loadPurchaseOrders = async () => {
        setStatus("receiving-status", "Loading receivable purchase orders...");
        try {
          const payload = await apiRequest("/api/purchase-orders?take=80&skip=0");
          const rows = Array.isArray(payload?.purchaseOrders) ? payload.purchaseOrders : [];
          state.purchaseOrders = rows.filter((po) => ELIGIBLE_STATUSES.has(po.status));
          renderPoTable();
          setStatus("receiving-status", "Loaded " + state.purchaseOrders.length + " receivable purchase order(s).", "ok");
        } catch (error) {
          setStatus("receiving-status", error.message || "Failed to load purchase orders", "error");
        }
      };

      const openPo = async (poId) => {
        setStatus("receiving-status", "Loading purchase order...");
        try {
          state.openPo = await apiRequest("/api/purchase-orders/" + encodeURIComponent(poId));
          renderOpenPo();
          setStatus("receiving-status", "Purchase order loaded.", "ok");
        } catch (error) {
          state.openPo = null;
          renderOpenPo();
          setStatus("receiving-status", error.message || "Failed to load purchase order", "error");
        }
      };

      const submitReceipt = async () => {
        if (!state.openPo) {
          setStatus("receiving-submit-status", "Choose a purchase order first.", "error");
          return;
        }

        const qtyInputs = Array.from(document.querySelectorAll(".receive-qty"));
        const lines = qtyInputs
          .map((input) => {
            const qty = Number.parseInt(input.value || "", 10);
            if (!Number.isInteger(qty) || qty <= 0) {
              return null;
            }
            return {
              lineId: input.getAttribute("data-line-id"),
              quantityReceived: qty,
            };
          })
          .filter(Boolean);

        if (lines.length === 0) {
          setStatus("receiving-submit-status", "Enter at least one receive quantity.", "error");
          return;
        }

        const notes = (qs("#receiving-notes")?.value || "").trim();

        setStatus("receiving-submit-status", "Posting receipt...");
        try {
          const payload = await apiRequest("/api/purchase-orders/" + encodeURIComponent(state.openPo.id) + "/receive", {
            method: "POST",
            body: JSON.stringify({
              notes: notes || undefined,
              lines,
            }),
          });

          state.openPo = payload.purchaseOrder || state.openPo;
          renderOpenPo();
          await loadPurchaseOrders();
          setStatus(
            "receiving-submit-status",
            "Receipt posted" + (payload.receipt?.id ? ": " + payload.receipt.id : "."),
            "ok",
          );
        } catch (error) {
          setStatus("receiving-submit-status", error.message || "Receipt posting failed", "error");
        }
      };

      qs("#receiving-load")?.addEventListener("click", () => {
        loadPurchaseOrders();
      });

      qs("#receiving-po-table")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("open-po-btn")) {
          return;
        }
        const poId = target.getAttribute("data-po-id");
        if (!poId) {
          return;
        }
        openPo(poId);
      });

      qs("#receive-submit")?.addEventListener("click", () => {
        submitReceipt();
      });

      renderPoTable();
      renderOpenPo();
      loadPurchaseOrders();
    })();
  </script>
</body>
</html>`;
