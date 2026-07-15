import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { getEnv } from "@/lib/config/env";

type Database = PostgresJsDatabase<typeof schema>;

let database: Database | undefined;
let sqlClient: ReturnType<typeof postgres> | undefined;

export function getDb(): Database {
  if (!database) {
    sqlClient = postgres(getEnv().DATABASE_URL, { max: 10 });
    database = drizzle(sqlClient, { schema });
  }

  return database;
}

export async function closeDb() {
  await sqlClient?.end();
  sqlClient = undefined;
  database = undefined;
}
