import { escapeHtml } from "../utils/escapeHtml";

type WorkshopJobPageInput = {
  jobId: string;
  staffRole: string;
  staffId?: string;
};

export const renderWorkshopJobPage = (input: WorkshopJobPageInput) => {
  const jobId = escapeHtml(input.jobId);
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Workshop Job Card</title>
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
    .page { max-width: 1080px; margin: 0 auto; padding: 14px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
    h1, h2 { margin: 0 0 8px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 180px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, select, textarea, button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; background: #fff; color: var(--text); }
    textarea { min-height: 90px; resize: vertical; width: 100%; }
    button { cursor: pointer; }
    button.primary { background: var(--accent); color: #fff; border-color: #09566f; }
    .status { margin-top: 8px; min-height: 18px; font-size: 13px; color: var(--muted); }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .meta-grid { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(180px, 1fr)); }
    .meta { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: #fff; }
    .meta .label { color: var(--muted); font-size: 12px; }
    .meta .value { margin-top: 4px; font-size: 14px; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 680px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; }
    th { background: #f1f7fb; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1 data-testid="workshop-job-card-heading">Workshop Job Card</h1>
      <div>Job id: <code id="job-id">${jobId}</code></div>
      <div class="controls" style="margin-top: 10px;">
        <div class="field">
          <label for="staff-role">X-Staff-Role</label>
          <input id="staff-role" type="text" />
        </div>
        <div class="field">
          <label for="staff-id">X-Staff-Id</label>
          <input id="staff-id" type="text" />
        </div>
        <a href="/workshop">Back to Workshop</a>
      </div>
      <div id="load-status" class="status"></div>
    </div>

    <div class="card">
      <h2>Job Details</h2>
      <div id="job-meta" class="meta-grid"></div>
    </div>

    <div class="card">
      <h2>Update Job</h2>
      <div class="controls">
        <div class="field">
          <label for="status-select">Status</label>
          <select id="status-select">
            <option value="NEW">NEW</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="AWAITING_PARTS">AWAITING_PARTS</option>
            <option value="READY">READY</option>
            <option value="COLLECTED">COLLECTED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        <div class="field" style="min-width: 280px;">
          <label for="title-input">Title</label>
          <input id="title-input" type="text" />
        </div>
      </div>
      <div class="controls" style="margin-top: 8px;">
        <div class="field" style="min-width: 100%;">
          <label for="notes-input">Notes</label>
          <textarea id="notes-input"></textarea>
        </div>
      </div>
      <div class="controls" style="margin-top: 8px;">
        <button id="save-status-btn" type="button">Save Status</button>
        <button id="save-notes-btn" class="primary" type="button">Save Notes/Title</button>
      </div>
      <div id="save-status" class="status"></div>
    </div>

    <div class="card">
      <h2>Lines</h2>
      <div id="lines-wrap" class="table-wrap"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const roleInput = qs("#staff-role");
      const staffIdInput = qs("#staff-id");
      roleInput.value = "${initialRole}";
      staffIdInput.value = "${initialStaffId}";

      const jobId = "${jobId}";
      let jobPayload = null;

      const setStatus = (id, message, mode = "info") => {
        const el = qs("#" + id);
        if (!el) return;
        el.textContent = message || "";
        el.classList.remove("ok", "error");
        if (mode === "ok") el.classList.add("ok");
        if (mode === "error") el.classList.add("error");
      };

      const getHeaders = () => {
        const headers = { "Content-Type": "application/json", "X-Staff-Role": roleInput.value || "STAFF" };
        const staffId = (staffIdInput.value || "").trim();
        if (staffId) headers["X-Staff-Id"] = staffId;
        return headers;
      };

      const escapeHtml = (value) =>
        String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");

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
          throw new Error(message);
        }
        return payload;
      };

      const renderJob = () => {
        const meta = qs("#job-meta");
        const linesWrap = qs("#lines-wrap");
        if (!meta || !linesWrap) return;

        const job = jobPayload?.job;
        if (!job) {
          meta.innerHTML = '<div class="meta"><div class="label">Info</div><div class="value">No job loaded.</div></div>';
          linesWrap.innerHTML = '<div style="padding: 10px;">No lines.</div>';
          return;
        }

        const cards = [
          { label: "Customer", value: job.customerName || "-" },
          { label: "Status (legacy)", value: job.status || "-" },
          { label: "Status (v1)", value: job.statusV1 || "-" },
          { label: "Title", value: job.title || "-" },
          { label: "Promised At", value: job.promisedAt ? new Date(job.promisedAt).toLocaleString() : "-" },
          { label: "Assigned To", value: job.assignedToStaffName || job.assignedToStaffId || "-" },
        ];
        meta.innerHTML = cards
          .map((card) =>
            '<div class="meta"><div class="label">' + escapeHtml(card.label) + '</div><div class="value">' + escapeHtml(card.value) + "</div></div>",
          )
          .join("");

        qs("#status-select").value = job.statusV1 || "NEW";
        qs("#title-input").value = job.title || "";
        qs("#notes-input").value = job.notes || "";

        const lines = Array.isArray(jobPayload?.lines) ? jobPayload.lines : [];
        if (lines.length === 0) {
          linesWrap.innerHTML = '<div style="padding: 10px;">No lines.</div>';
          return;
        }

        const rows = lines
          .map((line) =>
            '<tr>' +
            '<td>' + escapeHtml(line.type) + '</td>' +
            '<td>' + escapeHtml(line.description) + '</td>' +
            '<td>' + escapeHtml(line.variantSku || "-") + '</td>' +
            '<td>' + escapeHtml(String(line.qty || 0)) + '</td>' +
            '<td>' + escapeHtml(String(line.unitPricePence || 0)) + '</td>' +
            "</tr>",
          )
          .join("");
        linesWrap.innerHTML =
          '<table><thead><tr><th>Type</th><th>Description</th><th>SKU</th><th>Qty</th><th>Unit (p)</th></tr></thead><tbody>' +
          rows +
          "</tbody></table>";
      };

      const loadJob = async () => {
        setStatus("load-status", "Loading workshop job...");
        try {
          jobPayload = await apiRequest("/api/workshop/jobs/" + encodeURIComponent(jobId));
          renderJob();
          setStatus("load-status", "Workshop job loaded.", "ok");
        } catch (error) {
          setStatus("load-status", error.message || "Failed to load workshop job", "error");
        }
      };

      const saveStatus = async () => {
        const status = (qs("#status-select").value || "").trim();
        if (!status) {
          setStatus("save-status", "Select a status first.", "error");
          return;
        }
        setStatus("save-status", "Saving status...");
        try {
          await apiRequest("/api/workshop/jobs/" + encodeURIComponent(jobId), {
            method: "PATCH",
            body: JSON.stringify({ status }),
          });
          await loadJob();
          setStatus("save-status", "Status saved.", "ok");
        } catch (error) {
          setStatus("save-status", error.message || "Failed to save status", "error");
        }
      };

      const saveNotesAndTitle = async () => {
        const title = (qs("#title-input").value || "").trim();
        const notes = (qs("#notes-input").value || "").trim();
        if (!title) {
          setStatus("save-status", "Title cannot be empty.", "error");
          return;
        }
        setStatus("save-status", "Saving notes/title...");
        try {
          await apiRequest("/api/workshop/jobs/" + encodeURIComponent(jobId), {
            method: "PATCH",
            body: JSON.stringify({
              title,
              notes,
            }),
          });
          await loadJob();
          setStatus("save-status", "Job updated.", "ok");
        } catch (error) {
          setStatus("save-status", error.message || "Failed to update job", "error");
        }
      };

      qs("#save-status-btn")?.addEventListener("click", saveStatus);
      qs("#save-notes-btn")?.addEventListener("click", saveNotesAndTitle);
      renderJob();
      loadJob();
    })();
  </script>
</body>
</html>`;
};
