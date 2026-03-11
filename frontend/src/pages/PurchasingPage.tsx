import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";

type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
};

type PurchaseOrder = {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier: Supplier;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  orderedAt: string | null;
  expectedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  totals: {
    quantityOrdered: number;
    quantityReceived: number;
    quantityRemaining: number;
  };
};

type SupplierListResponse = {
  suppliers: Supplier[];
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

const statusOptions = ["", "DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

const toStatusBadgeClass = (status: PurchaseOrder["status"]) => {
  switch (status) {
    case "RECEIVED":
      return "status-badge status-complete";
    case "PARTIALLY_RECEIVED":
      return "status-badge status-warning";
    case "CANCELLED":
      return "status-badge status-cancelled";
    case "SENT":
      return "status-badge status-info";
    case "DRAFT":
    default:
      return "status-badge";
  }
};

const formatPurchaseOrderStatus = (status: PurchaseOrder["status"]) => {
  switch (status) {
    case "PARTIALLY_RECEIVED":
      return "Part Received";
    case "SENT":
      return "Ordered";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
};

export const PurchasingPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error } = useToasts();
  const canManage = isManagerPlus(user?.role);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const [status, setStatus] = useState<(typeof statusOptions)[number]>("");
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [createSupplierId, setCreateSupplierId] = useState("");
  const [orderedAt, setOrderedAt] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("take", "100");
    params.set("skip", "0");
    if (status) {
      params.set("status", status);
    }
    if (supplierId) {
      params.set("supplierId", supplierId);
    }
    if (debouncedSearch.trim()) {
      params.set("q", debouncedSearch.trim());
    }
    if (fromDate) {
      params.set("from", fromDate);
    }
    if (toDate) {
      params.set("to", toDate);
    }
    return params.toString();
  }, [debouncedSearch, fromDate, status, supplierId, toDate]);

  const loadSuppliers = async () => {
    try {
      const payload = await apiGet<SupplierListResponse>("/api/suppliers");
      setSuppliers(payload.suppliers || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load suppliers";
      error(message);
    }
  };

  const loadPurchaseOrders = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<PurchaseOrderListResponse>(`/api/purchase-orders?${query}`);
      setPurchaseOrders(payload.purchaseOrders || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load purchase orders";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPurchaseOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const createPurchaseOrder = async (event: FormEvent) => {
    event.preventDefault();

    if (!canManage) {
      error("Creating purchase orders requires MANAGER+.");
      return;
    }

    setCreating(true);
    try {
      const purchaseOrder = await apiPost<PurchaseOrder>("/api/purchase-orders", {
        supplierId: createSupplierId,
        orderedAt: orderedAt || undefined,
        expectedAt: expectedAt || undefined,
        notes: notes || undefined,
      });

      setOrderedAt("");
      setExpectedAt("");
      setNotes("");
      success("Purchase order created");
      await loadPurchaseOrders();
      navigate(`/purchasing/${purchaseOrder.id}`);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Failed to create purchase order";
      error(message);
    } finally {
      setCreating(false);
    }
  };

  const orderedUnits = useMemo(
    () => purchaseOrders.reduce((sum, po) => sum + po.totals.quantityOrdered, 0),
    [purchaseOrders],
  );
  const remainingUnits = useMemo(
    () => purchaseOrders.reduce((sum, po) => sum + po.totals.quantityRemaining, 0),
    [purchaseOrders],
  );
  const draftCount = useMemo(
    () => purchaseOrders.filter((po) => po.status === "DRAFT").length,
    [purchaseOrders],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Purchasing</h1>
            <p className="muted-text">Purchase order list, supplier filters, and receiving entry points.</p>
          </div>
          <div className="actions-inline">
            <Link to="/suppliers" className="button-link">Suppliers</Link>
            <button type="button" onClick={() => void loadPurchaseOrders()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label className="grow">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="PO number, supplier, SKU, product"
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as (typeof statusOptions)[number])}>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option || "All"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">Visible Purchase Orders</span>
            <strong className="metric-value">{purchaseOrders.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ordered Units</span>
            <strong className="metric-value">{orderedUnits}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Remaining Units</span>
            <strong className="metric-value">{remainingUnits}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Draft Orders</span>
            <strong className="metric-value">{draftCount}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PO</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Ordered</th>
                <th>Received</th>
                <th>Remaining</th>
                <th>Expected</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.length === 0 ? (
                <tr>
                  <td colSpan={8}>{loading ? "Loading purchase orders..." : "No purchase orders found."}</td>
                </tr>
              ) : (
                purchaseOrders.map((purchaseOrder) => (
                  <tr
                    key={purchaseOrder.id}
                    className="clickable-row"
                    onClick={() => navigate(`/purchasing/${purchaseOrder.id}`)}
                  >
                    <td>
                      <div className="table-primary">{purchaseOrder.poNumber}</div>
                      <div className="table-secondary mono-text">{purchaseOrder.id.slice(0, 8)}</div>
                    </td>
                    <td>
                      <div className="table-primary">{purchaseOrder.supplier?.name || "-"}</div>
                      <div className="table-secondary">
                        {purchaseOrder.supplier?.contactName || purchaseOrder.supplier?.email || purchaseOrder.supplier?.phone || "-"}
                      </div>
                    </td>
                    <td>
                      <span className={toStatusBadgeClass(purchaseOrder.status)}>{formatPurchaseOrderStatus(purchaseOrder.status)}</span>
                    </td>
                    <td className="numeric-cell">{purchaseOrder.totals.quantityOrdered}</td>
                    <td className="numeric-cell">{purchaseOrder.totals.quantityReceived}</td>
                    <td className="numeric-cell">{purchaseOrder.totals.quantityRemaining}</td>
                    <td>{purchaseOrder.expectedAt ? new Date(purchaseOrder.expectedAt).toLocaleDateString() : "-"}</td>
                    <td>{new Date(purchaseOrder.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Create Purchase Order</h2>
            <p className="muted-text">Creating an order does not affect stock. Stock increases only when goods are received.</p>
          </div>
        </div>

        {!canManage ? (
          <div className="restricted-panel">You can view purchase orders, but creating them requires MANAGER+.</div>
        ) : (
          <form className="purchase-form-grid" onSubmit={createPurchaseOrder}>
            <label>
              Supplier
              <select value={createSupplierId} onChange={(event) => setCreateSupplierId(event.target.value)} required>
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ordered Date
              <input type="date" value={orderedAt} onChange={(event) => setOrderedAt(event.target.value)} />
            </label>
            <label>
              Expected Date
              <input type="date" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} />
            </label>
            <label className="purchase-form-wide">
              Notes
              <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="delivery notes, supplier ref" />
            </label>
            <div className="actions-inline">
              <button type="submit" className="primary" disabled={creating || !createSupplierId}>
                {creating ? "Creating..." : "Create Purchase Order"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
};
