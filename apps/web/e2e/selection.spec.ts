/**
 * Sélection partagée et chaîne d'Échap (ADR-0009, README du handoff, « Comportements ») :
 * ‹ › de l'inspecteur Marche déplace la sélection dans toutes les vues ; Échap enchaîne saisie
 * → panneau non épinglé → sélection → panneau épinglé ; un clic dans le vide du plan coté, de
 * l'élévation ou de la 3D revient à l'inspecteur « sans sélection » (2d).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  applyPreset,
  inspectorPanel,
  instrument,
  openApp,
  openSection,
  openTab,
  selectTreadOnPlan,
  settle,
  treadClickPoint,
  viewHighlight,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const panel = (page: Page) => page.locator("#free-panel");

/**
 * Point du SVG exporté affiché où un clic ne touche aucune marche ni la cible du nez d'arrivée
 * (« le vide »).
 */
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.locator("#view-panel .svg-export svg").evaluate((svg) => {
    const r = svg.getBoundingClientRect();
    for (let fy = 0.02; fy < 1; fy += 0.06) {
      for (let fx = 0.02; fx < 1; fx += 0.06) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (
          hit !== null &&
          hit.closest(".svg-export") &&
          !hit.closest("[data-tread]") &&
          !hit.closest("[data-nosing-target]")
        ) {
          return { x, y };
        }
      }
    }
    return null;
  });
  if (!point) throw new Error("aucun point vide dans le dessin");
  return point;
}

test("‹ › : la marche voisine est sélectionnée et surlignée dans le plan", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const inspector = await selectTreadOnPlan(page, 3);
  await expect.poll(() => viewHighlight(page)).toContain('data-tread="3"');
  await inspector.getByRole("button", { name: "Marche suivante" }).click();
  await expect(inspector.locator('[data-tread-number="4"]')).toBeVisible();
  await expect.poll(() => viewHighlight(page)).toContain('data-tread="4"');
  await inspector.getByRole("button", { name: "Marche précédente" }).click();
  await inspector.getByRole("button", { name: "Marche précédente" }).click();
  await expect(inspector.locator('[data-tread-number="2"]')).toBeVisible();
  await expect.poll(() => viewHighlight(page)).toContain('data-tread="2"');
  // Première marche : ‹ désactivé.
  await inspector.getByRole("button", { name: "Marche précédente" }).click();
  await expect(inspector.locator('[data-tread-number="1"]')).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Marche précédente" })).toBeDisabled();
  // La sélection suit aussi l'élévation.
  await openTab(page, "Élévation");
  await expect.poll(() => viewHighlight(page)).toContain('data-tread="1"');
});

test("Échap : panneau non épinglé, puis sélection, puis panneau épinglé ; saisie rétablie", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const inspector = await selectTreadOnPlan(page, 3);

  // Échap seul : retour à l'inspecteur « sans sélection », surlignage retiré.
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveAttribute("data-template", "project");
  await expect.poll(() => viewHighlight(page)).toBe("");

  // Panneau non épinglé ouvert : Échap le ferme d'abord, la sélection reste.
  await selectTreadOnPlan(page, 3);
  await openSection(page, "Découpage");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(inspector).toHaveAttribute("data-template", "tread");
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveAttribute("data-template", "project");

  // Panneau épinglé : la sélection part d'abord, le panneau ensuite.
  await openSection(page, "Découpage");
  await panel(page).getByRole("button", { name: "Épingler le panneau" }).click();
  await selectTreadOnPlan(page, 3);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveAttribute("data-template", "project");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  // Échap dans une saisie : la valeur est rétablie, la marche reste sélectionnée.
  await selectTreadOnPlan(page, 3);
  const angle = inspector.getByLabel("Angle imposé", { exact: true });
  const before = await angle.inputValue();
  await angle.fill("9");
  await angle.press("Escape");
  await expect(angle).toHaveValue(before);
  await expect(inspector).toHaveAttribute("data-template", "tread");
  // Perte de focus : la valeur rétablie n'est pas appliquée (aucune retouche).
  await angle.blur();
  await settle(page);
  await expect(angle).toHaveValue(before);
  await expect(inspector.getByRole("button", { name: "Retirer la retouche" })).toBeDisabled();
});

test("clic dans le vide du plan, de l'élévation et de la 3D : inspecteur « sans sélection »", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const inspector = await selectTreadOnPlan(page, 3);

  // Plan coté.
  let p = await emptyPoint(page);
  await page.mouse.click(p.x, p.y);
  await expect(inspector).toHaveAttribute("data-template", "project");

  // Élévation : clic sur une marche (inspecteur Marche), puis dans le vide.
  await openTab(page, "Élévation");
  p = await treadClickPoint(page, 3);
  await page.mouse.click(p.x, p.y);
  await expect(inspector).toHaveAttribute("data-template", "tread");
  p = await emptyPoint(page);
  await page.mouse.click(p.x, p.y);
  await expect(inspector).toHaveAttribute("data-template", "project");

  // 3D : la sélection faite sur le plan est gardée, un clic hors des pièces l'efface.
  await selectTreadOnPlan(page, 3);
  await openTab(page, "3D");
  await expect(inspector).toHaveAttribute("data-template", "tread");
  // Coin du canevas non recouvert par un calque (étiquette de sélection, barre d'outils) : le
  // cadrage laisse les coins hors de l'escalier.
  const corner = await page.locator(".viewer3d canvas").evaluate((canvas) => {
    const r = canvas.getBoundingClientRect();
    const corners = [
      [r.left + 12, r.bottom - 12],
      [r.right - 12, r.bottom - 12],
      [r.right - 12, r.top + 12],
      [r.left + 12, r.top + 12],
    ] as const;
    for (const [x, y] of corners) {
      if (document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    return null;
  });
  if (!corner) throw new Error("aucun coin libre du canevas 3D");
  await page.mouse.click(corner.x, corner.y);
  await settle(page);
  await expect(inspector).toHaveAttribute("data-template", "project");
});
