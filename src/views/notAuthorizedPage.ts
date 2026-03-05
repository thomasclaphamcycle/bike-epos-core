import { escapeHtml } from "../utils/escapeHtml";

type NotAuthorizedPageInput = {
  requiredRole?: string;
  currentRole?: string;
};

export const renderNotAuthorizedPage = (input: NotAuthorizedPageInput) => {
  const requiredRole = input.requiredRole ? escapeHtml(input.requiredRole) : undefined;
  const currentRole = input.currentRole ? escapeHtml(input.currentRole) : undefined;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Not Authorized</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #fff;
      --line: #d8dfe6;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0c6f91;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .wrap { max-width: 540px; margin: 56px auto; padding: 0 14px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px; }
    h1 { margin: 0 0 8px; }
    p { margin: 8px 0; color: var(--muted); }
    .meta { font-size: 13px; color: #506171; margin-top: 10px; }
    .actions { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
    a, button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fbfd;
      color: var(--text);
      text-decoration: none;
      padding: 8px 10px;
      font-size: 14px;
      cursor: pointer;
    }
    .primary { background: var(--accent); color: #fff; border-color: #09566f; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Not Authorized</h1>
      <p>Your account does not have permission to access this page.</p>
      <div class="meta">
        ${requiredRole ? `<div><strong>Required role:</strong> ${requiredRole}</div>` : ""}
        ${currentRole ? `<div><strong>Your role:</strong> ${currentRole}</div>` : ""}
      </div>
      <div class="actions">
        <a class="primary" href="/pos">Go to POS</a>
        <a href="/workshop">Workshop</a>
        <button type="button" id="logout-btn">Logout</button>
      </div>
    </div>
  </div>
  <script>
    (() => {
      const logoutBtn = document.getElementById("logout-btn");
      if (!logoutBtn) return;
      logoutBtn.addEventListener("click", async () => {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
        } catch {}
        window.location.assign("/login");
      });
    })();
  </script>
</body>
</html>`;
};

