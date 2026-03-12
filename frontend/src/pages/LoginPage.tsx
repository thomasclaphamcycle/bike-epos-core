import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiGet, ApiError } from "../api/client";
import { normalizeLoginRedirectTarget } from "../utils/authRedirect";
import { toRoleHomeRoute } from "../utils/homeRoute";
import CorePosLogo from "../components/branding/CorePosLogo";
import { appBuildLabel } from "../utils/buildInfo";

type ActiveLoginUser = {
  id: string;
  displayName: string;
  role: "STAFF" | "MANAGER" | "ADMIN";
  hasPin: boolean;
};

export const LoginPage = () => {
  const { user, login, loginWithPin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTarget = useMemo(() => {
    const fromState = normalizeLoginRedirectTarget((location.state as { from?: string } | null)?.from);
    if (fromState) {
      return fromState;
    }
    return normalizeLoginRedirectTarget(new URLSearchParams(location.search).get("next"));
  }, [location.search, location.state]);

  const [users, setUsers] = useState<ActiveLoginUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [pin, setPin] = useState("");
  const [pinFocused, setPinFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordIdentifier, setPasswordIdentifier] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

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

  useEffect(() => {
    if (!selectedUser || selectedUser.hasPin) {
      return;
    }

    setPin("");
    setErrorMessage("This account does not have a PIN yet. Use email and password below.");
  }, [selectedUser, setPin]);

  const canSubmit = useMemo(
    () =>
      Boolean(selectedUserId) &&
      selectedUser?.hasPin === true &&
      /^\d{4}$/.test(pin) &&
      !submitting &&
      !usersLoading,
    [selectedUserId, selectedUser, pin, submitting, usersLoading],
  );

  const submitPinLogin = useCallback(async () => {
    if (!selectedUserId || !selectedUser?.hasPin || !/^\d{4}$/.test(pin)) {
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
  }, [focusPinInput, loginWithPin, navigate, pin, redirectTarget, selectedUser, selectedUserId]);

  const submitPasswordLogin = useCallback(async () => {
    if (!passwordIdentifier.trim() || !passwordValue) {
      setErrorMessage("Email and password are required.");
      return;
    }

    setPasswordSubmitting(true);
    setErrorMessage(null);

    try {
      await login(passwordIdentifier, passwordValue);
      navigate(redirectTarget || "/home", { replace: true });
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Login failed.");
      }
    } finally {
      setPasswordSubmitting(false);
    }
  }, [login, navigate, passwordIdentifier, passwordValue, redirectTarget]);

  useEffect(() => {
    if (selectedUserId && /^\d{4}$/.test(pin) && !submitting && !usersLoading) {
      void submitPinLogin();
    }
  }, [pin, selectedUserId, submitPinLogin, submitting, usersLoading]);

  const onPasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await submitPasswordLogin();
  };

  return (
    <div className="login-shell">
      <div className="login-stage">
        <div className="login-card">
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
                    if (loginUser.hasPin) {
                      focusPinInput();
                    }
                  }}
                  disabled={submitting || passwordSubmitting}
                >
                  <span className="login-user-name">{loginUser.displayName}</span>
                  <span className="login-user-role">
                    {loginUser.role}
                    {loginUser.hasPin ? "" : " · Password only"}
                  </span>
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
                disabled={selectedUser?.hasPin === false || passwordSubmitting}
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

          <div className="login-password-divider">
            <span>Password fallback</span>
          </div>

          <div className="login-password-section">
            <div className="login-pin-labels">
              <label htmlFor="password-email">Email</label>
              <p className="login-pin-help">
                Use this when a PIN is not set or has been reset.
              </p>
            </div>
            <form className="login-password-form" onSubmit={onPasswordSubmit}>
              <input
                id="password-email"
                data-testid="login-password-email"
                type="email"
                value={passwordIdentifier}
                onChange={(event) => {
                  setPasswordIdentifier(event.target.value);
                  setErrorMessage(null);
                }}
                autoComplete="username"
                placeholder="staff@example.com"
                disabled={submitting || passwordSubmitting}
              />
              <input
                data-testid="login-password-value"
                type="password"
                value={passwordValue}
                onChange={(event) => {
                  setPasswordValue(event.target.value);
                  setErrorMessage(null);
                }}
                autoComplete="current-password"
                placeholder="Password"
                disabled={submitting || passwordSubmitting}
              />
              <button
                type="submit"
                className="login-password-submit"
                data-testid="login-password-submit"
                disabled={submitting || passwordSubmitting}
              >
                {passwordSubmitting ? "Logging in..." : "Use password"}
              </button>
            </form>
          </div>

          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          <p className="login-build-info">{appBuildLabel}</p>
        </div>
      </div>
    </div>
  );
};
