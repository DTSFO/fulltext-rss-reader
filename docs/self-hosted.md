# Normal self-hosted deployment

[简体中文](self-hosted.zh-CN.md)

This guide deploys the private, single-user profile defined by `docker-compose.yml`. The stack contains PostgreSQL, a one-shot migration job, the Next.js web application, and an independent refresh worker. The web port is bound to loopback; DNS, HTTPS, host patching, monitoring, and backup retention remain operator responsibilities.

Do not use the hosted-demo profile for personal data. It is intentionally disposable, quota-limited, and seeded with shared credentials.

## 1. Prerequisites

- A maintained Linux host with Docker Engine and Docker Compose v2.
- Git, a dedicated checkout path, and enough disk space for images, PostgreSQL, articles, and backups.
- A hostname whose DNS points to your HTTPS reverse proxy or managed tunnel.
- Node.js 22 and pnpm 11 on the host only for generating the Argon2 password hash. The running application itself is built inside Docker.
- OpenSSL or another cryptographically secure secret generator.

The Compose stack does not publish PostgreSQL. The application listens on `127.0.0.1:18120` by default, not on every host interface.

## 2. Prepare production configuration

From a dedicated checkout:

```bash
cp .env.production.example .env
pnpm install --frozen-lockfile
```

Generate a URL-safe PostgreSQL password and a session secret:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Use different outputs for `POSTGRES_PASSWORD` and `SESSION_SECRET`. A hexadecimal database password avoids breaking the internal PostgreSQL connection URL.

Generate the fixed user's Argon2 password hash without putting the password in the process list or shell history:

```bash
read -r -s -p "Reader password: " RSS_PASSWORD; printf '\n'
printf '%s' "$RSS_PASSWORD" | pnpm hash-password
unset RSS_PASSWORD
```

Edit `.env` and replace every `replace-...` value:

| Variable | Required production value |
| --- | --- |
| `APP_URL` | Exact public HTTPS origin, for example `https://rss.example.com`, with no path. Appearance mutations use it for same-origin validation. |
| `APP_PORT` | Loopback host port used by the reverse proxy; defaults to `18120`. |
| `POSTGRES_DB` / `POSTGRES_USER` | Database and role names. Keep them stable after first deployment. |
| `POSTGRES_PASSWORD` | Long, random, URL-safe secret. Compose refuses to start when it is absent. |
| `SINGLE_USER_USERNAME` | Permanent login name for this installation. Do not casually change it after data exists. |
| `SINGLE_USER_PASSWORD_HASH` | Argon2 output from `pnpm hash-password`, enclosed in single quotes so `$` is not expanded by Compose. |
| `SESSION_SECRET` | Independent random value of at least 32 characters. Rotating it invalidates existing sessions. |
| `FEED_REFRESH_MINUTES` | Normal interval scheduled after a successful feed refresh. |
| `REFRESH_BATCH_SIZE` | Due feeds claimed by each worker batch, from 1 to 20. |
| `FULL_TEXT_PREFETCH_COUNT` | Newest pending articles extracted after a scheduled feed refresh, from 0 to 20. |
| `DEMO_MODE` | Keep `false` for normal self-hosting. |

`NODE_ENV=production` is enforced by `docker-compose.yml`. `DATABASE_URL` is also assembled by Compose with the internal `postgres` service name; the localhost URL in `.env.example` is only for local development.

Protect the configuration:

```bash
chmod 600 .env
docker compose config --quiet
```

`docker compose config --quiet` validates interpolation without printing the resolved secrets. Never paste the full rendered Compose configuration into an issue.

## 3. Build and start

```bash
docker compose up -d --build --wait
docker compose ps -a
```

Expected state:

- `postgres` is running and healthy.
- `migrate` has completed successfully and is shown as exited with code 0.
- `web` is running and healthy.
- `worker` is running. It has no HTTP health endpoint, so confirm its startup event in the logs.

The web and worker services do not start until the migration job succeeds. A failed migration is therefore a startup blocker rather than a partially initialized deployment.

## 4. Publish over HTTPS

Keep port `18120` bound to loopback and forward a public HTTPS hostname to it. A minimal Caddy site is:

```caddyfile
rss.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18120
}
```

Nginx or a managed tunnel is also suitable. Preserve the original Host and forwarded protocol headers, do not publish the PostgreSQL port, and keep the application port blocked from the public network.

`APP_URL` must match the origin visible in the browser. If it remains `http://localhost:3000` or points to a different hostname, appearance and theme write requests fail the same-origin check with HTTP 403. Production sessions use Secure cookies, so the public entry point must be HTTPS.

## 5. Verify the deployment

Check the containers and local application liveness:

```bash
docker compose ps -a
docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
curl --fail --silent --show-error http://127.0.0.1:18120/api/health
curl --fail --silent --show-error https://rss.example.com/api/health
```

The `/api/health` route is an application liveness response; it does not query PostgreSQL. Keep the database check separate.

Finish with a browser smoke test:

