import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiGet, ApiError } from "../api/client";
import { toRoleHomeRoute } from "../utils/homeRoute";
import CorePosLogo from "../components/branding/CorePosLogo";

type ActiveLoginUser = {
  id: string;
  displayName: string;
  role: "STAFF" | "MANAGER" | "ADMIN";
  hasPin: boolean;
};

export const LoginPage = () => {
  const { user, loginWithPin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTarget = useMemo(() => {
    const fromState = (location.state as { from?: string } | null)?.from;
    if (fromState) {
      return fromState;
    }
    const next = new URLSearchParams(location.search).get("next");
    return next || null;
  }, [location.search, location.state]);

  const [users, setUsers] = useState<ActiveLoginUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) || null,
    [users, selectedUserId],
  );
  const noPinSelected = Boolean(selectedUser && !selectedUser.hasPin);
  const noPinMessage = "No PIN has been set for this user yet. Please ask a manager to set or reset the PIN.";

  useEffect(() => {
    if (user) {
      navigate(redirectTarget || toRoleHomeRoute(user.role), { replace: true });
    }
  }, [user, navigate, redirectTarget]);

  useEffect(() => {
    void (async () => {
      setUsersLoading(true);
      setErrorMessage(null);
      try {
        const payload = await apiGet<{ users: ActiveLoginUser[] }>("/api/auth/active-users");
        setUsers(payload.users || []);
      } catch (error) {
        if (error instanceof Error) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Failed to load active users.");
        }
      } finally {
        setUsersLoading(false);
      }
    })();
  }, []);

  const canSubmit = useMemo(
    () => Boolean(selectedUserId) && !noPinSelected && /^\d{4}$/.test(pin) && !submitting && !usersLoading,
    [selectedUserId, noPinSelected, pin, submitting, usersLoading],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUserId || noPinSelected || !/^\d{4}$/.test(pin)) {
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await loginWithPin(selectedUserId, pin);
      navigate(redirectTarget || "/home", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setErrorMessage("Incorrect PIN");
      } else if (error instanceof ApiError && error.status === 429) {
        setErrorMessage(error.message);
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
        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-logo-wrap">
            <CorePosLogo variant="stacked" size={200} />
          </div>

          <div className="login-user-list" data-testid="login-user-list">
            {usersLoading ? (
              <div className="login-inline-status">Loading staff...</div>
            ) : users.length ? (
              users.map((loginUser) => (
                <button
                  key={loginUser.id}
                  type="button"
                  className={selectedUserId === loginUser.id ? "login-user-button login-user-button-active" : "login-user-button"}
                  data-testid={`login-user-${loginUser.id}`}
                  onClick={() => {
                    setSelectedUserId(loginUser.id);
                    setErrorMessage(null);
                  }}
                  disabled={submitting}
                >
                  <span className="login-user-name">{loginUser.displayName}</span>
                  <span className="login-user-role">{loginUser.role}</span>
                </button>
              ))
            ) : (
              <div className="login-inline-status">No active users available.</div>
            )}
          </div>

          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            data-testid="login-pin"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
            autoComplete="one-time-code"
            required
          />

          {noPinSelected ? (
            <p className="login-inline-status login-pin-help" data-testid="login-no-pin-message">
              {noPinMessage}
            </p>
          ) : null}

          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

          <button
            className="primary login-submit-button"
            data-testid="login-submit"
            type="submit"
            disabled={!canSubmit}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};
