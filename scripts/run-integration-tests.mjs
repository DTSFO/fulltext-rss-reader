import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

const composeFile = "docker-compose.integration.yml";
const composeProject = `fulltext-rss-reader-integration-${process.pid}`;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an integration PostgreSQL port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const databasePort = process.env.INTEGRATION_POSTGRES_PORT
  ? Number(process.env.INTEGRATION_POSTGRES_PORT)
  : await availablePort();
const dockerDatabaseUrl = `postgres://fulltext-rss-reader_test:fulltext-rss-reader_test@127.0.0.1:${databasePort}/fulltext-rss-reader_integration_test`;
let databaseUrl = process.env.INTEGRATION_DATABASE_URL;
let startedDocker = false;

function command(binary, args, env = process.env) {
  const result = spawnSync(binary, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (!databaseUrl) {
  const docker = spawnSync("docker", ["version"], { stdio: "ignore" });
  if ((docker.status ?? 1) !== 0) {
    console.error(
      "Integration PostgreSQL unavailable: install Docker, or set INTEGRATION_DATABASE_URL to a disposable PostgreSQL database whose name contains 'test'.",
    );
    process.exit(2);
  }
  const composeEnv = { ...process.env, INTEGRATION_POSTGRES_PORT: String(databasePort) };
  if (command("docker", ["compose", "-p", composeProject, "-f", composeFile, "up", "-d", "--wait", "postgres-integration"], composeEnv) !== 0) {
    process.exit(1);
  }
  databaseUrl = dockerDatabaseUrl;
  startedDocker = true;
}

const parsed = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
if (!/(^|[_-])test($|[_-])/u.test(databaseName)) {
  console.error("Refusing to run integration tests: PostgreSQL database name must contain a distinct 'test' segment.");
  process.exit(2);
}

const env = {
  ...process.env,
  NODE_ENV: "test",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
  DATABASE_URL: databaseUrl,
  APP_URL: "http://localhost:3000",
  SINGLE_USER_PASSWORD_HASH: "$argon2id$integration-placeholder",
  SESSION_SECRET: "integration-session-secret-at-least-32-bytes",
};

let exitCode = 1;
try {
  if (command("pnpm", ["db:migrate"], env) !== 0) process.exitCode = 1;
  else exitCode = command("pnpm", ["exec", "vitest", "run", "--config", "vitest.integration.config.ts", ...process.argv.slice(2)], env);
} finally {
  if (startedDocker) {
    const composeEnv = { ...process.env, INTEGRATION_POSTGRES_PORT: String(databasePort) };
    command("docker", ["compose", "-p", composeProject, "-f", composeFile, "down", "-v"], composeEnv);
  }
}
process.exit(exitCode);
