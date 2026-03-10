import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { toRoleHomeRoute } from "../utils/homeRoute";

export const LoginPage = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      navigate(toRoleHomeRoute(user.role), { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      await login(identifier, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || "/home", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setErrorMessage("Invalid username/email or password.");
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Login failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-stage">
        <section className="login-brand-panel" aria-label="CorePOS product summary">
          <div className="login-wordmark-lockup">
            <div className="login-wordmark-badge" aria-hidden="true">
              CP
            </div>
            <div>
              <p className="login-brand-kicker">CorePOS</p>
              <h1 className="login-brand-title">Retail and workshop operations</h1>
            </div>
          </div>

          <p className="login-brand-copy">
            One workspace for point of sale, workshop jobs, stock control, purchasing,
            and day-to-day management.
          </p>

          <div className="login-brand-points">
            <div className="login-brand-point">
              <strong>Retail ready</strong>
              <span>Fast POS, receipts, refunds, tills, and daily trade control.</span>
            </div>
            <div className="login-brand-point">
              <strong>Workshop ready</strong>
              <span>Jobs, approvals, parts, collection, and planning in one flow.</span>
            </div>
          </div>
        </section>

        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-form-header">
            <p className="login-form-eyebrow">Staff sign in</p>
            <h2>Welcome back</h2>
            <p className="muted-text">
              Sign in with your CorePOS username or email to continue.
            </p>
          </div>

          <div className="login-demo-chip" aria-label="Demo credentials hint">
            Demo users: admin / manager / staff
          </div>

          <label htmlFor="identifier">Username or email</label>
          <input
            id="identifier"
            data-testid="login-email"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />

          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

          <button
            className="primary login-submit-button"
            data-testid="login-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};
