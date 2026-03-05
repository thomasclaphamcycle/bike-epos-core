export const renderSuppliersPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Suppliers</title>
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
    textarea { min-height: 60px; resize: vertical; }
    button { cursor: pointer; background: #f9fbfc; }
    button.primary { background: var(--accent); color: #fff; border-color: #09566f; }
    .status { margin-top: 6px; min-height: 18px; font-size: 13px; color: var(--muted); }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .grid-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 820px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; vertical-align: middle; }
    th { background: #f1f7fb; }
    @media (max-width: 980px) {
      .grid-two { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1 style="margin: 0 0 4px;" data-testid="suppliers-heading">Suppliers</h1>
      <div style="font-size: 13px; color: var(--muted);">Create, search, and edit suppliers used by purchasing.</div>
      <div class="controls" style="margin-top: 8px;">
        <div class="field" style="min-width: 220px;">
          <label for="supplier-search">Search</label>
          <input id="supplier-search" type="text" placeholder="Name, email, or phone" />
        </div>
        <button id="supplier-load" class="primary" type="button">Load Suppliers</button>
      </div>
      <div id="suppliers-status" class="status"></div>
    </div>

    <div class="grid-two">
      <div class="card">
        <h2 style="margin: 0 0 8px;">Create Supplier</h2>
        <div class="controls">
          <div class="field"><label for="new-name">Name</label><input id="new-name" type="text" /></div>
          <div class="field"><label for="new-email">Email</label><input id="new-email" type="text" /></div>
          <div class="field"><label for="new-phone">Phone</label><input id="new-phone" type="text" /></div>
          <div class="field"><label for="new-lead">Lead Time (days)</label><input id="new-lead" type="number" min="0" step="1" /></div>
        </div>
        <div class="field" style="margin-top: 8px;"><label for="new-notes">Notes</label><textarea id="new-notes"></textarea></div>
        <div class="controls" style="margin-top: 8px;"><button id="supplier-create" class="primary" type="button">Create Supplier</button></div>
        <div id="supplier-create-status" class="status"></div>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 8px;">Edit Supplier</h2>
        <div id="supplier-edit-meta" class="status">Select a supplier from the list.</div>
        <div class="controls">
          <div class="field"><label for="edit-name">Name</label><input id="edit-name" type="text" /></div>
          <div class="field"><label for="edit-email">Email</label><input id="edit-email" type="text" /></div>
          <div class="field"><label for="edit-phone">Phone</label><input id="edit-phone" type="text" /></div>
          <div class="field"><label for="edit-lead">Lead Time (days)</label><input id="edit-lead" type="number" min="0" step="1" /></div>
        </div>
        <div class="field" style="margin-top: 8px;"><label for="edit-notes">Notes</label><textarea id="edit-notes"></textarea></div>
        <div class="controls" style="margin-top: 8px;"><button id="supplier-save" class="primary" type="button">Save Changes</button></div>
        <div id="supplier-edit-status" class="status"></div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Suppliers</h2>
      <div id="suppliers-table" class="table-wrap"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const state = {
        suppliers: [],
        selectedSupplierId: null,
      };

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

      const renderSupplierTable = () => {
        const wrap = qs("#suppliers-table");
        if (!wrap) return;

        if (!Array.isArray(state.suppliers) || state.suppliers.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No suppliers found.</div>';
          return;
        }

        const rows = state.suppliers
          .map((supplier) =>
            '<tr>' +
            '<td>' + supplier.id + '</td>' +
            '<td>' + supplier.name + '</td>' +
            '<td>' + (supplier.email || '-') + '</td>' +
            '<td>' + (supplier.phone || '-') + '</td>' +
            '<td>' + (supplier.leadTimeDays ?? '-') + '</td>' +
            '<td><button type="button" class="supplier-open-btn" data-supplier-id="' + supplier.id + '">Edit</button></td>' +
            '</tr>',
          )
          .join('');

        wrap.innerHTML =
          '<table>' +
          '<thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Lead Time</th><th>Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';
      };

      const renderSelectedSupplier = () => {
        const supplier = state.suppliers.find((row) => row.id === state.selectedSupplierId) || null;
        const meta = qs("#supplier-edit-meta");

        if (!supplier) {
          if (meta) {
            meta.textContent = "Select a supplier from the list.";
          }
          qs("#edit-name").value = "";
          qs("#edit-email").value = "";
          qs("#edit-phone").value = "";
          qs("#edit-lead").value = "";
          qs("#edit-notes").value = "";
          return;
        }

        if (meta) {
          meta.textContent = supplier.name + " (" + supplier.id + ")";
        }

        qs("#edit-name").value = supplier.name || "";
        qs("#edit-email").value = supplier.email || "";
        qs("#edit-phone").value = supplier.phone || "";
        qs("#edit-lead").value = supplier.leadTimeDays ?? "";
        qs("#edit-notes").value = supplier.notes || "";
      };

      const loadSuppliers = async () => {
        const search = (qs("#supplier-search")?.value || "").trim();
        const params = new URLSearchParams();
        if (search) {
          params.set("search", search);
        }
        const query = params.toString() ? "?" + params.toString() : "";

        setStatus("suppliers-status", "Loading suppliers...");
        try {
          const payload = await apiRequest("/api/suppliers" + query);
          state.suppliers = Array.isArray(payload?.suppliers) ? payload.suppliers : [];

          if (state.selectedSupplierId && !state.suppliers.some((row) => row.id === state.selectedSupplierId)) {
            state.selectedSupplierId = null;
          }

          renderSupplierTable();
          renderSelectedSupplier();
          setStatus("suppliers-status", "Loaded " + state.suppliers.length + " supplier(s).", "ok");
        } catch (error) {
          setStatus("suppliers-status", error.message || "Failed to load suppliers", "error");
        }
      };

      const createSupplier = async () => {
        const name = (qs("#new-name")?.value || "").trim();
        const email = (qs("#new-email")?.value || "").trim();
        const phone = (qs("#new-phone")?.value || "").trim();
        const notes = (qs("#new-notes")?.value || "").trim();
        const leadRaw = (qs("#new-lead")?.value || "").trim();

        if (!name) {
          setStatus("supplier-create-status", "Name is required.", "error");
          return;
        }

        let leadTimeDays;
        if (leadRaw) {
          const parsedLead = Number.parseInt(leadRaw, 10);
          if (!Number.isInteger(parsedLead) || parsedLead < 0) {
            setStatus("supplier-create-status", "Lead time must be an integer >= 0.", "error");
            return;
          }
          leadTimeDays = parsedLead;
        }

        setStatus("supplier-create-status", "Creating supplier...");
        try {
          await apiRequest("/api/suppliers", {
            method: "POST",
            body: JSON.stringify({
              name,
              email: email || undefined,
              phone: phone || undefined,
              leadTimeDays,
              notes: notes || undefined,
            }),
          });

          qs("#new-name").value = "";
          qs("#new-email").value = "";
          qs("#new-phone").value = "";
          qs("#new-lead").value = "";
          qs("#new-notes").value = "";

          await loadSuppliers();
          setStatus("supplier-create-status", "Supplier created.", "ok");
        } catch (error) {
          setStatus("supplier-create-status", error.message || "Create failed", "error");
        }
      };

      const saveSupplier = async () => {
        if (!state.selectedSupplierId) {
          setStatus("supplier-edit-status", "Select a supplier first.", "error");
          return;
        }

        const name = (qs("#edit-name")?.value || "").trim();
        const email = (qs("#edit-email")?.value || "").trim();
        const phone = (qs("#edit-phone")?.value || "").trim();
        const notes = (qs("#edit-notes")?.value || "").trim();
        const leadRaw = (qs("#edit-lead")?.value || "").trim();

        if (!name) {
          setStatus("supplier-edit-status", "Name is required.", "error");
          return;
        }

        let leadTimeDays = null;
        if (leadRaw) {
          const parsedLead = Number.parseInt(leadRaw, 10);
          if (!Number.isInteger(parsedLead) || parsedLead < 0) {
            setStatus("supplier-edit-status", "Lead time must be an integer >= 0.", "error");
            return;
          }
          leadTimeDays = parsedLead;
        }

        setStatus("supplier-edit-status", "Saving supplier...");
        try {
          await apiRequest("/api/suppliers/" + encodeURIComponent(state.selectedSupplierId), {
            method: "PATCH",
            body: JSON.stringify({
              name,
              email: email || null,
              phone: phone || null,
              leadTimeDays,
              notes: notes || null,
            }),
          });

          await loadSuppliers();
          setStatus("supplier-edit-status", "Supplier updated.", "ok");
        } catch (error) {
          setStatus("supplier-edit-status", error.message || "Update failed", "error");
        }
      };

      qs("#supplier-load")?.addEventListener("click", () => {
        loadSuppliers();
      });

      qs("#supplier-create")?.addEventListener("click", () => {
        createSupplier();
      });

      qs("#supplier-save")?.addEventListener("click", () => {
        saveSupplier();
      });

      qs("#suppliers-table")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("supplier-open-btn")) {
          return;
        }
        const supplierId = target.getAttribute("data-supplier-id");
        if (!supplierId) {
          return;
        }

        state.selectedSupplierId = supplierId;
        renderSelectedSupplier();
      });

      renderSupplierTable();
      renderSelectedSupplier();
      loadSuppliers();
    })();
  </script>
</body>
</html>`;
