import "server-only";

import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { getEnv } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";

export async function ensureConfiguredUser() {
  const { SINGLE_USER_USERNAME } = getEnv();
  const db = getDb();

  const [user] = await db
    .insert(users)
    .values({ username: SINGLE_USER_USERNAME })
    .onConflictDoUpdate({
      target: users.username,
      set: { updatedAt: new Date() },
    })
    .returning({ id: users.id, username: users.username });

  if (user) {
    return user;
  }

  const [existingUser] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.username, SINGLE_USER_USERNAME))
    .limit(1);

  if (!existingUser) {
    throw new Error("Configured user could not be created.");
  }

  return existingUser;
}
