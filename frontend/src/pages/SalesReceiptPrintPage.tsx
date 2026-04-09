import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useToasts } from "../components/ToastProvider";
import {
  getManagedPrintJob,
  getManagedPrintJobStatusBadgeClassName,
  getManagedPrintJobStatusLabel,
  isManagedPrintJobTerminal,
  type ManagedPrintJobSummary,
} from "../features/printing/managedPrintJobs";
import {
  getManagedReceiptPrintErrorMessage,
  getManagedReceiptPrintSuccessMessage,
  prepareManagedReceiptPrint,
  printManagedReceipt,
  type ReceiptPrintPreparationResponse,
} from "../features/receipts/managedReceiptPrinting";
import { getStoredReceiptWorkstationKey } from "../features/receipts/receiptWorkstation";
import { SalesReceipt, type SalesReceiptData } from "../features/receipts/SalesReceipt";

const getReceiptPrintButtonLabel = (
  loading: boolean,
  queueing: boolean,
  printJob: ManagedPrintJobSummary | null,
) => {
  if (loading) {
    return "Loading...";
  }
  if (queueing) {
    return "Queueing...";
  }
  if (printJob?.status === "PENDING" || printJob?.status === "PROCESSING") {
    return "Printing...";
  }
  if (printJob?.status === "SUCCEEDED") {
    return "Reprint receipt";
  }
  if (printJob?.status === "FAILED" || printJob?.status === "CANCELLED") {
    return "Retry receipt print";
  }
  return "Print receipt";
};

export const SalesReceiptPrintPage = () => {
  const { saleId } = useParams<{ saleId: string }>();
  const { error, success } = useToasts();
  const [receipt, setReceipt] = useState<SalesReceiptData | null>(null);
  const [preparation, setPreparation] = useState<ReceiptPrintPreparationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
  const [printJob, setPrintJob] = useState<ManagedPrintJobSummary | null>(null);
  const workstationKey = useMemo(() => getStoredReceiptWorkstationKey(), []);
  const announcedFailedJobStateRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!printJob || isManagedPrintJobTerminal(printJob.status)) {
      return undefined;
    }

    let cancelled = false;
    const refreshJob = async () => {
      try {
        const payload = await getManagedPrintJob(printJob.id);
        if (!cancelled) {
          setPrintJob(payload.job);
        }
      } catch (jobError) {
        if (!cancelled) {
          error(jobError instanceof Error ? jobError.message : "Failed to refresh receipt print status");
        }
      }
    };

    void refreshJob();
    const intervalId = window.setInterval(() => {
      void refreshJob();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [error, printJob]);

  useEffect(() => {
    if (!printJob || (printJob.status !== "FAILED" && printJob.status !== "CANCELLED")) {
      return;
    }

    const failureKey = `${printJob.id}:${printJob.status}:${printJob.attemptCount}`;
    if (announcedFailedJobStateRef.current === failureKey) {
      return;
    }
    announcedFailedJobStateRef.current = failureKey;
    error(printJob.lastError || "Receipt print failed. Use browser print fallback if needed.");
  }, [error, printJob]);

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

    setQueueing(true);
    try {
      const result = await printManagedReceipt(saleId, {
        workstationKey,
        printerId: selectedPrinterId || undefined,
      });
      success(getManagedReceiptPrintSuccessMessage(result));
      announcedFailedJobStateRef.current = null;
      setPrintJob(result.job);
      setPreparation((current) => current ? {
        ...current,
        printer: {
          ...result.printer,
        },
      } : current);
    } catch (printError) {
      error(getManagedReceiptPrintErrorMessage(printError));
    } finally {
      setQueueing(false);
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
                disabled={loading || queueing || Boolean(printJob && !isManagedPrintJobTerminal(printJob.status))}
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
            disabled={
              !receipt
              || loading
              || queueing
              || Boolean(preparation?.resolutionError && !selectedPrinterId)
              || Boolean(printJob && !isManagedPrintJobTerminal(printJob.status))
            }
          >
            {getReceiptPrintButtonLabel(loading, queueing, printJob)}
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
        {printJob ? (
          <div className="sales-receipt-print-page__job-status">
            <span className={getManagedPrintJobStatusBadgeClassName(printJob.status)}>
              {getManagedPrintJobStatusLabel(printJob.status)}
            </span>
            <span className="table-secondary">
              Job {printJob.id.slice(0, 8)} on {printJob.printerName || "managed receipt printer"}
              {printJob.status === "PENDING" ? " is queued." : null}
              {printJob.status === "PROCESSING" ? " is printing now." : null}
              {printJob.status === "SUCCEEDED" ? " completed successfully." : null}
              {printJob.status === "FAILED" ? ` failed after ${printJob.attemptCount} attempt${printJob.attemptCount === 1 ? "" : "s"}.` : null}
              {printJob.status === "CANCELLED" ? " was cancelled." : null}
            </span>
            {printJob.lastError ? (
              <span className="warning-text">{printJob.lastError}</span>
            ) : null}
            {printJob.nextAttemptAt && !isManagedPrintJobTerminal(printJob.status) ? (
              <span className="table-secondary">
                Next retry due around {new Date(printJob.nextAttemptAt).toLocaleTimeString()}.
              </span>
            ) : null}
          </div>
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
