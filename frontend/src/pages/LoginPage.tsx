import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiGet, ApiError } from "../api/client";
import { toRoleHomeRoute } from "../utils/homeRoute";
import CorePosLogo from "../components/branding/CorePosLogo";
import { appBuildLabel } from "../utils/buildInfo";

type ActiveLoginUser = {
  id: string;
  displayName: string;
  role: "STAFF" | "MANAGER" | "ADMIN";
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
  const [pinFocused, setPinFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

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

  const focusPinInput = useCallback(() => {
    requestAnimationFrame(() => {
      pinInputRef.current?.focus();
    });
  }, []);

  const canSubmit = useMemo(
    () => Boolean(selectedUserId) && /^\d{4}$/.test(pin) && !submitting && !usersLoading,
    [selectedUserId, pin, submitting, usersLoading],
  );

  const submitPinLogin = useCallback(async () => {
    if (!selectedUserId || !/^\d{4}$/.test(pin)) {
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
        setPin("");
        focusPinInput();
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
  }, [focusPinInput, loginWithPin, navigate, pin, redirectTarget, selectedUserId]);

  useEffect(() => {
    if (selectedUserId && /^\d{4}$/.test(pin) && !submitting && !usersLoading) {
      void submitPinLogin();
    }
  }, [pin, selectedUserId, submitPinLogin, submitting, usersLoading]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await submitPinLogin();
  };

  return (
    <div className="login-shell">
      <div className="login-stage">
        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-logo-wrap">
            <CorePosLogo variant="stacked" size={228} />
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
                    focusPinInput();
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

          <div className="login-pin-section">
            <div className="login-pin-labels">
              <label htmlFor="pin">PIN</label>
              <p className="login-pin-help">
                {submitting ? "Logging in..." : "Enter 4-digit PIN"}
              </p>
            </div>
            <div
              className={`login-pin-shell${errorMessage ? " login-pin-shell-error" : ""}`}
              onClick={() => pinInputRef.current?.focus()}
            >
              <input
                id="pin"
                ref={pinInputRef}
                data-testid="login-pin"
                className="login-pin-input"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
                  setErrorMessage(null);
                }}
                onFocus={() => setPinFocused(true)}
                onBlur={() => setPinFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canSubmit) {
                    event.preventDefault();
                    void submitPinLogin();
                  }
                }}
                autoComplete="one-time-code"
                required
              />
              <div className="login-pin-slots" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, index) => {
                  const hasValue = index < pin.length;
                  const isActive = pinFocused && index === Math.min(pin.length, 3);
                  return (
                    <span
                      key={index}
                      className={`login-pin-slot${hasValue ? " login-pin-slot-filled" : ""}${isActive ? " login-pin-slot-active" : ""}`}
                    >
                      {hasValue ? "•" : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          <p className="login-build-info">{appBuildLabel}</p>
        </form>
      </div>
    </div>
  );
};
