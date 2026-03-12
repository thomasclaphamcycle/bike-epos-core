import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api/client";
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

type PurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
  unitCostPence: number | null;
  createdAt: string;
  updatedAt: string;
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
  items: PurchaseOrderItem[];
  totals: {
    quantityOrdered: number;
    quantityReceived: number;
    quantityRemaining: number;
  };
};

type VariantSearchRow = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  costPricePence: number | null;
  isActive: boolean;
  product?: {
    id: string;
    name: string;
    brand: string | null;
  };
};

type VariantListResponse = {
  variants: VariantSearchRow[];
};

type SupplierProductLink = {
  id: string;
  supplierId: string;
  supplierName: string;
  variantId: string;
  supplierProductCode: string | null;
  supplierCostPence: number | null;
  preferredSupplier: boolean;
  isActive: boolean;
};

type SupplierProductLinkListResponse = {
  supplierProductLinks: SupplierProductLink[];
};

type Location = {
  id: string;
  name: string;
  isDefault: boolean;
};

type LocationListResponse = {
  locations: Location[];
};

type EditableLine = {
  quantityOrdered: number;
  unitCostPence: string;
};

type ReceivingLine = {
  quantity: string;
  unitCostPence: string;
};

type ReceiveValidationResult = {
  isValid: boolean;
  message: string | null;
};

const formatMoney = (pence: number | null) =>
  pence === null ? "-" : `£${(pence / 100).toFixed(2)}`;

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
      return "Partially Received";
    case "SENT":
      return "Ordered";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
};

const toDateInputValue = (value: string | null) => {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
};

