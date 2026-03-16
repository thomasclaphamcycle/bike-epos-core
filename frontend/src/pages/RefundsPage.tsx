import { useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { toBackendUrl } from "../utils/backendUrl";

type SaleLine = {
  id: string;
  quantity: number;
  unitPricePence: number;
  lineTotalPence: number;
  productName: string;
  variantName: string | null;
};

type SalePayload = {
  sale: {
    id: string;
    completedAt: string | null;
    totalPence: number;
    receiptNumber: string | null;
  };
  saleItems: SaleLine[];
};

type ReceiptLookup = {
  receiptNumber: string;
  saleId: string | null;
};

type RefundSummaryPayload = {
  refund: {
    id: string;
    computedTotalPence: number;
    status: string;
    receiptNumber: string | null;
    returnToStock?: boolean;
  };
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const isUuidLike = (value: string) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value.trim());

export const RefundsPage = () => {
  const { user } = useAuth();
  const { success, error } = useToasts();

  const [lookup, setLookup] = useState("");
  const [loadingSale, setLoadingSale] = useState(false);
  const [salePayload, setSalePayload] = useState<SalePayload | null>(null);

  const [lineQtyById, setLineQtyById] = useState<Record<string, number>>({});
  const [tenderType, setTenderType] = useState<"CASH" | "CARD" | "VOUCHER" | "OTHER">("CARD");
  const [returnToStock, setReturnToStock] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [result, setResult] = useState<{
    refundId: string;
    receiptNumber: string | null;
    receiptUrl: string;
  } | null>(null);

  const canManageRefunds = user?.role === "MANAGER" || user?.role === "ADMIN";

  const estimatedTotalPence = useMemo(() => {
    if (!salePayload) {
      return 0;
    }
    return salePayload.saleItems.reduce((sum, line) => {
      const qty = Math.max(0, Math.min(line.quantity, lineQtyById[line.id] ?? 0));
      return sum + qty * line.unitPricePence;
    }, 0);
  }, [salePayload, lineQtyById]);

  const hydrateLineDefaults = (payload: SalePayload) => {
    setLineQtyById(
      Object.fromEntries(payload.saleItems.map((line) => [line.id, line.quantity])),
    );
  };

  const loadSale = async () => {
    const query = lookup.trim();
    if (!query) {
      error("Enter a sale id or receipt number");
      return;
    }

    setLoadingSale(true);
    setResult(null);

    try {
      let saleId = query;

      if (!isUuidLike(query)) {
        const receipt = await apiGet<ReceiptLookup>(`/api/receipts/${encodeURIComponent(query)}`);
        if (!receipt.saleId) {
          throw new Error("Receipt is not linked to a sale");
        }
        saleId = receipt.saleId;
      }

      const payload = await apiGet<SalePayload>(`/api/sales/${encodeURIComponent(saleId)}`);
      if (!payload.sale.completedAt) {
        throw new Error("Sale is not completed; only completed sales can be refunded");
      }

      setSalePayload(payload);
      hydrateLineDefaults(payload);
      success("Sale loaded");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load sale";
      error(message);
      setSalePayload(null);
    } finally {
      setLoadingSale(false);
    }
  };

  const submitRefund = async () => {
    if (!salePayload) {
      error("Load a sale first");
      return;
    }

    const selectedLines = salePayload.saleItems
      .map((line) => {
        const qty = Math.max(0, Math.min(line.quantity, lineQtyById[line.id] ?? 0));
        return {
          line,
          qty,
        };
      })
      .filter((entry) => entry.qty > 0);

    if (selectedLines.length === 0) {
      error("Select at least one line quantity to refund");
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiPost<RefundSummaryPayload>("/api/refunds", {
        saleId: salePayload.sale.id,
      });
      const refundId = created.refund.id;

      let latestSummary: RefundSummaryPayload = created;

      for (const entry of selectedLines) {
        latestSummary = await apiPost<RefundSummaryPayload>(
          `/api/refunds/${encodeURIComponent(refundId)}/lines`,
          {
            saleLineId: entry.line.id,
            quantity: entry.qty,
          },
        );
      }

      const totalPence = latestSummary.refund.computedTotalPence;
      if (!Number.isInteger(totalPence) || totalPence <= 0) {
        throw new Error("Refund total computed as zero");
      }

      await apiPost(`/api/refunds/${encodeURIComponent(refundId)}/tenders`, {
        tenderType,
        amountPence: totalPence,
      });

      const completed = await apiPost<RefundSummaryPayload>(
        `/api/refunds/${encodeURIComponent(refundId)}/complete`,
        {
          returnToStock,
        },
      );

      const issued = await apiPost<{ receipt: { receiptNumber: string } | null }>(
        "/api/receipts/issue",
        {
          refundId,
        },
      );

      const receiptNumber = issued.receipt?.receiptNumber || completed.refund.receiptNumber || null;
      const receiptUrl = receiptNumber
        ? `/r/${encodeURIComponent(receiptNumber)}`
        : `/api/refunds/${encodeURIComponent(refundId)}`;

      setResult({
        refundId,
        receiptNumber,
        receiptUrl,
      });
      success("Refund completed");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Refund failed";
      error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!canManageRefunds) {
    return (
      <div className="page-shell">
        <section className="card">
          <h1>Refunds</h1>
          <p className="error-banner">Manager access required.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <section className="card">
        <h1>Refunds</h1>
        <div className="filter-row">
          <label className="grow">
            Sale ID or Receipt Number
            <input
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              placeholder="paste sale id or receipt number"
            />
          </label>
          <button type="button" onClick={() => void loadSale()} disabled={loadingSale}>
            {loadingSale ? "Loading..." : "Load Sale"}
          </button>
        </div>
      </section>

      {salePayload ? (
        <section className="card">
          <h2>Sale {salePayload.sale.id.slice(0, 8)}</h2>
          <p className="muted-text">
            Completed: {salePayload.sale.completedAt ? new Date(salePayload.sale.completedAt).toLocaleString() : "-"}
            {" | "}
            Total: {formatMoney(salePayload.sale.totalPence)}
            {" | "}
            Receipt: {salePayload.sale.receiptNumber || "-"}
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Sold Qty</th>
                  <th>Refund Qty</th>
                  <th>Unit</th>
                  <th>Line Refund</th>
                </tr>
              </thead>
              <tbody>
                {salePayload.saleItems.map((line) => {
                  const currentQty = Math.max(0, Math.min(line.quantity, lineQtyById[line.id] ?? 0));
                  return (
                    <tr key={line.id}>
                      <td>{line.productName}{line.variantName ? ` (${line.variantName})` : ""}</td>
                      <td>{line.quantity}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={line.quantity}
                          value={currentQty}
                          onChange={(event) => {
                            const raw = Number(event.target.value);
                            const next = Number.isFinite(raw) ? Math.max(0, Math.min(line.quantity, raw)) : 0;
                            setLineQtyById((prev) => ({
                              ...prev,
                              [line.id]: next,
                            }));
                          }}
                        />
                      </td>
                      <td>{formatMoney(line.unitPricePence)}</td>
                      <td>{formatMoney(currentQty * line.unitPricePence)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="filter-row" style={{ marginTop: "10px" }}>
            <label>
              Tender Method
              <select value={tenderType} onChange={(event) => setTenderType(event.target.value as typeof tenderType)}>
                <option value="CARD">CARD</option>
                <option value="CASH">CASH</option>
                <option value="VOUCHER">VOUCHER</option>
                <option value="OTHER">OTHER</option>
              </select>
            </label>

            <label>
              <span>Return items to stock</span>
              <input
                type="checkbox"
                checked={returnToStock}
                onChange={(event) => setReturnToStock(event.target.checked)}
                style={{ width: "18px", minHeight: "18px" }}
              />
            </label>

            <div className="totals-row">
              <strong>Estimated Refund:</strong> {formatMoney(estimatedTotalPence)}
            </div>

            <button type="button" className="primary" onClick={() => void submitRefund()} disabled={submitting}>
              {submitting ? "Processing..." : "Process Refund"}
            </button>
          </div>

          {result ? (
            <div className="success-panel">
              <strong>Refund completed: {result.refundId}</strong>
              <div className="success-links">
                <a href={toBackendUrl(result.receiptUrl)} target="_blank" rel="noreferrer">
                  {result.receiptNumber ? `Open receipt ${result.receiptNumber}` : "Open refund"}
                </a>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};
