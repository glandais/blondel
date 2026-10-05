/**
 * Application installable (ADR-0008) : manifeste et icônes servis, service worker installé
 * (encart « prêt hors ligne »), puis rechargement **hors ligne** : l'application s'ouvre, le
 * modèle est calculé (worker en cache) et la vue 3D, chargée à la demande, s'affiche.
 *
 * Le service worker, bloqué par défaut dans les autres specs (`playwright.config.ts`), est
 * autorisé ici.
 */
import { expect, test } from "@playwright/test";
import { openApp, openTab, settle } from "./support.js";

test.use({ serviceWorkers: "allow" });

test("manifeste : nom, affichage autonome, icônes servies", async ({ page, request }) => {
  await openApp(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href!, page.url());
  const res = await request.get(manifestUrl.href);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.short_name).toBe("Blondel");
  expect(manifest.name).toContain("Blondel");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const r = await request.get(new URL(icon.src, manifestUrl).href);
    expect(r.ok(), icon.src).toBe(true);
  }
});

test("hors ligne : après installation, l'application se recharge et calcule sans réseau", async ({
  page,
  context,
}) => {
  await openApp(page);
  // Installation terminée (cache rempli) : le service worker est actif.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(page.getByRole("status", { name: "Mise à jour de l'application" })).toContainText(
    "prêt à fonctionner hors ligne",
  );
  // L'avis ne recouvre pas la mention indicative du pied de l'inspecteur (toujours lisible).
  const disclaimer = page.locator(".inspector-disclaimer");
  await disclaimer.scrollIntoViewIfNeeded();
  const covered = await disclaimer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const points = [0.1, 0.5, 0.9].map((f) => [r.left + f * r.width, r.top + r.height / 2]);
    return points.filter(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      return hit === null || !el.contains(hit);
    }).length;
  });
  expect(covered).toBe(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("toolbar", { name: "Barre d'outils" })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await settle(page);
  // Modèle calculé par le worker (servi par le cache) : nombre de hauteurs affiché.
  await expect(
    page
      .locator(".figure-line__item")
      .filter({ has: page.locator("dt", { hasText: /^n$/ }) })
      .locator("dd"),
  ).toHaveText(/^\d+$/);
  // Vue 3D : morceau chargé à la demande, lui aussi en cache.
  await openTab(page, "3D");
  await expect(page.locator(".viewer3d canvas")).toBeVisible();
  await context.setOffline(false);
});
