For the target Windows 11 local-server setup, the repo currently assumes this server-side contract:

- the runtime checkout lives at `C:\corepos`
- the durable release-state folder lives at `C:\corepos\.corepos-runtime`
- the external handoff script exists at `C:\Users\coreposadmin\corepos-runtime\deploy-corepos.cmd`
- that handoff script performs the install/build/migrate/restart work needed to leave the app healthy again on `http://127.0.0.1:3100`
- PM2 manages the backend under the process name `corepos`
- the self-hosted GitHub Actions runner runs on the same machine and can reach:
  - `C:\corepos`
  - `C:\Users\coreposadmin\corepos-runtime\deploy-corepos.cmd`
  - `http://127.0.0.1:3100`

### PM2 Runtime (Windows Server Reality)

Observed on the live shop server:

- PM2 command path:
  - `C:\Users\coreposadmin\AppData\Roaming\npm\pm2.cmd`

- PM2 daemon:
  - `C:\Users\coreposadmin\AppData\Roaming\npm\node_modules\pm2\lib\Daemon.js`

- Current PM2 processes:
  - `corepos-backend`
  - `corepos-frontend`
  - `cloudflared`

Important:

- `pm2` may NOT be on PATH in PowerShell
- use full path if needed:

```powershell
& "C:\Users\coreposadmin\AppData\Roaming\npm\pm2.cmd" list
```

- Backend must be running on:

```text
http://localhost:3100
```

- If login breaks:
  - check backend port
  - check PM2 process state
  - check correct working directory (`C:\corepos`)

If you are fronting the server with Cloudflare Tunnel, set `PUBLIC_APP_URL` to the exact customer-facing hostname carried by that tunnel so workshop/public links match the externally reachable URL.

For health monitoring on this Windows setup, use exactly one recurring production monitor:

- a Windows Scheduled Task that runs `npm run health:check` from `C:\corepos` every 5 minutes
- or the repo's scheduled `CorePOS Health Monitor` GitHub Actions workflow on the self-hosted runner

Because `scripts/health_monitor.js` is stateful, it records transitions in `C:\corepos\.corepos-runtime\health-state.json` and sends Slack only when the state changes. Even so, keeping both schedulers active at once is still unnecessary and can create duplicate transition alerts.

Before reopening the shop after a server rebuild, validate the machine assumptions directly from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/validate_windows_production.ps1
```

The Unix helper script still protects against dirty-checkout upgrades and uses `git pull --ff-only`. The Windows self-hosted auto-deploy path now prefers a deterministic force-sync because the runtime checkout can pick up local drift from prior installs.

If a release introduces unexpected operational issues, restore the backup and roll back to the last known-good release.

Use the `Rollback CorePOS Production` GitHub Actions workflow instead of hand-running `git reset` commands on the host.

If the rollback target is missing migration directories present in the current checkout, `previous_safe` blocks the rollback. Restore the verified database backup, then rerun the workflow in `recovery_mode`.

## 7. Recovery Procedures

If CorePOS fails during startup:

1. check environment variables
2. confirm PostgreSQL is reachable from the app host
3. check whether pending migrations failed
4. inspect recent logs for Prisma, auth, or port-binding errors
5. compare `/health?details=1` and `/api/system/version` to confirm the running version/revision, environment, runtime uptime, and whether shipping-print-agent support is configured as expected

If the database is corrupted or a bad release must be reversed:

1. stop the app
2. restore the most recent verified backup
3. run the `Rollback CorePOS Production` workflow to redeploy the last known-good release
4. restart the app
5. verify login and a small set of core workflows before resuming use

Keep a known-good release artifact and a recent verified backup before every production upgrade.

## Minimal Hardware Guidance

For a small single-shop deployment, start with:

- 2 CPU cores
- 4 GB RAM
- SSD-backed storage
- reliable local network access for tills/workshop stations
- regular off-machine backup storage for PostgreSQL dumps

If you run PostgreSQL and the app on the same machine, prefer headroom over minimums, especially for backup, restore, and browser-heavy manager workflows.
