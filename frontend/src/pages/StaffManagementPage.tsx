import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type UserRole = "STAFF" | "MANAGER" | "ADMIN";

type StaffUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserListResponse = {
  users: StaffUser[];
};

type UserEditState = {
  name: string;
  role: UserRole;
  isActive: boolean;
};

const roleOptions: UserRole[] = ["STAFF", "MANAGER", "ADMIN"];

const normalizeIsActive = (value: boolean | string | null | undefined, fallback: boolean) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
};

export const StaffManagementPage = () => {
  const { success, error } = useToasts();

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState<UserRole>("STAFF");
  const [createPassword, setCreatePassword] = useState("temp-pass-123");
  const [createPin, setCreatePin] = useState("");

  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [userEdits, setUserEdits] = useState<Record<string, UserEditState>>({});
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<UserListResponse>("/api/admin/users");
      setUsers(payload.users || []);
      setUserEdits(
        Object.fromEntries(
          (payload.users || []).map((user) => [
            user.id,
            {
              name: user.name ?? "",
              role: user.role,
              isActive: user.isActive,
            },
          ]),
        ),
      );
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load staff users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createUser = async () => {
    const pin = createPin.trim();
    if (pin && !/^\d{4}$/.test(pin)) {
      error("PIN must be exactly 4 digits");
      return;
    }

    try {
      await apiPost("/api/admin/users", {
        name: createName,
        email: createEmail,
        role: createRole,
        tempPassword: createPassword,
        pin: pin || undefined,
      });
      success("Staff user created");
      setCreateName("");
      setCreateEmail("");
      setCreateRole("STAFF");
      setCreatePassword("temp-pass-123");
      setCreatePin("");
      setExpandedUserId(null);
      await loadUsers();
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create user");
    }
  };

  const updateUser = async (userId: string, body: { name?: string; role?: UserRole; isActive?: boolean }) => {
    const existingUser = users.find((user) => user.id === userId);
    if (!existingUser) {
      error("User not found");
      return;
    }

    const normalizedBody = {
      ...body,
      ...(Object.prototype.hasOwnProperty.call(body, "isActive")
        ? {
            isActive: normalizeIsActive(
              body.isActive as boolean | string | null | undefined,
              existingUser.isActive,
            ),
          }
        : {}),
    };

    try {
      await apiPatch(`/api/admin/users/${encodeURIComponent(userId)}`, normalizedBody);
      success("User updated");
      await loadUsers();
    } catch (updateError) {
      error(updateError instanceof Error ? updateError.message : "Failed to update user");
    }
  };

  const resetPassword = async (userId: string) => {
    const tempPassword = resetPasswords[userId]?.trim() || "temp-pass-123";
    try {
      await apiPost(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
        tempPassword,
      });
      success("Password reset");
      setResetPasswords((current) => ({ ...current, [userId]: "" }));
    } catch (resetError) {
      error(resetError instanceof Error ? resetError.message : "Failed to reset password");
    }
  };

  const setPin = async (userId: string) => {
    const pin = pinInputs[userId]?.trim() ?? "";
    if (!/^\d{4}$/.test(pin)) {
      error("PIN must be exactly 4 digits");
      return;
    }

    try {
      await apiPost(`/api/admin/users/${encodeURIComponent(userId)}/set-pin`, { pin });
      success("PIN updated");
      setPinInputs((current) => ({ ...current, [userId]: "" }));
    } catch (resetError) {
      error(resetError instanceof Error ? resetError.message : "Failed to set PIN");
    }
  };

  const visibleUsers = showInactive ? users : users.filter((user) => user.isActive);
  const formatDate = (value: string) => new Date(value).toLocaleDateString();

  return (
    <div className="page-shell">
      <section className="card staff-create-card">
        <div className="staff-create-shell">
          <div className="card-header-row staff-section-heading">
            <h2>Create User</h2>
            <button type="button" className="secondary" onClick={() => void loadUsers()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="staff-create-grid">
            <label>
              Name
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="New user" />
            </label>
            <label>
              Email
              <input value={createEmail} onChange={(event) => setCreateEmail(event.target.value)} placeholder="staff@example.com" />
            </label>
            <label>
              Role
              <select value={createRole} onChange={(event) => setCreateRole(event.target.value as UserRole)}>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </label>
            <label>
              New Password
              <input value={createPassword} onChange={(event) => setCreatePassword(event.target.value)} placeholder="At least 8 characters" />
            </label>
            <label>
              PIN
              <input
                value={createPin}
                onChange={(event) => setCreatePin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                maxLength={4}
                placeholder="Optional 4-digit PIN"
              />
            </label>
            <div className="actions-inline staff-create-actions">
              <button type="button" className="primary" onClick={() => void createUser()}>
                Create User
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card staff-list-card">
        <div className="card-header-row staff-list-header">
          <div />
          <label className="staff-toggle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            <span>Show inactive</span>
          </label>
        </div>
        <div className="staff-user-list">
          {visibleUsers.length ? visibleUsers.map((user) => (
            <article key={user.id} className={`staff-user-card${user.isActive ? "" : " staff-row-inactive"}`}>
              <button
                type="button"
                className="staff-summary-row"
                aria-expanded={expandedUserId === user.id}
                onClick={() => setExpandedUserId((current) => (current === user.id ? null : user.id))}
              >
                <div className="staff-summary-primary">
                  <h3>{user.name ?? user.username}</h3>
                  <p className="muted-text">{user.email ?? user.username}</p>
                </div>
                <div className="staff-summary-meta">
                  <span className={`staff-role-badge staff-role-badge-${user.role.toLowerCase()}`}>{user.role}</span>
                  <span className={`staff-status-badge ${user.isActive ? "staff-status-badge-active" : "staff-status-badge-inactive"}`}>
                    {user.isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <span className="muted-text">Created {formatDate(user.createdAt)}</span>
                  <span className="staff-expand-affordance">{expandedUserId === user.id ? "Collapse" : "Edit"}</span>
                </div>
              </button>

              {expandedUserId === user.id ? (
                <div className="staff-editor-panel">
                  <div className="staff-editor-grid">
                    <label className="staff-form-field staff-field-name">
                      <span>Name</span>
                      <input
                        value={userEdits[user.id]?.name ?? ""}
                        onChange={(event) => setUserEdits((current) => ({
                          ...current,
                          [user.id]: {
                            name: event.target.value,
                            role: current[user.id]?.role ?? user.role,
                            isActive: normalizeIsActive(current[user.id]?.isActive, user.isActive),
                          },
                        }))}
                      />
                    </label>

                    <label className="staff-form-field staff-field-role">
                      <span>Role</span>
                      <select
                        value={userEdits[user.id]?.role ?? user.role}
                        onChange={(event) => setUserEdits((current) => ({
                          ...current,
                          [user.id]: {
                            name: current[user.id]?.name ?? user.name ?? "",
                            role: event.target.value as UserRole,
                            isActive: normalizeIsActive(current[user.id]?.isActive, user.isActive),
                          },
                        }))}
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </label>

                    <div className="staff-form-field staff-field-status">
                      <span>Status</span>
                      <div className="staff-status-action">
                        <span
                          className={`staff-status-badge ${
                            normalizeIsActive(userEdits[user.id]?.isActive, user.isActive)
                              ? "staff-status-badge-active"
                              : "staff-status-badge-inactive"
                          }`}
                        >
                          {normalizeIsActive(userEdits[user.id]?.isActive, user.isActive) ? "ACTIVE" : "INACTIVE"}
                        </span>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            const nextIsActive = !normalizeIsActive(userEdits[user.id]?.isActive, user.isActive);
                            setUserEdits((current) => ({
                              ...current,
                              [user.id]: {
                                name: current[user.id]?.name ?? user.name ?? "",
                                role: current[user.id]?.role ?? user.role,
                                isActive: nextIsActive,
                              },
                            }));
                            void updateUser(user.id, { isActive: nextIsActive });
                          }}
                        >
                          {normalizeIsActive(userEdits[user.id]?.isActive, user.isActive) ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </div>

                    <div className="staff-profile-actions">
                      <button
                        type="button"
                        onClick={() => void updateUser(user.id, {
                          name: userEdits[user.id]?.name ?? user.name ?? "",
                          role: userEdits[user.id]?.role ?? user.role,
                          isActive: normalizeIsActive(userEdits[user.id]?.isActive, user.isActive),
                        })}
                      >
                        Save Profile
                      </button>
                    </div>

                    <div className="staff-credential-row staff-credential-row-password">
                      <label className="staff-form-field">
                        <span>New Password</span>
                        <input
                          className="staff-password-input"
                          value={resetPasswords[user.id] ?? ""}
                          onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                          placeholder="At least 8 characters"
                        />
                      </label>
                      <button type="button" onClick={() => void resetPassword(user.id)}>
                        Set Password
                      </button>
                    </div>

                    <div className="staff-credential-row staff-credential-row-pin">
                      <label className="staff-form-field">
                        <span>PIN</span>
                        <input
                          className="staff-pin-input"
                          value={pinInputs[user.id] ?? ""}
                          onChange={(event) => setPinInputs((current) => ({
                            ...current,
                            [user.id]: event.target.value.replace(/\D/g, "").slice(0, 4),
                          }))}
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="4-digit PIN"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void setPin(user.id)}
                        disabled={!/^\d{4}$/.test(pinInputs[user.id] ?? "")}
                      >
                        Set PIN
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          )) : (
            <div className="restricted-panel">
              {showInactive ? "No users found." : "No active users found."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
