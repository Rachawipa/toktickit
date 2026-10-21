import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    // Existing suites log in with wrong passwords on purpose; keep the limit out of their way.
    env: { LOGIN_MAX_ATTEMPTS: "1000" },
  },
});
