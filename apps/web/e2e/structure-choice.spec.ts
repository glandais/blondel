/**
 * Décisions A4 et A13 de l'utilisateur (2026-09-30) : au choix d'une structure qui exige un
 * poteau d'angle, le jour vif du préréglage passe en poteau (100 mm, ou poteau élargi décalé
 * vers le jour pour les profilés), en une seule modification annulable, avec un message.
 */
import { expect, test } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  chooseStructure,
  describeTasks,
  instrument,
  openApp,
  openSection,
  overBudget,
  settle,
  structureSelect,
  takeLongTasks,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test(`limons à la française sur le quart tournant : poteau de 100 mm, annulable (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openSection(page, "Tracé");
  const jour = page.getByLabel("Jour", { exact: true });
  await expect(jour).toHaveValue("sharp");
  await takeLongTasks(page);

  await chooseStructure(page, "wood-housed");
  await openSection(page, "Tracé");
  await expect(jour).toHaveValue("newel");
  await expect(page.getByLabel("Côté du poteau")).toHaveValue("100");
  await expect(page.locator(".notice")).toContainText("jour vif → poteau de 100 mm");
  await expect(page.locator(".figure-line__errors")).toHaveCount(0);

  // Une seule entrée d'historique : « Annuler » rend le jour vif et la structure « aucune ».
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(jour).toHaveValue("sharp");
  await openSection(page, "Structure");
  await expect(structureSelect(page)).toHaveValue("none");

  const over = overBudget(await takeLongTasks(page));
  expect(describeTasks(over), `tâches > ${LONG_TASK_BUDGET_MS} ms`).toBe("");
});

test("profilés sur le quart tournant : poteau élargi décalé vers le jour", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await takeLongTasks(page);
  await chooseStructure(page, "steel-profile");
  await openSection(page, "Tracé");
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("newel");
  await expect(page.locator(".notice")).toContainText("vers le jour");
  const offset = page.getByLabel("Décalage du poteau vers le jour");
  await expect(offset).not.toHaveValue("0");
  const over = overBudget(await takeLongTasks(page));
  expect(describeTasks(over), `tâches > ${LONG_TASK_BUDGET_MS} ms`).toBe("");
});
