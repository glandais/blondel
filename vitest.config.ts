import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // Tests de bout en bout (Playwright, `pnpm e2e`) : jamais exécutés par vitest.
    exclude: [...configDefaults.exclude, "apps/*/e2e/**"],
    environment: "node",
    // Tests lourds (propriétés DXF, PDF, exemples) : 5 s par défaut ne suffisent pas sur une
    // machine chargée ; un vrai blocage reste détecté.
    testTimeout: 30_000,
  },
});
