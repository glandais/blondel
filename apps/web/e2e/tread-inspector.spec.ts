/**
 * Inspecteur Marche (maquette 2a, ADR-0009 point 4) : il remplace le mode expert du plan et
 * reprend tout ce que prouvait `expert.spec.ts` — sélection d'une marche balancée sur le plan
 * coté, angle de la ligne de nez saisi (retouche « angle » persistée, annulable), flèches dans
 * la vue (une entrée d'historique par rafale), nez fixe à la touche F, retouche orpheline après
 * régénération, retrait des orphelines puis de tout, persistance (autosauvegarde), bloc
 * indisponible sur un hélicoïdal. Plus : petite rotation sans remarque K3 / K5, liste des
 * retouches nez par nez, « Retirer la retouche » et touche Suppr (annulables), marche atteinte
 * au clavier sur le plan (Tab, Entrée).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  commitField,
  describeTasks,
  inspectorPanel,
  instrument,
  openApp,
  openSection,
  openTab,
  overBudget,
  selectTreadOnPlan,
  settle,
  takeLongTasks,
  viewHighlight,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

/** Marche balancée du quart tournant à gauche (nez 2, zone 1 → 6). */
const WINDER = 3;

function nosingBlock(page: Page) {
  return inspectorPanel(page).getByRole("region", { name: "Ligne de nez" });
}

const undo = (page: Page) => page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
const redo = (page: Page) =>
  page.getByRole("button", { name: "Rétablir (Ctrl+Maj+Z)", exact: true });

