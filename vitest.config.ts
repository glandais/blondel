import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // Tests de bout en bout (Playwright, `pnpm e2e`) : jamais exécutés par vitest.
    exclude: [...configDefaults.exclude, "apps/*/e2e/**"],
    environment: "node",
  },
});
