# Hosted demo deployment profile

[简体中文](hosted-demo.zh-CN.md)

This guide describes the repository's portable, authenticated demo profile. It runs the real Next.js reader against invented seed data, but remains deliberately separate from the normal self-hosted stack: it has an isolated database, shared-account quotas, deterministic resets, and no background refresh worker.

The Compose profile defines application containers and a loopback listener. It does not install DNS, an HTTPS proxy or tunnel, monitoring, or a reset scheduler.

## 1. Prerequisites and boundary

- A maintained Linux host with Docker Engine and Docker Compose v2.
- Git and a stable checkout used only for this demo.
- Node.js 22 and pnpm 11 for generating the shared password hash.
- OpenSSL or another secure random generator.
- A dedicated hostname, DNS, and an HTTPS reverse proxy or managed tunnel.

PostgreSQL is not published on the host. The demo uses its own Compose project, bridge network, image tag, and named volume. User-triggered feed operations still use the application's guarded fetch path, but there is no scheduled background refresh.

Never add production feeds, accounts, credentials, exports, or private URLs to this stack or its seed file.

## 2. Configure

```bash
cp .env.demo.example .env.demo
pnpm install --frozen-lockfile
openssl rand -hex 32
openssl rand -hex 32
```

Use different random outputs for `DEMO_POSTGRES_PASSWORD` and `DEMO_SESSION_SECRET`. Keep the database password URL-safe.

The login page displays the fixed shared password `demo-reader` when `DEMO_MODE=true`. Generate a hash for that exact password without putting it in a command argument:

```bash
printf '%s' 'demo-reader' | pnpm hash-password
```

Edit `.env.demo`:

- Set `DEMO_APP_URL` to the exact public HTTPS origin, with no path.
- Put the URL-safe database secret in `DEMO_POSTGRES_PASSWORD`.
- Put the independent session secret in `DEMO_SESSION_SECRET`.
- Put the generated Argon2 output in `DEMO_PASSWORD_HASH` and keep it single-quoted so Compose does not expand `$`.
- Keep `DEMO_USERNAME=demo-user` unless the published login instructions and seed expectations are intentionally updated.
- Change `DEMO_APP_PORT` only when the HTTPS entry point uses a different loopback port.

Never commit `.env.demo`. Protect and validate it:

```bash
chmod 600 .env.demo
docker compose --project-name fulltext-rss-reader-demo --env-file .env.demo --file docker-compose.demo.yml config --quiet
```

The example enables five feeds, three custom themes, fifty retained articles per feed, a one-minute account-level feed-creation cooldown, and a ten-minute manual-refresh cooldown. The creation cooldown is reserved atomically before outbound fetching, persists after feed deletion, and also applies to failed fetch attempts. Increase limits only after reviewing host capacity and edge-level request controls.

## 3. Start and verify

```bash
./scripts/demo-stack.sh up
./scripts/demo-stack.sh status
curl --fail --silent --show-error http://127.0.0.1:18121/api/health
```

On initial creation, the stack builds the application, waits for PostgreSQL, runs migrations, loads deterministic seed data, and waits for the web health check. The `/api/health` route is application liveness only; inspect PostgreSQL separately when diagnosing database problems.

After publishing HTTPS, also run:

```bash
curl --fail --silent --show-error https://rss-demo.example.com/api/health
```

Then sign in with `demo-user` / `demo-reader`, add one public feed, confirm the configured feed and theme limits, and verify a theme write. Do not use private or credential-bearing URLs.

## 4. Data lifecycle and operations

The demo database is disposable. The seed job executes `TRUNCATE TABLE users CASCADE`, removing subscriptions, articles, reading state, categories, and appearance data owned by the shared account.

```bash
./scripts/demo-stack.sh logs
./scripts/demo-stack.sh reseed
./scripts/demo-stack.sh reset
./scripts/demo-stack.sh down
./scripts/demo-stack.sh destroy
```