export const PurchaseOrderPage = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { success, error } = useToasts();
  const canManage = isManagerPlus(user?.role);

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);

  const [orderedAt, setOrderedAt] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

  const [lineEdits, setLineEdits] = useState<Record<string, EditableLine>>({});
  const [receivingEdits, setReceivingEdits] = useState<Record<string, ReceivingLine>>({});
  const [locationId, setLocationId] = useState("");
  const [submittingReceiveItemId, setSubmittingReceiveItemId] = useState<string | null>(null);
  const [receiveSuccessMessage, setReceiveSuccessMessage] = useState<string | null>(null);

  const [variantSearch, setVariantSearch] = useState("");
  const debouncedVariantSearch = useDebouncedValue(variantSearch, 250);
  const [variantResults, setVariantResults] = useState<VariantSearchRow[]>([]);
  const [supplierLinksByVariantId, setSupplierLinksByVariantId] = useState<Record<string, SupplierProductLink>>({});
  const [lineQuantity, setLineQuantity] = useState("1");
  const [lineUnitCostPence, setLineUnitCostPence] = useState("");
  const [addingVariantId, setAddingVariantId] = useState<string | null>(null);

  const canEditLines = canManage && purchaseOrder?.status === "DRAFT";
  const canReceive = canManage
    && purchaseOrder !== null
    && (purchaseOrder.status === "DRAFT"
      || purchaseOrder.status === "SENT"
      || purchaseOrder.status === "PARTIALLY_RECEIVED");

  const loadPurchaseOrder = async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const payload = await apiGet<PurchaseOrder>(`/api/purchase-orders/${encodeURIComponent(id)}`);
      setPurchaseOrder(payload);
      setOrderedAt(toDateInputValue(payload.orderedAt));
      setExpectedAt(toDateInputValue(payload.expectedAt));
      setNotes(payload.notes || "");
      setLineEdits(
        Object.fromEntries(
          payload.items.map((item) => [
            item.id,
            {
              quantityOrdered: item.quantityOrdered,
              unitCostPence: item.unitCostPence === null ? "" : String(item.unitCostPence),
            },
          ]),
        ),
      );
      setReceivingEdits(
        Object.fromEntries(
          payload.items.map((item) => [
            item.id,
            {
              quantity: "",
              unitCostPence: item.unitCostPence === null ? "" : String(item.unitCostPence),
            },
          ]),
        ),
      );
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load purchase order";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async () => {
    try {
      const payload = await apiGet<LocationListResponse>("/api/locations");
      const nextLocations = payload.locations || [];
      setLocations(nextLocations);
      setLocationId((current) => {
        if (current && nextLocations.some((location) => location.id === current)) {
          return current;
        }
        return nextLocations.find((location) => location.isDefault)?.id ?? nextLocations[0]?.id ?? "";
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load locations";
      error(message);
    }
  };

  useEffect(() => {
    void Promise.all([loadPurchaseOrder(), loadLocations()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!debouncedVariantSearch.trim() || !canEditLines) {
      setVariantResults([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const payload = await apiGet<VariantListResponse>(
          `/api/variants?q=${encodeURIComponent(debouncedVariantSearch.trim())}&active=1&take=25&skip=0`,
        );
        if (!cancelled) {
          setVariantResults(payload.variants || []);
        }
      } catch (searchError) {
        if (!cancelled) {
          const message = searchError instanceof Error ? searchError.message : "Variant search failed";
          error(message);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [canEditLines, debouncedVariantSearch, error]);

  useEffect(() => {
    if (!purchaseOrder) {
      setSupplierLinksByVariantId({});
      return;
    }

    const variantIds = Array.from(new Set([
      ...purchaseOrder.items.map((item) => item.variantId),
      ...variantResults.map((variant) => variant.id),
    ]));

    if (variantIds.length === 0) {
      setSupplierLinksByVariantId({});
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const params = new URLSearchParams();
        params.set("supplierId", purchaseOrder.supplierId);
        params.set("variantIds", variantIds.join(","));
        params.set("active", "1");
        params.set("take", String(Math.min(variantIds.length, 200)));
        params.set("skip", "0");

        const payload = await apiGet<SupplierProductLinkListResponse>(
          `/api/supplier-product-links?${params.toString()}`,
        );

        if (!cancelled) {
          setSupplierLinksByVariantId(
            Object.fromEntries(
              (payload.supplierProductLinks || []).map((link) => [link.variantId, link]),
            ),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setSupplierLinksByVariantId({});
          error(loadError instanceof Error ? loadError.message : "Failed to load supplier links");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [error, purchaseOrder, variantResults]);

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault();

    if (!id || !canManage || !purchaseOrder) {
      return;
    }

    setSavingDetails(true);
    try {
      await apiPatch(`/api/purchase-orders/${encodeURIComponent(id)}`, {
        orderedAt: orderedAt || null,
        expectedAt: expectedAt || null,
        notes: notes || null,
      });
      success("Purchase order details updated");
      await loadPurchaseOrder();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to update purchase order";
      error(message);
    } finally {
      setSavingDetails(false);
    }
  };

  const updateStatus = async (status: "SENT" | "CANCELLED") => {
    if (!id || !canManage) {
      return;
    }

    try {
      await apiPatch(`/api/purchase-orders/${encodeURIComponent(id)}`, { status });
      success(`Purchase order marked ${status}`);
      await loadPurchaseOrder();
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update status";
      error(message);
    }
  };

  const addVariantToPurchaseOrder = async (variant: VariantSearchRow) => {
    if (!id || !canEditLines) {
      return;
    }

    const quantityOrdered = Number.parseInt(lineQuantity, 10);
    const parsedUnitCost =
      lineUnitCostPence.trim().length > 0 ? Number.parseInt(lineUnitCostPence, 10) : undefined;

    if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) {
      error("Ordered quantity must be a positive integer.");
      return;
    }
    if (parsedUnitCost !== undefined && (!Number.isInteger(parsedUnitCost) || parsedUnitCost < 0)) {
      error("Unit cost must be a non-negative integer.");
      return;
    }

    setAddingVariantId(variant.id);
    try {
      await apiPost(`/api/purchase-orders/${encodeURIComponent(id)}/items`, {
        lines: [
          {
            variantId: variant.id,
            quantityOrdered,
            unitCostPence: parsedUnitCost,
          },
        ],
      });
      setVariantSearch("");
      setVariantResults([]);
      setLineQuantity("1");
      setLineUnitCostPence("");
      success("Line added");
      await loadPurchaseOrder();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Failed to add line";
      error(message);
    } finally {
      setAddingVariantId(null);
    }
  };

  const updateLine = async (itemId: string) => {
    if (!id || !canEditLines) {
      return;
    }

    const edit = lineEdits[itemId];
    if (!edit) {
      return;
    }

    const quantityOrdered = Number.parseInt(String(edit.quantityOrdered), 10);
    const parsedUnitCost = edit.unitCostPence.trim().length > 0 ? Number.parseInt(edit.unitCostPence, 10) : null;

    if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) {
      error("Ordered quantity must be a positive integer.");
      return;
    }
    if (parsedUnitCost !== null && (!Number.isInteger(parsedUnitCost) || parsedUnitCost < 0)) {
      error("Unit cost must be a non-negative integer.");
      return;
    }

    try {
      await apiPatch(`/api/purchase-orders/${encodeURIComponent(id)}/lines/${encodeURIComponent(itemId)}`, {
        quantityOrdered,
        unitCostPence: parsedUnitCost,
      });
      success("Line updated");
      await loadPurchaseOrder();
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Failed to update line";
      error(message);
    }
  };

  const receiveLine = async (itemId: string) => {
    if (!id || !canReceive) {
      return;
    }

    const item = purchaseOrder?.items.find((line) => line.id === itemId);
    if (!item) {
      return;
    }
    const receipt = receivingEdits[itemId];
    const validation = validateReceiveLine(item, receipt);
    if (!validation.isValid) {
      error(validation.message || "Receive quantity is invalid.");
      return;
    }

    const quantity = Number.parseInt(receipt!.quantity, 10);
    const parsedUnitCost =
      receipt!.unitCostPence.trim().length > 0 ? Number.parseInt(receipt!.unitCostPence, 10) : undefined;

    setSubmittingReceiveItemId(itemId);
    setReceiveSuccessMessage(null);
    try {
      await apiPost(`/api/purchase-orders/${encodeURIComponent(id)}/receive`, {
        locationId,
        lines: [
          {
            purchaseOrderItemId: itemId,
            quantity,
            unitCostPence: parsedUnitCost,
          },
        ],
      });
      const successMessage = `Received ${quantity} unit${quantity === 1 ? "" : "s"} for ${item.productName}.`;
      success(successMessage);
      setReceiveSuccessMessage(successMessage);
      await loadPurchaseOrder();
    } catch (receiveError) {
      const message = receiveError instanceof Error ? receiveError.message : "Failed to receive stock";
      error(message);
    } finally {
      setSubmittingReceiveItemId(null);
    }
  };

  const populateReceiveRemaining = (itemId: string, quantityRemaining: number) => {
    if (quantityRemaining <= 0) {
      return;
    }

    setReceivingEdits((current) => ({
      ...current,
      [itemId]: {
        quantity: String(quantityRemaining),
        unitCostPence: current[itemId]?.unitCostPence ?? "",
      },
    }));
  };

  const populateAllReceiveRemaining = () => {
    if (!purchaseOrder) {
      return;
    }

    setReceivingEdits((current) => {
      const next = { ...current };
      for (const item of purchaseOrder.items) {
        if (item.quantityRemaining <= 0) {
          continue;
        }

        next[item.id] = {
          quantity: String(item.quantityRemaining),
          unitCostPence: current[item.id]?.unitCostPence ?? "",
        };
      }
      return next;
    });
  };

  const validateReceiveLine = (
    item: PurchaseOrderItem,
    receipt: ReceivingLine | undefined,
  ): ReceiveValidationResult => {
    if (!locationId) {
      return {
        isValid: false,
        message: "Select a receive location.",
      };
    }

    if (!receipt || receipt.quantity.trim().length === 0) {
      return {
        isValid: false,
        message: "Enter a receive quantity before submitting.",
      };
    }

    const quantity = Number.parseInt(receipt.quantity, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return {
        isValid: false,
        message: "Receive quantity must be a positive integer.",
      };
    }

    if (quantity > item.quantityRemaining) {
      return {
        isValid: false,
        message: `Receive quantity cannot exceed remaining quantity (${item.quantityRemaining}).`,
      };
    }

    const parsedUnitCost =
      receipt.unitCostPence.trim().length > 0 ? Number.parseInt(receipt.unitCostPence, 10) : undefined;
    if (parsedUnitCost !== undefined && (!Number.isInteger(parsedUnitCost) || parsedUnitCost < 0)) {
      return {
        isValid: false,
        message: "Receive unit cost must be a non-negative integer.",
      };
    }

    return {
      isValid: true,
      message: null,
    };
  };

  const totalEstimatedCost = useMemo(() => {
    if (!purchaseOrder) {
      return 0;
    }
    return purchaseOrder.items.reduce(
      (sum, item) => sum + (item.unitCostPence ?? 0) * item.quantityOrdered,
      0,
    );
  }, [purchaseOrder]);

  if (!id) {
    return <div className="page-shell"><p>Missing purchase order id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Purchase Order</h1>
            <p className="muted-text">Supplier details, variant lines, and receiving in one view.</p>
          </div>
          <div className="actions-inline">
            <Link to="/purchasing" className="button-link">Back to Purchasing</Link>
            <Link to="/suppliers" className="button-link">Suppliers</Link>
          </div>
        </div>

        {loading ? <p>Loading...</p> : null}

        {!purchaseOrder ? null : (
          <>
            <div className="detail-grid">
              <div className="metric-card">
                <span className="metric-label">PO</span>
                <strong className="metric-value detail-id">{purchaseOrder.poNumber}</strong>
                <span className="table-secondary mono-text">{purchaseOrder.id}</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Supplier</span>
                <strong className="metric-value detail-metric-text">{purchaseOrder.supplier.name}</strong>
                <span className="table-secondary">
                  {purchaseOrder.supplier.contactName || purchaseOrder.supplier.email || purchaseOrder.supplier.phone || "-"}
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Status</span>
                <strong className="metric-value detail-metric-text">
                  <span className={toStatusBadgeClass(purchaseOrder.status)}>{formatPurchaseOrderStatus(purchaseOrder.status)}</span>
                </strong>
                <span className="table-secondary">
                  Ordered {purchaseOrder.totals.quantityOrdered} | Received {purchaseOrder.totals.quantityReceived} | Remaining {purchaseOrder.totals.quantityRemaining}
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Estimated Cost</span>
                <strong className="metric-value">{formatMoney(totalEstimatedCost)}</strong>
                <span className="table-secondary">From current line unit costs</span>
              </div>
            </div>

            <form className="purchase-form-grid" onSubmit={saveDetails}>
              <label>
                Ordered Date
                <input
                  type="date"
                  value={orderedAt}
                  onChange={(event) => setOrderedAt(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label>
                Expected Date
                <input
                  type="date"
                  value={expectedAt}
                  onChange={(event) => setExpectedAt(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="purchase-form-wide">
                Notes
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="delivery notes, supplier ref"
                  disabled={!canManage}
                />
              </label>
              <div className="actions-inline">
                <button type="submit" className="primary" disabled={!canManage || savingDetails}>
                  {savingDetails ? "Saving..." : "Save Details"}
                </button>
                {canManage && purchaseOrder.status === "DRAFT" ? (
                  <button type="button" onClick={() => void updateStatus("SENT")}>
                    Mark Sent
                  </button>
                ) : null}
                {canManage && (purchaseOrder.status === "DRAFT" || purchaseOrder.status === "SENT") ? (
                  <button type="button" onClick={() => void updateStatus("CANCELLED")}>
                    Cancel PO
                  </button>
                ) : null}
              </div>
            </form>

            {!canManage ? (
              <div className="restricted-panel">
                STAFF can view purchase orders. Creating, editing, and receiving require MANAGER+.
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Purchase Order Lines</h2>
            <p className="muted-text">Variant-centric purchasing lines using the existing catalog API.</p>
          </div>
        </div>

        {!purchaseOrder ? null : (
          <>
            {canEditLines ? (
              <div className="page-shell">
                <div className="filter-row">
                  <label className="grow">
                    Search Variant
                    <input
                      value={variantSearch}
                      onChange={(event) => setVariantSearch(event.target.value)}
                      placeholder="SKU, barcode, product, variant"
                    />
                  </label>
                  <label>
                    Ordered Qty
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={lineQuantity}
                      onChange={(event) => setLineQuantity(event.target.value)}
                    />
                  </label>
                  <label>
                    Unit Cost (pence)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={lineUnitCostPence}
                      onChange={(event) => setLineUnitCostPence(event.target.value)}
                      placeholder="optional"
                    />
                  </label>
                </div>
                <p className="muted-text">
                  If unit cost is left blank, the PO line now falls back to the active supplier link cost for this supplier when one exists.
                </p>

                {variantResults.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Variant</th>
                          <th>SKU</th>
                          <th>Retail</th>
                          <th>Cost</th>
                          <th>Supplier Link</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variantResults.map((variant) => {
                          const supplierLink = supplierLinksByVariantId[variant.id];
                          return (
                            <tr key={variant.id}>
                              <td>
                                <div className="table-primary">{variant.product?.name || "-"}</div>
                                <div className="table-secondary">{variant.product?.brand || "-"}</div>
                              </td>
                              <td>{variant.name || variant.option || "-"}</td>
                              <td className="mono-text">{variant.sku}</td>
                              <td>{formatMoney(variant.retailPricePence)}</td>
                              <td>{formatMoney(variant.costPricePence)}</td>
                              <td>
                                {supplierLink ? (
                                  <>
                                    <div>{supplierLink.supplierProductCode || "No supplier ref"}</div>
                                    <div className="table-secondary">
                                      {formatMoney(supplierLink.supplierCostPence)}
                                      {supplierLink.preferredSupplier ? " | Preferred" : ""}
                                    </div>
                                  </>
                                ) : (
                                  <span className="table-secondary">No active supplier link</span>
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => void addVariantToPurchaseOrder(variant)}
                                  disabled={addingVariantId === variant.id}
                                >
                                  {addingVariantId === variant.id ? "Adding..." : "Add"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted-text">Search for a variant to add a new purchase order line.</p>
                )}
              </div>
            ) : (
              <p className="muted-text">
                Lines can only be added or edited while the purchase order is in DRAFT and you have MANAGER+ access.
              </p>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>SKU</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    <th>Remaining</th>
                    <th>Unit Cost</th>
                    <th>Supplier Link</th>
                    <th>Line Cost</th>
                    <th>Update</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrder.items.length === 0 ? (
                    <tr>
                      <td colSpan={10}>No lines on this purchase order yet.</td>
                    </tr>
                  ) : (
                    purchaseOrder.items.map((item) => {
                      const edit = lineEdits[item.id];
                      const supplierLink = supplierLinksByVariantId[item.variantId];
                      return (
                        <tr key={item.id}>
                          <td>{item.productName}</td>
                          <td>{item.variantName || "-"}</td>
                          <td className="mono-text">{item.sku}</td>
                          <td>
                            <input
                              className="compact-input"
                              type="number"
                              min="1"
                              step="1"
                              value={edit?.quantityOrdered ?? item.quantityOrdered}
                              onChange={(event) =>
                                setLineEdits((current) => ({
                                  ...current,
                                  [item.id]: {
                                    quantityOrdered: Number.parseInt(event.target.value, 10) || 0,
                                    unitCostPence: current[item.id]?.unitCostPence ?? "",
                                  },
                                }))
                              }
                              disabled={!canEditLines}
                            />
                          </td>
                          <td className="numeric-cell">{item.quantityReceived}</td>
                          <td className="numeric-cell">{item.quantityRemaining}</td>
                          <td>
                            <input
                              className="compact-input"
                              type="number"
                              min="0"
                              step="1"
                              value={edit?.unitCostPence ?? ""}
                              onChange={(event) =>
                                setLineEdits((current) => ({
                                  ...current,
                                  [item.id]: {
                                    quantityOrdered: current[item.id]?.quantityOrdered ?? item.quantityOrdered,
                                    unitCostPence: event.target.value,
                                  },
                                }))
                              }
                              disabled={!canEditLines}
                            />
                          </td>
                          <td>
                            {supplierLink ? (
                              <>
                                <div>{supplierLink.supplierProductCode || "No supplier ref"}</div>
                                <div className="table-secondary">
                                  {formatMoney(supplierLink.supplierCostPence)}
                                  {supplierLink.preferredSupplier ? " | Preferred" : ""}
                                </div>
                              </>
                            ) : (
                              <span className="table-secondary">No active supplier link</span>
                            )}
                          </td>
                          <td>{formatMoney((item.unitCostPence ?? 0) * item.quantityOrdered)}</td>
                          <td>
                            <button type="button" onClick={() => void updateLine(item.id)} disabled={!canEditLines}>
                              Update
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Goods Receiving</h2>
            <p className="muted-text">Receive stock directly from this PO. Stock does not increase until receiving is posted.</p>
          </div>
        </div>

        {!purchaseOrder ? null : !canReceive ? (
          <div className="restricted-panel">
            Receiving is available to MANAGER+ while the purchase order is DRAFT, SENT, or PARTIALLY_RECEIVED.
          </div>
        ) : (
          <>
            <div className="detail-grid">
              <div className="metric-card">
                <span className="metric-label">Ordered</span>
                <strong className="metric-value">{purchaseOrder.totals.quantityOrdered}</strong>
                <span className="table-secondary">Units on this PO</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Received</span>
                <strong className="metric-value">{purchaseOrder.totals.quantityReceived}</strong>
                <span className="table-secondary">Booked into stock</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Remaining</span>
                <strong className="metric-value">{purchaseOrder.totals.quantityRemaining}</strong>
                <span className="table-secondary">
                  {purchaseOrder.status === "PARTIALLY_RECEIVED" ? "Awaiting final receipt" : "Still to receive"}
                </span>
              </div>
            </div>

            {receiveSuccessMessage ? (
              <div className="restricted-panel">{receiveSuccessMessage}</div>
            ) : null}

            <div className="filter-row">
              <label>
                Receive Location
                <select
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  data-testid="po-receive-location"
                >
                  <option value="">Select location</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}{location.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="actions-inline">
                <button
                  type="button"
                  className="button-link"
                  onClick={populateAllReceiveRemaining}
                  disabled={submittingReceiveItemId !== null || purchaseOrder.items.every((item) => item.quantityRemaining <= 0)}
                  data-testid="po-receive-fill-all"
                >
                  Receive All Remaining
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    <th>Remaining</th>
                    <th>Receive Now</th>
                    <th>Unit Cost (pence)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrder.items.length === 0 ? (
                    <tr>
                      <td colSpan={8}>No lines available for receiving.</td>
                    </tr>
                  ) : (
                    purchaseOrder.items.map((item) => {
                      const receipt = receivingEdits[item.id];
                      const validation = validateReceiveLine(item, receipt);
                      const isSubmitting = submittingReceiveItemId === item.id;
                      return (
                        <tr key={`${item.id}-receive`}>
                          <td>{item.productName}</td>
                          <td>{item.variantName || item.sku}</td>
                          <td className="numeric-cell">{item.quantityOrdered}</td>
                          <td className="numeric-cell">{item.quantityReceived}</td>
                          <td className="numeric-cell">{item.quantityRemaining}</td>
                          <td>
                            <input
                              className="compact-input"
                              type="number"
                              min="1"
                              max={String(item.quantityRemaining)}
                              step="1"
                              value={receipt?.quantity ?? ""}
                              data-testid={`po-receive-qty-${item.id}`}
                              onChange={(event) =>
                                setReceivingEdits((current) => ({
                                  ...current,
                                  [item.id]: {
                                    quantity: event.target.value,
                                    unitCostPence: current[item.id]?.unitCostPence ?? "",
                                  },
                                }))
                              }
                              disabled={item.quantityRemaining <= 0 || isSubmitting}
                            />
                          </td>
                          <td>
                            <input
                              className="compact-input"
                              type="number"
                              min="0"
                              step="1"
                              value={receipt?.unitCostPence ?? ""}
                              onChange={(event) =>
                                setReceivingEdits((current) => ({
                                  ...current,
                                  [item.id]: {
                                    quantity: current[item.id]?.quantity ?? "",
                                    unitCostPence: event.target.value,
                                  },
                                }))
                              }
                              disabled={item.quantityRemaining <= 0 || isSubmitting}
                            />
                          </td>
                          <td>
                            <div className="actions-inline">
                              <button
                                type="button"
                                onClick={() => populateReceiveRemaining(item.id, item.quantityRemaining)}
                                disabled={item.quantityRemaining <= 0 || isSubmitting}
                                data-testid={`po-receive-fill-${item.id}`}
                              >
                                Receive Remaining
                              </button>
                              <button
                                type="button"
                                onClick={() => void receiveLine(item.id)}
                                disabled={item.quantityRemaining <= 0 || isSubmitting || !validation.isValid}
                                data-testid={`po-receive-submit-${item.id}`}
                              >
                                {isSubmitting ? "Receiving..." : "Receive"}
                              </button>
                            </div>
                            {!validation.isValid && item.quantityRemaining > 0 ? (
                              <div className="table-secondary">{validation.message}</div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
