import { defineConfig } from "drizzle-kit";

// Use Postgres in production (DATABASE_URL set), SQLite locally
const isPostgres = !!process.env.DATABASE_URL;

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: isPostgres ? "postgresql" : "sqlite",
  dbCredentials: isPostgres
    ? { url: process.env.DATABASE_URL! }
    : { url: "./data.db" },
});
