import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiGet, apiPatch, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { useAppConfig } from "../config/appConfig";
import { isBikeCategory } from "@shared/bikeCategory";
import { buildBikeTagFallbackSpecLines } from "@shared/bikeTagRenderData";

type VariantDetail = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  manufacturerBarcode: string | null;
  internalBarcode: string | null;
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
    category: string | null;
    brand: string | null;
    description: string | null;
    keySellingPoints: string | null;
  };
};

type VariantProductDetail = NonNullable<VariantDetail["product"]>;
type ProductDetail = {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  keySellingPoints: string | null;
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

type StockAdjustmentResponse = {
  entry: {
    id: string;
    quantityDelta: number;
    referenceId: string;
    createdAt: string;
  };
  stock: {
    totalOnHand: number;
    onHandAtLocation: number;
  };
};

const formatMoney = (pence: number | null) =>
  pence === null ? "-" : `£${(pence / 100).toFixed(2)}`;

const normalizeMultilineText = (value: string | null | undefined) =>
  (value ?? "").replace(/\r\n/g, "\n").trim();

const formatSignedQuantity = (quantity: number) => (quantity > 0 ? `+${quantity}` : `${quantity}`);

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

const ADJUSTMENT_REASONS = [
  "COUNT_CORRECTION",
  "DAMAGED",
  "SUPPLIER_ERROR",
  "THEFT",
  "OTHER",
] as const;

const MOVEMENT_TYPE_OPTIONS = [
  "",
  "PURCHASE",
  "SALE",
  "ADJUSTMENT",
  "WORKSHOP_USE",
  "RETURN",
  "TRANSFER",
] as const;

const formatReasonLabel = (value: string | null) =>
  value
    ? value
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "-";

const formatMovementTypeLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatMovementReferenceLabel = (referenceType: string | null, referenceId: string | null) => {
  if (referenceType === "WORKSHOP_JOB_PART") {
    return {
      primary: "Workshop part record",
      secondary: referenceId,
    };
  }

  if (referenceType === "WORKSHOP_JOB_LINE") {
    return {
      primary: "Workshop job line",
      secondary: referenceId,
    };
  }

  if (referenceType === "STOCK_ADJUSTMENT") {
    return {
      primary: formatReasonLabel(referenceId),
      secondary: null,
    };
  }

  if (referenceType === "STOCK_TRANSFER_OUT") {
    return {
      primary: "Transfer out",
      secondary: referenceId,
    };
  }

  if (referenceType === "STOCK_TRANSFER_IN") {
    return {
      primary: "Transfer in",
      secondary: referenceId,
    };
  }

  return {
    primary: referenceType ? formatMovementTypeLabel(referenceType) : "-",
    secondary: referenceId,
  };
};

const getMovementStory = (movement: MovementResponse["movements"][number]) => {
  if (movement.type === "WORKSHOP_USE") {
    if (movement.quantity < 0) {
      return movement.referenceType === "WORKSHOP_JOB_PART"
        ? "Consumed from a workshop part record."
        : "Consumed during workshop job completion.";
    }

    return movement.referenceType === "WORKSHOP_JOB_PART"
      ? "Returned from a workshop part record."
      : "Returned back from workshop activity.";
  }

  if (movement.type === "PURCHASE") {
    return "Booked into stock through purchase-order receiving.";
  }

  if (movement.type === "SALE") {
    return "Reduced through a completed retail sale.";
  }

  if (movement.type === "ADJUSTMENT") {
    return "Manual correction or count adjustment.";
  }

  if (movement.type === "TRANSFER") {
    return movement.referenceType === "STOCK_TRANSFER_OUT"
      ? "Moved out to another stock location."
      : "Received in from another stock location.";
  }

  return movement.note || "Inventory movement recorded.";
};

const getStockStateLabel = (onHand: number, lowStockThreshold: number) => {
  if (onHand < 0) {
    return "Negative";
  }
  if (onHand === 0) {
    return "Zero";
  }
  if (onHand <= lowStockThreshold) {
    return "Low";
  }
  return "Positive";
};

const getStockStateClass = (onHand: number, lowStockThreshold: number) => {
  if (onHand < 0) {
    return "stock-badge stock-state-negative";
  }
  if (onHand === 0) {
    return "stock-badge stock-state-zero";
  }
  if (onHand <= lowStockThreshold) {
    return "stock-badge stock-state-low";
  }
  return "stock-badge stock-state-positive";
};

export const InventoryItemPage = () => {
  const appConfig = useAppConfig();
  const { variantId } = useParams<{ variantId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { error, success } = useToasts();

  const [variant, setVariant] = useState<VariantDetail | null>(null);
  const [stock, setStock] = useState<StockResponse | null>(null);
  const [movements, setMovements] = useState<MovementResponse["movements"]>([]);
  const [loading, setLoading] = useState(false);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementNotice, setMovementNotice] = useState<string | null>(null);
  const [movementType, setMovementType] = useState<(typeof MOVEMENT_TYPE_OPTIONS)[number]>("");
  const [movementFrom, setMovementFrom] = useState("");
  const [movementTo, setMovementTo] = useState("");
  const [adjustmentDelta, setAdjustmentDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState<(typeof ADJUSTMENT_REASONS)[number]>("COUNT_CORRECTION");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [countedQuantity, setCountedQuantity] = useState("");
  const [countNote, setCountNote] = useState("");
  const [submittingCount, setSubmittingCount] = useState(false);
  const [sellingPointsDraft, setSellingPointsDraft] = useState("");
  const [savingSellingPoints, setSavingSellingPoints] = useState(false);
  const [generatingSellingPoints, setGeneratingSellingPoints] = useState(false);
  const lowStockThreshold = appConfig.operations.lowStockThreshold;

  const canViewMovements = useMemo(() => isManagerPlus(user?.role), [user?.role]);
  const canAdjustStock = useMemo(() => isManagerPlus(user?.role), [user?.role]);
  const canEditSellingPoints = useMemo(() => isManagerPlus(user?.role), [user?.role]);
  const isCountMode = searchParams.get("mode") === "count";
  const isBikeProduct = useMemo(
    () => isBikeCategory(variant?.product?.category ?? null),
    [variant?.product?.category],
  );
  const normalizedStoredSellingPoints = useMemo(
    () => normalizeMultilineText(variant?.product?.keySellingPoints),
    [variant?.product?.keySellingPoints],
  );
  const sellingPointsDirty = useMemo(
    () => normalizeMultilineText(sellingPointsDraft) !== normalizedStoredSellingPoints,
    [normalizedStoredSellingPoints, sellingPointsDraft],
  );

  const loadInventoryDetail = async () => {
    if (!variantId) {
      return;
    }

    setLoading(true);
    try {
      const [variantPayload, stockPayload] = await Promise.all([
        apiGet<VariantDetail>(`/api/variants/${encodeURIComponent(variantId)}`),
        apiGet<StockResponse>(`/api/stock/variants/${encodeURIComponent(variantId)}`),
      ]);

      setVariant(variantPayload);
      setStock(stockPayload);
      setSellingPointsDraft(variantPayload.product?.keySellingPoints ?? "");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load inventory item";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  const loadMovements = async () => {
    if (!variantId) {
      return;
    }

    setMovementNotice(null);

    if (!canViewMovements) {
      setMovements([]);
      setMovementLoading(false);
      setMovementNotice("Movement history is available to MANAGER+ only.");
      return;
    }

    const params = new URLSearchParams();
    params.set("variantId", variantId);
    if (movementType) {
      params.set("type", movementType);
    }
    if (movementFrom) {
      params.set("from", movementFrom);
    }
    if (movementTo) {
      params.set("to", movementTo);
    }

    setMovementLoading(true);

    try {
      const movementPayload = await apiGet<MovementResponse>(`/api/inventory/movements?${params.toString()}`);
      setMovements(movementPayload.movements || []);
    } catch (movementError) {
      if (movementError instanceof ApiError && movementError.status === 403) {
        setMovements([]);
        setMovementNotice("Movement history is available to MANAGER+ only.");
      } else {
        const message =
          movementError instanceof Error ? movementError.message : "Failed to load movement history";
        error(message);
      }
    } finally {
      setMovementLoading(false);
    }
  };

  useEffect(() => {
    void loadInventoryDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId]);

  useEffect(() => {
    void loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewMovements, movementFrom, movementTo, movementType, variantId]);

  const parsedAdjustmentDelta = useMemo(() => {
    if (!adjustmentDelta.trim()) {
      return null;
    }

    const parsed = Number.parseInt(adjustmentDelta, 10);
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  }, [adjustmentDelta]);

  const projectedOnHand = useMemo(() => {
    if (parsedAdjustmentDelta === null || Number.isNaN(parsedAdjustmentDelta) || !stock) {
      return null;
    }
    return stock.onHand + parsedAdjustmentDelta;
  }, [parsedAdjustmentDelta, stock]);

  const adjustmentDirection = useMemo(() => {
    if (parsedAdjustmentDelta === null || Number.isNaN(parsedAdjustmentDelta) || parsedAdjustmentDelta === 0) {
      return null;
    }
    return parsedAdjustmentDelta > 0 ? "Increase" : "Decrease";
  }, [parsedAdjustmentDelta]);

  const adjustmentValidationMessage = useMemo(() => {
    if (adjustmentDelta.trim() === "") {
      return null;
    }
    if (parsedAdjustmentDelta === null || Number.isNaN(parsedAdjustmentDelta)) {
      return "Enter a whole-number stock change.";
    }
    if (parsedAdjustmentDelta === 0) {
      return "Quantity delta must be a non-zero integer.";
    }
    return null;
  }, [adjustmentDelta, parsedAdjustmentDelta]);

  const parsedCountedQuantity = useMemo(() => {
    if (!countedQuantity.trim()) {
      return null;
    }

    const parsed = Number.parseInt(countedQuantity, 10);
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  }, [countedQuantity]);

  const cycleCountDifference = useMemo(() => {
    if (parsedCountedQuantity === null || Number.isNaN(parsedCountedQuantity) || !stock) {
      return null;
    }
    return parsedCountedQuantity - stock.onHand;
  }, [parsedCountedQuantity, stock]);

  const cycleCountValidationMessage = useMemo(() => {
    if (countedQuantity.trim() === "") {
      return null;
    }
    if (parsedCountedQuantity === null || Number.isNaN(parsedCountedQuantity)) {
      return "Enter a whole-number counted quantity.";
    }
    if (parsedCountedQuantity < 0) {
      return "Counted quantity cannot be negative.";
    }
    if (cycleCountDifference === 0) {
      return "Count matches current stock. No correction is needed.";
    }
    return null;
  }, [countedQuantity, cycleCountDifference, parsedCountedQuantity]);

  const purchaseQty = useMemo(
    () => movements.reduce((sum, movement) => sum + (movement.type === "PURCHASE" ? Math.max(movement.quantity, 0) : 0), 0),
    [movements],
  );
  const salesQty = useMemo(
    () => movements.reduce((sum, movement) => sum + (movement.type === "SALE" ? Math.abs(Math.min(movement.quantity, 0)) : 0), 0),
    [movements],
  );
  const workshopUseQty = useMemo(
    () => movements.reduce((sum, movement) => sum + (movement.type === "WORKSHOP_USE" ? Math.abs(Math.min(movement.quantity, 0)) : 0), 0),
    [movements],
  );
  const adjustmentNetQty = useMemo(
    () => movements.reduce((sum, movement) => sum + (movement.type === "ADJUSTMENT" ? movement.quantity : 0), 0),
    [movements],
  );
  const latestMovementAt = movements[0]?.createdAt ?? null;

  const stockAttentionMessage = useMemo(() => {
    const onHand = stock?.onHand ?? 0;

    if (onHand < 0) {
      return "Negative stock needs immediate review. Check the movement history, then run a cycle count before the next sale or workshop allocation.";
    }
    if (onHand === 0) {
      return "This variant is out of stock. Confirm open purchase orders or raise a new reorder before it is promised again.";
    }
    if (onHand <= lowStockThreshold) {
      return "Stock is low. Review reorder suggestions and recent workshop use before the next busy trading day.";
    }
    if (workshopUseQty > 0) {
      return `Workshop use is visible in the movement history. ${workshopUseQty} unit${workshopUseQty === 1 ? "" : "s"} have been consumed by workshop jobs in the current view.`;
    }
    return "Stock level is currently healthy. Use movements and location counts to confirm where the remaining stock is sitting.";
  }, [lowStockThreshold, stock?.onHand, workshopUseQty]);

  const submitAdjustment = async (event: FormEvent) => {
    event.preventDefault();

    if (!variantId) {
      return;
    }

    const parsedDelta = Number.parseInt(adjustmentDelta, 10);
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      error("Quantity delta must be a non-zero integer.");
      return;
    }

    setAdjusting(true);
    try {
      await apiPost<StockAdjustmentResponse>("/api/stock/adjustments", {
        variantId,
        quantityDelta: parsedDelta,
        note: adjustmentNote || undefined,
        referenceType: "STOCK_ADJUSTMENT",
        referenceId: adjustmentReason,
      });

      setAdjustmentDelta("");
      setAdjustmentNote("");
      success(
        `Stock adjusted by ${formatSignedQuantity(parsedDelta)}. New on-hand stock: ${stock?.onHand !== undefined ? stock.onHand + parsedDelta : "updated"}.`,
      );
      await Promise.all([loadInventoryDetail(), loadMovements()]);
    } catch (adjustmentError) {
      const message = adjustmentError instanceof Error ? adjustmentError.message : "Failed to adjust stock";
      error(message);
    } finally {
      setAdjusting(false);
    }
  };

  const submitCycleCount = async (event: FormEvent) => {
    event.preventDefault();

    if (!variantId || !stock) {
      return;
    }

    if (parsedCountedQuantity === null || Number.isNaN(parsedCountedQuantity) || parsedCountedQuantity < 0) {
      error("Counted quantity must be a whole number.");
      return;
    }

    const quantityDelta = parsedCountedQuantity - stock.onHand;
    if (quantityDelta === 0) {
      error("Count matches current stock. No correction is needed.");
      return;
    }

    setSubmittingCount(true);
    try {
      await apiPost<StockAdjustmentResponse>("/api/stock/adjustments", {
        variantId,
        quantityDelta,
        note: countNote || undefined,
        referenceType: "STOCK_ADJUSTMENT",
        referenceId: "COUNT_CORRECTION",
      });

      setCountedQuantity("");
      setCountNote("");
      success(
        `Cycle count applied. Stock changed by ${formatSignedQuantity(quantityDelta)} and is now ${parsedCountedQuantity}.`,
      );
      await Promise.all([loadInventoryDetail(), loadMovements()]);
      if (isCountMode) {
        const params = new URLSearchParams(searchParams);
        params.delete("mode");
        setSearchParams(params, { replace: true });
      }
    } catch (countError) {
      const message = countError instanceof Error ? countError.message : "Failed to apply cycle count";
      error(message);
    } finally {
      setSubmittingCount(false);
    }
  };

  const saveSellingPoints = async (event: FormEvent) => {
    event.preventDefault();

    const productId = variant?.product?.id;
    if (!productId || !isBikeProduct) {
      return;
    }

    setSavingSellingPoints(true);
    try {
      const normalized = normalizeMultilineText(sellingPointsDraft);
      const updatedProduct = await apiPatch<VariantProductDetail>(`/api/products/${encodeURIComponent(productId)}`, {
        keySellingPoints: normalized || null,
      });

      setVariant((current) =>
        current
          ? {
              ...current,
              product: current.product
                ? {
                    ...current.product,
                    category: updatedProduct.category,
                    brand: updatedProduct.brand,
                    description: updatedProduct.description,
                    keySellingPoints: updatedProduct.keySellingPoints,
                    name: updatedProduct.name,
                  }
                : current.product,
            }
          : current,
      );
      setSellingPointsDraft(updatedProduct.keySellingPoints ?? "");
      success("Key selling points saved.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save key selling points";
      error(message);
    } finally {
      setSavingSellingPoints(false);
    }
  };

  const generateSellingPointsFromSpecs = async () => {
    if (!variant || !variant.product?.id || !isBikeProduct) {
      error("No bike-tag selling points could be generated from the current product details.");
      return;
    }

    setGeneratingSellingPoints(true);
    try {
      const productDetail = await apiGet<ProductDetail>(`/api/products/${encodeURIComponent(variant.product.id)}`);
      const generatedSellingPoints = buildBikeTagFallbackSpecLines(
        {
          sku: variant.sku,
          barcode: variant.barcode,
          manufacturerBarcode: variant.manufacturerBarcode,
          internalBarcode: variant.internalBarcode,
          name: variant.name,
          option: variant.option,
          retailPricePence: variant.retailPricePence,
          product: {
            name: productDetail.name,
            category: productDetail.category,
            brand: productDetail.brand,
            keySellingPoints: null,
          },
        },
        {
          name: productDetail.name,
          category: productDetail.category,
          brand: productDetail.brand,
          description: productDetail.description,
          keySellingPoints: null,
        },
      );

      if (generatedSellingPoints.length === 0) {
        error("No bike-tag selling points could be generated from the current product details.");
        return;
      }

      setSellingPointsDraft(generatedSellingPoints.join("\n"));
      success("Selling point suggestions loaded. Review and save when you are happy.");
    } catch (generateError) {
      const message = generateError instanceof Error ? generateError.message : "Failed to generate selling points";
      error(message);
    } finally {
      setGeneratingSellingPoints(false);
    }
  };

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
          <div className="actions-inline">
            <Link to="/management/reordering">Reordering</Link>
            <Link to="/management/inventory">Inventory intel</Link>
            <Link to="/inventory/stocktakes">Stocktake sessions</Link>
            <button
              type="button"
              className="primary"
              onClick={() => navigate(`/variants/${variantId}/bike-tag/print`)}
              disabled={loading || !variant}
            >
              Print bike tag
            </button>
            <Link to={`/inventory/${variantId}/label`}>Print label</Link>
            <Link to={`/inventory/${variantId}?mode=count`}>Cycle count</Link>
            <Link to="/inventory">Back to Inventory</Link>
          </div>
        </div>

        {loading ? <p>Loading...</p> : null}

        {variant ? (
          <>
            <div className="job-meta-grid">
              <div><strong>Product:</strong> {variant.product?.name || "-"}</div>
              <div><strong>Brand:</strong> {variant.product?.brand || "-"}</div>
              <div><strong>Variant:</strong> {variant.name || variant.option || "-"}</div>
              <div><strong>SKU:</strong> <span className="mono-text">{variant.sku}</span></div>
              <div><strong>Preferred barcode:</strong> <span className="mono-text">{variant.barcode || "-"}</span></div>
              <div><strong>Manufacturer barcode:</strong> <span className="mono-text">{variant.manufacturerBarcode || "-"}</span></div>
              <div><strong>Internal barcode:</strong> <span className="mono-text">{variant.internalBarcode || "-"}</span></div>
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
                <span className="metric-label">Stock State</span>
                <strong className="metric-value">
                  <span className={getStockStateClass(stock?.onHand ?? 0, lowStockThreshold)}>
                    {getStockStateLabel(stock?.onHand ?? 0, lowStockThreshold)}
                  </span>
                </strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Tracked Locations</span>
                <strong className="metric-value">{stock?.locations.length ?? 0}</strong>
              </div>
            </div>

            <p className="muted-text">
              {stockAttentionMessage}
            </p>

            {isBikeProduct && variant.product ? (
              <div style={{ marginTop: "20px", borderTop: "1px solid var(--border-color, #d7deea)", paddingTop: "20px" }}>
                <div className="card-header-row" style={{ alignItems: "flex-start", gap: "16px" }}>
                  <div>
                    <h2 style={{ marginBottom: "6px" }}>Key Selling Points</h2>
                    <p className="muted-text" style={{ marginBottom: 0 }}>
                      Used on printed bike tags. One point per line. Short lines work best on printed tags.
                    </p>
                  </div>
                  {!canEditSellingPoints ? <span className="muted-text">MANAGER+ only</span> : null}
                </div>

                <form onSubmit={saveSellingPoints}>
                  <textarea
                    value={sellingPointsDraft}
                    onChange={(event) => setSellingPointsDraft(event.target.value)}
                    rows={5}
                    disabled={!canEditSellingPoints || savingSellingPoints}
                    placeholder={"Lightweight aluminium frame\nBosch Performance Line motor\nRack, mudguards, and integrated lights"}
                    style={{ width: "100%", marginTop: "12px" }}
                  />
                  <div className="actions-inline" style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      onClick={generateSellingPointsFromSpecs}
                      disabled={!canEditSellingPoints || savingSellingPoints || generatingSellingPoints}
                    >
                      {generatingSellingPoints ? "Generating..." : "Generate from specs"}
                    </button>
                    <button
                      type="submit"
                      className="primary"
                      disabled={!canEditSellingPoints || savingSellingPoints || !sellingPointsDirty}
                    >
                      {savingSellingPoints ? "Saving..." : "Save selling points"}
                    </button>
                    {sellingPointsDirty ? (
                      <button
                        type="button"
                        onClick={() => setSellingPointsDraft(variant.product?.keySellingPoints ?? "")}
                        disabled={savingSellingPoints}
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                </form>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Stock Adjustment</h2>
            <p className="muted-text">Records a stock adjustment against the current variant.</p>
          </div>
          {!canAdjustStock ? <span className="muted-text">MANAGER+ only</span> : null}
        </div>

        {canAdjustStock ? (
          <>
            <div className="inventory-adjustment-summary">
              <div className="metric-card">
                <span className="metric-label">Current On Hand</span>
                <strong className="metric-value">{stock?.onHand ?? 0}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Adjustment Direction</span>
                <strong className="metric-value">
                  {adjustmentDirection ? (
                    <span className={adjustmentDirection === "Increase" ? "stock-badge stock-good" : "stock-badge stock-state-zero"}>
                      {adjustmentDirection}
                    </span>
                  ) : (
                    "-"
                  )}
                </strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Resulting On Hand</span>
                <strong className="metric-value">
                  {projectedOnHand === null ? "-" : (
                    <span className={getStockStateClass(projectedOnHand, lowStockThreshold)}>
                      {projectedOnHand}
                    </span>
                  )}
                </strong>
              </div>
            </div>

            <form className="inventory-adjustment-form" onSubmit={submitAdjustment}>
              <label>
                Quantity Delta
                <input
                  type="number"
                  step="1"
                  value={adjustmentDelta}
                  onChange={(event) => setAdjustmentDelta(event.target.value)}
                  placeholder="Use negative values to reduce stock"
                  required
                />
              </label>

              <label>
                Reason
                <select
                  value={adjustmentReason}
                  onChange={(event) => setAdjustmentReason(event.target.value as (typeof ADJUSTMENT_REASONS)[number])}
                >
                  {ADJUSTMENT_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {formatReasonLabel(reason)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inventory-adjustment-note">
                Note
                <input
                  value={adjustmentNote}
                  onChange={(event) => setAdjustmentNote(event.target.value)}
                  placeholder="Optional note for the adjustment"
                />
              </label>

              <button
                type="submit"
                className="primary"
                disabled={adjusting || adjustmentValidationMessage !== null}
              >
                {adjusting ? "Adjusting..." : "Apply Adjustment"}
              </button>
            </form>

            {adjustmentValidationMessage ? (
              <p className="inventory-adjustment-validation">{adjustmentValidationMessage}</p>
            ) : null}
          </>
        ) : (
          <p className="muted-text">Stock adjustments are available to MANAGER+ only.</p>
        )}
      </section>

      <section className={`card ${isCountMode ? "inventory-count-card-active" : ""}`}>
        <div className="card-header-row">
          <div>
            <h2>Stocktake / Cycle Count</h2>
            <p className="muted-text">Enter the physical count and apply a safe count correction using the existing stock adjustment ledger.</p>
          </div>
          {!canAdjustStock ? <span className="muted-text">MANAGER+ only</span> : null}
        </div>

        {canAdjustStock ? (
          <>
            <div className="inventory-adjustment-summary inventory-count-summary">
              <div className="metric-card">
                <span className="metric-label">Current Stock</span>
                <strong className="metric-value">{stock?.onHand ?? 0}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Counted Stock</span>
                <strong className="metric-value">{parsedCountedQuantity === null || Number.isNaN(parsedCountedQuantity) ? "-" : parsedCountedQuantity}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Adjustment</span>
                <strong className="metric-value">
                  {cycleCountDifference === null ? "-" : (
                    <span className={cycleCountDifference < 0 ? "movement-negative" : "movement-positive"}>
                      {formatSignedQuantity(cycleCountDifference)}
                    </span>
                  )}
                </strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Resulting Stock</span>
                <strong className="metric-value">
                  {parsedCountedQuantity === null || Number.isNaN(parsedCountedQuantity) ? "-" : (
                    <span className={getStockStateClass(parsedCountedQuantity, lowStockThreshold)}>
                      {parsedCountedQuantity}
                    </span>
                  )}
                </strong>
              </div>
            </div>

            <form className="inventory-adjustment-form inventory-count-form" onSubmit={submitCycleCount}>
              <label>
                Counted Quantity
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={countedQuantity}
                  onChange={(event) => setCountedQuantity(event.target.value)}
                  placeholder="Enter physical count"
                  required
                />
              </label>

              <label className="inventory-adjustment-note">
                Note
                <input
                  value={countNote}
                  onChange={(event) => setCountNote(event.target.value)}
                  placeholder="Optional note for this count"
                />
              </label>

              <button
                type="submit"
                className="primary"
                disabled={submittingCount || cycleCountValidationMessage !== null}
              >
                {submittingCount ? "Applying..." : "Apply Count"}
              </button>
            </form>

            {cycleCountValidationMessage ? (
              <p className="inventory-adjustment-validation">{cycleCountValidationMessage}</p>
            ) : null}
          </>
        ) : (
          <p className="muted-text">Cycle counts are available to MANAGER+ only.</p>
        )}
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
          <div>
            <h2>Movement History</h2>
            <p className="muted-text">
              Review purchasing receipts, retail sales, workshop usage, and manual corrections in one place. Use the filters to isolate a specific stock story.
            </p>
          </div>
          {movementNotice ? <span className="muted-text">{movementNotice}</span> : null}
        </div>

        {canViewMovements ? (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <span className="metric-label">Purchased</span>
                <strong className="metric-value">{purchaseQty}</strong>
                <span className="dashboard-metric-detail">Visible receipts</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Sold</span>
                <strong className="metric-value">{salesQty}</strong>
                <span className="dashboard-metric-detail">Retail sale movement</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Workshop Used</span>
                <strong className="metric-value">{workshopUseQty}</strong>
                <span className="dashboard-metric-detail">Bike job consumption</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Net Adjustments</span>
                <strong className="metric-value">{adjustmentNetQty > 0 ? `+${adjustmentNetQty}` : adjustmentNetQty}</strong>
                <span className="dashboard-metric-detail">Manual corrections</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Latest Movement</span>
                <strong className="metric-value">{latestMovementAt ? new Date(latestMovementAt).toLocaleDateString() : "-"}</strong>
                <span className="dashboard-metric-detail">Newest visible entry</span>
              </div>
            </div>

            {workshopUseQty > 0 ? (
              <div className="actions-inline">
                <button type="button" className="button-link" onClick={() => setMovementType("WORKSHOP_USE")}>
                  Show workshop use only
                </button>
                {movementType ? (
                  <button type="button" className="button-link" onClick={() => setMovementType("")}>
                    Clear movement type filter
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="filter-row">
              <label>
                Type
                <select
                  value={movementType}
                  onChange={(event) => setMovementType(event.target.value as (typeof MOVEMENT_TYPE_OPTIONS)[number])}
                >
                  <option value="">All</option>
                  {MOVEMENT_TYPE_OPTIONS.filter((option) => option).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                From
                <input type="date" value={movementFrom} onChange={(event) => setMovementFrom(event.target.value)} />
              </label>

              <label>
                To
                <input type="date" value={movementTo} onChange={(event) => setMovementTo(event.target.value)} />
              </label>

              <button type="button" onClick={() => void loadMovements()} disabled={movementLoading}>
                {movementLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Change</th>
                <th>Reason</th>
                <th>Unit Cost</th>
                <th>Stock Story</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    {canViewMovements
                      ? movementLoading
                        ? "Loading movement history..."
                        : "No movements match the current filters. Clear the date or type filter to review the full stock history."
                      : "Movement history hidden for STAFF users."}
                  </td>
                </tr>
              ) : (
                movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>
                      <div className="table-primary">{new Date(movement.createdAt).toLocaleString()}</div>
                      {movement.createdByStaffId ? (
                        <div className="table-secondary mono-text">{movement.createdByStaffId}</div>
                      ) : null}
                    </td>
                    <td>
                      <span className="stock-badge stock-muted">{formatMovementTypeLabel(movement.type)}</span>
                    </td>
                    <td className={movement.quantity < 0 ? "numeric-cell movement-negative" : "numeric-cell movement-positive"}>
                      {formatSignedQuantity(movement.quantity)}
                    </td>
                    <td>
                      <div className="table-primary">{formatMovementReferenceLabel(movement.referenceType, movement.referenceId).primary}</div>
                      {formatMovementReferenceLabel(movement.referenceType, movement.referenceId).secondary ? (
                        <div className="table-secondary mono-text">{formatMovementReferenceLabel(movement.referenceType, movement.referenceId).secondary}</div>
                      ) : null}
                    </td>
                    <td>{movement.unitCost ? `£${movement.unitCost}` : "-"}</td>
                    <td>{getMovementStory(movement)}</td>
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
