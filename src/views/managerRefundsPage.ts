export const renderManagerRefundsPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manager Refunds</title>
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
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; vertical-align: middle; }
    th { background: #f1f7fb; }
    a { color: #0c5478; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1 style="margin: 0 0 4px;" data-testid="manager-refunds-heading">Manager Refunds</h1>
      <div style="font-size: 13px; color: var(--muted);">Recent completed refunds with receipt links.</div>
      <div class="controls" style="margin-top: 10px;">
        <div class="field">
          <label for="refunds-from">From</label>
          <input id="refunds-from" type="text" placeholder="YYYY-MM-DD" />
        </div>
        <div class="field">
          <label for="refunds-to">To</label>
          <input id="refunds-to" type="text" placeholder="YYYY-MM-DD" />
        </div>
        <button id="refunds-load" class="primary" type="button">Load</button>
      </div>
      <div id="refunds-status" class="status"></div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Recent Completed Refunds</h2>
      <div class="table-wrap" id="refunds-table-wrap"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const state = { refunds: [] };

      const setStatus = (message, mode) => {
        const el = qs("#refunds-status");
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

      const renderRefunds = () => {
        const wrap = qs("#refunds-table-wrap");
        if (!wrap) return;

        if (!Array.isArray(state.refunds) || state.refunds.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No completed refunds.</div>';
          return;
        }

        const table = document.createElement("table");
        table.innerHTML =
          '<thead>' +
          '<tr>' +
          '<th>Completed</th>' +
          '<th>Refund ID</th>' +
          '<th>Sale ID</th>' +
          '<th>Customer</th>' +
          '<th>Total (pence)</th>' +
          '<th>Cash Tender (pence)</th>' +
          '<th>Receipt</th>' +
          '</tr>' +
          '</thead>' +
          '<tbody></tbody>';

        const tbody = table.querySelector("tbody");
        state.refunds.forEach((refund) => {
          const tr = document.createElement("tr");

          const cells = [
            String(refund.completedAt || "-"),
            refund.id,
            refund.saleId,
            refund.customer?.name || "-",
            refund.totalPence,
            refund.cashTenderPence,
          ];

          cells.forEach((value) => {
            const td = document.createElement("td");
            td.textContent = String(value);
            tr.appendChild(td);
          });

          const receiptTd = document.createElement("td");
          if (refund.receiptNumber) {
            const link = document.createElement("a");
            link.href = "/r/" + encodeURIComponent(refund.receiptNumber);
            link.textContent = refund.receiptNumber;
            link.target = "_blank";
            link.rel = "noopener";
            receiptTd.appendChild(link);
          } else {
            receiptTd.textContent = "-";
          }
          tr.appendChild(receiptTd);

          tbody.appendChild(tr);
        });

        wrap.innerHTML = "";
        wrap.appendChild(table);
      };

      const loadRefunds = async () => {
        const from = (qs("#refunds-from")?.value || "").trim();
        const to = (qs("#refunds-to")?.value || "").trim();

        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);

        const query = params.toString() ? "?" + params.toString() : "";

        setStatus("Loading manager refunds...");
        try {
          const payload = await apiRequest("/api/refunds" + query);
          state.refunds = Array.isArray(payload?.refunds) ? payload.refunds : [];
          renderRefunds();
          setStatus("Loaded " + String(state.refunds.length) + " refund(s).", "ok");
        } catch (error) {
          setStatus(error.message || "Failed to load refunds", "error");
        }
      };

      const today = new Date().toISOString().slice(0, 10);
      const fromInput = qs("#refunds-from");
      const toInput = qs("#refunds-to");
      if (fromInput && !fromInput.value) fromInput.value = today;
      if (toInput && !toInput.value) toInput.value = today;

      qs("#refunds-load")?.addEventListener("click", () => {
        loadRefunds();
      });

      renderRefunds();
      loadRefunds();
    })();
  </script>
</body>
</html>`;
