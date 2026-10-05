/**
 * Mode expert du plan 2D (SPEC §2.3, CHALLENGE A4) : sélection d'une ligne de nez, rotation
 * autour de P_k par la poignée (surcharge « angle » persistée, un seul « Annuler » pour tout le
 * glissement), nez fixe au clic droit, surcharge orpheline affichée après régénération.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  commitField,
  describeTasks,
  instrument,
  openApp,
  openSection,
  openTab,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

async function openExpert(page: Page): Promise<void> {
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Mode expert", exact: true }).click();
  await expect(page.getByLabel("Nez sélectionné")).toBeVisible();
}

function overrides(page: Page) {
  return page.getByRole("list", { name: "Surcharges des nez" }).locator("li");
}

test(`mode expert : rotation d'un nez, nez fixe, orpheline, annulation (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await takeLongTasks(page);
  await openExpert(page);

  // Sélection d'un nez balancé par un clic sur sa ligne (zone de clic élargie).
  const select = page.getByLabel("Nez sélectionné");
  const balanced = await select
    .locator("option", { hasText: "(balancé)" })
    .first()
    .getAttribute("value");
  expect(balanced).not.toBeNull();
  const k = Number(balanced);
  const hit = page.locator(`line.plan-expert__hit[data-nosing="${k}"]`);
  await hit.click({ force: true });
  await expect(select).toHaveValue(String(k));
  const status = page.locator(".plan-site__status");
  const before = await status.textContent();

  // Glissement de la poignée : plusieurs déplacements, une seule entrée d'historique.
  const handle = page.locator("circle.plan-expert__handle");
  const box = await handle.boundingBox();
  if (!box) throw new Error("poignée introuvable");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Simple clic sur la poignée (sans glissement) : aucune surcharge (le nez balancé n'est pas
  // figé à son angle courant).
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
  await expect(page.getByText("Aucune surcharge.")).toBeVisible();
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Petits déplacements : la ligne reste entre le jour et le mur (angle applicable).
  for (let i = 1; i <= 4; i++) await page.mouse.move(x + i, y + i, { steps: 2 });
  await page.mouse.up();
  await settle(page);
  await expect(overrides(page)).toHaveCount(1);
  await expect(overrides(page).first()).toContainText(`nez ${k} : angle imposé`);
  await expect(status).not.toHaveText(before ?? "");
  await expect(page.locator(".plan-expert__notes")).toHaveCount(0);

  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  await undo.click();
  await settle(page);
  await expect(page.getByText("Aucune surcharge.")).toBeVisible();
  await page.getByRole("button", { name: "Rétablir (Ctrl+Maj+Z)", exact: true }).click();
  await settle(page);
  await expect(overrides(page)).toHaveCount(1);

  // Angle saisi au clavier dans le panneau.
  const angle = page.getByLabel("Angle imposé (°)");
  await angle.fill("4,5");
  await angle.press("Enter");
  await settle(page);
  await expect(overrides(page).first()).toContainText("angle imposé 4,5°");

  // Nez fixe par clic droit sur la ligne du dernier nez.
  const last = Number(await select.locator("option").last().getAttribute("value"));
  await page.locator(`line.plan-expert__hit[data-nosing="${last}"]`).click({
    button: "right",
    force: true,
  });
  await settle(page);
  await expect(overrides(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Nez fixe" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Moins de marches : le dernier nez disparaît, sa surcharge devient orpheline (affichée).
  await openSection(page, "Site");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2300");
  await expect(page.locator(".plan-expert__orphan")).toHaveCount(1);
  await expect(page.locator(".plan-expert__orphan")).toContainText("orpheline");
  await page.getByRole("button", { name: /^Retirer les orphelines/ }).click();
  await settle(page);
  await expect(page.locator(".plan-expert__orphan")).toHaveCount(0);

  // Tout retirer : une entrée, annulable.
  await page.getByRole("button", { name: "Retirer toutes les surcharges" }).click();
  await settle(page);
  await expect(page.getByText("Aucune surcharge.")).toBeVisible();

  const tasks = await takeLongTasks(page);
  expect(describeTasks(overBudget(tasks), tasks)).toBe("");
});

test("mode expert indisponible sur un hélicoïdal", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal à fût central");
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Mode expert", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Mode expert indisponible" }),
  ).toBeVisible();
});
