import { migrate } from "drizzle-orm/postgres-js/migrator";

import { closeDb, getDb } from "@/lib/db/client";
import { logger } from "@/lib/logging/logger";

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  logger.info({ event: "database.migration.completed" });
  await closeDb();
}

main().catch((error: unknown) => {
  logger.error({ event: "database.migration.failed", err: error });
  process.exitCode = 1;
});
