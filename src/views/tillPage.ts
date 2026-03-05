export const renderTillPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Till / Cash-Up</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #fff;
      --line: #d8dfe6;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0c6f91;
      --danger: #8b1f1f;
      --ok: #226634;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .page { max-width: 1240px; margin: 0 auto; padding: 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 140px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, select, button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; }
    button { cursor: pointer; background: #f9fbfc; }
    button.primary { background: var(--accent); color: #fff; border-color: #09576f; }
    .status { margin-top: 8px; min-height: 18px; color: var(--muted); font-size: 13px; }
    .status.error { color: var(--danger); }
    .status.ok { color: var(--ok); }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; background: #fff; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; vertical-align: middle; }
    th { background: #f1f7fb; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="controls" style="justify-content: space-between;">
        <div>
          <h1 style="margin: 0 0 6px;">Till / Cash-Up</h1>
          <div style="font-size: 13px; color: var(--muted);">Manage cash sessions and reconciliation.</div>
        </div>
        <div class="controls">
          <a href="/pos">POS</a>
          <a href="/reports">Reports</a>
        </div>
      </div>
    </div>

    <div class="grid">
      <div>
        <div class="card">
          <h2 style="margin: 0 0 8px;">Open Session</h2>
          <div class="controls">
            <div class="field">
              <label for="open-date">Business Date</label>
              <input id="open-date" type="text" placeholder="YYYY-MM-DD (optional)" />
            </div>
            <div class="field">
              <label for="opening-float">Opening Float (pence)</label>
              <input id="opening-float" type="number" min="0" step="1" value="0" data-testid="till-open-float" />
            </div>
            <button id="open-session-btn" class="primary" type="button" data-testid="till-open-submit">Open</button>
          </div>
          <div id="open-status" class="status"></div>
        </div>

        <div class="card">
          <h2 style="margin: 0 0 8px;">Paid In / Paid Out</h2>
          <div class="controls">
            <div class="field">
              <label for="movement-type">Type</label>
              <select id="movement-type">
                <option value="PAID_IN">PAID_IN</option>
                <option value="PAID_OUT">PAID_OUT</option>
              </select>
            </div>
            <div class="field">
              <label for="movement-amount">Amount (pence)</label>
              <input id="movement-amount" type="number" min="1" step="1" value="100" data-testid="till-movement-amount" />
            </div>
            <div class="field">
              <label for="movement-ref">Ref</label>
              <input id="movement-ref" type="text" placeholder="optional ref" />
            </div>
            <button id="movement-submit-btn" type="button" class="primary" data-testid="till-movement-submit">Save</button>
          </div>
          <div id="movement-status" class="status"></div>
        </div>

        <div class="card">
          <h2 style="margin: 0 0 8px;">Count + Close</h2>
          <div class="controls">
            <div class="field">
              <label for="counted-cash">Counted Cash (pence)</label>
              <input id="counted-cash" type="number" min="0" step="1" data-testid="till-counted-cash" />
            </div>
            <div class="field" style="min-width: 260px;">
              <label for="count-notes">Notes</label>
              <input id="count-notes" type="text" placeholder="optional notes" />
            </div>
            <button id="save-count-btn" type="button">Save Count</button>
            <button id="close-session-btn" type="button" class="primary" data-testid="till-close-submit">Close Session</button>
          </div>
          <div id="close-status" class="status"></div>
        </div>
      </div>

      <div>
        <div class="card">
          <h2 style="margin: 0 0 8px;">Current Session Summary</h2>
          <div id="current-session-meta" style="font-size: 13px; color: var(--muted);">No open session.</div>
          <div class="table-wrap"><table id="summary-table"></table></div>
          <div class="controls" style="margin-top: 8px;">
            <button id="refresh-current-btn" type="button">Refresh</button>
            <a id="summary-csv-link" href="#" target="_blank" rel="noopener">Download CSV</a>
          </div>
          <div id="current-status" class="status"></div>
        </div>

        <div class="card">
          <h2 style="margin: 0 0 8px;">Recent Sessions</h2>
          <div class="controls">
            <div class="field">
              <label for="from-date">From</label>
              <input id="from-date" type="text" placeholder="YYYY-MM-DD" />
            </div>
            <div class="field">
              <label for="to-date">To</label>
              <input id="to-date" type="text" placeholder="YYYY-MM-DD" />
            </div>
            <button id="load-sessions-btn" type="button">Load</button>
          </div>
          <div id="sessions-status" class="status"></div>
          <div id="sessions-wrap" class="table-wrap"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const state = { current: null, sessions: [] };

      const setStatus = (id, message, mode) => {
        const el = qs("#" + id);
        if (!el) return;
        el.textContent = message || "";
        el.classList.remove("error", "ok");
        if (mode === "error") el.classList.add("error");
        if (mode === "ok") el.classList.add("ok");
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
          const error = new Error(message);
          error.status = response.status;
          throw error;
        }
        return payload;
      };

      const renderSummary = () => {
        const table = qs("#summary-table");
        const meta = qs("#current-session-meta");
        const csvLink = qs("#summary-csv-link");
        if (!table || !meta || !csvLink) return;

        if (!state.current || !state.current.session) {
          meta.textContent = "No open session.";
          table.innerHTML = "";
          csvLink.style.display = "none";
          return;
        }

        const session = state.current.session;
        const totals = state.current.totals || {};
        meta.textContent =
          "Session " + session.id + " | Date " + String(session.businessDate).slice(0, 10) + " | Status " + session.status;
        csvLink.style.display = "inline";
        csvLink.setAttribute("href", "/api/till/sessions/" + encodeURIComponent(session.id) + "/summary.csv");

        const rows = [
          ["Opening Float", totals.openingFloatPence],
          ["Paid In", totals.paidInPence],
          ["Paid Out", totals.paidOutPence],
          ["Cash Sales", totals.cashSalesPence],
          ["Cash Refunds", totals.cashRefundsPence],
          ["Expected Cash", totals.expectedCashPence],
          ["Counted Cash", totals.countedCashPence],
          ["Variance", totals.variancePence],
        ];

        table.innerHTML = "";
        const thead = document.createElement("thead");
        const trh = document.createElement("tr");
        ["Metric", "Pence"].forEach((header) => {
          const th = document.createElement("th");
          th.textContent = header;
          trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        rows.forEach((row) => {
          const tr = document.createElement("tr");
          const c1 = document.createElement("td");
          c1.textContent = row[0];
          const c2 = document.createElement("td");
          c2.textContent = row[1] === null || row[1] === undefined ? "-" : String(row[1]);
          tr.appendChild(c1);
          tr.appendChild(c2);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
      };

      const renderSessions = () => {
        const wrap = qs("#sessions-wrap");
        if (!wrap) return;
        if (!state.sessions.length) {
          wrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No sessions.</div>';
          return;
        }

        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        ["ID", "Date", "Opened", "Closed", "Status", "Opening Float"].forEach((h) => {
          const th = document.createElement("th");
          th.textContent = h;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const session of state.sessions) {
          const row = document.createElement("tr");
          [session.id, String(session.businessDate).slice(0, 10), session.openedAt, session.closedAt || "-", session.status, session.openingFloatPence]
            .forEach((value) => {
              const td = document.createElement("td");
              td.textContent = String(value);
              row.appendChild(td);
            });
          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        wrap.innerHTML = "";
        wrap.appendChild(table);
      };

      const loadCurrent = async () => {
        setStatus("current-status", "Loading current session...");
        try {
          const payload = await apiRequest("/api/till/sessions/current");
          state.current = payload;
          renderSummary();
          setStatus("current-status", payload.session ? "Current session loaded." : "No open session.", "ok");
        } catch (error) {
          setStatus("current-status", error.message || "Failed to load current session", "error");
        }
      };

      const loadSessions = async () => {
        const from = (qs("#from-date").value || "").trim();
        const to = (qs("#to-date").value || "").trim();
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        setStatus("sessions-status", "Loading sessions...");
        try {
          const payload = await apiRequest("/api/till/sessions?" + params.toString());
          state.sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
          renderSessions();
          setStatus("sessions-status", "Loaded " + state.sessions.length + " sessions.", "ok");
        } catch (error) {
          setStatus("sessions-status", error.message || "Failed to load sessions", "error");
        }
      };

      const openSession = async () => {
        const openingFloatPence = Number.parseInt(qs("#opening-float").value || "", 10);
        const businessDate = (qs("#open-date").value || "").trim();
        setStatus("open-status", "Opening session...");
        try {
          await apiRequest("/api/till/sessions/open", {
            method: "POST",
            body: JSON.stringify({
              openingFloatPence,
              businessDate: businessDate || undefined,
            }),
          });
          setStatus("open-status", "Session opened.", "ok");
          await loadCurrent();
          await loadSessions();
        } catch (error) {
          setStatus("open-status", error.message || "Failed to open session", "error");
        }
      };

      const addMovement = async () => {
        if (!state.current?.session?.id) {
          setStatus("movement-status", "Open a session first.", "error");
          return;
        }

        const amountPence = Number.parseInt(qs("#movement-amount").value || "", 10);
        const type = qs("#movement-type").value;
        const ref = (qs("#movement-ref").value || "").trim();

        setStatus("movement-status", "Saving movement...");
        try {
          await apiRequest("/api/till/sessions/" + encodeURIComponent(state.current.session.id) + "/movements", {
            method: "POST",
            body: JSON.stringify({ type, amountPence, ref: ref || undefined }),
          });
          setStatus("movement-status", "Movement recorded.", "ok");
          await loadCurrent();
          await loadSessions();
        } catch (error) {
          setStatus("movement-status", error.message || "Failed to save movement", "error");
        }
      };

      const saveCount = async () => {
        if (!state.current?.session?.id) {
          setStatus("close-status", "Open a session first.", "error");
          return;
        }
        const countedCashPence = Number.parseInt(qs("#counted-cash").value || "", 10);
        const notes = (qs("#count-notes").value || "").trim();
        setStatus("close-status", "Saving count...");
        try {
          await apiRequest("/api/till/sessions/" + encodeURIComponent(state.current.session.id) + "/count", {
            method: "POST",
            body: JSON.stringify({ countedCashPence, notes: notes || undefined }),
          });
          setStatus("close-status", "Count saved.", "ok");
          await loadCurrent();
        } catch (error) {
          setStatus("close-status", error.message || "Failed to save count", "error");
        }
      };

      const closeSession = async () => {
        if (!state.current?.session?.id) {
          setStatus("close-status", "Open a session first.", "error");
          return;
        }
        setStatus("close-status", "Closing session...");
        try {
          await apiRequest("/api/till/sessions/" + encodeURIComponent(state.current.session.id) + "/close", {
            method: "POST",
            body: JSON.stringify({}),
          });
          setStatus("close-status", "Session closed.", "ok");
          await loadCurrent();
          await loadSessions();
        } catch (error) {
          setStatus("close-status", error.message || "Failed to close session", "error");
        }
      };

      qs("#open-session-btn")?.addEventListener("click", openSession);
      qs("#movement-submit-btn")?.addEventListener("click", addMovement);
      qs("#save-count-btn")?.addEventListener("click", saveCount);
      qs("#close-session-btn")?.addEventListener("click", closeSession);
      qs("#refresh-current-btn")?.addEventListener("click", loadCurrent);
      qs("#load-sessions-btn")?.addEventListener("click", loadSessions);

      loadCurrent();
      loadSessions();
    })();
  </script>
</body>
</html>`;
