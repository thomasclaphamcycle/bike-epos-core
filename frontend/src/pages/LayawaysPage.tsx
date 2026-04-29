import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { formatCurrencyFromPence } from "../utils/currency";

type LayawayRow = {
  id: string;
  saleId: string;
  status: string;
  totalPence: number;
  depositPaidPence: number;
  remainingPence: number;
  expiresAt: string;
  isOverdue: boolean;
  requiresReview: boolean;
  stockReleasedAt: string | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  items: Array<{
    id: string;
    productName: string;
    variantName: string | null;
    sku: string;
    quantity: number;
  }>;
};

type LayawayListResponse = {
  layaways: LayawayRow[];
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

export const LayawaysPage = () => {
  const navigate = useNavigate();
  const [layaways, setLayaways] = useState<LayawayRow[]>([]);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLayaways = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<LayawayListResponse>(
        `/api/layaways${includeClosed ? "?includeClosed=true" : ""}`,
      );
      setLayaways(payload.layaways);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load layaways");
    } finally {
      setLoading(false);
    }
  }, [includeClosed]);

  useEffect(() => {
    void loadLayaways();
  }, [loadLayaways]);

  const cancelLayaway = async (layaway: LayawayRow) => {
    setError(null);
    setMessage(null);
    try {
      await apiPost(`/api/layaways/${encodeURIComponent(layaway.id)}/cancel`, {});
      setMessage("Layaway cancelled and stock released.");
      await loadLayaways();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel layaway");
    }
  };

  return (
    <main className="management-page layaway-page">
      <section className="management-hero">
        <div>
          <p className="eyebrow">POS</p>
          <h1>Layaways</h1>
          <p>Open stock holds, part-paid orders, and overdue layaways needing review.</p>
        </div>
        <div className="actions-inline">
          <Link className="button-link" to="/pos">Open POS</Link>
          <button type="button" onClick={() => void loadLayaways()}>Refresh</button>
        </div>
      </section>

      <section className="store-info-card">
        <div className="section-header">
          <div>
            <h2>Held Stock</h2>
            <p>Unpaid expired layaways release automatically. Part-paid overdue layaways stay held for staff review.</p>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(event) => setIncludeClosed(event.target.checked)}
            />
            Include closed
          </label>
        </div>
        {message ? <div className="form-success">{message}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
        {loading ? (
          <p className="muted-text">Loading layaways...</p>
        ) : layaways.length === 0 ? (
          <p className="muted-text">No layaways to review.</p>
        ) : (
          <div className="layaway-list">
            {layaways.map((layaway) => (
              <article key={layaway.id} className={`layaway-row${layaway.isOverdue ? " layaway-row--overdue" : ""}`}>
                <div>
                  <div className="table-primary">{layaway.customer?.name ?? "Walk-in customer"}</div>
                  <div className="muted-text">
                    {layaway.items.map((item) => `${item.quantity}x ${item.productName}`).join(", ")}
                  </div>
                </div>
                <div>
                  <span className="metric-label">Status</span>
                  <strong>{layaway.requiresReview ? "Review overdue" : layaway.status.replaceAll("_", " ")}</strong>
                </div>
                <div>
                  <span className="metric-label">Deposit</span>
                  <strong>{formatCurrencyFromPence(layaway.depositPaidPence)}</strong>
                </div>
                <div>
                  <span className="metric-label">Remaining</span>
                  <strong>{formatCurrencyFromPence(layaway.remainingPence)}</strong>
                </div>
                <div>
                  <span className="metric-label">Expires</span>
                  <strong>{formatDate(layaway.expiresAt)}</strong>
                </div>
                <div className="actions-inline">
                  <button
                    type="button"
                    onClick={() => navigate(`/pos?saleId=${encodeURIComponent(layaway.saleId)}`)}
                    disabled={Boolean(layaway.stockReleasedAt)}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelLayaway(layaway)}
                    disabled={layaway.depositPaidPence > 0 || Boolean(layaway.stockReleasedAt) || layaway.status === "COMPLETED"}
                    title={layaway.depositPaidPence > 0 ? "Part-paid layaways need refund or store-credit review first" : undefined}
                  >
                    Release
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};
