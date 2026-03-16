import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiGet, ApiError } from "../api/client";
import { normalizeLoginRedirectTarget } from "../utils/authRedirect";
import { toRoleHomeRoute } from "../utils/homeRoute";
import CorePosLogo from "../components/branding/CorePosLogo";
import { useRuntimeVersionLabel } from "../hooks/useRuntimeVersionLabel";

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
  const appVersionLabel = useRuntimeVersionLabel();
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
<<<<<<< HEAD
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const pinUsers = useMemo(() => users.filter((candidate) => candidate.hasPin), [users]);

  const selectedUser = useMemo(
    () => pinUsers.find((candidate) => candidate.id === selectedUserId) ?? null,
    [selectedUserId, pinUsers],
  );
=======
  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) || null,
    [users, selectedUserId],
  );
  const noPinSelected = Boolean(selectedUser && !selectedUser.hasPin);
  const noPinMessage = "No PIN has been set for this user yet. Please ask a manager to set or reset the PIN.";
>>>>>>> feat/login-pin-status-prompt

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
<<<<<<< HEAD
    () =>
      Boolean(selectedUserId) &&
      /^\d{4}$/.test(pin) &&
      !submitting &&
      !usersLoading,
    [selectedUserId, pin, submitting, usersLoading],
  );

  const submitPinLogin = useCallback(async () => {
    if (!selectedUserId || !/^\d{4}$/.test(pin)) {
=======
    () => Boolean(selectedUserId) && !noPinSelected && /^\d{4}$/.test(pin) && !submitting && !usersLoading,
    [selectedUserId, noPinSelected, pin, submitting, usersLoading],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUserId || noPinSelected || !/^\d{4}$/.test(pin)) {
>>>>>>> feat/login-pin-status-prompt
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
            ) : pinUsers.length ? (
              pinUsers.map((loginUser) => (
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
                  disabled={submitting}
                >
                  <span className="login-user-name">{loginUser.displayName}</span>
                  <span className="login-user-role">{loginUser.role}</span>
                </button>
              ))
            ) : (
              <div className="login-inline-status">No PIN-enabled users available.</div>
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
                disabled={!selectedUser}
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

          {noPinSelected ? (
            <p className="login-inline-status login-pin-help" data-testid="login-no-pin-message">
              {noPinMessage}
            </p>
          ) : null}

          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          <p className="login-build-info">{appVersionLabel}</p>
        </div>
      </div>
    </div>
  );
};
