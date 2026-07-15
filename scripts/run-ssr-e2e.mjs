import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";

import { hash } from "@node-rs/argon2";

const composeFile = "docker-compose.integration.yml";
const composeProject = `fulltext-rss-reader-ssr-e2e-${process.pid}`;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an authenticated SSR E2E port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const databasePort = process.env.SSR_E2E_DATABASE_PORT
  ? Number(process.env.SSR_E2E_DATABASE_PORT)
  : await availablePort();
const dockerDatabaseUrl = `postgres://fulltext-rss-reader_test:fulltext-rss-reader_test@127.0.0.1:${databasePort}/fulltext-rss-reader_integration_test`;
const appPort = process.env.SSR_E2E_PORT
  ? Number(process.env.SSR_E2E_PORT)
  : await availablePort();
const baseURL = `http://localhost:${appPort}`;
const username = process.env.SSR_E2E_USERNAME ?? "demo-user";
const password = process.env.SSR_E2E_PASSWORD ?? "ssr-e2e-password";
let databaseUrl = process.env.SSR_E2E_DATABASE_URL;
let startedDocker = false;

function command(binary, args, env) {
  const result = spawnSync(binary, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (!databaseUrl) {
  const docker = spawnSync("docker", ["version"], { stdio: "ignore" });
  if ((docker.status ?? 1) !== 0) {
    console.error(
      "Authenticated SSR E2E requires Docker, or SSR_E2E_DATABASE_URL pointing to a disposable PostgreSQL database whose name contains 'test'.",
    );
    process.exit(2);
  }
  const composeEnv = {
    ...process.env,
    INTEGRATION_POSTGRES_PORT: String(databasePort),
  };
  if (command("docker", ["compose", "-p", composeProject, "-f", composeFile, "up", "-d", "--wait", "postgres-integration"], composeEnv) !== 0) {
    process.exit(1);
  }
  databaseUrl = dockerDatabaseUrl;
  startedDocker = true;
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")).toLowerCase();
if (!/(^|[_-])test($|[_-])/u.test(databaseName)) {
  console.error("Refusing authenticated SSR E2E: PostgreSQL database name must contain a distinct 'test' segment.");
  process.exit(2);
}

const passwordHash = process.env.SSR_E2E_PASSWORD_HASH ?? await hash(password);
const runtimeEnv = {
  ...process.env,
  NODE_ENV: "production",
  E2E_TEST_MODE: "false",
  DATABASE_URL: databaseUrl,
  APP_URL: baseURL,
  SINGLE_USER_USERNAME: username,
  SINGLE_USER_PASSWORD_HASH: passwordHash,
  SESSION_SECRET: "ssr-e2e-session-secret-at-least-32-bytes",
  SSR_E2E_PORT: String(appPort),
  SSR_E2E_BASE_URL: baseURL,
  SSR_E2E_USERNAME: username,
  SSR_E2E_PASSWORD: password,
};

let exitCode = 1;
try {
  const migrationEnv = {
    ...runtimeEnv,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
  };
  if (command("pnpm", ["db:migrate"], migrationEnv) !== 0) {
    exitCode = 1;
  } else if (process.env.SSR_E2E_SKIP_BUILD !== "true" && command("pnpm", ["build:web"], runtimeEnv) !== 0) {
    exitCode = 1;
  } else {
    const standaloneStatic = ".next/standalone/.next/static";
    rmSync(standaloneStatic, { recursive: true, force: true });
    mkdirSync(".next/standalone/.next", { recursive: true });
    cpSync(".next/static", standaloneStatic, { recursive: true });
    if (existsSync("public")) {
      rmSync(".next/standalone/public", { recursive: true, force: true });
      cpSync("public", ".next/standalone/public", { recursive: true });
    }
    exitCode = command(
      "pnpm",
      ["exec", "playwright", "test", "--config", "playwright.ssr.config.ts"],
      runtimeEnv,
    );
  }
} finally {
  if (startedDocker) {
    const composeEnv = {
      ...process.env,
      INTEGRATION_POSTGRES_PORT: String(databasePort),
    };
    command("docker", ["compose", "-p", composeProject, "-f", composeFile, "down", "-v"], composeEnv);
  }
}

process.exit(exitCode);
