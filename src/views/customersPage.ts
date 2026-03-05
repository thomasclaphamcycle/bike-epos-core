import { escapeHtml } from "../utils/escapeHtml";

type CustomersPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderCustomersPage = (input: CustomersPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Customers</title>
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
    .page { max-width: 1240px; margin: 0 auto; padding: 14px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    h1, h2 { margin: 0 0 8px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 180px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; background: #fff; color: var(--text); }
    button { cursor: pointer; }
    button.primary { background: var(--accent); border-color: #08546f; color: #fff; }
    .status { margin-top: 8px; min-height: 18px; font-size: 13px; color: var(--muted); }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; background: #fff; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; }
    th { background: #f2f7fb; }
    .muted { color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1 data-testid="customers-heading">Customers</h1>
      <div class="muted">Search and create customer profiles.</div>
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
    </div>

    <div class="card">
      <h2>Search</h2>
      <div class="controls">
        <div class="field" style="min-width: 320px;">
          <label for="search-q">Name, email, phone</label>
          <input id="search-q" type="text" placeholder="Search customers" />
        </div>
        <button id="search-btn" class="primary" type="button">Search</button>
      </div>
      <div id="search-status" class="status"></div>
      <div id="search-results" class="table-wrap"></div>
    </div>

    <div class="card">
      <h2>Create Customer</h2>
      <div class="controls">
        <div class="field"><label for="create-name">Name</label><input id="create-name" type="text" /></div>
        <div class="field"><label for="create-email">Email</label><input id="create-email" type="email" /></div>
        <div class="field"><label for="create-phone">Phone</label><input id="create-phone" type="text" /></div>
        <div class="field" style="min-width: 280px;"><label for="create-notes">Notes</label><input id="create-notes" type="text" /></div>
        <button id="create-btn" class="primary" type="button">Create</button>
      </div>
      <div id="create-status" class="status"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const roleInput = qs("#staff-role");
      const staffIdInput = qs("#staff-id");
      roleInput.value = "${initialRole}";
      staffIdInput.value = "${initialStaffId}";

      const state = { customers: [] };

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

      const renderRows = () => {
        const wrap = qs("#search-results");
        if (!wrap) return;

        if (!Array.isArray(state.customers) || state.customers.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px;" class="muted">No customers found.</div>';
          return;
        }

        const rows = state.customers
          .map((customer) =>
            '<tr>' +
            '<td>' + escapeHtml(customer.name || "") + '</td>' +
            '<td>' + escapeHtml(customer.email || "") + '</td>' +
            '<td>' + escapeHtml(customer.phone || "") + '</td>' +
            '<td>' + escapeHtml(customer.updatedAt ? new Date(customer.updatedAt).toLocaleString() : "") + '</td>' +
            '<td><a href="/customers/' + encodeURIComponent(customer.id) + '">Open</a></td>' +
            '</tr>',
          )
          .join("");

        wrap.innerHTML =
          '<table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Updated</th><th>Profile</th></tr></thead><tbody>' +
          rows +
          "</tbody></table>";
      };

      const loadCustomers = async () => {
        const search = (qs("#search-q").value || "").trim();
        const params = new URLSearchParams();
        if (search) {
          params.set("search", search);
        }
        params.set("take", "60");

        setStatus("search-status", "Loading customers...");
        try {
          const payload = await apiRequest("/api/customers?" + params.toString());
          state.customers = Array.isArray(payload?.customers) ? payload.customers : [];
          renderRows();
          setStatus("search-status", "Loaded " + state.customers.length + " customers.", "ok");
        } catch (error) {
          setStatus("search-status", error.message || "Failed to load customers", "error");
        }
      };

      const createCustomer = async () => {
        const name = (qs("#create-name").value || "").trim();
        const email = (qs("#create-email").value || "").trim();
        const phone = (qs("#create-phone").value || "").trim();
        const notes = (qs("#create-notes").value || "").trim();

        if (!name) {
          setStatus("create-status", "name is required", "error");
          return;
        }

        setStatus("create-status", "Creating customer...");
        try {
          const customer = await apiRequest("/api/customers", {
            method: "POST",
            body: JSON.stringify({
              name,
              email: email || undefined,
              phone: phone || undefined,
              notes: notes || undefined,
            }),
          });

          qs("#create-name").value = "";
          qs("#create-email").value = "";
          qs("#create-phone").value = "";
          qs("#create-notes").value = "";

          setStatus("create-status", "Customer created.", "ok");
          await loadCustomers();
          window.location.assign("/customers/" + encodeURIComponent(customer.id));
        } catch (error) {
          setStatus("create-status", error.message || "Failed to create customer", "error");
        }
      };

      qs("#search-btn")?.addEventListener("click", loadCustomers);
      qs("#search-q")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          loadCustomers();
        }
      });
      qs("#create-btn")?.addEventListener("click", createCustomer);

      renderRows();
      loadCustomers();
    })();
  </script>
</body>
</html>`;
};
