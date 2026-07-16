# Hosted demo deployment profile

This document describes the repository's portable, authenticated demo profile. It runs the real Next.js reader against invented seed data, but it is deliberately separate from the normal self-hosted Compose stack: the demo has its own database and quotas, and it does not start the background refresh worker.

The profile defines application containers and a loopback listener. It does not install DNS, an HTTPS proxy or tunnel, monitoring, or a reset scheduler. Those remain operator-managed deployment concerns and can differ from the infrastructure used by the public instance.

## Assumptions

- A Linux host with Docker Engine and Docker Compose v2.
- A dedicated hostname such as rss-demo.example.com.
- An HTTPS entry point, such as a reverse proxy or managed tunnel, that forwards to the configured loopback port.
- DNS configured for the selected HTTPS entry point.
- The repository checked out in a stable, dedicated path.

PostgreSQL is not published on the host. The demo uses its own Compose project, bridge network, image tag, and named database volume. The background refresh worker is deliberately omitted; user-triggered feed operations still use the application's existing guarded fetch path and limits.

## Configure

    cp .env.demo.example .env.demo
    pnpm install --frozen-lockfile
    pnpm hash-password

Edit .env.demo:

- Set DEMO_APP_URL to the exact public HTTPS origin, with no path.
- Generate long random values for DEMO_POSTGRES_PASSWORD and DEMO_SESSION_SECRET.
- Put the Argon2 output from pnpm hash-password in DEMO_PASSWORD_HASH and keep it single-quoted.
- Generate that hash for the public shared-demo password `demo-reader`; the login page displays this credential when `DEMO_MODE=true`.
- Keep DEMO_USERNAME=demo-user unless you intentionally update the published login instructions.
- Change DEMO_APP_PORT only if the HTTPS entry point uses a different loopback port.

Never commit .env.demo.

The example enables demo mode with conservative shared-account limits: five feeds, three custom themes, fifty retained articles per feed, a one-minute account-level subscription creation cooldown, and a ten-minute manual refresh cooldown. The creation cooldown is reserved atomically before the outbound fetch, persists after feed deletion, and also applies to failed fetch attempts. Adjust the corresponding DEMO_MAX and DEMO_*_COOLDOWN variables only after reviewing host capacity and edge-level request limits.

## Start and inspect

    ./scripts/demo-stack.sh up
    ./scripts/demo-stack.sh status
    curl --fail http://127.0.0.1:18121/api/health

Every up or reset builds the application image, migrates the isolated database, replaces its contents with deterministic demo records, and waits for the web health check.

Useful operations:

    ./scripts/demo-stack.sh logs
    ./scripts/demo-stack.sh reseed
    ./scripts/demo-stack.sh reset
    ./scripts/demo-stack.sh down
    ./scripts/demo-stack.sh destroy

- reseed removes user-owned state and restores fixtures without deleting the PostgreSQL volume.
- reset deletes the entire demo volume, then migrates, seeds, and starts a clean stack.
- destroy stops the stack and permanently removes its disposable database volume.

Run these commands only from the dedicated demo checkout. The script fixes the Compose project name to fulltext-rss-reader-demo by default so it cannot target the normal stack accidentally.

## Publish over HTTPS

Keep the application bound to the loopback address. An HTTPS reverse proxy can forward to it; for example, with the default port, a Caddy site can use:

    rss-demo.example.com {
        encode zstd gzip
        reverse_proxy 127.0.0.1:18121
    }

Use the equivalent HTTPS virtual host in Nginx or another proxy. A managed tunnel is also suitable when it routes the public hostname to `http://127.0.0.1:18121` without publishing the application port. In either case, preserve the original Host and forwarded-protocol headers and add request-rate and connection limits appropriate for a public shared account.

## Scheduled reset

A shared demo should reset regularly. The Compose file and `demo-stack.sh` do not install a scheduler. For a six-hour cron cadence, an operator can add an entry similar to:

    17 */6 * * * cd /srv/fulltext-rss-reader && ./scripts/demo-stack.sh reset >> /var/log/fulltext-rss-reader-demo-reset.log 2>&1

Replace the checkout path with the actual dedicated demo path. Choose an off-peak minute and configure log rotation. Reset causes a short outage while the image, migration, seed, and health check complete. Use reseed instead when retaining the database container is preferred.

## Update

    git pull --ff-only
    ./scripts/demo-stack.sh up

If a migration or seed change requires a clean database, run reset.

## Operational boundary

- Do not add production feeds, accounts, credentials, or exports to the seed file.
- Do not publish the PostgreSQL port.
- Keep the HTTPS edge and Docker host patched.
- Keep the existing safe-fetch and workload-limit implementation enabled.
- Monitor disk usage, container health, and proxy logs; the seeded database itself is disposable and should not be backed up.
