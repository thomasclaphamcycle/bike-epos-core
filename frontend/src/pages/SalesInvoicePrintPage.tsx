import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAppConfig } from "../config/appConfig";
import {
  SalesInvoiceDocument,
  type SalesInvoiceData,
} from "../features/documents/SalesInvoiceDocument";

type SaleReceiptLookup = {
  receiptNumber: string;
};

export const SalesInvoicePrintPage = () => {
  const { saleId } = useParams<{ saleId: string }>();
  const appConfig = useAppConfig();
  const { error } = useToasts();
  const [sale, setSale] = useState<SalesInvoiceData | null>(null);
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!saleId) {
      return;
    }

    let active = true;
    const loadSale = async () => {
      setLoading(true);
      try {
        const salePayload = await apiGet<SalesInvoiceData>(`/api/sales/${encodeURIComponent(saleId)}`);
        if (!active) {
          return;
        }

        setSale(salePayload);

        if (!salePayload.sale.completedAt) {
          setReceiptNumber(null);
          return;
        }

        const receiptPayload = await apiGet<SaleReceiptLookup>(`/api/sales/${encodeURIComponent(saleId)}/receipt`);
        if (active) {
          setReceiptNumber(receiptPayload.receiptNumber);
        }
      } catch (loadError) {
        if (active) {
          error(loadError instanceof Error ? loadError.message : "Failed to load sale document");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadSale();
    return () => {
      active = false;
    };
  }, [error, saleId]);

  useEffect(() => {
    if (!sale) {
      return undefined;
    }

    const previousTitle = document.title;
    const documentNumber = receiptNumber || sale.sale.receiptNumber || sale.sale.id.slice(0, 8).toUpperCase();
    document.title = `Invoice · ${documentNumber}`;
    return () => {
      document.title = previousTitle;
    };
  }, [receiptNumber, sale]);

  const printPageStyle = useMemo(() => (
    `@media print {
      @page {
        size: A4 portrait;
        margin: 12mm;
      }
    }`
  ), []);

  if (!saleId) {
    return <div className="page-shell"><p>Missing sale id.</p></div>;
  }

  const isIncompleteSale = Boolean(sale && !sale.sale.completedAt);

  return (
    <div className="sales-invoice-print-page">
      <style media="print">{printPageStyle}</style>

      <div className="sales-invoice-print-page__actions">
        <div className="actions-inline">
          <Link to="/sales-history/transactions">Back to sales history</Link>
          <Link to={`/sales/${encodeURIComponent(saleId)}/receipt/print`}>Open thermal receipt</Link>
        </div>
        <button type="button" className="primary" onClick={() => window.print()} disabled={!sale || loading || isIncompleteSale}>
          {loading ? "Loading..." : "Print A4 invoice"}
        </button>
      </div>

      <div className="sales-invoice-print-page__copy">
        <h1>Sales Invoice</h1>
        <p className="muted-text">
          Office-style browser print page for A4 filing, workshop paperwork, and Xerox-style document output. Use the print dialog to choose the office printer.
        </p>
      </div>

      <div className="sales-invoice-print-page__sheet">
        {sale ? (
          sale.sale.completedAt ? (
            <SalesInvoiceDocument sale={sale} appConfig={appConfig} receiptNumber={receiptNumber} />
          ) : (
            <div className="card sales-invoice-print-page__state-card">
              <strong>Invoice print is available after the sale is completed.</strong>
              <p className="muted-text">Complete the sale first, then reopen this page to print the A4 office document.</p>
            </div>
          )
        ) : loading ? (
          <div className="card sales-invoice-print-page__state-card">Loading invoice…</div>
        ) : (
          <div className="card sales-invoice-print-page__state-card">Sale invoice is not available.</div>
        )}
      </div>
    </div>
  );
};
