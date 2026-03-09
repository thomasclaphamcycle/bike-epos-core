import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";

type VariantDetail = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPrice: string;
  retailPricePence: number;
  costPricePence: number | null;
  taxCode: string | null;
  isActive: boolean;
  product?: {
    id: string;
    name: string;
    brand: string | null;
  };
};

type StockResponse = {
  variantId: string;
  onHand: number;
  locations: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    onHand: number;
  }>;
};

type MovementResponse = {
  variantId: string;
  movements: Array<{
    id: string;
    type: string;
    quantity: number;
    unitCost: string | null;
    referenceType: string | null;
    referenceId: string | null;
    note: string | null;
    createdByStaffId: string | null;
    createdAt: string;
  }>;
};

const formatMoney = (pence: number | null) =>
  pence === null ? "-" : `£${(pence / 100).toFixed(2)}`;

const formatSignedQuantity = (quantity: number) => (quantity > 0 ? `+${quantity}` : `${quantity}`);

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

export const InventoryItemPage = () => {
  const { variantId } = useParams<{ variantId: string }>();
  const { user } = useAuth();
  const { error } = useToasts();

  const [variant, setVariant] = useState<VariantDetail | null>(null);
  const [stock, setStock] = useState<StockResponse | null>(null);
  const [movements, setMovements] = useState<MovementResponse["movements"]>([]);
  const [loading, setLoading] = useState(false);
  const [movementNotice, setMovementNotice] = useState<string | null>(null);

  const canViewMovements = useMemo(() => isManagerPlus(user?.role), [user?.role]);

  useEffect(() => {
    if (!variantId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setVariant(null);
      setStock(null);
      setMovements([]);
      setMovementNotice(null);

      try {
        const [variantPayload, stockPayload] = await Promise.all([
          apiGet<VariantDetail>(`/api/variants/${encodeURIComponent(variantId)}`),
          apiGet<StockResponse>(`/api/stock/variants/${encodeURIComponent(variantId)}`),
        ]);

        if (cancelled) {
          return;
        }

        setVariant(variantPayload);
        setStock(stockPayload);

        if (!canViewMovements) {
          setMovements([]);
          setMovementNotice("Movement history is available to MANAGER+ only.");
          return;
        }

        try {
          const movementPayload = await apiGet<MovementResponse>(
            `/api/inventory/movements?variantId=${encodeURIComponent(variantId)}`,
          );
          if (!cancelled) {
            setMovements(movementPayload.movements || []);
          }
        } catch (movementError) {
          if (cancelled) {
            return;
          }
          if (movementError instanceof ApiError && movementError.status === 403) {
            setMovements([]);
            setMovementNotice("Movement history is available to MANAGER+ only.");
          } else {
            const message =
              movementError instanceof Error ? movementError.message : "Failed to load movement history";
            error(message);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : "Failed to load inventory item";
          error(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [canViewMovements, error, variantId]);

  if (!variantId) {
    return <div className="page-shell"><p>Missing inventory item id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Inventory Detail</h1>
            <p className="muted-text">Variant-level stock, locations, and movement history.</p>
          </div>
          <Link to="/inventory">Back to Inventory</Link>
        </div>

        {loading ? <p>Loading...</p> : null}

        {variant ? (
          <>
            <div className="job-meta-grid">
              <div><strong>Product:</strong> {variant.product?.name || "-"}</div>
              <div><strong>Brand:</strong> {variant.product?.brand || "-"}</div>
              <div><strong>Variant:</strong> {variant.name || variant.option || "-"}</div>
              <div><strong>SKU:</strong> <span className="mono-text">{variant.sku}</span></div>
              <div><strong>Barcode:</strong> <span className="mono-text">{variant.barcode || "-"}</span></div>
              <div><strong>Retail:</strong> {formatMoney(variant.retailPricePence)}</div>
              <div><strong>Cost:</strong> {formatMoney(variant.costPricePence)}</div>
              <div>
                <strong>Status:</strong>{" "}
                <span className={variant.isActive ? "stock-badge stock-good" : "stock-badge stock-muted"}>
                  {variant.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>

            <div className="metric-grid">
              <div className="metric-card">
                <span className="metric-label">Total On Hand</span>
                <strong className="metric-value">{stock?.onHand ?? 0}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Tracked Locations</span>
                <strong className="metric-value">{stock?.locations.length ?? 0}</strong>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Stock By Location</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Default</th>
                <th>On Hand</th>
              </tr>
            </thead>
            <tbody>
              {!stock || stock.locations.length === 0 ? (
                <tr>
                  <td colSpan={3}>No location-level stock rows found.</td>
                </tr>
              ) : (
                stock.locations.map((location) => (
                  <tr key={location.id}>
                    <td>{location.name}</td>
                    <td>{location.isDefault ? "Yes" : "No"}</td>
                    <td className="numeric-cell">{location.onHand}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Movement History</h2>
          {movementNotice ? <span className="muted-text">{movementNotice}</span> : null}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Reference</th>
                <th>Unit Cost</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {canViewMovements ? "No movements found." : "Movement history hidden for STAFF users."}
                  </td>
                </tr>
              ) : (
                movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{new Date(movement.createdAt).toLocaleString()}</td>
                    <td>{movement.type}</td>
                    <td className={movement.quantity < 0 ? "numeric-cell movement-negative" : "numeric-cell movement-positive"}>
                      {formatSignedQuantity(movement.quantity)}
                    </td>
                    <td>
                      {movement.referenceType || "-"}
                      {movement.referenceId ? (
                        <div className="table-secondary mono-text">{movement.referenceId}</div>
                      ) : null}
                    </td>
                    <td>{movement.unitCost ? `£${movement.unitCost}` : "-"}</td>
                    <td>{movement.note || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
