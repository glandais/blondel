/**
 * Nouveautés de la vague G dans l'interface : typologie S / Z (préréglage, enchaînement des
 * tournants dans le formulaire de tracé) et méthodes de balancement M2 (herse, curseur α borné
 * par le modèle) et M6 (rotation paramétrée, curseurs λ et p), sous le budget de tâches longues.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  describeTasks,
  instrument,
  openApp,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const typology = (page: Page) => page.locator(".typology__label");

test(`S / Z : préréglage, enchaînement des tournants, sans bloquant (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await takeLongTasks(page);
  await applyPreset(page, "Deux quarts tournants opposés (S)");
  await expect(typology(page)).toContainText("Deux quarts tournants opposés (S / Z");
  const sequence = page.getByLabel("Enchaînement des tournants 1 et 2");
  await expect(sequence).toHaveValue("opposite");
  await expect(page.locator(".typology__note")).toContainText("le jour change de côté");
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);

  // S → U : le second tournant prend le sens du premier ; « Annuler » revient au S.
  await sequence.selectOption("same");
  await settle(page);
  await expect(typology(page)).toContainText("(U)");
  await expect(page.locator(".typology__note")).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(sequence).toHaveValue("opposite");
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);

  const over = overBudget(await takeLongTasks(page));
  expect(describeTasks(over), `tâches > ${LONG_TASK_BUDGET_MS} ms`).toBe("");
});

test(`M2 et M6 : curseurs bornés, un geste = une entrée d'historique (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await takeLongTasks(page);
  const method = page.getByLabel("Méthode", { exact: true });
  for (const m of ["M0", "M1", "M2", "M3", "M6"]) {
    await expect(method.locator(`option[value="${m}"]`)).toHaveCount(1);
  }

  // M2 : curseur α borné par la zone retenue (strictement sous α_max < 90°).
  await method.selectOption("M2");
  await settle(page);
  const alpha = page.getByRole("slider", { name: "Angle α de la herse" });
  await expect(alpha).toBeVisible();
  await expect(page.getByLabel("Variante M3")).toHaveCount(0);
  const max = Number(await alpha.getAttribute("max"));
  expect(max).toBeGreaterThan(0);
  expect(max).toBeLessThan(90);
  await expect(alpha.locator("xpath=..").locator("output")).toContainText("(défaut)");
  await expect(alpha).toHaveValue("20");
  // Clavier : trois pas, une entrée d'historique par touche.
  await alpha.focus();
  for (let i = 0; i < 3; i++) await alpha.press("ArrowRight");
  await settle(page);
  await expect(alpha).toHaveValue("21.5");
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(alpha).toHaveValue("21");
  // Glissement à la souris : plusieurs valeurs, une seule entrée d'historique.
  const box = await alpha.boundingBox();
  if (!box) throw new Error("curseur introuvable");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  for (const f of [0.3, 0.4, 0.5]) await page.mouse.move(box.x + box.width * f, y, { steps: 3 });
  await page.mouse.up();
  await settle(page);
  expect(await alpha.inputValue()).not.toBe("21");
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(alpha).toHaveValue("21");
  // Fin de course : α au maximum du curseur, découpage toujours valide.
  await alpha.focus();
  await alpha.press("End");
  await settle(page);
  expect(Number(await alpha.inputValue())).toBeLessThan(90);
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);
  await page.getByRole("button", { name: "Angle α de la herse : valeur par défaut" }).click();
  await settle(page);
  await expect(alpha).toHaveValue("20");

  // M6 : portée λ et raideur p.
  await method.selectOption("M6");
  await settle(page);
  const reach = page.getByRole("slider", { name: "Portée λ de la rotation" });
  const steep = page.getByRole("slider", { name: "Raideur p de la rotation" });
  await expect(reach).toHaveAttribute("max", "50");
  await expect(steep).toHaveAttribute("max", "20");
  await expect(reach).toHaveValue("2");
  await reach.focus();
  await reach.press("ArrowRight");
  await settle(page);
  await expect(reach).toHaveValue("2.1");
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);

  const over = overBudget(await takeLongTasks(page));
  expect(describeTasks(over), `tâches > ${LONG_TASK_BUDGET_MS} ms`).toBe("");
});
