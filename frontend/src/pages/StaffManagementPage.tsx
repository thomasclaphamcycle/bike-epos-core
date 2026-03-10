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

  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState<UserRole>("STAFF");
  const [createPassword, setCreatePassword] = useState("temp-pass-123");

  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
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
    try {
      await apiPost("/api/admin/users", {
        name: createName,
        email: createEmail,
        role: createRole,
        tempPassword: createPassword,
      });
      success("Staff user created");
      setCreateName("");
      setCreateEmail("");
      setCreateRole("STAFF");
      setCreatePassword("temp-pass-123");
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

  const resetPin = async (userId: string) => {
    try {
      await apiPost(`/api/admin/users/${encodeURIComponent(userId)}/reset-pin`);
      success("PIN reset");
    } catch (resetError) {
      error(resetError instanceof Error ? resetError.message : "Failed to reset PIN");
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Staff Management</h1>
            <p className="muted-text">
              Admin-only operational user management. This UI stays aligned with the existing admin user APIs and does not redesign authentication.
            </p>
          </div>
          <button type="button" onClick={() => void loadUsers()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="purchase-form-grid">
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
          <label className="purchase-form-wide">
            Temporary Password
            <input value={createPassword} onChange={(event) => setCreatePassword(event.target.value)} placeholder="At least 8 characters" />
          </label>
          <div className="actions-inline">
            <button type="button" className="primary" onClick={() => void createUser()}>
              Create User
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Existing Staff Users</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Current Name</th>
                <th>Edit Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length ? users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name ?? "-"}</td>
                  <td>
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
                  </td>
                  <td>{user.username}</td>
                  <td>{user.email ?? "-"}</td>
                  <td>
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
                  </td>
                  <td>
                    <button type="button" onClick={() => void updateUser(user.id, { isActive: !user.isActive })}>
                      {user.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="actions-inline">
                      <button
                        type="button"
                        onClick={() => void updateUser(user.id, {
                          name: userEdits[user.id]?.name ?? user.name ?? "",
                          role: userEdits[user.id]?.role ?? user.role,
                        })}
                      >
                        Save
                      </button>
                      <input
                        className="compact-input"
                        value={resetPasswords[user.id] ?? ""}
                        onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                        placeholder="new temp password"
                      />
                      <button type="button" onClick={() => void resetPassword(user.id)}>
                        Reset Password
                      </button>
                      <button type="button" onClick={() => void resetPin(user.id)}>
                        Reset PIN
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8}>No staff users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
