import { escapeHtml } from "../utils/escapeHtml";

type WorkshopPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderWorkshopPage = (input: WorkshopPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Workshop</title>
  <style>
    :root {
      --bg: #f5f7f9;
      --card: #fff;
      --line: #d5dbe2;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0a6c8f;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .page { max-width: 1320px; margin: 0 auto; padding: 18px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 140px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, select, button, textarea { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; background: #fff; color: var(--text); }
    textarea { min-height: 64px; resize: vertical; }
    button { cursor: pointer; }
    button.primary { background: var(--accent); border-color: #08546f; color: #fff; }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    th, td { font-size: 13px; padding: 7px 9px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
    th { background: #f2f7fb; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; background: #fff; }
    .muted { color: var(--muted); font-size: 13px; }
    .status { margin-top: 8px; font-size: 13px; min-height: 18px; color: var(--muted); }
    .status.error { color: #8f1f1f; }
    .status.ok { color: #256538; }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="controls" style="justify-content: space-between;">
        <div>
          <h1 style="margin: 0 0 6px;">Workshop</h1>
          <div class="muted">Create jobs, add part/labour lines, finalize to basket.</div>
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
            <a href="/pos">POS</a> |
            <a href="/inventory">Inventory</a> |
            <a href="/purchasing">Purchasing</a> |
            <a href="/till">Till</a> |
            <a href="/admin">Admin</a>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Create Job</h2>
      <div class="controls">
        <div class="field"><label for="create-customer">Customer Name</label><input id="create-customer" type="text" /></div>
        <div class="field"><label for="create-bike">Bike Description</label><input id="create-bike" type="text" /></div>
        <div class="field" style="min-width: 340px;"><label for="create-notes">Notes</label><input id="create-notes" type="text" /></div>
        <button id="create-job" class="primary" type="button">Create Job</button>
        <button id="refresh-jobs" type="button">Refresh Jobs</button>
      </div>
      <div id="job-create-status" class="status"></div>
    </div>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 8px;">Jobs</h2>
        <div class="controls">
          <div class="field"><label for="job-search">Search</label><input id="job-search" type="text" placeholder="customer, bike, notes" /></div>
          <div class="field"><label for="job-status-filter">Status</label>
            <select id="job-status-filter">
              <option value="">All</option>
              <option value="BOOKED">BOOKED</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="READY">READY</option>
              <option value="COLLECTED">COLLECTED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>
        </div>
        <div id="jobs-status" class="status"></div>
        <div id="jobs-wrap" class="table-wrap"></div>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 8px;">Selected Job</h2>
        <div id="selected-job-meta" class="muted">No job selected.</div>
        <div class="controls" style="margin-top: 8px;">
          <button id="finalize-job" class="primary" type="button">Finalize To Basket</button>
          <button id="close-job" type="button">Close Job</button>
        </div>
        <div id="selected-job-status" class="status"></div>
        <div id="selected-job-lines" class="table-wrap"></div>

        <h3 style="margin-top: 14px;">Attach Customer</h3>
        <div class="controls">
          <div class="field" style="min-width: 260px;"><label for="customer-search">Customer Search</label><input id="customer-search" type="text" placeholder="name, email, phone" /></div>
          <button id="customer-search-btn" type="button">Search</button>
          <button id="customer-clear-btn" type="button">Clear</button>
        </div>
        <div id="customer-selected" class="muted" style="margin-top: 6px;">No customer attached.</div>
        <div id="customer-search-status" class="status"></div>
        <div id="customer-search-wrap" class="table-wrap"></div>

        <h3 style="margin-top: 14px;">Add Part</h3>
        <div class="controls">
          <div class="field" style="min-width: 260px;"><label for="part-search">Product Search / Barcode</label><input id="part-search" type="text" /></div>
          <button id="part-search-btn" type="button">Search</button>
          <div class="field"><label for="part-qty">Qty</label><input id="part-qty" type="number" min="1" step="1" value="1" /></div>
          <div class="field"><label for="part-price">Unit Price (pence)</label><input id="part-price" type="number" min="0" step="1" value="0" /></div>
          <button id="add-part-btn" class="primary" type="button">Add Part</button>
        </div>
        <div id="part-selected" class="muted" style="margin-top: 6px;">No part product selected.</div>
        <div id="part-search-status" class="status"></div>
        <div id="part-search-wrap" class="table-wrap"></div>

        <h3 style="margin-top: 14px;">Add Labour</h3>
        <div class="controls">
          <div class="field" style="min-width: 260px;"><label for="labour-desc">Description</label><input id="labour-desc" type="text" /></div>
          <div class="field"><label for="labour-qty">Qty</label><input id="labour-qty" type="number" min="1" step="1" value="1" /></div>
          <div class="field"><label for="labour-price">Unit Price (pence)</label><input id="labour-price" type="number" min="0" step="1" value="0" /></div>
          <button id="add-labour-btn" class="primary" type="button">Add Labour</button>
        </div>
        <div id="labour-status" class="status"></div>
      </div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);

      qs("#staff-role").value = ["STAFF", "MANAGER", "ADMIN"].includes("${initialRole}") ? "${initialRole}" : "STAFF";
      qs("#staff-id").value = "${initialStaffId}";

      const state = {
        jobs: [],
        selectedJobId: null,
        selectedJob: null,
        selectedPartResult: null,
        partResults: [],
        customerResults: [],
      };

      const getHeaders = () => {
        const headers = { "Content-Type": "application/json", "X-Staff-Role": qs("#staff-role").value || "STAFF" };
        const staffId = (qs("#staff-id").value || "").trim();
        if (staffId) {
          headers["X-Staff-Id"] = staffId;
        }
        return headers;
      };

      const setStatus = (id, message, mode = "info") => {
        const el = qs("#" + id);
        if (!el) {
          return;
        }
        el.textContent = message || "";
        el.classList.remove("error", "ok");
        if (mode === "error") {
          el.classList.add("error");
        }
        if (mode === "ok") {
          el.classList.add("ok");
        }
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
      const escapeHtml = (value) =>
        String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      const toSafeText = (value) => escapeHtml(value);
      const isBarcodeLike = (value) => /^[0-9]{8,}$/.test(value);
      const getCustomerDisplayName = (customer) => {
        if (!customer) {
          return "";
        }
        if (customer.name) {
          return customer.name;
        }
        return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
      };

      const renderJobs = () => {
        const wrap = qs("#jobs-wrap");
        if (!wrap) {
          return;
        }

        if (state.jobs.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px;" class="muted">No jobs found.</div>';
          return;
        }

        const rows = state.jobs
          .map((job) =>
            '<tr>' +
            '<td>' + toSafeText(job.id) + '</td>' +
            '<td>' + toSafeText(job.customerName || "") + '</td>' +
            '<td>' + toSafeText(job.bikeDescription || "") + '</td>' +
            '<td>' + toSafeText(job.status || "") + '</td>' +
            '<td>' + (job.lineCount || 0) + '</td>' +
            '<td><button type="button" class="select-job-btn" data-job-id="' + toSafeText(job.id) + '">Open</button></td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>ID</th><th>Customer</th><th>Bike</th><th>Status</th><th>Lines</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const renderSelectedJob = () => {
        const meta = qs("#selected-job-meta");
        const linesWrap = qs("#selected-job-lines");
        if (!meta || !linesWrap) {
          return;
        }

        if (!state.selectedJob) {
          meta.textContent = "No job selected.";
          linesWrap.innerHTML = '<div style="padding: 10px;" class="muted">No lines.</div>';
          return;
        }

        const job = state.selectedJob.job || state.selectedJob;
        meta.textContent =
          "Job: " + job.id +
          " | Customer: " + (job.customerName || "") +
          " | Status: " + (job.status || "") +
          (job.finalizedBasketId ? " | Basket: " + job.finalizedBasketId : "");

        const lines = Array.isArray(state.selectedJob.lines) ? state.selectedJob.lines : [];
        if (lines.length === 0) {
          linesWrap.innerHTML = '<div style="padding: 10px;" class="muted">No lines added yet.</div>';
          return;
        }

        const rows = lines
          .map((line) =>
            '<tr>' +
            '<td>' + toSafeText(line.type) + '</td>' +
            '<td>' + toSafeText(line.description || "") + '</td>' +
            '<td>' + toSafeText(line.variantSku || "") + '</td>' +
            '<td>' + line.qty + '</td>' +
            '<td>' + formatMoney(line.unitPricePence || 0) + '</td>' +
            '<td>' + formatMoney(line.lineTotalPence || 0) + '</td>' +
            '</tr>',
          )
          .join("");

        linesWrap.innerHTML =
          '<table>' +
          '<thead><tr><th>Type</th><th>Description</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const renderPartSearchResults = () => {
        const wrap = qs("#part-search-wrap");
        const selectedLabel = qs("#part-selected");
        if (!wrap || !selectedLabel) {
          return;
        }

        if (state.partResults.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px;" class="muted">No products loaded.</div>';
        } else {
          const rows = state.partResults
            .map((row) =>
              '<tr>' +
              '<td>' + toSafeText(row.name || "") + '</td>' +
              '<td>' + toSafeText(row.sku || "") + '</td>' +
              '<td>' + toSafeText(row.barcode || "") + '</td>' +
              '<td>' + formatMoney(row.pricePence || 0) + '</td>' +
              '<td>' + Number(row.onHandQty || 0) + '</td>' +
              '<td><button type="button" class="select-part-btn" data-variant-id="' + toSafeText(row.id) + '">Use</button></td>' +
              '</tr>',
            )
            .join("");

          wrap.innerHTML =
            '<table>' +
            '<thead><tr><th>Name</th><th>SKU</th><th>Barcode</th><th>Price</th><th>On Hand</th><th>Action</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
            '</table>';
        }

        if (!state.selectedPartResult) {
          selectedLabel.textContent = "No part product selected.";
        } else {
          selectedLabel.textContent =
            "Selected part: " +
            (state.selectedPartResult.name || "") +
            " | SKU: " + (state.selectedPartResult.sku || "") +
            " | On hand: " + Number(state.selectedPartResult.onHandQty || 0);
          qs("#part-price").value = String(state.selectedPartResult.pricePence || 0);
        }
      };

      const renderCustomerSearchResults = () => {
        const wrap = qs("#customer-search-wrap");
        const selected = qs("#customer-selected");
        if (!wrap || !selected) {
          return;
        }

        const job = state.selectedJob?.job || null;
        if (!job) {
          selected.textContent = "Select a workshop job first.";
        } else if (job.customerId) {
          selected.textContent =
            "Attached customer: " + (job.customerName || job.customerId) + " (" + job.customerId + ")";
        } else {
          selected.textContent = "No customer attached.";
        }

        if (state.customerResults.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px;" class="muted">No customers loaded.</div>';
          return;
        }

        const rows = state.customerResults
          .map((customer) =>
            '<tr>' +
            '<td>' + toSafeText(getCustomerDisplayName(customer) || customer.id) + '</td>' +
            '<td>' + toSafeText(customer.email || "") + '</td>' +
            '<td>' + toSafeText(customer.phone || "") + '</td>' +
            '<td><button type="button" class="attach-customer-btn" data-customer-id="' + toSafeText(customer.id) + '">Attach</button></td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const refreshJobs = async () => {
        const queryParts = [];
        const status = (qs("#job-status-filter").value || "").trim();
        const q = (qs("#job-search").value || "").trim();
        if (status) {
          queryParts.push("status=" + encodeURIComponent(status));
        }
        if (q) {
          queryParts.push("q=" + encodeURIComponent(q));
        }
        queryParts.push("take=100");
        queryParts.push("skip=0");

        setStatus("jobs-status", "Loading jobs...");
        try {
          const payload = await apiRequest("/api/workshop/jobs?" + queryParts.join("&"));
          state.jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
          renderJobs();
          setStatus("jobs-status", "Loaded " + state.jobs.length + " jobs.", "ok");
        } catch (error) {
          setStatus("jobs-status", error.message || "Failed to load jobs", "error");
        }
      };

      const loadJob = async (jobId) => {
        if (!jobId) {
          return;
        }
        setStatus("selected-job-status", "Loading job...");
        try {
          const payload = await apiRequest("/api/workshop/jobs/" + encodeURIComponent(jobId));
          state.selectedJobId = jobId;
          state.selectedJob = payload;
          renderSelectedJob();
          renderCustomerSearchResults();
          setStatus("selected-job-status", "Job loaded.", "ok");
        } catch (error) {
          setStatus("selected-job-status", error.message || "Failed to load job", "error");
        }
      };

      const createJob = async () => {
        const customerName = (qs("#create-customer").value || "").trim();
        const bikeDescription = (qs("#create-bike").value || "").trim();
        const notes = (qs("#create-notes").value || "").trim();

        if (!customerName || !bikeDescription) {
          setStatus("job-create-status", "Customer name and bike description are required.", "error");
          return;
        }

        setStatus("job-create-status", "Creating job...");
        try {
          const job = await apiRequest("/api/workshop/jobs", {
            method: "POST",
            body: JSON.stringify({
              customerName,
              bikeDescription,
              notes: notes || undefined,
            }),
          });
          state.selectedJobId = job.id;
          state.selectedJob = {
            job: {
              id: job.id,
              customerName: job.customerName || customerName,
              bikeDescription: job.bikeDescription || bikeDescription,
              status: job.status || "BOOKED",
              finalizedBasketId: job.finalizedBasketId || null,
            },
            lines: [],
          };
          renderSelectedJob();
          renderCustomerSearchResults();
          setStatus("job-create-status", "Job created.", "ok");
          await refreshJobs();
          await loadJob(job.id);
        } catch (error) {
          setStatus("job-create-status", error.message || "Failed to create job", "error");
        }
      };

      const searchPartProducts = async () => {
        const raw = (qs("#part-search").value || "").trim();
        if (!raw) {
          setStatus("part-search-status", "Enter search text.", "error");
          return;
        }

        setStatus("part-search-status", "Searching products...");
        try {
          const query = isBarcodeLike(raw)
            ? "barcode=" + encodeURIComponent(raw)
            : "q=" + encodeURIComponent(raw);
          const payload = await apiRequest("/api/products/search?" + query + "&take=40&skip=0");
          state.partResults = Array.isArray(payload?.rows) ? payload.rows : [];
          state.selectedPartResult = state.partResults[0] || null;
          renderPartSearchResults();
          setStatus("part-search-status", "Loaded " + state.partResults.length + " products.", "ok");
        } catch (error) {
          setStatus("part-search-status", error.message || "Search failed", "error");
        }
      };

      const searchCustomersForJob = async () => {
        const raw = (qs("#customer-search").value || "").trim();
        if (!raw) {
          setStatus("customer-search-status", "Enter customer search text.", "error");
          return;
        }

        setStatus("customer-search-status", "Searching customers...");
        try {
          const payload = await apiRequest(
            "/api/customers/search?q=" + encodeURIComponent(raw) + "&take=20",
          );
          state.customerResults = Array.isArray(payload?.customers) ? payload.customers : [];
          renderCustomerSearchResults();
          setStatus(
            "customer-search-status",
            "Loaded " + state.customerResults.length + " customers.",
            "ok",
          );
        } catch (error) {
          setStatus("customer-search-status", error.message || "Customer search failed", "error");
        }
      };

      const attachCustomerToSelectedJob = async (customerId) => {
        if (!state.selectedJobId) {
          setStatus("customer-search-status", "Select a workshop job first.", "error");
          return;
        }

        setStatus("customer-search-status", "Attaching customer...");
        try {
          await apiRequest("/api/workshop/jobs/" + encodeURIComponent(state.selectedJobId) + "/customer", {
            method: "PATCH",
            body: JSON.stringify({ customerId }),
          });
          await loadJob(state.selectedJobId);
          await refreshJobs();
          renderCustomerSearchResults();
          setStatus("customer-search-status", customerId ? "Customer attached." : "Customer cleared.", "ok");
        } catch (error) {
          setStatus("customer-search-status", error.message || "Failed to attach customer", "error");
        }
      };

      const addPartLine = async () => {
        if (!state.selectedJobId) {
          setStatus("part-search-status", "Select a workshop job first.", "error");
          return;
        }
        if (!state.selectedPartResult) {
          setStatus("part-search-status", "Select a part product result first.", "error");
          return;
        }

        const qty = Number.parseInt(qs("#part-qty").value || "", 10);
        const unitPricePence = Number.parseInt(qs("#part-price").value || "", 10);
        if (!Number.isInteger(qty) || qty <= 0) {
          setStatus("part-search-status", "Part qty must be a positive integer.", "error");
          return;
        }
        if (!Number.isInteger(unitPricePence) || unitPricePence < 0) {
          setStatus("part-search-status", "Part unit price must be a non-negative integer.", "error");
          return;
        }

        setStatus("part-search-status", "Adding part line...");
        try {
          await apiRequest("/api/workshop/jobs/" + encodeURIComponent(state.selectedJobId) + "/lines", {
            method: "POST",
            body: JSON.stringify({
              type: "PART",
              productId: state.selectedPartResult.productId,
              variantId: state.selectedPartResult.id,
              qty,
              unitPricePence,
            }),
          });
          setStatus("part-search-status", "Part line added.", "ok");
          await loadJob(state.selectedJobId);
          await refreshJobs();
        } catch (error) {
          setStatus("part-search-status", error.message || "Failed to add part line", "error");
        }
      };

      const addLabourLine = async () => {
        if (!state.selectedJobId) {
          setStatus("labour-status", "Select a workshop job first.", "error");
          return;
        }

        const description = (qs("#labour-desc").value || "").trim();
        const qty = Number.parseInt(qs("#labour-qty").value || "", 10);
        const unitPricePence = Number.parseInt(qs("#labour-price").value || "", 10);

        if (!description) {
          setStatus("labour-status", "Labour description is required.", "error");
          return;
        }
        if (!Number.isInteger(qty) || qty <= 0) {
          setStatus("labour-status", "Labour qty must be a positive integer.", "error");
          return;
        }
        if (!Number.isInteger(unitPricePence) || unitPricePence < 0) {
          setStatus("labour-status", "Labour unit price must be a non-negative integer.", "error");
          return;
        }

        setStatus("labour-status", "Adding labour line...");
        try {
          await apiRequest("/api/workshop/jobs/" + encodeURIComponent(state.selectedJobId) + "/lines", {
            method: "POST",
            body: JSON.stringify({
              type: "LABOUR",
              description,
              qty,
              unitPricePence,
            }),
          });
          setStatus("labour-status", "Labour line added.", "ok");
          qs("#labour-desc").value = "";
          await loadJob(state.selectedJobId);
          await refreshJobs();
        } catch (error) {
          setStatus("labour-status", error.message || "Failed to add labour line", "error");
        }
      };

      const finalizeSelectedJob = async () => {
        if (!state.selectedJobId) {
          setStatus("selected-job-status", "Select a workshop job first.", "error");
          return;
        }

        setStatus("selected-job-status", "Finalizing job...");
        try {
          const result = await apiRequest(
            "/api/workshop/jobs/" + encodeURIComponent(state.selectedJobId) + "/finalize",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          );
          setStatus(
            "selected-job-status",
            "Finalized to basket " + result.basket.id + (result.idempotent ? " (already finalized)." : "."),
            "ok",
          );
          await loadJob(state.selectedJobId);
          await refreshJobs();
        } catch (error) {
          setStatus("selected-job-status", error.message || "Failed to finalize job", "error");
        }
      };

      const closeSelectedJob = async () => {
        if (!state.selectedJobId) {
          setStatus("selected-job-status", "Select a workshop job first.", "error");
          return;
        }

        setStatus("selected-job-status", "Closing job...");
        try {
          const result = await apiRequest(
            "/api/workshop/jobs/" + encodeURIComponent(state.selectedJobId) + "/close",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          );
          setStatus(
            "selected-job-status",
            result.idempotent ? "Job was already closed." : "Job closed.",
            "ok",
          );
          await loadJob(state.selectedJobId);
          await refreshJobs();
        } catch (error) {
          setStatus("selected-job-status", error.message || "Failed to close job", "error");
        }
      };

      qs("#create-job")?.addEventListener("click", createJob);
      qs("#refresh-jobs")?.addEventListener("click", refreshJobs);
      qs("#job-search")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          refreshJobs();
        }
      });
      qs("#job-status-filter")?.addEventListener("change", refreshJobs);

      qs("#jobs-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("select-job-btn")) {
          return;
        }
        const jobId = target.getAttribute("data-job-id");
        if (jobId) {
          loadJob(jobId);
        }
      });

      qs("#customer-search-btn")?.addEventListener("click", searchCustomersForJob);
      qs("#customer-search")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchCustomersForJob();
        }
      });
      qs("#customer-search-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("attach-customer-btn")) {
          return;
        }

        const customerId = target.getAttribute("data-customer-id");
        if (customerId) {
          attachCustomerToSelectedJob(customerId);
        }
      });
      qs("#customer-clear-btn")?.addEventListener("click", () => {
        attachCustomerToSelectedJob(null);
      });

      qs("#part-search-btn")?.addEventListener("click", searchPartProducts);
      qs("#part-search")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchPartProducts();
        }
      });
      qs("#part-search-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("select-part-btn")) {
          return;
        }
        const variantId = target.getAttribute("data-variant-id");
        if (!variantId) {
          return;
        }
        state.selectedPartResult =
          state.partResults.find((row) => row.id === variantId) || null;
        renderPartSearchResults();
      });

      qs("#add-part-btn")?.addEventListener("click", addPartLine);
      qs("#add-labour-btn")?.addEventListener("click", addLabourLine);
      qs("#finalize-job")?.addEventListener("click", finalizeSelectedJob);
      qs("#close-job")?.addEventListener("click", closeSelectedJob);

      const initialize = async () => {
        renderJobs();
        renderSelectedJob();
        renderCustomerSearchResults();
        renderPartSearchResults();
        await refreshJobs();
      };

      initialize();
    })();
  </script>
</body>
</html>`;
};
