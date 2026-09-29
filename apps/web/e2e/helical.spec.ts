/**
 * Jalon 5 dans l'interface : tracé hélicoïdal (type de tracé, formulaire, préréglage, plan à
 * arcs, 3D), comparateur avec le débillardé soudé (jour adapté), développés par tronçon et
 * repères de joints, corrections proposées dans la barre d'erreurs (appliquer, annuler).
 */
import { expect, test } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  commitField,
  openApp,
  openTab,
  settle,
  structureSelect,
} from "./support.js";

test("hélicoïdal : préréglage, formulaire, plan à arcs, 3D, retour aux volées", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal à fût central");
  const kind = page.getByLabel("Type de tracé");
  await expect(kind).toHaveValue("helical");
  await expect(structureSelect(page)).toHaveValue("helical-core");
  await expect(page.getByLabel("Emmarchement E")).toHaveCount(0);
  const radius = page.getByLabel("Rayon extérieur R_e");
  await expect(radius).toHaveValue("950");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Plan : marches en secteur (arcs SVG), palier d'arrivée, cote du rayon.
  await openTab(page, "Plan 2D");
  const plan = page.locator(".svg-export svg");
  await expect(plan.locator("path.landing")).toHaveCount(1);
  await expect(plan.locator('[data-dimension="radius"] text')).toHaveText("R 950");
  const d = await plan.locator('path[data-tread="1"]').getAttribute("d");
  expect(d).toMatch(/A/);

  // Formulaire : R_e et marches par tour appliqués au modèle.
  await commitField(page, radius, "1000");
  await expect(plan.locator('[data-dimension="radius"] text')).toHaveText("R 1 000");
  await page.getByLabel("Rotation", { exact: true }).selectOption("angle");
  await settle(page);
  await expect(page.getByLabel("Angle total (nez de départ → nez d'arrivée)")).toBeVisible();

  // 3D : fût, marches et main courante maillés sans erreur.
  await openTab(page, "3D");
  await expect(page.locator(".viewer3d canvas")).toBeVisible();
  await expect(page.locator(".viewer3d__errors")).toHaveCount(0);
  await expect(page.locator(".viewer3d__empty")).toHaveCount(0);

  // Élévation : plafond formé par le tour supérieur.
  await openTab(page, "Élévation");
  await expect(page.locator(".svg-export rect.soffit").first()).toBeVisible();

  // Retour aux volées (annulable) : escalier droit, structure « aucune ».
  await kind.selectOption("flights");
  await settle(page);
  await expect(page.getByLabel("Emmarchement E")).toBeVisible();
  await expect(structureSelect(page)).toHaveValue("none");
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(kind).toHaveValue("helical");
});

test("corrections proposées : bouton dans la barre d'erreurs, appliqué puis annulé", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "wood-housed");
  // Le choix de la structure pose le poteau (décision A4) : jour remis à angle vif à la main
  // pour faire apparaître l'erreur et sa correction.
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("newel");
  await page.getByLabel("Jour", { exact: true }).selectOption("sharp");
  await settle(page);
  const bar = page.locator(".errors-bar");
  const fix = bar.getByRole("button", { name: /Passer le jour en poteau de 100 mm/ });
  await expect(fix).toBeVisible();
  await expect(bar).toContainText(/erreur/i);
  await fix.click();
  await settle(page);
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("newel");
  await expect(page.locator(".notice--info")).toContainText("Correction appliquée");
  await expect(fix).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("sharp");
  await expect(fix).toBeVisible();
});

test("comparateur : débillardé soudé à jour adapté, appliqué ; développés par tronçon et joints", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openTab(page, "Comparateur");
  const table = page.locator(".compare table");
  const header = table.locator("thead th", { hasText: "limon de jour débillardé soudé" });
  await expect(header).toBeVisible();
  const col = await table
    .locator("thead th")
    .evaluateAll((ths) => ths.findIndex((th) => /débillardé soudé/.test(th.textContent ?? "")));
  expect(col).toBeGreaterThan(0);
  const jour = table
    .locator("tbody tr", { hasText: "Raccord de jour" })
    .locator("td")
    .nth(col - 1);
  await expect(jour).toContainText(/T1 : arc R /);
  await table
    .locator("tfoot tr")
    .last()
    .locator("td")
    .nth(col - 1)
    .getByRole("button", { name: "Appliquer" })
    .click();
  await settle(page);
  await expect(structureSelect(page)).toHaveValue("steel-curved");
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("arc");

  await openTab(page, "Développés");
  const joints = page.locator(".flat-view__joints").filter({ hasText: "LD1" });
  await expect(joints).toBeVisible();
  await expect(joints.locator("[data-joint]").first()).toContainText(/J\d+ : LD1 ↔ LD2/);
  await joints.getByRole("button", { name: "LD2" }).click();
  await expect(page.locator(".flat-view__head")).toContainText("LD2");
  await expect(page.locator(".flat-view__drawing .svg-export svg")).toBeVisible();
});