test(`inspecteur Marche : angle, flèches, nez fixe, orpheline, annulation, persistance (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await takeLongTasks(page);

  // Sélection d'une marche balancée sur le plan coté : gabarit Marche, marche surlignée.
  const inspector = await selectTreadOnPlan(page, WINDER);
  await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(`Marche ${WINDER}`);
  await expect(inspector.locator(".insp-eyebrow")).toHaveText("Marche · tournant 1");
  await expect(inspector.locator(".tag")).toHaveText("balancée");
  await expect.poll(() => viewHighlight(page)).toContain(`data-tread="${WINDER}"`);
  for (const label of [
    "Giron (ligne de foulée)",
    "Collet",
    "Hauteur",
    "Altitude du nez",
    "Échappée au nez",
  ]) {
    await expect(inspector.locator(".insp-values td", { hasText: label })).toHaveCount(1);
  }

  const block = nosingBlock(page);
  const angle = block.getByLabel("Angle imposé", { exact: true });
  const fix = block.getByRole("button", { name: /^Fixer le nez/ });
  const remove = block.getByRole("button", { name: "Retirer la retouche" });
  await expect(block.getByText(/^Calculé par M3/)).toBeVisible();
  await expect(remove).toBeDisabled();
  await expect(fix).toHaveAttribute("aria-pressed", "false");

  // Angle saisi : retouche appliquée, une entrée d'historique.
  await commitField(page, angle, "4,5");
  await expect(angle).toHaveValue("4,5");
  await expect(remove).toBeEnabled();
  await expect(block.getByText("1 retouche sur l'escalier")).toBeVisible();
  // Petite rotation : ni croisement (K5) ni collets non monotones (K3) signalés.
  await expect(block.locator(".nosing-line__notes")).toHaveCount(0);
  // Liste des retouches, nez par nez.
  await expect(block.getByRole("list", { name: "Retouches des lignes de nez" })).toContainText(
    `nez ${WINDER - 1} : angle imposé 4,5°`,
  );
  await undo(page).click();
  await settle(page);
  await expect(remove).toBeDisabled();
  await expect(block.getByText(/retouches? sur l'escalier/)).toHaveCount(0);
  await redo(page).click();
  await settle(page);
  await expect(angle).toHaveValue("4,5");

  // Flèches avec le focus dans la vue : +1° en une entrée d'historique.
  await page.locator("#view-panel").focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  await expect(angle).toHaveValue("5,5");
  await undo(page).click();
  await settle(page);
  await expect(angle).toHaveValue("4,5");
  await redo(page).click();
  await settle(page);
  await expect(angle).toHaveValue("5,5");
  // Maj : ±0,1° ; une rafale de touches sur le même nez = une seule entrée.
  await page.locator("#view-panel").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await settle(page);
  await expect(angle).toHaveValue("5,3");
  await undo(page).click();
  await settle(page);
  await expect(angle).toHaveValue("5,5");
  await undo(page).click();
  await settle(page);
  await expect(angle).toHaveValue("4,5");

  // F : nez fixe (bascule), annulable.
  await page.locator("#view-panel").focus();
  await page.keyboard.press("f");
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "true");
  await undo(page).click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "false");
  await redo(page).click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "true");
  await expect(block.getByText("2 retouches sur l'escalier")).toBeVisible();

  // « Retirer la retouche » : les deux retouches du nez, en une entrée d'historique.
  await remove.click();
  await settle(page);
  await expect(block.getByText(/retouches? sur l'escalier/)).toHaveCount(0);
  await expect(remove).toBeDisabled();
  await undo(page).click();
  await settle(page);
  await expect(block.getByText("2 retouches sur l'escalier")).toBeVisible();
  // Suppr (focus dans la vue) : même retrait, annulable.
  await page.locator("#view-panel").focus();
  await page.keyboard.press("Delete");
  await settle(page);
  await expect(remove).toBeDisabled();
  await undo(page).click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "true");
  await expect(angle).toHaveValue("4,5");

  // Nez fixe sous la dernière marche, puis moins de marches : retouche orpheline affichée.
  const last = Number(
    await page
      .locator("#view-panel .svg-export [data-tread]")
      .evaluateAll((els) => Math.max(...els.map((e) => Number(e.getAttribute("data-tread")) || 0))),
  );
  await selectTreadOnPlan(page, last);
  await page.keyboard.press("f");
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "true");
  await expect(block.getByText("3 retouches sur l'escalier")).toBeVisible();

  await openSection(page, "Site");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2300");
  await selectTreadOnPlan(page, WINDER);
  const orphans = block.getByText(/^1 retouche orpheline \(nez inexistant\)$/);
  await expect(orphans).toBeVisible();
  await block.getByRole("button", { name: "Retirer les orphelines" }).click();
  await settle(page);
  await expect(orphans).toHaveCount(0);
  await expect(block.getByText("2 retouches sur l'escalier")).toBeVisible();

  // Tout retirer : une entrée, annulable.
  await block.getByRole("button", { name: "Tout retirer" }).click();
  await settle(page);
  await expect(block.getByText(/retouches? sur l'escalier/)).toHaveCount(0);
  await expect(remove).toBeDisabled();
  await undo(page).click();
  await settle(page);
  await expect(block.getByText("2 retouches sur l'escalier")).toBeVisible();

  const tasks = await takeLongTasks(page);
  expect(describeTasks(overBudget(tasks), tasks)).toBe("");

  // Persistance : les retouches sont dans le projet (autosauvegarde), rouvert au rechargement.
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("blondel.autosave.project")?.includes('"nosingOverrides":[{'),
      ),
    )
    .toBe(true);
  await page.reload();
  await settle(page);
  await selectTreadOnPlan(page, WINDER);
  await expect(block.getByText("2 retouches sur l'escalier")).toBeVisible();
  await expect(block.getByLabel("Angle imposé", { exact: true })).toHaveValue("4,5");
  await expect(fix).toHaveAttribute("aria-pressed", "true");
});

test("inspecteur Marche au clavier : marche du plan atteinte par Tab, ouverte par Entrée", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openTab(page, "Plan");
  const tread = page
    .locator("#view-panel .svg-export")
    .getByRole("button", { name: `Marche ${WINDER}`, exact: true });
  await expect(tread).toHaveAttribute("tabindex", "0");
  await tread.focus();
  await page.keyboard.press("Enter");
  const inspector = inspectorPanel(page);
  await expect(inspector).toHaveAttribute("data-template", "tread");
  await expect(inspector.locator(`[data-tread-number="${WINDER}"]`)).toBeVisible();
  // Avec le focus sur la marche : F fixe son nez (le bloc « Ligne de nez » remplace l'expert).
  await page.keyboard.press("f");
  await settle(page);
  await expect(nosingBlock(page).getByRole("button", { name: /^Fixer le nez/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("inspecteur Marche : ligne de nez indisponible sur un hélicoïdal", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal à fût central");
  await selectTreadOnPlan(page, 3);
  await expect(nosingBlock(page).getByRole("status")).toContainText(
    "Retouche de la ligne de nez indisponible",
  );
  await expect(nosingBlock(page).getByRole("button", { name: /^Fixer le nez/ })).toHaveCount(0);
});
