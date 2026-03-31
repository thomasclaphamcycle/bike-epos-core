import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { SalesReceipt, type SalesReceiptData } from "../features/receipts/SalesReceipt";

type SaleReceiptLookup = {
  receiptNumber: string;
};

export const SalesReceiptPrintPage = () => {
  const { saleId } = useParams<{ saleId: string }>();
  const { error } = useToasts();
  const [receipt, setReceipt] = useState<SalesReceiptData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!saleId) {
      return;
    }

    let active = true;
    const loadReceipt = async () => {
      setLoading(true);
      try {
        const issuedReceipt = await apiGet<SaleReceiptLookup>(`/api/sales/${encodeURIComponent(saleId)}/receipt`);
        const payload = await apiGet<SalesReceiptData>(
          `/api/receipts/${encodeURIComponent(issuedReceipt.receiptNumber)}`,
        );
        if (active) {
          setReceipt(payload);
        }
      } catch (loadError) {
        if (active) {
          error(loadError instanceof Error ? loadError.message : "Failed to load receipt");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadReceipt();
    return () => {
      active = false;
    };
  }, [error, saleId]);

  useEffect(() => {
    if (!receipt) {
      return undefined;
    }

    const previousTitle = document.title;
    document.title = `Receipt · ${receipt.receiptNumber}`;
    return () => {
      document.title = previousTitle;
    };
  }, [receipt]);

  const printPageStyle = useMemo(() => (
    `@media print {
      @page {
        size: 80mm auto;
        margin: 0;
      }
    }`
  ), []);

  if (!saleId) {
    return <div className="page-shell"><p>Missing sale id.</p></div>;
  }

  return (
    <div className="sales-receipt-print-page">
      <style media="print">{printPageStyle}</style>

      <div className="sales-receipt-print-page__actions">
        <Link to="/pos">Back to POS</Link>
        <button type="button" className="primary" onClick={() => window.print()} disabled={!receipt || loading}>
          {loading ? "Loading..." : "Print receipt"}
        </button>
      </div>

      <div className="sales-receipt-print-page__copy">
        <h1>Sales Receipt</h1>
        <p className="muted-text">
          Thermal-style browser print preview for the completed sale receipt.
        </p>
      </div>

      <div className="sales-receipt-print-page__sheet">
        {receipt ? (
          <SalesReceipt receipt={receipt} />
        ) : loading ? (
          <div className="card">Loading receipt…</div>
        ) : (
          <div className="card">Receipt is not available.</div>
        )}
      </div>
    </div>
  );
};
