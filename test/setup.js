import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// This runs in Node context before vitest starts
export async function setup() {
  const migrationsDir = join(process.cwd(), "migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const statements = [];
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const stmts = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    statements.push(...stmts);
  }

  // Write to a temporary module that the test will import
  const modulePath = join(process.cwd(), "test", ".migrations-cache.mjs");
  writeFileSync(
    modulePath,
    `export const statements = ${JSON.stringify(statements)};`
  );
}
