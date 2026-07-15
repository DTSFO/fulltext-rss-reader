import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://fulltext-rss-reader:fulltext-rss-reader@localhost:5432/fulltext-rss-reader",
  },
  strict: true,
  verbose: true,
});
