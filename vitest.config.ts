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
  },
});
