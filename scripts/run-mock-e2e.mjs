import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a mock E2E port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const port = process.env.PLAYWRIGHT_PORT ?? String(await availablePort());
const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_PORT: port },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
