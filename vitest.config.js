import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globalSetup: ["./test/setup.js"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { ADMIN_SECRET: "segredo-de-teste" },
        },
      },
    },
  },
});
