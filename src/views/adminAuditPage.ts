export const renderAdminAuditPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Audit</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #fff;
      --line: #d8dfe6;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0c6f91;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .page { max-width: 1240px; margin: 0 auto; padding: 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 160px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; }
    button { cursor: pointer; background: #f9fbfc; }
    button.primary { background: var(--accent); color: #fff; border-color: #09576f; }
    .status { margin-top: 8px; min-height: 18px; color: var(--muted); font-size: 13px; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; background: #fff; }
    table { width: 100%; border-collapse: collapse; min-width: 1080px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; vertical-align: top; }
    th { background: #f1f7fb; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="controls" style="justify-content: space-between;">
        <div>
          <h1 style="margin: 0 0 6px;">Admin Audit</h1>
          <div style="color: var(--muted); font-size: 13px;">Filter audit events by date, action, and entity.</div>
        </div>
        <div class="controls">
          <a href="/admin">Admin Users</a>
          <a href="/pos">POS</a>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="controls">
        <div class="field">
          <label for="from">From (YYYY-MM-DD)</label>
          <input id="from" type="text" />
        </div>
        <div class="field">
          <label for="to">To (YYYY-MM-DD)</label>
          <input id="to" type="text" />
        </div>
        <div class="field">
          <label for="entity-type">Entity Type</label>
          <input id="entity-type" type="text" />
        </div>
        <div class="field">
          <label for="action">Action</label>
          <input id="action" type="text" />
        </div>
        <button id="load-btn" type="button" class="primary">Load</button>
      </div>
      <div id="status" class="status"></div>
      <div id="table-wrap" class="table-wrap"></div>
    </div>
  </div>
  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const state = { events: [] };

      const setStatus = (message) => {
        const el = qs("#status");
        if (!el) return;
        el.textContent = message || "";
      };

      const apiRequest = async (path) => {
        const response = await fetch(path);
        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { raw: text };
        }
        if (!response.ok) {
          throw new Error(payload?.error?.message || payload?.error || "Request failed");
        }
        return payload;
      };

      const render = () => {
        const wrap = qs("#table-wrap");
        if (!wrap) return;

        if (!state.events.length) {
          wrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No events.</div>';
          return;
        }

        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        ["When", "Action", "Entity", "Actor", "Metadata"].forEach((header) => {
          const th = document.createElement("th");
          th.textContent = header;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const event of state.events) {
          const row = document.createElement("tr");

          const createdAt = document.createElement("td");
          createdAt.textContent = event.createdAt || "";
          row.appendChild(createdAt);

          const action = document.createElement("td");
          action.textContent = event.action || "";
          row.appendChild(action);

          const entity = document.createElement("td");
          entity.textContent = (event.entityType || "") + ":" + (event.entityId || "");
          row.appendChild(entity);

          const actor = document.createElement("td");
          actor.textContent = (event.actorRole || "-") + (event.actorId ? " (" + event.actorId + ")" : "");
          row.appendChild(actor);

          const metadata = document.createElement("td");
          const pre = document.createElement("pre");
          pre.textContent = event.metadata ? JSON.stringify(event.metadata, null, 2) : "-";
          metadata.appendChild(pre);
          row.appendChild(metadata);

          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        wrap.innerHTML = "";
        wrap.appendChild(table);
      };

      const load = async () => {
        const params = new URLSearchParams();
        const from = (qs("#from").value || "").trim();
        const to = (qs("#to").value || "").trim();
        const entityType = (qs("#entity-type").value || "").trim();
        const action = (qs("#action").value || "").trim();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (entityType) params.set("entityType", entityType);
        if (action) params.set("action", action);
        params.set("limit", "200");

        setStatus("Loading audit events...");
        try {
          const payload = await apiRequest("/api/audit?" + params.toString());
          state.events = Array.isArray(payload?.events) ? payload.events : [];
          render();
          setStatus("Loaded " + state.events.length + " events.");
        } catch (error) {
          setStatus(error.message || "Failed to load audit events");
        }
      };

      qs("#load-btn")?.addEventListener("click", load);
      load();
    })();
  </script>
</body>
</html>`;
