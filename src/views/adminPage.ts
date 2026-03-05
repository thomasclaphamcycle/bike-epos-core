export const renderAdminPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Users</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #fff;
      --line: #d8dfe6;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0c6f91;
      --danger: #8b1f1f;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .page { max-width: 1240px; margin: 0 auto; padding: 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .field { display: grid; gap: 4px; min-width: 160px; }
    .field label { font-size: 12px; color: var(--muted); }
    input, select, button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; }
    button { cursor: pointer; background: #f9fbfc; }
    button.primary { background: var(--accent); color: #fff; border-color: #09576f; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 7px 9px; font-size: 13px; vertical-align: middle; }
    th { background: #f1f7fb; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; margin-top: 8px; background: #fff; }
    .status { margin-top: 8px; min-height: 18px; color: var(--muted); font-size: 13px; }
    .status.error { color: var(--danger); }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="controls" style="justify-content: space-between;">
        <div>
          <h1 style="margin: 0 0 6px;">Admin Users</h1>
          <div style="color: var(--muted); font-size: 13px;">Manage staff accounts and roles.</div>
        </div>
        <div class="controls">
          <a href="/admin/audit">Audit</a>
          <a href="/pos">POS</a>
          <button id="logout-btn" type="button">Logout</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Create User</h2>
      <div class="controls">
        <div class="field">
          <label for="create-name">Name</label>
          <input id="create-name" type="text" data-testid="admin-create-name" />
        </div>
        <div class="field">
          <label for="create-email">Email</label>
          <input id="create-email" type="email" data-testid="admin-create-email" />
        </div>
        <div class="field">
          <label for="create-role">Role</label>
          <select id="create-role" data-testid="admin-create-role">
            <option value="STAFF">STAFF</option>
            <option value="MANAGER">MANAGER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
        <div class="field">
          <label for="create-password">Temp Password</label>
          <input id="create-password" type="text" data-testid="admin-create-password" />
        </div>
        <button id="create-user-btn" type="button" class="primary" data-testid="admin-create-submit">Create</button>
      </div>
      <div id="create-status" class="status"></div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 8px;">Users</h2>
      <button id="refresh-users-btn" type="button">Refresh</button>
      <div id="users-status" class="status"></div>
      <div id="users-wrap" class="table-wrap"></div>
    </div>
  </div>

  <script>
    (() => {
      const qs = (selector) => document.querySelector(selector);
      const state = {
        users: [],
      };

      const setStatus = (id, message, isError = false) => {
        const el = qs("#" + id);
        if (!el) return;
        el.textContent = message || "";
        el.classList.toggle("error", Boolean(isError));
      };

      const apiRequest = async (path, options = {}) => {
        const response = await fetch(path, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
          },
        });

        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { raw: text };
        }

        if (!response.ok) {
          const message = payload?.error?.message || payload?.error || "Request failed";
          const error = new Error(message);
          error.status = response.status;
          throw error;
        }

        return payload;
      };

      const renderUsers = () => {
        const wrap = qs("#users-wrap");
        if (!wrap) return;

        if (!Array.isArray(state.users) || state.users.length === 0) {
          wrap.innerHTML = '<div style="padding: 10px; color: #5a6672;">No users found.</div>';
          return;
        }

        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        ["Name", "Email", "Role", "Active", "Update", "Reset Password"].forEach((text) => {
          const th = document.createElement("th");
          th.textContent = text;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const user of state.users) {
          const row = document.createElement("tr");

          const nameCell = document.createElement("td");
          const nameInput = document.createElement("input");
          nameInput.type = "text";
          nameInput.value = user.name || "";
          nameInput.className = "name-input";
          nameInput.setAttribute("data-user-id", user.id);
          nameCell.appendChild(nameInput);
          row.appendChild(nameCell);

          const emailCell = document.createElement("td");
          emailCell.textContent = user.email || "-";
          row.appendChild(emailCell);

          const roleCell = document.createElement("td");
          const roleSelect = document.createElement("select");
          roleSelect.className = "role-select";
          roleSelect.setAttribute("data-user-id", user.id);
          ["STAFF", "MANAGER", "ADMIN"].forEach((role) => {
            const option = document.createElement("option");
            option.value = role;
            option.textContent = role;
            option.selected = user.role === role;
            roleSelect.appendChild(option);
          });
          roleCell.appendChild(roleSelect);
          row.appendChild(roleCell);

          const activeCell = document.createElement("td");
          const activeSelect = document.createElement("select");
          activeSelect.className = "active-select";
          activeSelect.setAttribute("data-user-id", user.id);
          [
            { value: "true", label: "Enabled" },
            { value: "false", label: "Disabled" },
          ].forEach((item) => {
            const option = document.createElement("option");
            option.value = item.value;
            option.textContent = item.label;
            option.selected = String(Boolean(user.isActive)) === item.value;
            activeSelect.appendChild(option);
          });
          activeCell.appendChild(activeSelect);
          row.appendChild(activeCell);

          const updateCell = document.createElement("td");
          const updateBtn = document.createElement("button");
          updateBtn.type = "button";
          updateBtn.className = "update-user-btn";
          updateBtn.setAttribute("data-user-id", user.id);
          updateBtn.textContent = "Save";
          updateCell.appendChild(updateBtn);
          row.appendChild(updateCell);

          const resetCell = document.createElement("td");
          const resetInput = document.createElement("input");
          resetInput.type = "text";
          resetInput.placeholder = "New temp password";
          resetInput.className = "reset-password-input";
          resetInput.setAttribute("data-user-id", user.id);
          resetInput.style.marginRight = "6px";
          const resetBtn = document.createElement("button");
          resetBtn.type = "button";
          resetBtn.className = "reset-password-btn";
          resetBtn.setAttribute("data-user-id", user.id);
          resetBtn.textContent = "Reset";
          resetCell.appendChild(resetInput);
          resetCell.appendChild(resetBtn);
          row.appendChild(resetCell);

          tbody.appendChild(row);
        }

        table.appendChild(tbody);
        wrap.innerHTML = "";
        wrap.appendChild(table);
      };

      const loadUsers = async () => {
        setStatus("users-status", "Loading users...");
        try {
          const payload = await apiRequest("/api/admin/users");
          state.users = Array.isArray(payload?.users) ? payload.users : [];
          renderUsers();
          setStatus("users-status", "Loaded " + state.users.length + " users.");
        } catch (error) {
          setStatus("users-status", error.message || "Failed to load users", true);
        }
      };

      const createUser = async () => {
        const name = (qs("#create-name").value || "").trim();
        const email = (qs("#create-email").value || "").trim();
        const role = qs("#create-role").value || "STAFF";
        const tempPassword = qs("#create-password").value || "";

        setStatus("create-status", "Creating user...");
        try {
          await apiRequest("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ name, email, role, tempPassword }),
          });
          setStatus("create-status", "User created.");
          qs("#create-password").value = "";
          await loadUsers();
        } catch (error) {
          setStatus("create-status", error.message || "Failed to create user", true);
        }
      };

      const saveUser = async (userId) => {
        const nameInput = qs('.name-input[data-user-id=\"' + userId + '\"]');
        const roleSelect = qs('.role-select[data-user-id=\"' + userId + '\"]');
        const activeSelect = qs('.active-select[data-user-id=\"' + userId + '\"]');

        const payload = {
          name: nameInput ? nameInput.value : "",
          role: roleSelect ? roleSelect.value : "STAFF",
          isActive: activeSelect ? activeSelect.value === "true" : true,
        };

        setStatus("users-status", "Saving user " + userId + "...");
        try {
          await apiRequest("/api/admin/users/" + encodeURIComponent(userId), {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          setStatus("users-status", "User updated.");
          await loadUsers();
        } catch (error) {
          setStatus("users-status", error.message || "Failed to update user", true);
        }
      };

      const resetPassword = async (userId) => {
        const input = qs('.reset-password-input[data-user-id=\"' + userId + '\"]');
        const tempPassword = input ? input.value : "";

        setStatus("users-status", "Resetting password for " + userId + "...");
        try {
          await apiRequest(
            "/api/admin/users/" + encodeURIComponent(userId) + "/reset-password",
            {
              method: "POST",
              body: JSON.stringify({ tempPassword }),
            },
          );
          if (input) {
            input.value = "";
          }
          setStatus("users-status", "Password reset.");
        } catch (error) {
          setStatus("users-status", error.message || "Failed to reset password", true);
        }
      };

      qs("#create-user-btn")?.addEventListener("click", createUser);
      qs("#refresh-users-btn")?.addEventListener("click", loadUsers);
      qs("#users-wrap")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        const userId = target.getAttribute("data-user-id");
        if (!userId) return;
        if (target.classList.contains("update-user-btn")) {
          saveUser(userId);
        }
        if (target.classList.contains("reset-password-btn")) {
          resetPassword(userId);
        }
      });
      qs("#logout-btn")?.addEventListener("click", async () => {
        await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
        window.location.assign("/login?next=/admin");
      });

      loadUsers();
    })();
  </script>
</body>
</html>`;
