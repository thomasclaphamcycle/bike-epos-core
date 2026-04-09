import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useToasts } from "../components/ToastProvider";
import {
  getManagedReceiptPrintErrorMessage,
  getManagedReceiptPrintSuccessMessage,
  prepareManagedReceiptPrint,
  printManagedReceipt,
  type ReceiptPrintPreparationResponse,
} from "../features/receipts/managedReceiptPrinting";
import { getStoredReceiptWorkstationKey } from "../features/receipts/receiptWorkstation";
import { SalesReceipt, type SalesReceiptData } from "../features/receipts/SalesReceipt";

export const SalesReceiptPrintPage = () => {
  const { saleId } = useParams<{ saleId: string }>();
  const { error, success } = useToasts();
  const [receipt, setReceipt] = useState<SalesReceiptData | null>(null);
  const [preparation, setPreparation] = useState<ReceiptPrintPreparationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
  const workstationKey = useMemo(() => getStoredReceiptWorkstationKey(), []);

  useEffect(() => {
    if (!saleId) {
      return;
    }

    let active = true;
    const loadReceipt = async () => {
      setLoading(true);
      try {
        const payload = await prepareManagedReceiptPrint(
          saleId,
          workstationKey ? { workstationKey } : {},
        );
        if (active) {
          setPreparation(payload);
          setReceipt(payload.receipt);
          setSelectedPrinterId(payload.printer?.id ?? "");
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
  }, [error, saleId, workstationKey]);

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

  const handleManagedPrint = async () => {
    if (!saleId) {
      return;
    }

    setPrinting(true);
    try {
      const result = await printManagedReceipt(saleId, {
        workstationKey,
        printerId: selectedPrinterId || undefined,
      });
      success(getManagedReceiptPrintSuccessMessage(result));
      setPreparation((current) => current ? {
        ...current,
        printer: {
          ...result.printer,
        },
      } : current);
    } catch (printError) {
      error(getManagedReceiptPrintErrorMessage(printError));
    } finally {
      setPrinting(false);
    }
  };

  if (!saleId) {
    return <div className="page-shell"><p>Missing sale id.</p></div>;
  }

  return (
    <div className="sales-receipt-print-page">
      <style media="print">{printPageStyle}</style>

      <div className="sales-receipt-print-page__actions">
        <div className="actions-inline">
          <Link to="/pos">Back to POS</Link>
          <Link to={`/sales/${encodeURIComponent(saleId)}/invoice/print`}>Open A4 invoice</Link>
        </div>
        <div className="actions-inline">
          {preparation && preparation.availablePrinters.length > 0 ? (
            <label className="sales-receipt-print-page__printer-select">
              <span>Receipt printer</span>
              <select
                value={selectedPrinterId}
                onChange={(event) => setSelectedPrinterId(event.target.value)}
                disabled={loading || printing}
              >
                <option value="">Use workstation/default route</option>
                {preparation.availablePrinters.map((printer) => (
                  <option key={printer.id} value={printer.id}>
                    {printer.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="primary"
            onClick={() => void handleManagedPrint()}
            disabled={!receipt || loading || printing || Boolean(preparation?.resolutionError && !selectedPrinterId)}
          >
            {loading ? "Loading..." : printing ? "Printing..." : "Print receipt"}
          </button>
          <button type="button" onClick={() => window.print()} disabled={!receipt || loading}>
            Use browser print (fallback)
          </button>
        </div>
      </div>

      <div className="sales-receipt-print-page__copy">
        <h1>Sales Receipt</h1>
        <p className="muted-text">
          Managed thermal receipt printing is the main path here. Browser print remains available as an explicit fallback.
        </p>
        {preparation?.currentWorkstation ? (
          <p className="muted-text">
            This browser is using <strong>{preparation.currentWorkstation.label}</strong> for receipt defaults.
          </p>
        ) : null}
        {preparation?.printer ? (
          <p className="muted-text">
            Managed route: <strong>{preparation.printer.name}</strong>
            {preparation.printer.resolutionSource === "workstation" ? " via workstation default" : null}
            {preparation.printer.resolutionSource === "default" ? " via global default" : null}
          </p>
        ) : null}
        {preparation?.resolutionError ? (
          <p className="warning-text">{preparation.resolutionError.message}</p>
        ) : null}
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
