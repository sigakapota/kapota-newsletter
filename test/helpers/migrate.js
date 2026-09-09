import { statements } from "../.migrations-cache.mjs";

// Apply statements read from migrations/ directory at globalSetup time
export async function applyMigrations(env) {
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}
