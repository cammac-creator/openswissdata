import { defineConfig } from "vitest/config";

// Force NODE_ENV=test BEFORE module evaluation so rate-limit.ts (and any
// other env-conditional code) can opt out cleanly during tests.
process.env.NODE_ENV = "test";

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      NODE_ENV: "test",
    },
    // sdks/mcp-server is a standalone sub-package with its own node_modules
    // (@modelcontextprotocol/sdk is not installed at the repo root). Its tests
    // run in a dedicated CI job that does `npm ci` inside sdks/mcp-server.
    exclude: ["**/node_modules/**", "**/dist/**", "sdks/mcp-server/**"],
  },
});
