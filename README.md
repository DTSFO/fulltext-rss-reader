# Fulltext RSS Reader

[简体中文](README.zh-CN.md)

A deployable single-user RSS/Atom reader with full-text extraction, guarded remote fetching, and versioned appearance settings. The normal Docker Compose profile includes an independent refresh worker; the public hosted demo deliberately runs a reduced, quota-limited profile without that worker.

[Live demo](https://rss-demo.713007.xyz/) | [Architecture](docs/architecture.md) | [Security](SECURITY.md)

![CI](https://github.com/DTSFO/fulltext-rss-reader/actions/workflows/ci.yml/badge.svg)

![Hosted reader](docs/assets/demo-reader.png)

The screenshots below are captured from the public, resettable hosted demo. They show the authenticated reader, adding an RSS/Atom subscription, and the appearance/theme controls.

| Add a subscription | Edit appearance and themes |
| --- | --- |
| ![Add a subscription](docs/assets/demo-add-feed.png) | ![Appearance and themes](docs/assets/demo-appearance.png) |

## What is included

- Next.js 16 and React 19 reader with responsive desktop and mobile workflows
- PostgreSQL persistence through Drizzle ORM
- RSS/Atom normalization and Readability-based full-text extraction
- Independent refresh worker with bounded batches and recoverable error state in the normal deployment profile
- Single-user Argon2 authentication and signed sessions
- URL, redirect, address-range, content-type, and response-size safeguards
- Theme editing, preview, import/export, leases, and recovery
- Vitest, Testing Library, Playwright, and integration test coverage

## Deployment profiles

| Profile | Runtime | Intended use |
| --- | --- | --- |
| Normal self-hosted stack | `web`, `worker`, `migrate`, PostgreSQL | A private single-user reader with scheduled background refresh |
| Hosted-demo stack | `web-demo`, `migrate-demo`, `seed-demo`, isolated PostgreSQL; no worker | A shared, disposable feature demo with manual refresh, quotas, cooldowns, and deterministic reset data |

These are repository-supported deployment profiles, not claims that every running instance uses the same topology. Reverse proxy, tunnel, DNS, monitoring, and reset scheduling remain operator-managed infrastructure.

## Hosted demo

The current public instance runs the authenticated hosted-demo profile with a disposable PostgreSQL database and no background refresh worker. Sign in with `demo-user` / `demo-reader` to add RSS subscriptions and try theme editing, preview, import, and export. To keep the shared instance bounded, it allows five feeds, three custom themes, fifty retained articles per feed, one new subscription attempt per shared account each minute, and one manual refresh per feed every ten minutes. The deployed instance is scheduled to restore invented seed data every six hours; scheduling is external to the application stack.

This is a shared public account. Do not add private, authenticated, or credential-bearing feed URLs. The demo is for feature evaluation only; it is not connected to a production database or control plane.

## Local development

Requirements: Node.js 22, pnpm 11, Docker, and Docker Compose.

```bash
cp .env.example .env
pnpm install
pnpm hash-password
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Replace the deliberately invalid hash in `.env` with the generated Argon2 value before starting the application.

For an isolated authenticated demo on a Linux host, use `docker-compose.demo.yml` and the deterministic reset/seed workflow documented in [Hosted demo](docs/hosted-demo.md). This stack binds only to a loopback port, uses a separate PostgreSQL volume, and does not start the background refresh worker. Publishing it over HTTPS and scheduling resets are separate operator tasks.

## Verification

```bash
pnpm safety
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The repository also contains Docker-backed integration and server-rendered Playwright suites. These require a local Docker daemon:

```bash
pnpm test:integration
pnpm test:e2e
```

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app` | Pages and typed route handlers |
| `src/features` | Reader, feed, article, auth, category, and appearance modules |
| `src/jobs` | Background feed refresh worker |
| `src/lib/http` | Guarded outbound HTTP access |
| `src/db` and `drizzle` | Schema, migrations, and database access |
| `tests` | Browser and integration scenarios |
| `docker-compose.demo.yml` | Isolated authenticated hosted-demo stack |
| `scripts/demo-stack.sh` and `scripts/demo-seed.sql` | Demo lifecycle and deterministic reset data |

## Security and data boundary

The repository and its examples contain no personal subscriptions, production database, deployment credentials, Agent session files, or private infrastructure configuration. Operators provide their own environment values, database, feed URLs, and HTTPS entry point. The hosted demo uses disposable, invented data and bounded quotas.

## License

MIT
