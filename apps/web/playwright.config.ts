/**
 * Tests de bout en bout (Playwright, Chromium) : parcours de l'application construite pour la
 * production (`vite build` puis `vite preview`), servie sous le même chemin de base que GitHub
 * Pages (`/blondel/`).
 *
 * - `E2E_PORT` : port du serveur de prévisualisation ; à défaut, un port libre est choisi au
 *   chargement de la configuration (hérité par les processus de test via l'environnement).
 * - `E2E_BASE_URL` : cible déjà servie (ex. le site déployé) ; aucun serveur n'est alors lancé.
 * - `E2E_GPU=1` : Chrome installé avec le GPU matériel (ANGLE / OpenGL) au lieu de SwiftShader,
 *   pour reproduire localement les conditions d'un poste réel.
 * - `E2E_SKIP_BUILD=1` : réutilise `dist/` (construit auparavant avec `BASE_PATH=/blondel/`).
 */
import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const BASE_PATH = "/blondel/";

/** Port TCP libre (demandé au système par un court processus Node, de façon synchrone). */
function freePort(): number {
  const out = execFileSync(
    process.execPath,
    [
      "-e",
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});",
    ],
    { encoding: "utf8" },
  );
  return Number(out);
}

const external = process.env["E2E_BASE_URL"];
if (!external && !process.env["E2E_PORT"]) process.env["E2E_PORT"] = String(freePort());
const port = Number(process.env["E2E_PORT"]);
const baseURL = external ?? `http://127.0.0.1:${port}${BASE_PATH}`;
const gpu = process.env["E2E_GPU"] === "1";
const build = process.env["E2E_SKIP_BUILD"] === "1" ? "" : "pnpm run build && ";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // Parcours longs (construction, exports) ; mesures de tâches longues : un seul worker, pour
  // ne pas partager le processeur entre deux pages mesurées.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    acceptDownloads: true,
    trace: "retain-on-failure",
    locale: "fr-FR",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: gpu
        ? {
            ...devices["Desktop Chrome"],
            viewport: { width: 1440, height: 900 },
            channel: "chrome",
            launchOptions: { args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=gl"] },
          }
        : { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          command: `${build}pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
          url: baseURL,
          env: { BASE_PATH },
          timeout: 180_000,
          reuseExistingServer: false,
          stdout: "ignore",
          stderr: "pipe",
        },
      }),
});