1. Sign in with `SINGLE_USER_USERNAME` and the original password, not the Argon2 hash.
2. Add one public RSS or Atom URL.
3. Perform a manual refresh.
4. Create or edit a theme to verify the public origin is configured correctly.

Do not use a private, authenticated, credential-bearing, or internal-network feed URL. The fetch layer deliberately blocks private address ranges and unsafe redirects.

## 6. Logs and worker behavior

```bash
docker compose logs --follow --tail=200 web worker
docker compose logs --tail=200 migrate postgres
```

Application logs are structured and redact common password, authorization, and cookie fields. Protect Docker and proxy logs as operational data anyway.

The normal worker behaves as follows:

- It polls every 30 seconds while idle and every 5 seconds after finding work.
- It claims at most `REFRESH_BATCH_SIZE` due feeds with a two-minute database lease and `SKIP LOCKED`, allowing recovery after interruption.
- A scheduled refresh stores normalized items, then attempts full-text extraction for up to `FULL_TEXT_PREFETCH_COUNT` newest pending articles.
- A failed feed refresh preserves the last known articles, records a safe error, and retries with exponential backoff starting at 30 minutes and capped at 12 hours.
- A failed article extraction falls back to feed-provided content and is not attempted again for 24 hours.
- Manual feed refresh updates the feed but does not run the worker's prefetch step; opening an article can trigger extraction on demand.

## 7. Backup

Store backups outside the Git checkout. The repository ignores `backups/` and `*.dump` as a last line of defense, but that is not a retention or encryption policy.

```bash
install -d -m 700 "$HOME/backups/fulltext-rss-reader"
BACKUP="$HOME/backups/fulltext-rss-reader/rss-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$BACKUP"
docker compose exec -T postgres pg_restore --list < "$BACKUP" > /dev/null
printf 'Backup verified: %s\n' "$BACKUP"
```

Copy verified backups to separate storage, encrypt them when appropriate, and regularly test restoration. A PostgreSQL volume is persistence, not a backup.

## 8. Restore

Restore is destructive. Confirm the target checkout, `.env`, database name, and backup file before continuing. Take an emergency dump first when the current database is still readable.

```bash
docker compose stop web worker
docker compose exec -T postgres sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /secure/path/rss-backup.dump
docker compose run --rm migrate
docker compose up -d --wait web worker
```

Repeat the database, local HTTP, public HTTPS, login, feed, and theme checks after restoration.

## 9. Upgrade and rollback

Before every upgrade:

1. Create and verify a database backup.
2. Record the current commit with `git rev-parse HEAD`.
3. Review migration and configuration changes.

Upgrade:

```bash
git pull --ff-only
docker compose up -d --build --wait
docker compose ps -a
docker compose logs --tail=200 migrate web worker
```

Then repeat the deployment smoke test.

Database migrations are forward-only; the repository does not provide automatic down migrations. If an application-only rollback is known to be schema-compatible, check out the recorded commit and rebuild. If the upgrade ran an incompatible migration, stop the application, check out the recorded commit, restore the matching pre-upgrade database backup, rebuild, and verify the complete stack. Do not run `docker compose down --volumes` on a normal installation.

## 10. Credential changes

- Updating `SINGLE_USER_PASSWORD_HASH` takes effect after recreating the web container. It does not by itself invalidate already signed sessions; rotate `SESSION_SECRET` as well when forced logout is required.
- Treat `SINGLE_USER_USERNAME` as immutable after first use. Changing it creates or selects a different database user and does not transfer existing subscriptions or themes.
- Changing `POSTGRES_PASSWORD` in `.env` does not change the password of an already initialized PostgreSQL role. Rotate the role password inside PostgreSQL in a coordinated maintenance window, then update `.env` and recreate the application containers.

## 11. Common failures

| Symptom | Check |
| --- | --- |
| Compose reports `POSTGRES_PASSWORD` is required | Copy `.env.production.example` to `.env` and replace the placeholder. |
| Login fails or the web container restarts | Confirm the hash is valid Argon2 output, remains single-quoted, and the session secret is at least 32 characters. |
| Theme or appearance writes return 403 | Make `APP_URL` exactly match the public browser origin and recreate `web`. |
| `migrate` exits with code 1 | Inspect `docker compose logs migrate postgres`; web and worker intentionally wait for migration success. |
| Database authentication fails after editing `.env` | An existing PostgreSQL role still has the old password; changing container environment alone does not rotate it. |
| Worker repeatedly restarts | Inspect `docker compose logs worker` for invalid environment or database connectivity errors. |
| A feed is rejected | Private IPs, unsafe DNS results, credentials in URLs, excessive redirects, unsupported content types, oversized responses, and timeouts are blocked by design. |
| A feed keeps its old articles after failure | Expected behavior: the worker records the error and schedules bounded retry backoff. |
| Local health works but public access fails | Check DNS, TLS, reverse-proxy routing, firewall rules, and the configured loopback port. |
| Port 18120 is already in use | Select another `APP_PORT` and update the proxy upstream; `APP_URL` remains the public origin. |
