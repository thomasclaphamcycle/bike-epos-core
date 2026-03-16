import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

type UploadState = "idle" | "submitting" | "success";

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read receipt image"));
    };
    reader.onerror = () => reject(new Error("Failed to read receipt image"));
    reader.readAsDataURL(file);
  });

export const CashReceiptUploadPage = () => {
  const { token } = useParams<{ token: string }>();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => Boolean(token && selectedFile && status !== "submitting"),
    [selectedFile, status, token],
  );

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setErrorMessage(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !selectedFile || status === "submitting") {
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const imageDataUrl = await readFileAsDataUrl(selectedFile);
      const response = await fetch(`/api/public/receipt-upload/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageDataUrl }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string | { message?: string };
        receiptImageUrl?: string;
      };

      if (!response.ok) {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : typeof payload.error?.message === "string"
              ? payload.error.message
              : "Receipt upload failed";
        throw new Error(message);
      }

      setReceiptImageUrl(payload.receiptImageUrl ?? null);
      setStatus("success");
      setSelectedFile(null);
    } catch (error) {
      setStatus("idle");
      setErrorMessage(error instanceof Error ? error.message : "Receipt upload failed");
    }
  };

  return (
    <div className="login-shell cash-upload-shell">
      <div className="login-stage">
        <section className="login-card cash-upload-card">
          <div className="cash-upload-heading">
            <h1>Upload petty cash receipt</h1>
            <p className="muted-text">
              Use this page to attach a photo of the petty cash receipt to the cash-out entry.
            </p>
          </div>

          {status === "success" ? (
            <div className="success-panel">
              <strong>Receipt attached.</strong>
              <div className="success-links">
                {receiptImageUrl ? <a href={receiptImageUrl} target="_blank" rel="noreferrer">Open receipt</a> : null}
                <Link to="/login">Back to CorePOS</Link>
              </div>
            </div>
          ) : (
            <form className="cash-upload-form" onSubmit={(event) => void handleSubmit(event)}>
              <label>
                Receipt photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  capture="environment"
                  onChange={handleFileChange}
                />
              </label>

              {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

              <button type="submit" disabled={!canSubmit}>
                {status === "submitting" ? "Uploading..." : "Attach receipt"}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
};