- `reseed` deliberately removes shared-account state and restores fixtures without deleting the PostgreSQL volume.
- `reset` deliberately deletes the entire demo volume, migrates, seeds, and starts a clean stack.
- `destroy` stops the stack and permanently deletes its disposable database volume.
- `up` creates the migration and seed jobs when required. Treat updates that recreate those jobs as potentially destructive to shared-account changes.

Run these commands only from the dedicated demo checkout. The script uses the Compose project name `fulltext-rss-reader-demo` by default so it cannot target the normal stack accidentally.

## 5. Logs and troubleshooting

`./scripts/demo-stack.sh logs` follows `web-demo`. To inspect every startup stage:

```bash
docker compose --project-name fulltext-rss-reader-demo --env-file .env.demo --file docker-compose.demo.yml ps -a
docker compose --project-name fulltext-rss-reader-demo --env-file .env.demo --file docker-compose.demo.yml logs --tail=200 postgres-demo migrate-demo seed-demo web-demo
```

Common diagnoses:

| Symptom | Check |
| --- | --- |
| Compose rejects configuration | Replace every placeholder in `.env.demo`; keep the Argon2 hash single-quoted. |
| `migrate-demo` fails | Inspect both migration and PostgreSQL logs. The web service intentionally waits for migration and seed success. |
| `seed-demo` fails | Confirm migrations completed and the checkout's seed SQL matches the application schema. |
| Local health works but public access fails | Check DNS, TLS, proxy or tunnel routing, firewall rules, and `DEMO_APP_PORT`. |
| Appearance writes return 403 | Make `DEMO_APP_URL` exactly match the public browser origin. |
| A request returns 409 or 429 | The shared account reached a quota or cooldown; inspect the configured `DEMO_MAX_*` and `DEMO_*_COOLDOWN_*` values. |
| Feeds do not refresh automatically | Expected behavior: the hosted-demo profile intentionally has no worker. Use manual refresh within the cooldown. |
| Database authentication fails after changing the password | Editing `.env.demo` does not rotate the password inside an existing volume. For this disposable stack, change the secret and run `reset` together. |

## 6. Publish over HTTPS

Keep the application bound to loopback. A minimal Caddy site is:

```caddyfile
rss-demo.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18121
}
```

Nginx or a managed tunnel is also suitable. Preserve the original Host and forwarded protocol headers, do not expose PostgreSQL, and apply public-account request-rate, request-body, and connection limits at the edge. Keep the Docker host and HTTPS edge patched.

## 7. Scheduled reset

The repository does not install a scheduler. The following root-crontab example prevents overlapping reset jobs with `flock` and runs every six hours:

```cron
17 */6 * * * flock -n /run/lock/fulltext-rss-reader-demo-reset.lock sh -c 'cd /srv/fulltext-rss-reader && ./scripts/demo-stack.sh reset' >> /var/log/fulltext-rss-reader-demo-reset.log 2>&1
```

Replace the checkout path, choose an off-peak minute, and configure log rotation. Reset causes a short outage and permanently deletes shared-account changes. Use `reseed` instead only when retaining the database volume is useful; it still deletes user-owned state.

## 8. Update and secret rotation

```bash
git pull --ff-only
./scripts/demo-stack.sh up
```

Treat an update as potentially reseeding disposable state, then repeat local health, public HTTPS, login, quota, and theme checks. If migration or seed changes require a clean database, use `reset`.

- Rotating `DEMO_SESSION_SECRET` invalidates existing sessions after the web container is recreated.
- Rotating `DEMO_PASSWORD_HASH` changes the login password, but the current login page still publishes `demo-reader`; keep them aligned.
- Rotating `DEMO_POSTGRES_PASSWORD` for the disposable demo should be paired with `reset`, because changing environment alone does not update an existing PostgreSQL role.

The seeded database is intentionally disposable and normally should not be backed up. Monitor disk usage, container state, proxy logs, and scheduled-reset results instead.
