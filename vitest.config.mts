import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Native replacement for vite-tsconfig-paths; resolves the `@/*` alias.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "cli",
          environment: "node",
          include: ["tests/cli/**/*.test.ts"],
          // The suite builds the CLI, then drives it against a dev server it
          // starts itself; both are far slower than a unit test.
          globalSetup: ["./tests/cli/build-cli.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
