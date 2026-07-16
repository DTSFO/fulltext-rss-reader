# Fulltext RSS Reader

A single-user RSS/Atom reader with full-text extraction, a background refresh worker, guarded remote fetching, and versioned appearance settings.

[Live demo](https://rss-demo.713007.xyz/) | [Static demo (GitHub Pages)](https://dtsfo.github.io/fulltext-rss-reader/) | [Architecture](docs/architecture.md) | [Security](SECURITY.md)

![CI](https://github.com/DTSFO/fulltext-rss-reader/actions/workflows/ci.yml/badge.svg)

![Fulltext RSS Reader demo](docs/assets/demo-reader.png)

## What is included

- Next.js 16 and React 19 reader with responsive desktop and mobile workflows
- PostgreSQL persistence through Drizzle ORM
- RSS/Atom normalization and Readability-based full-text extraction
- Independent refresh worker with bounded batches and recoverable error state
- Single-user Argon2 authentication and signed sessions
- URL, redirect, address-range, content-type, and response-size safeguards
- Theme editing, preview, import/export, leases, and recovery
- Vitest, Testing Library, Playwright, and integration test coverage

## Demos

The hosted demo runs the authenticated application with a disposable PostgreSQL database. Sign in with `demo-user` / `demo-reader` to add RSS subscriptions and try theme editing, preview, import, and export. To keep the shared instance bounded, it allows five feeds, three custom themes, fifty retained articles per feed, one new subscription attempt per shared account each minute, and one manual refresh per feed every ten minutes. Invented seed data is restored every six hours.

This is a shared public account. Do not add private, authenticated, or credential-bearing feed URLs.

The GitHub Pages demo remains a static React build with embedded example feeds. Search, filters, read state, article selection, and starring are interactive in memory. It does not fetch external URLs, store credentials, connect to PostgreSQL, or expose an account.

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

Run the public static demo separately:

```bash
pnpm demo:dev
```

For an isolated authenticated demo on a VPS, use docker-compose.demo.yml and the deterministic reset/seed workflow documented in [Hosted demo](docs/hosted-demo.md). This stack binds only to a loopback port, uses a separate PostgreSQL volume, and does not start the background refresh worker.

## Verification

```bash
pnpm safety
pnpm lint
pnpm typecheck
pnpm test
pnpm demo:build
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
| `demo` | Static portfolio demo deployed to GitHub Pages |
| `docker-compose.demo.yml` | Isolated authenticated hosted-demo stack |
| `scripts/demo-stack.sh` and `scripts/demo-seed.sql` | Demo lifecycle and deterministic reset data |

## Public edition

This repository is an independent sanitized publication. It contains no private Git history, personal subscriptions, production database, deployment credentials, Agent session files, or private infrastructure configuration.

## License

MIT
