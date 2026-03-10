import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type PinStatusResponse = {
  hasPin: boolean;
};

const PIN_REGEX = /^\d{4}$/;

export const PinSettingsPage = () => {
  const { success, error } = useToasts();
  const [loading, setLoading] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<PinStatusResponse>("/api/auth/pin-status");
      setHasPin(payload.hasPin);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load PIN status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = () => {
    if (hasPin && !PIN_REGEX.test(currentPin.trim())) {
      error("Current PIN must be exactly 4 digits.");
      return false;
    }
    if (!PIN_REGEX.test(pin.trim())) {
      error("New PIN must be exactly 4 digits.");
      return false;
    }
    if (pin.trim() !== confirmPin.trim()) {
      error("PIN confirmation does not match.");
      return false;
    }
    return true;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }

    setSubmitting(true);
    try {
      if (hasPin) {
        await apiPatch("/api/auth/pin", {
          currentPin: currentPin.trim(),
          nextPin: pin.trim(),
        });
        success("PIN updated");
      } else {
        await apiPost("/api/auth/pin", {
          pin: pin.trim(),
        });
        success("PIN created");
      }

      setCurrentPin("");
      setPin("");
      setConfirmPin("");
      await loadStatus();
    } catch (submitError) {
      error(submitError instanceof Error ? submitError.message : "Failed to save PIN");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>My PIN</h1>
            <p className="muted-text">
              Set a 4-digit PIN for fast in-store sign-in. Password login remains active during this foundation rollout.
            </p>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Current status</span>
            <strong className="metric-value">{loading ? "Checking..." : hasPin ? "PIN set" : "No PIN yet"}</strong>
            <span className="dashboard-metric-detail">
              {hasPin
                ? "Change your PIN below. The existing PIN is never displayed."
                : "Create a 4-digit PIN. You will use it for the upcoming staff-button login flow."}
            </span>
          </div>
        </div>

        <form className="purchase-form-grid" onSubmit={onSubmit}>
          {hasPin ? (
            <label>
              Current PIN
              <input
                inputMode="numeric"
                pattern="\d{4}"
                value={currentPin}
                onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4 digits"
              />
            </label>
          ) : null}

          <label>
            {hasPin ? "New PIN" : "PIN"}
            <input
              inputMode="numeric"
              pattern="\d{4}"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="4 digits"
            />
          </label>

          <label>
            Confirm PIN
            <input
              inputMode="numeric"
              pattern="\d{4}"
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Repeat PIN"
            />
          </label>

          <div className="actions-inline">
            <button className="primary" type="submit" disabled={submitting || loading}>
              {submitting ? "Saving..." : hasPin ? "Change PIN" : "Create PIN"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
