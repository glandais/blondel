/**
 * Vue 3D (jalon 6) : barre d'outils 3D — cotes principales en surimpression, vue éclatée, plan
 * de coupe, mesure point à point, sélection et isolation d'une pièce, apparence par famille de
 * pièces — sans tâche longue au-delà du budget.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  chooseStructure,
  describeTasks,
  instrument,
  openApp,
  openTab,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.describe.configure({ retries: 1 });

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

/** Clique au centre du canevas (le cadrage initial vise le centre de l'escalier). */
async function clickCanvas(page: Page, dx = 0, dy = 0): Promise<void> {
  const box = await page.locator(".viewer3d canvas").boundingBox();
  if (!box) throw new Error("canevas 3D introuvable");
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await settle(page);
}

test(`outils 3D : cotes, éclatée, coupe, mesure, isolation (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "wood-housed");
  // Chargement et calculs hors périmètre (mesurés par long-tasks.spec.ts).
  await takeLongTasks(page);
  await openTab(page, "3D");
  const over: string[] = [];
  const check = async (label: string) => {
    const tasks = await takeLongTasks(page);
    const bad = overBudget(tasks);
    if (bad.length > 0) over.push(`${label}\n${describeTasks(bad, tasks)}`);
  };
  await check("ouverture de la vue 3D");

  // Cotes principales : H, emmarchement, reculement.
  const overlay = page.locator(".viewer3d__overlay");
  await expect(overlay.locator("text", { hasText: /^H = / })).toHaveCount(1);
  await expect(overlay.locator("text", { hasText: /^E = / })).toHaveCount(1);
  await expect(overlay.locator("text", { hasText: /^Reculement / })).toHaveCount(1);

  await expect(page.getByRole("toolbar", { name: "Outils 3D" })).toBeVisible();
  await page.getByLabel("Cotes principales").uncheck();
  await expect(overlay.locator("text")).toHaveCount(0);
  await page.getByLabel("Cotes principales").check();
  await settle(page);
  await check("cotes");

  // Vue éclatée puis retour.
  const explode = page.getByLabel("Vue éclatée");
  await explode.fill("100");
  await settle(page);
  await explode.fill("0");
  await settle(page);
  await check("vue éclatée");

  // Plan de coupe en hauteur, déplacé, inversé, retiré.
  await page.getByLabel("Plan de coupe").selectOption("z");
  await settle(page);
  await page.getByLabel("Position de la coupe").fill("30");
  await settle(page);
  await page.getByLabel("Inverser la coupe").check();
  await settle(page);
  await page.getByLabel("Plan de coupe").selectOption("none");
  await settle(page);
  await check("plan de coupe");

  // Mesure point à point : deux clics sur les pièces.
  await page.getByRole("button", { name: "Mesurer" }).click();
  await expect(page.locator(".viewer3d__measure")).toHaveText(/premier point/);
  await clickCanvas(page);
  await clickCanvas(page, 40, 30);
  await expect(page.locator(".viewer3d__measure")).toHaveText(/^Distance : [\d  ,]+ mm$/);
  await expect(overlay.locator(".viewer3d__annotation--measure")).toHaveCount(1);
  await page.getByRole("button", { name: "Effacer la mesure" }).click();
  await page.getByRole("button", { name: "Mesurer" }).click();
  await settle(page);
  await check("mesure");

  // Sélection puis isolation d'une pièce.
  await clickCanvas(page);
  await expect(page.locator(".viewer3d__selected")).toBeVisible();
  await page.getByRole("button", { name: "Isoler la pièce" }).click();
  await settle(page);
  await expect(overlay.locator("text")).toHaveCount(0);
  await page.getByRole("button", { name: "Tout afficher" }).click();
  await settle(page);
  await check("isolation");

  // Apparence par famille de pièces (aperçu) : essence des marches, puis retour au projet.
  await page.locator(".viewer3d__materials > summary").click();
  const treads = page.getByLabel("Marches, contremarches et paliers");
  await treads.selectOption({ label: "Frêne" });
  await settle(page);
  await expect(page.locator(".viewer3d__materials > summary")).toHaveText("Matériaux (1)");
  await treads.selectOption("");
  await settle(page);
  await expect(page.locator(".viewer3d__materials > summary")).toHaveText("Matériaux");
  await check("matériaux");

  await expect(page.locator(".viewer3d__errors")).toHaveCount(0);
  expect(over.join("\n\n")).toBe("");
});

interface CameraHook {
  pose: () => { position: [number, number, number]; target: [number, number, number] };
  orbit: (azimuthDeg: number, elevationDeg: number) => void;
}

/** Pose de la caméra (point d'accès de test de la vue 3D). */
async function cameraPose(page: Page) {
  return page.evaluate(() => {
    const h = (window as Window & { __blondelViewer3D?: CameraHook }).__blondelViewer3D;
    if (!h) throw new Error("point d'accès de test de la vue 3D absent");
    return h.pose();
  });
}

const distance = (p: { position: number[]; target: number[] }) =>
  Math.hypot(...p.position.map((v, i) => v - p.target[i]!));

test("vue 3D : boutons − / + et Recadrer de la vue centrale (sans recalcul)", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await openTab(page, "3D");
  await expect.poll(() => page.evaluate(() => "__blondelViewer3D" in window)).toBe(true);
  const initial = await cameraPose(page);
  const zoomIn = page.getByRole("button", { name: "Zoom avant", exact: true });
  const zoomOut = page.getByRole("button", { name: "Zoom arrière", exact: true });
  const fit = page.getByRole("button", { name: "Recadrer", exact: true });

  // « + » rapproche la caméra de sa cible, « − » l'éloigne ; la cible ne bouge pas.
  await zoomIn.click();
  await expect.poll(async () => distance(await cameraPose(page))).toBeLessThan(distance(initial));
  const closer = await cameraPose(page);
  expect(closer.target).toEqual(initial.target);
  await zoomOut.click();
  await zoomOut.click();
  await expect
    .poll(async () => distance(await cameraPose(page)))
    .toBeGreaterThan(distance(initial));
  // Aucun calcul relancé par le zoom.
  await expect(page.locator(".figure-line__pending")).toHaveCount(0);

  // Vue tournée, puis « Recadrer » : cadrage de trois quarts de l'escalier entier (celui des
  // démos, `three/framing.ts` : 35° d'azimut, 28° de plongée), le même d'où que l'on parte.
  const orbit = (az: number, el: number) =>
    page.evaluate(
      ([a, e]) =>
        (window as Window & { __blondelViewer3D?: CameraHook }).__blondelViewer3D!.orbit(a!, e!),
      [az, el],
    );
  const angles = (p: { position: number[]; target: number[] }) => {
    const [dx, dy, dz] = p.position.map((v, i) => v - p.target[i]!) as [number, number, number];
    return {
      azimuth: (Math.atan2(dx, dz) * 180) / Math.PI,
      elevation: (Math.asin(dy / Math.hypot(dx, dy, dz)) * 180) / Math.PI,
    };
  };
  await orbit(70, -15);
  await fit.click();
  await expect
    .poll(async () => {
      const a = angles(await cameraPose(page));
      return Math.abs(a.azimuth - 35) < 1 && Math.abs(a.elevation - 28) < 1;
    })
    .toBe(true);
  const framed = await cameraPose(page);
  await orbit(-40, 20);
  await zoomIn.click();
  await fit.click();
  await expect
    .poll(async () => {
      const p = await cameraPose(page);
      return Math.max(...p.position.map((v, i) => Math.abs(v - framed.position[i]!)));
    })
    .toBeLessThan(0.001);
  await expect(page.locator(".viewer3d__errors")).toHaveCount(0);
});
