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

const roleOptions: UserRole[] = ["STAFF", "MANAGER", "ADMIN"];

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
  const [userEdits, setUserEdits] = useState<Record<string, { name: string; role: UserRole }>>({});

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
      await loadUsers();
    } catch (createError) {
      error(createError instanceof Error ? createError.message : "Failed to create user");
    }
  };

  const updateUser = async (userId: string, body: { name?: string; role?: UserRole; isActive?: boolean }) => {
    try {
      await apiPatch(`/api/admin/users/${encodeURIComponent(userId)}`, body);
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

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Staff Management</h1>
          </div>
          <button type="button" onClick={() => void loadUsers()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="staff-create-grid">
          <label>
            Name
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="New staff member" />
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
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Existing Staff Users</h2>
          </div>
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
              <div className="staff-user-card-header">
                <div>
                  <h3>{user.name ?? user.username}</h3>
                  <p className="muted-text">
                    {user.username}
                    {user.email ? ` · ${user.email}` : ""}
                  </p>
                </div>
                <div className="staff-user-meta">
                  <span className="stock-badge stock-muted">{user.role}</span>
                  <span className={`stock-badge ${user.isActive ? "stock-good" : "stock-state-zero"}`}>
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                  <span className="muted-text">Created {new Date(user.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="staff-user-sections">
                <section className="staff-user-section">
                  <div className="staff-user-section-header">
                    <h4>Profile</h4>
                    <button
                      type="button"
                      onClick={() => void updateUser(user.id, {
                        name: userEdits[user.id]?.name ?? user.name ?? "",
                        role: userEdits[user.id]?.role ?? user.role,
                      })}
                    >
                      Save Profile
                    </button>
                  </div>
                  <div className="staff-user-grid">
                    <label>
                      Name
                      <input
                        value={userEdits[user.id]?.name ?? ""}
                        onChange={(event) => setUserEdits((current) => ({
                          ...current,
                          [user.id]: {
                            name: event.target.value,
                            role: current[user.id]?.role ?? user.role,
                          },
                        }))}
                      />
                    </label>
                    <label>
                      Role
                      <select
                        value={userEdits[user.id]?.role ?? user.role}
                        onChange={(event) => setUserEdits((current) => ({
                          ...current,
                          [user.id]: {
                            name: current[user.id]?.name ?? user.name ?? "",
                            role: event.target.value as UserRole,
                          },
                        }))}
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </label>
                    <div className="staff-status-control">
                      <span className="staff-field-label">Status</span>
                      <button type="button" onClick={() => void updateUser(user.id, { isActive: !user.isActive })}>
                        {user.isActive ? "Set Inactive" : "Set Active"}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="staff-user-section">
                  <div className="staff-user-section-header">
                    <h4>Credentials</h4>
                  </div>
                  <div className="staff-user-grid">
                    <div className="staff-credential-action">
                      <label>
                        New Password
                        <input
                          className="compact-input"
                          value={resetPasswords[user.id] ?? ""}
                          onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                          placeholder="At least 8 characters"
                        />
                      </label>
                      <button type="button" onClick={() => void resetPassword(user.id)}>
                        Set Password
                      </button>
                    </div>

                    <div className="staff-credential-action">
                      <label>
                        PIN
                        <input
                          className="compact-input"
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
                </section>
              </div>
            </article>
          )) : (
            <div className="restricted-panel">
              {showInactive ? "No staff users found." : "No active staff users found."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
