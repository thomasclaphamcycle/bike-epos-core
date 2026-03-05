import { escapeHtml } from "../utils/escapeHtml";

type LoginPageInput = {
  nextPath: string;
};

export const renderLoginPage = ({ nextPath }: LoginPageInput) => {
  const safeNextPath = escapeHtml(nextPath);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Staff Login</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #fff;
      --line: #d8dfe6;
      --text: #1d2329;
      --muted: #5a6672;
      --accent: #0b6a8d;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .wrap { max-width: 440px; margin: 56px auto; padding: 0 14px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
    h1 { margin: 0 0 8px; }
    .muted { color: var(--muted); font-size: 14px; }
    .field { display: grid; gap: 6px; margin-top: 12px; }
    input, button { border: 1px solid var(--line); border-radius: 8px; font-size: 14px; padding: 9px 11px; }
    button { cursor: pointer; background: var(--accent); border-color: #085771; color: #fff; margin-top: 12px; }
    .status { margin-top: 12px; min-height: 20px; font-size: 13px; color: var(--muted); }
    .status.error { color: #8b1f1f; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Staff Login</h1>
      <div class="muted">Use your staff email and password.</div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" data-testid="login-email" autocomplete="username" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" data-testid="login-password" autocomplete="current-password" />
      </div>
      <button id="login-btn" type="button" data-testid="login-submit">Login</button>
      <div id="login-status" class="status"></div>
    </div>
  </div>
  <script>
    (() => {
      const nextPath = "${safeNextPath}";
      const qs = (selector) => document.querySelector(selector);
      const setStatus = (message, isError) => {
        const el = qs("#login-status");
        if (!el) return;
        el.textContent = message || "";
        el.classList.toggle("error", Boolean(isError));
      };

      const login = async () => {
        const email = (qs("#email").value || "").trim();
        const password = qs("#password").value || "";
        if (!email || !password) {
          setStatus("Email and password are required.", true);
          return;
        }

        setStatus("Logging in...");
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });

        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { raw: text };
        }

        if (!response.ok) {
          const message = payload?.error?.message || payload?.error || "Login failed";
          setStatus(message, true);
          return;
        }

        window.location.assign(nextPath || "/pos");
      };

      qs("#password")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          login();
        }
      });
      qs("#login-btn")?.addEventListener("click", login);
    })();
  </script>
</body>
</html>`;
};
