/**
 * Ligne de chiffres sous la vue : échappée sur la largeur des marches et échappée « non limitée » quand la trémie
 * couvre tout l'escalier (décision A7 du 2026-09-29). Les valeurs sont lues dans le modèle
 * (`Model.headroomWidth`, `Model.headroomUnlimited`) : aucun calcul dans l'interface.
 */
import { expect, test, type Page } from "@playwright/test";
import { applyPreset, openApp } from "./support.js";

/** Valeur affichée d'un élément de la ligne de chiffres, repéré par son intitulé. */
const statusValue = (page: Page, label: string) =>
  page
    .locator(".figure-line__item")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");

test("ligne de chiffres : « Échappée largeur » mesurée, « non limitée » sous une trémie couvrante", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const width = statusValue(page, "Échappée largeur");
  await expect(width).toHaveCount(1);
  await expect(width).toContainText(/\d/);
  await expect(width).not.toContainText("non limitée");
  await expect(statusValue(page, "Échappée")).toContainText(/\d/);
  // Format de la maquette : mm entiers avec l'unité (arrondi à l'affichage seulement).
  await expect(statusValue(page, "Échappée")).toHaveText(/^\d[\d\s ]* mm$/);
  await expect(width).toHaveText(/^\d[\d\s ]* mm$/);
  // Une seule ligne, panneau ouvert compris ; les secondaires quittent la ligne au besoin et
  // restent dans le détail repliable.
  await page.locator("#rail-tab-stepping").click();
  const line = (await page.locator(".figure-line").boundingBox())!;
  expect(line.height).toBeLessThan(30);
  await expect(page.locator('.figure-line__extra [data-figure="headroomWidth"] dd')).toContainText(
    /\d/,
  );

  // Demi-tournant des préréglages : la trémie couvre tout l'escalier.
  await applyPreset(page, "Demi-tournant balancé");
  await expect(width).toHaveText("non limitée");
  await expect(statusValue(page, "Échappée")).toHaveText("non limitée");
});
