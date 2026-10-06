/**
 * Captures d'écran de la refonte de l'interface (ADR-0009) : même serveur et mêmes réglages que
 * les tests de bout en bout, mais seuls les fichiers `*.captures.ts` sont lancés (jamais par
 * `pnpm e2e`). Les images sont écrites dans `docs/ux/captures-refonte/` (`CAPTURES_DIR` pour un
 * autre dossier) ; `docs/ux/captures/` (interface d'avant la refonte, `docs/ux/EXISTANT.md`)
 * n'est plus réécrit.
 */
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  testDir: "e2e/captures",
  testMatch: "**/*.captures.ts",
  // Un seul parcours enchaîne onze captures (démo, guidé, libre, inspecteurs, Fabrication).
  timeout: 300_000,
  expect: { timeout: 30_000 },
});
