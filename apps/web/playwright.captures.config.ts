/**
 * Captures d'écran de la documentation de l'existant (`docs/ux/`) : même serveur et mêmes
 * réglages que les tests de bout en bout, mais seuls les fichiers `*.captures.ts` sont lancés
 * (jamais par `pnpm e2e`). Les images sont écrites dans `docs/ux/captures/`.
 */
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  testDir: "e2e/captures",
  testMatch: "**/*.captures.ts",
  expect: { timeout: 30_000 },
});
