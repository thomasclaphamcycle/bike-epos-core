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
      <div class="controls">
        <div class="field">
          <label for="line-type">Type</label>
          <select id="line-type">
            <option value="LABOUR">LABOUR</option>
            <option value="PART">PART</option>
          </select>
        </div>
        <div class="field" style="min-width: 320px;">
          <label for="line-description">Description</label>
          <input id="line-description" type="text" />
        </div>
        <div class="field">
          <label for="line-quantity">Quantity</label>
          <input id="line-quantity" type="number" min="1" step="1" value="1" />
        </div>
        <div class="field">
          <label for="line-unit-price">Unit Price (GBP)</label>
          <input id="line-unit-price" type="number" min="0" step="0.01" value="0.00" />
        </div>
        <div class="field" style="min-width: 220px;">
          <label for="line-product-id">Product Id (optional PART)</label>
          <input id="line-product-id" type="text" placeholder="UUID" />
        </div>
        <button id="line-add-btn" class="primary" type="button">Add Line</button>
      </div>
      <div id="line-status" class="status"></div>
      <div id="line-totals" class="status"></div>
      <div id="parts-status" class="status"></div>
      <div id="lines-wrap" class="table-wrap"></div>
      <h3 style="margin-top: 12px;">Part Reservations</h3>
      <div class="controls">
        <div class="field" style="min-width: 260px;">
          <label for="reservation-product-id">Product Id</label>
          <input id="reservation-product-id" type="text" placeholder="Product UUID" />
        </div>
        <div class="field">
          <label for="reservation-quantity">Quantity</label>
          <input id="reservation-quantity" type="number" min="1" step="1" value="1" />
        </div>
        <button id="reservation-add-btn" type="button">Reserve Stock</button>
      </div>
      <div id="reservation-status" class="status"></div>
      <div id="reservations-wrap" class="table-wrap"></div>
      <div class="controls" style="margin-top: 10px;">
        <button id="convert-sale-btn" class="primary" type="button">Create Invoice (MANAGER+)</button>
        <a id="convert-sale-link" href="#" style="display:none;">Open Invoice in POS</a>
      </div>
      <div id="convert-sale-status" class="status"></div>
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

      const formatMoney = (pence) => "£" + ((Number(pence || 0) / 100).toFixed(2));

      const canConvertToSale = () => {
        const role = String(roleInput.value || "STAFF").trim().toUpperCase();
        return role === "MANAGER" || role === "ADMIN";
      };

      const updateConvertButtonVisibility = () => {
        const btn = qs("#convert-sale-btn");
        if (!(btn instanceof HTMLButtonElement)) {
          return;
        }
        btn.style.display = canConvertToSale() ? "inline-block" : "none";
      };

      const setSaleLink = (saleId, saleUrl) => {
        const link = qs("#convert-sale-link");
        if (!(link instanceof HTMLAnchorElement)) {
          return;
        }
        if (!saleId) {
          link.style.display = "none";
          link.removeAttribute("href");
          link.textContent = "";
          return;
        }

        link.href = saleUrl || ("/pos?saleId=" + encodeURIComponent(saleId));
        link.style.display = "inline";
        link.textContent = "Open Invoice in POS";
      };

      const renderJob = () => {
        const meta = qs("#job-meta");
        const linesWrap = qs("#lines-wrap");
        const lineTotals = qs("#line-totals");
        const partsStatus = qs("#parts-status");
        const reservationsWrap = qs("#reservations-wrap");
        if (!meta || !linesWrap || !reservationsWrap) return;

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
          { label: "Invoice Sale", value: job.saleId || "-" },
          { label: "Parts Status", value: jobPayload?.partsStatus || "OK" },
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
        const reservations = Array.isArray(jobPayload?.reservations) ? jobPayload.reservations : [];
        const totals = jobPayload?.totals || { subtotalPence: 0, taxPence: 0, totalPence: 0 };
        const partsStatusValue = jobPayload?.partsStatus || "OK";
        setSaleLink(job.saleId || null, job.saleId ? "/pos?saleId=" + encodeURIComponent(job.saleId) : null);
        if (lineTotals) {
          lineTotals.innerHTML =
            "Subtotal: " + escapeHtml(formatMoney(totals.subtotalPence)) +
            " | Tax: " + escapeHtml(formatMoney(totals.taxPence)) +
            " | Total: " + escapeHtml(formatMoney(totals.totalPence));
        }
        if (partsStatus) {
          partsStatus.textContent = "Parts status: " + partsStatusValue;
          partsStatus.classList.remove("ok", "error");
          partsStatus.classList.add(partsStatusValue === "OK" ? "ok" : "error");
        }
        if (lines.length === 0) {
          linesWrap.innerHTML = '<div style="padding: 10px;">No lines.</div>';
        } else {
          const rows = lines
            .map((line) =>
              '<tr>' +
              '<td>' + escapeHtml(line.type) + '</td>' +
              '<td><input type="text" class="line-description-input" data-line-id="' + escapeHtml(line.id) + '" value="' + escapeHtml(line.description || "") + '" /></td>' +
              '<td>' + escapeHtml(line.variantSku || "-") + '</td>' +
              '<td><input type="number" min="1" step="1" class="line-qty-input" data-line-id="' + escapeHtml(line.id) + '" value="' + escapeHtml(String(line.qty || 0)) + '" /></td>' +
              '<td><input type="number" min="0" step="0.01" class="line-price-input" data-line-id="' + escapeHtml(line.id) + '" value="' + ((Number(line.unitPricePence || 0) / 100).toFixed(2)) + '" /></td>' +
              '<td>' + escapeHtml(formatMoney(line.lineTotalPence || 0)) + '</td>' +
              '<td>' +
              '<button type="button" class="line-save-btn" data-line-id="' + escapeHtml(line.id) + '">Save</button> ' +
              '<button type="button" class="line-delete-btn" data-line-id="' + escapeHtml(line.id) + '">Delete</button>' +
              '</td>' +
              "</tr>",
            )
            .join("");
          linesWrap.innerHTML =
            '<table><thead><tr><th>Type</th><th>Description</th><th>SKU</th><th>Qty</th><th>Unit (GBP)</th><th>Line Total</th><th>Actions</th></tr></thead><tbody>' +
            rows +
            "</tbody></table>";
        }

        if (reservations.length === 0) {
          reservationsWrap.innerHTML = '<div style="padding: 10px;">No reservations.</div>';
        } else {
          const reservationRows = reservations
            .map((reservation) =>
              '<tr>' +
              '<td>' + escapeHtml(reservation.productName || reservation.productId || "-") + '</td>' +
              '<td>' + escapeHtml(reservation.variantSku || "-") + '</td>' +
              '<td>' + escapeHtml(String(reservation.quantity || 0)) + '</td>' +
              '<td>' + escapeHtml(new Date(reservation.createdAt).toLocaleString()) + '</td>' +
              '<td><button type="button" class="reservation-delete-btn" data-reservation-id="' + escapeHtml(reservation.id) + '">Delete</button></td>' +
              "</tr>",
            )
            .join("");
          reservationsWrap.innerHTML =
            '<table><thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Created</th><th>Action</th></tr></thead><tbody>' +
            reservationRows +
            "</tbody></table>";
        }
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

      const addLine = async () => {
        const type = (qs("#line-type").value || "").trim();
        const description = (qs("#line-description").value || "").trim();
        const quantity = Number.parseInt(qs("#line-quantity").value || "", 10);
        const unitPrice = Number.parseFloat(qs("#line-unit-price").value || "");
        const productId = (qs("#line-product-id").value || "").trim();

        if (!description) {
          setStatus("line-status", "Line description is required.", "error");
          return;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          setStatus("line-status", "Quantity must be a positive integer.", "error");
          return;
        }
        if (Number.isNaN(unitPrice) || unitPrice < 0) {
          setStatus("line-status", "Unit price must be >= 0.", "error");
          return;
        }
        if (type === "PART" && !productId) {
          setStatus("line-status", "PART lines require productId in this flow.", "error");
          return;
        }

        setStatus("line-status", "Adding line...");
        try {
          await apiRequest("/api/workshop/jobs/" + encodeURIComponent(jobId) + "/lines", {
            method: "POST",
            body: JSON.stringify({
              type,
              description,
              quantity,
              unitPrice,
              productId: productId || undefined,
            }),
          });
          qs("#line-description").value = "";
          qs("#line-product-id").value = "";
          qs("#line-quantity").value = "1";
          qs("#line-unit-price").value = "0.00";
          await loadJob();
          setStatus("line-status", "Line added.", "ok");
        } catch (error) {
          setStatus("line-status", error.message || "Failed to add line", "error");
        }
      };

      const saveLine = async (lineId) => {
        const descriptionInput = qs('.line-description-input[data-line-id="' + lineId + '"]');
        const qtyInput = qs('.line-qty-input[data-line-id="' + lineId + '"]');
        const priceInput = qs('.line-price-input[data-line-id="' + lineId + '"]');
        if (!(descriptionInput instanceof HTMLInputElement)) return;
        if (!(qtyInput instanceof HTMLInputElement)) return;
        if (!(priceInput instanceof HTMLInputElement)) return;

        const description = (descriptionInput.value || "").trim();
        const quantity = Number.parseInt(qtyInput.value || "", 10);
        const unitPrice = Number.parseFloat(priceInput.value || "");
        if (!description) {
          setStatus("line-status", "Description cannot be empty.", "error");
          return;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          setStatus("line-status", "Quantity must be a positive integer.", "error");
          return;
        }
        if (Number.isNaN(unitPrice) || unitPrice < 0) {
          setStatus("line-status", "Unit price must be >= 0.", "error");
          return;
        }

        setStatus("line-status", "Saving line...");
        try {
          await apiRequest(
            "/api/workshop/jobs/" + encodeURIComponent(jobId) + "/lines/" + encodeURIComponent(lineId),
            {
              method: "PATCH",
              body: JSON.stringify({
                description,
                quantity,
                unitPrice,
              }),
            },
          );
          await loadJob();
          setStatus("line-status", "Line updated.", "ok");
        } catch (error) {
          setStatus("line-status", error.message || "Failed to save line", "error");
        }
      };

      const deleteLine = async (lineId) => {
        setStatus("line-status", "Deleting line...");
        try {
          await apiRequest(
            "/api/workshop/jobs/" + encodeURIComponent(jobId) + "/lines/" + encodeURIComponent(lineId),
            {
              method: "DELETE",
            },
          );
          await loadJob();
          setStatus("line-status", "Line deleted.", "ok");
        } catch (error) {
          setStatus("line-status", error.message || "Failed to delete line", "error");
        }
      };

      const addReservation = async () => {
        const productId = (qs("#reservation-product-id").value || "").trim();
        const quantity = Number.parseInt(qs("#reservation-quantity").value || "", 10);

        if (!productId) {
          setStatus("reservation-status", "Product id is required.", "error");
          return;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          setStatus("reservation-status", "Quantity must be a positive integer.", "error");
          return;
        }

        setStatus("reservation-status", "Reserving stock...");
        try {
          await apiRequest("/api/workshop/jobs/" + encodeURIComponent(jobId) + "/reservations", {
            method: "POST",
            body: JSON.stringify({
              productId,
              quantity,
            }),
          });
          qs("#reservation-product-id").value = "";
          qs("#reservation-quantity").value = "1";
          await loadJob();
          setStatus("reservation-status", "Stock reserved.", "ok");
        } catch (error) {
          setStatus("reservation-status", error.message || "Failed to reserve stock", "error");
        }
      };

      const deleteReservation = async (reservationId) => {
        setStatus("reservation-status", "Deleting reservation...");
        try {
          await apiRequest(
            "/api/workshop/jobs/" + encodeURIComponent(jobId) + "/reservations/" + encodeURIComponent(reservationId),
            {
              method: "DELETE",
            },
          );
          await loadJob();
          setStatus("reservation-status", "Reservation deleted.", "ok");
        } catch (error) {
          setStatus("reservation-status", error.message || "Failed to delete reservation", "error");
        }
      };

      const convertToSale = async () => {
        if (!canConvertToSale()) {
          setStatus("convert-sale-status", "Create Invoice requires MANAGER+.", "error");
          return;
        }

        setStatus("convert-sale-status", "Creating invoice sale...");
        try {
          const payload = await apiRequest(
            "/api/workshop/jobs/" + encodeURIComponent(jobId) + "/convert-to-sale",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          );
          if (payload?.saleId) {
            setSaleLink(payload.saleId, payload.saleUrl || null);
          }
          await loadJob();
          setStatus(
            "convert-sale-status",
            payload?.idempotent
              ? "Invoice already existed. POS link is ready."
              : "Invoice created. POS link is ready.",
            "ok",
          );
        } catch (error) {
          setStatus("convert-sale-status", error.message || "Failed to create invoice", "error");
        }
      };

      qs("#save-status-btn")?.addEventListener("click", saveStatus);
      qs("#save-notes-btn")?.addEventListener("click", saveNotesAndTitle);
      qs("#line-add-btn")?.addEventListener("click", addLine);
      qs("#reservation-add-btn")?.addEventListener("click", addReservation);
      qs("#convert-sale-btn")?.addEventListener("click", convertToSale);
      roleInput.addEventListener("change", updateConvertButtonVisibility);
      qs("#lines-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        const lineId = target.getAttribute("data-line-id");
        if (!lineId) return;
        if (target.classList.contains("line-save-btn")) {
          saveLine(lineId);
        }
        if (target.classList.contains("line-delete-btn")) {
          deleteLine(lineId);
        }
      });
      qs("#reservations-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        if (!target.classList.contains("reservation-delete-btn")) return;
        const reservationId = target.getAttribute("data-reservation-id");
        if (!reservationId) return;
        deleteReservation(reservationId);
      });
      updateConvertButtonVisibility();
      renderJob();
      loadJob();
    })();
  </script>
</body>
</html>`;
};
