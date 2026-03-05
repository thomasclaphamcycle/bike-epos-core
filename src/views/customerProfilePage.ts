import { escapeHtml } from "../utils/escapeHtml";

type CustomerProfilePageInput = {
  customerId: string;
  staffRole: string;
  staffId?: string;
};

export const renderCustomerProfilePage = (input: CustomerProfilePageInput) => {
  const customerId = escapeHtml(input.customerId);
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Customer Profile</title>
  <style>
    :root {
      --bg: #f5f7f9;
      --card: #fff;
      --line: #d5dbe2;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0a6c8f;
      --ok: #256538;
      --danger: #8f1f1f;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .page { max-width: 980px; margin: 0 auto; padding: 14px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    h1, h2 { margin: 0 0 8px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 220px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, button, textarea { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; background: #fff; color: var(--text); }
    textarea { min-height: 70px; resize: vertical; }
    button { cursor: pointer; }
    button.primary { background: var(--accent); border-color: #08546f; color: #fff; }
    .status { margin-top: 8px; min-height: 18px; font-size: 13px; color: var(--muted); }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .meta-grid { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(220px, 1fr)); }
    .meta { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: #fff; }
    .meta .label { font-size: 12px; color: var(--muted); }
    .meta .value { margin-top: 4px; font-size: 14px; }
    .muted { color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1 data-testid="customer-profile-heading">Customer Profile</h1>
      <div class="muted">Customer id: <span id="customer-id">${customerId}</span></div>
      <div class="controls" style="margin-top: 10px;">
        <div class="field">
          <label for="staff-role">X-Staff-Role</label>
          <input id="staff-role" type="text" />
        </div>
        <div class="field">
          <label for="staff-id">X-Staff-Id</label>
          <input id="staff-id" type="text" />
        </div>
      </div>
      <div id="profile-status" class="status"></div>
    </div>

    <div class="card">
      <h2>Details</h2>
      <div id="profile-meta" class="meta-grid"></div>
    </div>

    <div class="card">
      <h2>Edit</h2>
      <div class="controls">
        <div class="field"><label for="edit-name">Name</label><input id="edit-name" type="text" /></div>
        <div class="field"><label for="edit-email">Email</label><input id="edit-email" type="email" /></div>
        <div class="field"><label for="edit-phone">Phone</label><input id="edit-phone" type="text" /></div>
      </div>
      <div class="controls" style="margin-top: 8px;">
        <div class="field" style="min-width: 480px;"><label for="edit-notes">Notes</label><textarea id="edit-notes"></textarea></div>
      </div>
      <div class="controls" style="margin-top: 8px;">
        <button id="save-btn" class="primary" type="button">Save</button>
        <a href="/customers">Back to Customers</a>
      </div>
      <div id="save-status" class="status"></div>
    </div>

    <div class="card">
      <h2>Recent Sales</h2>
      <div class="controls">
        <div class="field">
          <label for="sales-from">From</label>
          <input id="sales-from" type="date" />
        </div>
        <div class="field">
          <label for="sales-to">To</label>
          <input id="sales-to" type="date" />
        </div>
        <button id="sales-load-btn" type="button">Load Sales</button>
      </div>
      <div id="sales-status" class="status"></div>
      <div id="sales-table" class="status"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const roleInput = qs("#staff-role");
      const staffIdInput = qs("#staff-id");
      roleInput.value = "${initialRole}";
      staffIdInput.value = "${initialStaffId}";

      const customerId = "${customerId}";
      let currentCustomer = null;
      let customerSales = [];

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
        if (staffId) {
          headers["X-Staff-Id"] = staffId;
        }
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

      const renderMeta = () => {
        const wrap = qs("#profile-meta");
        if (!wrap) return;

        if (!currentCustomer) {
          wrap.innerHTML = '<div class="muted">No customer loaded.</div>';
          return;
        }

        const c = currentCustomer;
        wrap.innerHTML = [
          { label: "Name", value: c.name || "-" },
          { label: "Email", value: c.email || "-" },
          { label: "Phone", value: c.phone || "-" },
          { label: "Created", value: c.createdAt ? new Date(c.createdAt).toLocaleString() : "-" },
          { label: "Updated", value: c.updatedAt ? new Date(c.updatedAt).toLocaleString() : "-" },
          { label: "Notes", value: c.notes || "-" },
        ].map((entry) =>
          '<div class="meta"><div class="label">' + escapeHtml(entry.label) + '</div><div class="value">' + escapeHtml(entry.value) + '</div></div>',
        ).join("");

        qs("#edit-name").value = c.name || "";
        qs("#edit-email").value = c.email || "";
        qs("#edit-phone").value = c.phone || "";
        qs("#edit-notes").value = c.notes || "";
      };

      const formatMoney = (pence) => "£" + ((Number(pence || 0) / 100).toFixed(2));

      const renderSales = () => {
        const wrap = qs("#sales-table");
        if (!wrap) return;

        if (!Array.isArray(customerSales) || customerSales.length === 0) {
          wrap.innerHTML = '<div class="muted">No completed sales found for this customer.</div>';
          return;
        }

        const rows = customerSales
          .map((sale) =>
            '<tr>' +
            '<td>' + escapeHtml(sale.id) + '</td>' +
            '<td>' + escapeHtml(sale.completedAt ? new Date(sale.completedAt).toLocaleString() : "-") + '</td>' +
            '<td>' + escapeHtml(formatMoney(sale.totalPence)) + '</td>' +
            '<td>' +
            (sale.receiptNumber
              ? '<a href="/r/' + encodeURIComponent(sale.receiptNumber) + '">' + escapeHtml(sale.receiptNumber) + "</a>"
              : "-") +
            "</td>" +
            "</tr>",
          )
          .join("");

        wrap.innerHTML =
          '<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; min-width: 520px;">' +
          '<thead><tr><th style="text-align:left; border-bottom:1px solid #d5dbe2; padding:7px 9px; background:#f2f7fb;">Sale ID</th><th style="text-align:left; border-bottom:1px solid #d5dbe2; padding:7px 9px; background:#f2f7fb;">Completed</th><th style="text-align:left; border-bottom:1px solid #d5dbe2; padding:7px 9px; background:#f2f7fb;">Total</th><th style="text-align:left; border-bottom:1px solid #d5dbe2; padding:7px 9px; background:#f2f7fb;">Receipt</th></tr></thead>' +
          '<tbody>' + rows + "</tbody></table></div>";
      };

      const loadCustomerSales = async () => {
        const params = new URLSearchParams();
        const from = (qs("#sales-from").value || "").trim();
        const to = (qs("#sales-to").value || "").trim();
        if (from) params.set("from", from);
        if (to) params.set("to", to);

        setStatus("sales-status", "Loading customer sales...");
        try {
          const payload = await apiRequest(
            "/api/customers/" + encodeURIComponent(customerId) + "/sales" +
              (params.toString() ? "?" + params.toString() : ""),
          );
          customerSales = Array.isArray(payload?.sales) ? payload.sales : [];
          renderSales();
          setStatus("sales-status", "Loaded " + customerSales.length + " sale(s).", "ok");
        } catch (error) {
          setStatus("sales-status", error.message || "Could not load customer sales", "error");
        }
      };

      const loadCustomer = async () => {
        setStatus("profile-status", "Loading customer profile...");
        try {
          currentCustomer = await apiRequest("/api/customers/" + encodeURIComponent(customerId));
          renderMeta();
          setStatus("profile-status", "Customer profile loaded.", "ok");
          await loadCustomerSales();
        } catch (error) {
          setStatus("profile-status", error.message || "Could not load customer profile", "error");
        }
      };

      const saveCustomer = async () => {
        if (!currentCustomer) {
          setStatus("save-status", "Customer is not loaded yet", "error");
          return;
        }

        const name = (qs("#edit-name").value || "").trim();
        if (!name) {
          setStatus("save-status", "name cannot be empty", "error");
          return;
        }

        setStatus("save-status", "Saving profile...");
        try {
          const payload = {
            name,
            email: (qs("#edit-email").value || "").trim() || null,
            phone: (qs("#edit-phone").value || "").trim() || null,
            notes: (qs("#edit-notes").value || "").trim() || null,
          };
          currentCustomer = await apiRequest("/api/customers/" + encodeURIComponent(customerId), {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          renderMeta();
          setStatus("save-status", "Profile updated.", "ok");
          setStatus("profile-status", "Customer profile loaded.", "ok");
        } catch (error) {
          setStatus("save-status", error.message || "Could not update profile", "error");
        }
      };

      qs("#save-btn")?.addEventListener("click", saveCustomer);
      qs("#sales-load-btn")?.addEventListener("click", loadCustomerSales);
      const today = new Date();
      const toDate = today.toISOString().slice(0, 10);
      const fromDate = new Date(today.getTime() - (1000 * 60 * 60 * 24 * 30))
        .toISOString()
        .slice(0, 10);
      qs("#sales-from").value = fromDate;
      qs("#sales-to").value = toDate;
      renderSales();
      loadCustomer();
    })();
  </script>
</body>
</html>`;
};
