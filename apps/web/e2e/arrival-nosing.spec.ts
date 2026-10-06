/**
 * Nez d'arrivée sélectionnable (QUESTIONS A28, décision de l'utilisateur du 2026-10-06) : le
 * dernier nez, au palier haut, n'est porté par aucune marche. Un clic sur sa ligne (plan coté)
 * ou son point (élévation) le sélectionne : inspecteur « Nez d'arrivée » avec le bloc « Ligne de
 * nez » seul (sans fiche de marche), nez surligné dans la vue ; angle affiché mais non
 * modifiable (les bords de l'escalier s'arrêtent à ce nez : tout angle non nul est inapplicable,
 * question A30), Fixer le nez (annulable) puis Retirer la retouche ; navigation ‹ › avec la
 * dernière marche ; clavier (Tab, Entrée) ; Échap revient à l'inspecteur « sans sélection ».
 */
import { expect, test, type Page } from "@playwright/test";
import {
  applyPreset,
  inspectorPanel,
  instrument,
  openApp,
  openTab,
  selectTreadOnPlan,
  settle,
  viewHighlight,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

/** Quart tournant à gauche : 15 nez (0 à 14), 14 marches ; le nez 14 est le nez d'arrivée. */
const ARRIVAL = 14;
const LAST_TREAD = 14;

const target = (page: Page) => page.locator(`#view-panel .svg-export [data-nosing-target]`);
const nosingBlock = (page: Page) =>
  inspectorPanel(page).getByRole("region", { name: "Ligne de nez" });
const undo = (page: Page) => page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });

/** Plan coté affiché (onglet Plan, mode « Plan coté »). */
async function showPlan(page: Page): Promise<void> {
  await openTab(page, "Plan");
  const drawing = page.getByRole("button", { name: "Plan coté", exact: true });
  if ((await drawing.getAttribute("aria-pressed")) !== "true") await drawing.click();
  await expect(page.locator("#view-panel .svg-export svg")).toBeVisible();
}

async function expectArrivalInspector(page: Page): Promise<void> {
  const inspector = inspectorPanel(page);
  await expect(inspector).toHaveAttribute("data-template", "nosing");
  await expect(inspector.getByRole("heading", { level: 3 })).toHaveText("Nez d'arrivée");
  await expect(inspector.locator(".insp-eyebrow")).toHaveText(`Nez ${ARRIVAL} · palier d'arrivée`);
  await expect.poll(() => viewHighlight(page)).toContain(`data-nosing="${ARRIVAL}"`);
}

test("plan coté : sélection du nez d'arrivée, angle verrouillé, nez fixe, annulation, retrait, Échap", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await showPlan(page);

  // Une seule cible, celle du nez d'arrivée, nommée et focalisable.
  await expect(target(page)).toHaveCount(1);
  await expect(target(page)).toHaveAttribute("data-nosing-target", String(ARRIVAL));
  await expect(target(page)).toHaveAttribute("aria-label", "Nez d'arrivée");

  await target(page).click();
  await settle(page);
  await expectArrivalInspector(page);
  const inspector = inspectorPanel(page);
  // Bloc « Ligne de nez » seul : aucune fiche de marche.
  await expect(inspector.locator(".insp-values")).toHaveCount(0);
  await expect(inspector.locator("[data-tread-number]")).toHaveCount(0);
  const block = nosingBlock(page);
  await expect(block).toBeVisible();
  const angle = block.getByLabel("Angle imposé", { exact: true });
  const fix = block.getByRole("button", { name: /^Fixer le nez/ });
  const remove = block.getByRole("button", { name: "Retirer la retouche" });
  await expect(block.locator("[data-computed]")).toBeVisible();
  await expect(remove).toBeDisabled();
  await expect(fix).toHaveAttribute("aria-pressed", "false");

  // Angle affiché (valeur du cœur) mais non modifiable, avec son motif ; les flèches de la vue
  // n'imposent pas d'angle sur ce nez.
  await expect(angle).toBeDisabled();
  await expect(angle).toHaveValue("0,0");
  await expect(block.getByText(/^Angle non modifiable : les bords de l'escalier/)).toBeVisible();
  await page.locator("#view-panel").focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  await expect(block.getByText(/retouches? sur l'escalier/)).toHaveCount(0);

  // Fixer le nez : une entrée d'historique, annulable ; toujours le nez d'arrivée inspecté.
  await fix.click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "true");
  await expect(block.getByText("1 retouche sur l'escalier")).toBeVisible();
  await expect(remove).toBeEnabled();
  await undo(page).click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "false");
  await expect(block.getByText(/retouches? sur l'escalier/)).toHaveCount(0);
  await expect(remove).toBeDisabled();
  await expect(inspector).toHaveAttribute("data-template", "nosing");

  // Fixer le nez, puis retirer la retouche (deux entrées d'historique).
  await fix.click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "true");
  await expect(block.getByText("1 retouche sur l'escalier")).toBeVisible();
  await remove.click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "false");
  await expect(block.getByText(/retouches? sur l'escalier/)).toHaveCount(0);
  await undo(page).click();
  await settle(page);
  await expect(fix).toHaveAttribute("aria-pressed", "true");
  // Lien de la liste : il désigne le nez d'arrivée lui-même.
  await block.getByRole("button", { name: `nez ${ARRIVAL} : fixe`, exact: true }).click();
  await settle(page);
  await expect(inspector).toHaveAttribute("data-template", "nosing");
  await remove.click();
  await settle(page);
  await expect(remove).toBeDisabled();

  // Échap : retour à l'inspecteur « sans sélection » (2d), surlignage effacé.
  await page.locator("#view-panel").focus();
  await page.keyboard.press("Escape");
  await settle(page);
  await expect(inspector).toHaveAttribute("data-template", "project");
  await expect.poll(() => viewHighlight(page)).not.toContain("data-nosing");
});

test("navigation ‹ › entre la dernière marche et le nez d'arrivée ; second clic désélectionne", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const inspector = await selectTreadOnPlan(page, LAST_TREAD);
  await inspector.getByRole("button", { name: "Nez d'arrivée", exact: true }).click();
  await settle(page);
  await expectArrivalInspector(page);
  await inspector.getByRole("button", { name: "Dernière marche", exact: true }).click();
  await settle(page);
  await expect(inspector).toHaveAttribute("data-template", "tread");
  await expect(inspector.locator(`[data-tread-number="${LAST_TREAD}"]`)).toBeVisible();

  // Clic sur le nez d'arrivée, puis second clic : sélection effacée.
  await target(page).click();
  await settle(page);
  await expect(inspector).toHaveAttribute("data-template", "nosing");
  await target(page).click();
  await settle(page);
  await expect(inspector).toHaveAttribute("data-template", "project");
});

test("clavier : nez d'arrivée atteint au Tab, Entrée le sélectionne", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await showPlan(page);
  await target(page).focus();
  await expect(target(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await settle(page);
  await expectArrivalInspector(page);
});

test("élévation : sélection du nez d'arrivée par son point, surligné", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openTab(page, "Élévation");
  await expect(page.locator("#view-panel .svg-export svg")).toBeVisible();
  await expect(target(page)).toHaveCount(1);
  await target(page).click();
  await settle(page);
  await expectArrivalInspector(page);
  await expect(nosingBlock(page)).toBeVisible();
  // La sélection est partagée : le plan surligne la ligne du nez d'arrivée.
  await showPlan(page);
  await expect.poll(() => viewHighlight(page)).toContain(`line[data-nosing="${ARRIVAL}"]`);
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "nosing");
});
