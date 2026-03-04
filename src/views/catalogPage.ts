const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type CatalogPageInput = {
  staffRole: string;
  staffId?: string;
};

export const renderCatalogPage = (input: CatalogPageInput) => {
  const initialRole = escapeHtml(input.staffRole || "STAFF");
  const initialStaffId = escapeHtml(input.staffId ?? "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Product Catalog</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #ffffff;
      --text: #1d2329;
      --muted: #5a6672;
      --line: #d9e0e6;
      --accent: #0f6b8f;
      --danger-bg: #fff2f2;
      --danger-text: #8b1f1f;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    .page {
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .top-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    h1, h2 {
      margin: 0 0 10px;
    }
    .muted {
      color: var(--muted);
      font-size: 14px;
    }
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: end;
    }
    .field {
      display: grid;
      gap: 6px;
      min-width: 160px;
    }
    .field label {
      font-size: 13px;
      color: var(--muted);
    }
    input, select, button, textarea {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 14px;
      background: #fff;
      color: var(--text);
    }
    textarea {
      min-height: 68px;
      resize: vertical;
    }
    button {
      cursor: pointer;
      background: #f8fbfd;
    }
    button.primary {
      background: var(--accent);
      color: #fff;
      border-color: #0b5b79;
    }
    .status {
      margin-top: 8px;
      font-size: 14px;
      color: var(--muted);
      min-height: 18px;
    }
    .status.error {
      color: var(--danger-text);
      background: var(--danger-bg);
      border: 1px solid #f3c9c9;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .grid-two {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 12px;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      margin-top: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1080px;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      font-size: 13px;
      vertical-align: middle;
    }
    th {
      background: #f5f9fc;
      font-weight: 600;
      color: #2a3a49;
    }
    td input[type="text"], td input[type="number"] {
      width: 140px;
      max-width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      font-size: 13px;
    }
    .row-status {
      color: var(--muted);
      font-size: 12px;
      min-width: 140px;
    }
    .row-status.error {
      color: var(--danger-text);
    }
    .empty {
      padding: 14px;
      color: var(--muted);
      font-size: 14px;
    }
    .manager-note {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    @media (max-width: 768px) {
      .page {
        padding: 12px;
      }
      table {
        min-width: 960px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="topbar">
        <div>
          <h1>Catalog</h1>
          <div class="muted">Retail product and variant maintenance (M25).</div>
        </div>
        <div class="top-actions">
          <a href="/reports">Reports</a>
          <div class="field">
            <label for="staff-role">X-Staff-Role</label>
            <select id="staff-role">
              <option value="STAFF">STAFF</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div class="field">
            <label for="staff-id">X-Staff-Id (optional)</label>
            <input id="staff-id" type="text" placeholder="staff-1" />
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Variants</h2>
      <div class="controls">
        <div class="field">
          <label for="catalog-q">Search</label>
          <input id="catalog-q" type="text" placeholder="SKU, barcode, product, brand" />
        </div>
        <div class="field">
          <label for="catalog-active">Active</label>
          <select id="catalog-active">
            <option value="">All</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>
        <div class="field">
          <label for="catalog-take">Page Size</label>
          <select id="catalog-take">
            <option value="50">50</option>
            <option value="100" selected>100</option>
            <option value="200">200</option>
          </select>
        </div>
        <button id="catalog-load" class="primary" type="button">Load</button>
      </div>
      <div id="catalog-status" class="status">Loading variants...</div>
      <div id="catalog-table-wrap" class="table-wrap"></div>
      <div class="manager-note">Create and edit actions require MANAGER+ role.</div>
    </div>

    <div class="grid-two">
      <div class="card">
        <h2>Create Product</h2>
        <div class="controls">
          <div class="field">
            <label for="product-name">Name</label>
            <input id="product-name" type="text" placeholder="Road Tube" />
          </div>
          <div class="field">
            <label for="product-brand">Brand</label>
            <input id="product-brand" type="text" placeholder="Continental" />
          </div>
          <div class="field" style="min-width: 240px;">
            <label for="product-description">Description</label>
            <textarea id="product-description" placeholder="Optional"></textarea>
          </div>
          <div class="field">
            <label for="product-active">Active</label>
            <select id="product-active">
              <option value="1" selected>Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
          <button id="product-create" class="primary" type="button">Create Product</button>
        </div>
        <div id="product-status" class="status"></div>
      </div>

      <div class="card">
        <h2>Add Variant</h2>
        <div class="controls">
          <div class="field">
            <label for="variant-product">Product</label>
            <select id="variant-product"></select>
          </div>
          <div class="field">
            <label for="variant-sku">SKU</label>
            <input id="variant-sku" type="text" placeholder="TUBE-700X25" />
          </div>
          <div class="field">
            <label for="variant-barcode">Barcode</label>
            <input id="variant-barcode" type="text" placeholder="Optional" />
          </div>
          <div class="field">
            <label for="variant-price">Retail Price (£)</label>
            <input id="variant-price" type="number" min="0" step="0.01" placeholder="6.99" />
          </div>
          <div class="field">
            <label for="variant-active">Active</label>
            <select id="variant-active">
              <option value="1" selected>Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
          <button id="variant-create" class="primary" type="button">Create Variant</button>
        </div>
        <div id="variant-status" class="status"></div>
      </div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);

      const roleInput = qs("#staff-role");
      const staffIdInput = qs("#staff-id");
      roleInput.value = ["STAFF", "MANAGER", "ADMIN"].includes("${initialRole}")
        ? "${initialRole}"
        : "STAFF";
      staffIdInput.value = "${initialStaffId}";

      const state = {
        products: [],
        variants: [],
      };

      const setStatus = (id, message, isError = false) => {
        const el = qs("#" + id);
        if (!el) {
          return;
        }
        el.textContent = message;
        if (isError) {
          el.classList.add("error");
        } else {
          el.classList.remove("error");
        }
      };

      const getHeaders = () => {
        const headers = { "X-Staff-Role": roleInput.value || "STAFF" };
        const staffId = (staffIdInput.value || "").trim();
        if (staffId) {
          headers["X-Staff-Id"] = staffId;
        }
        return headers;
      };

      const getErrorMessage = (payload, fallback) =>
        payload?.error?.message || payload?.error || fallback;

      const canWrite = () => roleInput.value === "MANAGER" || roleInput.value === "ADMIN";
      const escapeCell = (value) =>
        String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll("\"", "&quot;")
          .replaceAll("'", "&#39;");

      const apiRequest = async (path, options = {}) => {
        const response = await fetch(path, {
          ...options,
          headers: {
            "Content-Type": "application/json",
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
          const err = new Error(getErrorMessage(payload, "Request failed (" + response.status + ")"));
          err.status = response.status;
          err.payload = payload;
          throw err;
        }

        return payload;
      };

      const toDisplayPrice = (variant) => {
        if (variant.retailPrice !== undefined && variant.retailPrice !== null) {
          return String(variant.retailPrice);
        }
        if (typeof variant.retailPricePence === "number") {
          return (variant.retailPricePence / 100).toFixed(2);
        }
        return "0.00";
      };

      const renderProductsSelect = () => {
        const select = qs("#variant-product");
        if (!select) {
          return;
        }

        if (state.products.length === 0) {
          select.innerHTML = '<option value="">No products yet</option>';
          return;
        }

        select.innerHTML = state.products
          .map((product) => {
            const brand = product.brand ? " - " + product.brand : "";
            return (
              '<option value="' +
              escapeCell(product.id) +
              '">' +
              escapeCell(product.name + brand) +
              "</option>"
            );
          })
          .join("");
      };

      const renderVariantTable = () => {
        const wrap = qs("#catalog-table-wrap");
        if (!wrap) {
          return;
        }

        if (state.variants.length === 0) {
          wrap.innerHTML = '<div class="empty">No variants found for current filters.</div>';
          return;
        }

        const rows = state.variants
          .map((variant) => {
            const productName = variant.product?.name || "Unknown";
            const brand = variant.product?.brand || "";
            const barcode = variant.barcode || "";
            const option = variant.option || variant.name || "";
            return (
              '<tr data-variant-id=\"' + escapeCell(variant.id) + '\">' +
              '<td>' + escapeCell(productName) + '</td>' +
              '<td>' + escapeCell(brand) + '</td>' +
              '<td>' + escapeCell(option) + '</td>' +
              '<td><input type=\"text\" data-field=\"sku\" value=\"' + escapeCell(variant.sku || \"\") + '\" /></td>' +
              '<td><input type=\"text\" data-field=\"barcode\" value=\"' + escapeCell(barcode) + '\" placeholder=\"(none)\" /></td>' +
              '<td><input type=\"number\" min=\"0\" step=\"0.01\" data-field=\"retailPrice\" value=\"' +
              escapeCell(toDisplayPrice(variant)) +
              '\" /></td>' +
              '<td><input type=\"checkbox\" data-field=\"isActive\" ' +
              (variant.isActive ? 'checked' : '') +
              ' /></td>' +
              '<td><button type=\"button\" class=\"row-save\" data-variant-id=\"' +
              escapeCell(variant.id) +
              '\">Save</button></td>' +
              '<td class=\"row-status\" data-status-for=\"' +
              escapeCell(variant.id) +
              '\"></td>' +
              '</tr>'
            );
          })
          .join("");

        wrap.innerHTML =
          '<table>' +
          '<thead>' +
          '<tr>' +
          '<th>Product</th>' +
          '<th>Brand</th>' +
          '<th>Option/Name</th>' +
          '<th>SKU</th>' +
          '<th>Barcode</th>' +
          '<th>Retail Price (£)</th>' +
          '<th>Active</th>' +
          '<th>Actions</th>' +
          '<th>Result</th>' +
          '</tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
          '</table>';

        const rowButtons = wrap.querySelectorAll(".row-save");
        rowButtons.forEach((button) => {
          button.disabled = !canWrite();
        });
      };

      const setRowStatus = (variantId, message, isError = false) => {
        const cell = qs('[data-status-for="' + variantId + '"]');
        if (!cell) {
          return;
        }
        cell.textContent = message;
        if (isError) {
          cell.classList.add("error");
        } else {
          cell.classList.remove("error");
        }
      };

      const loadProducts = async () => {
        const payload = await apiRequest("/api/products?take=200&skip=0");
        state.products = Array.isArray(payload?.products) ? payload.products : [];
        renderProductsSelect();
      };

      const loadVariants = async () => {
        setStatus("catalog-status", "Loading variants...");

        const q = (qs("#catalog-q").value || "").trim();
        const active = qs("#catalog-active").value;
        const take = qs("#catalog-take").value || "100";

        const params = new URLSearchParams();
        params.set("take", take);
        params.set("skip", "0");
        if (q) {
          params.set("q", q);
        }
        if (active === "1" || active === "0") {
          params.set("active", active);
        }

        try {
          const payload = await apiRequest("/api/variants?" + params.toString());
          state.variants = Array.isArray(payload?.variants) ? payload.variants : [];
          renderVariantTable();
          setStatus("catalog-status", "Loaded " + state.variants.length + " variants.");
        } catch (error) {
          setStatus("catalog-status", error.message || "Failed to load variants", true);
        }
      };

      const createProduct = async () => {
        if (!canWrite()) {
          setStatus("product-status", "MANAGER+ role required for product changes.", true);
          return;
        }

        const name = (qs("#product-name").value || "").trim();
        const brand = (qs("#product-brand").value || "").trim();
        const description = (qs("#product-description").value || "").trim();
        const isActive = qs("#product-active").value === "1";

        if (!name) {
          setStatus("product-status", "Name is required.", true);
          return;
        }

        setStatus("product-status", "Creating product...");

        try {
          await apiRequest("/api/products", {
            method: "POST",
            body: JSON.stringify({
              name,
              brand: brand || undefined,
              description: description || undefined,
              isActive,
            }),
          });
          qs("#product-name").value = "";
          qs("#product-brand").value = "";
          qs("#product-description").value = "";
          setStatus("product-status", "Product created.");
          await loadProducts();
          await loadVariants();
        } catch (error) {
          setStatus("product-status", error.message || "Failed to create product", true);
        }
      };

      const createVariant = async () => {
        if (!canWrite()) {
          setStatus("variant-status", "MANAGER+ role required for variant changes.", true);
          return;
        }

        const productId = qs("#variant-product").value;
        const sku = (qs("#variant-sku").value || "").trim();
        const barcode = (qs("#variant-barcode").value || "").trim();
        const retailPrice = (qs("#variant-price").value || "").trim();
        const isActive = qs("#variant-active").value === "1";

        if (!productId) {
          setStatus("variant-status", "Select a product first.", true);
          return;
        }
        if (sku.length < 2) {
          setStatus("variant-status", "SKU must be at least 2 characters.", true);
          return;
        }
        if (!retailPrice) {
          setStatus("variant-status", "Retail price is required.", true);
          return;
        }

        setStatus("variant-status", "Creating variant...");

        try {
          await apiRequest("/api/products/" + encodeURIComponent(productId) + "/variants", {
            method: "POST",
            body: JSON.stringify({
              sku,
              barcode: barcode || undefined,
              retailPrice,
              isActive,
            }),
          });

          qs("#variant-sku").value = "";
          qs("#variant-barcode").value = "";
          qs("#variant-price").value = "";
          setStatus("variant-status", "Variant created.");
          await loadVariants();
        } catch (error) {
          setStatus("variant-status", error.message || "Failed to create variant", true);
        }
      };

      const saveVariantRow = async (button) => {
        if (!canWrite()) {
          setStatus("catalog-status", "MANAGER+ role required for variant changes.", true);
          return;
        }

        const variantId = button.getAttribute("data-variant-id");
        const row = button.closest("tr");
        if (!variantId || !row) {
          return;
        }

        const skuInput = row.querySelector('input[data-field="sku"]');
        const barcodeInput = row.querySelector('input[data-field="barcode"]');
        const priceInput = row.querySelector('input[data-field="retailPrice"]');
        const activeInput = row.querySelector('input[data-field="isActive"]');

        const sku = (skuInput?.value || "").trim();
        const barcode = (barcodeInput?.value || "").trim();
        const retailPrice = (priceInput?.value || "").trim();
        const isActive = Boolean(activeInput?.checked);

        if (sku.length < 2) {
          setRowStatus(variantId, "SKU must be at least 2 chars", true);
          return;
        }
        if (!retailPrice) {
          setRowStatus(variantId, "Retail price is required", true);
          return;
        }

        setRowStatus(variantId, "Saving...");

        try {
          const updated = await apiRequest("/api/variants/" + encodeURIComponent(variantId), {
            method: "PATCH",
            body: JSON.stringify({
              sku,
              barcode: barcode.length > 0 ? barcode : null,
              retailPrice,
              isActive,
            }),
          });

          const idx = state.variants.findIndex((v) => v.id === variantId);
          if (idx >= 0) {
            state.variants[idx] = updated;
          }
          setRowStatus(variantId, "Saved");
        } catch (error) {
          setRowStatus(variantId, error.message || "Save failed", true);
        }
      };

      qs("#catalog-load")?.addEventListener("click", () => {
        loadVariants();
      });
      qs("#catalog-q")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          loadVariants();
        }
      });
      qs("#product-create")?.addEventListener("click", () => {
        createProduct();
      });
      qs("#variant-create")?.addEventListener("click", () => {
        createVariant();
      });

      qs("#catalog-table-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.classList.contains("row-save")) {
          return;
        }
        saveVariantRow(target);
      });

      const refreshAll = async () => {
        const productCreateButton = qs("#product-create");
        const variantCreateButton = qs("#variant-create");
        if (productCreateButton) {
          productCreateButton.disabled = !canWrite();
        }
        if (variantCreateButton) {
          variantCreateButton.disabled = !canWrite();
        }
        setStatus("catalog-status", "Loading variants...");
        setStatus("product-status", "");
        setStatus("variant-status", "");
        try {
          await loadProducts();
          await loadVariants();
        } catch (error) {
          setStatus("catalog-status", error.message || "Failed to load catalog", true);
        }
      };

      roleInput.addEventListener("change", () => {
        refreshAll();
      });
      staffIdInput.addEventListener("change", () => {
        refreshAll();
      });

      refreshAll();
    })();
  </script>
</body>
</html>`;
};
