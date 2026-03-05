export const renderManagerCashPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manager Cash</title>
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
    input, button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; }
    button { cursor: pointer; background: #f9fbfc; }
    button.primary { background: var(--accent); color: #fff; border-color: #09566f; }
    .status { margin-top: 6px; min-height: 18px; font-size: 13px; color: var(--muted); }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 8px; }
    .metric { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: #fff; }
    .metric .label { font-size: 12px; color: var(--muted); }
    .metric .value { font-size: 20px; margin-top: 4px; font-weight: 700; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 920px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; vertical-align: middle; }
    th { background: #f1f7fb; }
    @media (max-width: 980px) {
      .summary-grid { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1 style="margin: 0 0 4px;" data-testid="manager-cash-heading">Manager Cash</h1>
      <div style="font-size: 13px; color: var(--muted);">Summary and recent cash movements for selected dates.</div>
      <div class="controls" style="margin-top: 10px;">
        <div class="field">
          <label for="cash-from">From</label>
          <input id="cash-from" type="text" placeholder="YYYY-MM-DD" />
        </div>
        <div class="field">
          <label for="cash-to">To</label>
          <input id="cash-to" type="text" placeholder="YYYY-MM-DD" />
        </div>
        <button id="cash-load" class="primary" type="button">Load</button>
      </div>
      <div id="cash-status" class="status"></div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Cash Summary</h2>
      <div id="cash-summary" class="summary-grid"></div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Recent Movements</h2>
      <div class="table-wrap" id="cash-movements-wrap"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const state = {
        summary: null,
        movements: [],
      };

      const setStatus = (message, mode) => {
        const el = qs("#cash-status");
        if (!el) return;
        el.textContent = message || "";
        el.classList.remove("ok", "error");
        if (mode === "ok") el.classList.add("ok");
        if (mode === "error") el.classList.add("error");
      };

      const apiRequest = async (path) => {
        const response = await fetch(path, {
          headers: {
            "Content-Type": "application/json",
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
          error.status = response.status;
          throw error;
        }

        return payload;
      };

      const metric = (label, value) => {
        return '<div class="metric"><div class="label">' + label + '</div><div class="value">' + String(value ?? 0) + '</div></div>';
      };

      const renderSummary = () => {
        const wrap = qs("#cash-summary");
        if (!wrap) return;

        if (!state.summary) {
          wrap.innerHTML = metric("Expected Cash", "-") + metric("Cash Sales", "-") + metric("Cash Refunds", "-");
          return;
        }

        const totals = state.summary.totals || {};
        wrap.innerHTML = [
          metric("Float", totals.floatPence),
          metric("Paid In", totals.paidInPence),
          metric("Paid Out", totals.paidOutPence),
          metric("Cash Sales", totals.cashSalesPence),
          metric("Cash Refunds", totals.cashRefundsPence),
          metric("Expected Cash", totals.expectedCashOnHandPence),
        ].join("");
      };

      const renderMovements = () => {
        const wrap = qs("#cash-movements-wrap");
        if (!wrap) return;

        if (!Array.isArray(state.movements) || state.movements.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No movements.</div>';
          return;
        }

        const table = document.createElement("table");
        table.innerHTML =
          '<thead>' +
          '<tr>' +
          '<th>Created</th>' +
          '<th>Type</th>' +
          '<th>Amount (pence)</th>' +
          '<th>Location</th>' +
          '<th>Sale</th>' +
          '<th>Refund</th>' +
          '<th>Note</th>' +
          '</tr>' +
          '</thead>' +
          '<tbody></tbody>';

        const tbody = table.querySelector("tbody");
        state.movements.forEach((movement) => {
          const row = document.createElement("tr");
          const values = [
            movement.createdAt,
            movement.type,
            movement.amountPence,
            movement.locationId || "default",
            movement.relatedSaleId || "-",
            movement.relatedRefundId || "-",
            movement.note || "-",
          ];
          values.forEach((value) => {
            const td = document.createElement("td");
            td.textContent = String(value);
            row.appendChild(td);
          });
          tbody.appendChild(row);
        });

        wrap.innerHTML = "";
        wrap.appendChild(table);
      };

      const load = async () => {
        const from = (qs("#cash-from")?.value || "").trim();
        const to = (qs("#cash-to")?.value || "").trim();
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const query = params.toString() ? "?" + params.toString() : "";

        setStatus("Loading cash manager dashboard...");

        try {
          const [summary, movements] = await Promise.all([
            apiRequest("/api/cash/summary" + query),
            apiRequest("/api/cash/movements" + query),
          ]);

          state.summary = summary;
          state.movements = Array.isArray(movements?.movements) ? movements.movements : [];
          renderSummary();
          renderMovements();
          setStatus("Loaded " + String(state.movements.length) + " movement(s).", "ok");
        } catch (error) {
          setStatus(error.message || "Failed to load manager cash dashboard", "error");
        }
      };

      const today = new Date().toISOString().slice(0, 10);
      const fromInput = qs("#cash-from");
      const toInput = qs("#cash-to");
      if (fromInput && !fromInput.value) fromInput.value = today;
      if (toInput && !toInput.value) toInput.value = today;

      qs("#cash-load")?.addEventListener("click", () => {
        load();
      });

      renderSummary();
      renderMovements();
      load();
    })();
  </script>
</body>
</html>`;
