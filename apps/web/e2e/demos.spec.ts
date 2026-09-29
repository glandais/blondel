/**
 * Préréglages de démonstration : le sélecteur présente deux groupes (« Basiques », « Démo ») ;
 * choisir chaque démo applique un escalier complet (une entrée d'annulation), passe sur l'onglet
 * 3D, sans erreur de génération ni contrôle bloquant, et sans tâche longue au-delà du budget.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  PRESETS,
  blockingCount,
  describeTasks,
  instrument,
  openApp,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

/** Libellés des démos du cœur (`DEMO_PRESET_LABELS`), dans l'ordre du sélecteur. */
const DEMOS = [
  "Hélicoïdal acier, verre et inox",
  "Quart tournant débillardé soudé",
  "Deux quarts en U, chêne massif",
  "Demi-tournant industriel en tôle pliée",
  "Escalier droit loft sur UPN",
  "Quart tournant à palier, frêne et verre",
  "Grand escalier d'ERP",
  "Hélicoïdal à jour central",
] as const;

// Mesures de temps : une reprise absorbe un pic de charge ponctuel de la machine.
test.describe.configure({ retries: 1 });

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test("sélecteur : deux groupes, Basiques puis Démo, description d'une ligne", async ({ page }) => {
  await openApp(page);
  const select = page.getByLabel("Préréglage");
  const groups = select.locator("optgroup");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute("label", "Basiques");
  await expect(groups.nth(1)).toHaveAttribute("label", "Démo");
  expect((await groups.nth(0).locator("option").allTextContents()).sort()).toEqual(
    [...PRESETS].sort(),
  );
  await expect(groups.nth(1).locator("option")).toHaveText([...DEMOS]);
  await expect(page.locator(".toolbar__hint")).toHaveCount(0);
  await select.selectOption({ label: DEMOS[0] });
  await expect(page.locator(".toolbar__hint")).toContainText("garde-corps verre");
});

test(`chaque démo : onglet 3D, aucun bloquant, une entrée d'annulation (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openApp(page);
  await settle(page);
  await takeLongTasks(page);
  const problems: string[] = [];
  const name = page.getByLabel("Projet", { exact: true });
  for (const label of DEMOS) {
    const before = await name.inputValue();
    await page.getByLabel("Préréglage").selectOption({ label });
    await page.getByRole("button", { name: "Appliquer", exact: true }).click();
    await settle(page);
    await expect(page.getByRole("tab", { name: "3D", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".viewer3d canvas")).toBeVisible();
    await expect(page.locator(".viewer3d__empty")).toHaveCount(0);
    await expect(name).toHaveValue(label);
    await expect(page.locator(".statusbar__errors")).toHaveCount(0);
    expect(await blockingCount(page), label).toBe(0);
    await expect(page.locator(".notice")).toContainText(label);
    await settle(page);
    const tasks = await takeLongTasks(page);
    const over = overBudget(tasks);
    if (over.length > 0) problems.push(`${label}\n${describeTasks(over, tasks)}`);
    // Une seule entrée d'annulation : « Annuler » rend le projet précédent.
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await settle(page);
    await expect(name).toHaveValue(before);
    await page.getByRole("button", { name: "Rétablir", exact: true }).click();
    await settle(page);
    await expect(name).toHaveValue(label);
    await takeLongTasks(page);
  }
  expect(problems.join("\n\n"), `tâches > ${LONG_TASK_BUDGET_MS} ms`).toBe("");
});

interface DemoViewerHook {
  pose: () => { position: [number, number, number]; target: [number, number, number] };
  orbit: (azimuthDeg: number, elevationDeg: number) => void;
  materialColor: (name: string) => string | null;
}

/** Azimut et plongée (degrés) de la caméra autour de sa cible, et hauteur de la cible (m). */
async function viewAngles(page: Page): Promise<{ azimuth: number; elevation: number; y: number }> {
  return page.evaluate(() => {
    const h = (window as Window & { __blondelViewer3D?: DemoViewerHook }).__blondelViewer3D;
    if (!h) throw new Error("point d'accès de test de la vue 3D absent");
    const { position: p, target: t } = h.pose();
    const [dx, dy, dz] = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
    const r = Math.hypot(dx, dy, dz);
    return {
      azimuth: (Math.atan2(dx, dz) * 180) / Math.PI,
      elevation: (Math.asin(dy / r) * 180) / Math.PI,
      y: t[1],
    };
  });
}

/** Luminance relative (0 à 1) de la couleur d'un matériau dessiné, `null` s'il est absent. */
async function materialLuminance(page: Page, name: string): Promise<number | null> {
  return page.evaluate((n) => {
    const h = (window as Window & { __blondelViewer3D?: DemoViewerHook }).__blondelViewer3D;
    const hex = h?.materialColor(n) ?? null;
    if (hex === null) return null;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }, name);
}

/** Cadrage de démo attendu (`three/framing.ts`, `DEMO_VIEW`) : 35° d'azimut, 28° de plongée. */
async function expectDemoFraming(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const a = await viewAngles(page);
      return Math.abs(a.azimuth - 35) < 1 && Math.abs(a.elevation - 28) < 1;
    })
    .toBe(true);
  // Visée sous le milieu de la hauteur de l'escalier (`DEMO_TARGET_HEIGHT`), pas au sol.
  const { y } = await viewAngles(page);
  expect(y).toBeGreaterThan(0.5);
  expect(y).toBeLessThan(2);
}

/** Cases « Contrôles sur les pièces » et « Cotes principales » de la vue 3D. */
async function expectOverlays(page: Page, shown: boolean): Promise<void> {
  for (const name of ["Contrôles sur les pièces", "Cotes principales"]) {
    const box = page.getByRole("checkbox", { name, exact: true });
    await (shown ? expect(box).toBeChecked() : expect(box).not.toBeChecked());
  }
}

test("démo : cotes et contrôles masqués, réactivables, rétablis par un préréglage de base", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal acier, verre et inox");
  await expectOverlays(page, false);
  // Aucune pièce teintée ni cote dessinée ; le panneau de contrôle garde les avertissements.
  await expect(page.locator(".viewer3d__overlay [data-annotation]")).toHaveCount(0);
  await expect(page.locator(".result--violation").first()).toBeAttached();
  // Réactivation par l'utilisateur, conservée en changeant d'onglet.
  await page.getByRole("checkbox", { name: "Contrôles sur les pièces", exact: true }).check();
  await page.getByRole("checkbox", { name: "Cotes principales", exact: true }).check();
  await page.getByRole("tab", { name: "Plan 2D", exact: true }).click();
  await page.getByRole("tab", { name: "3D", exact: true }).click();
  await expectOverlays(page, true);
  await expect(page.locator(".viewer3d__overlay [data-annotation]").first()).toBeAttached();
  // Nouvelle démo : de nouveau masqués ; préréglage de base : rétablis.
  await applyPreset(page, "Hélicoïdal à jour central");
  await expectOverlays(page, false);
  await applyPreset(page, "Hélicoïdal à fût central");
  await page.getByRole("tab", { name: "3D", exact: true }).click();
  await expectOverlays(page, true);
});

test("choisir une démo cadre l'escalier de trois quarts et applique les teintes", async ({
  page,
}) => {
  await openApp(page);
  // Depuis le plan : la vue 3D se monte avec la démo.
  await applyPreset(page, "Escalier droit loft sur UPN");
  await expect.poll(() => page.evaluate(() => "__blondelViewer3D" in window)).toBe(true);
  await expectDemoFraming(page);
  await expectOverlays(page, false);
  // Acier peint en noir (#1f2328, luminance ≈ 0,12) : plus sombre que le gris anthracite par
  // défaut (#3a3f45, ≈ 0,24).
  await expect.poll(() => materialLuminance(page, "steel-painted")).toBeLessThan(0.17);
  // L'utilisateur tourne la vue, puis choisit une autre démo, la vue 3D déjà ouverte : nouveau
  // cadrage, et l'acier peint passe au blanc (#f2f2ee) sans recréer les matériaux.
  await page.evaluate(() =>
    (window as Window & { __blondelViewer3D?: DemoViewerHook }).__blondelViewer3D!.orbit(70, -15),
  );
  const turned = await viewAngles(page);
  expect(Math.abs(turned.azimuth - 35)).toBeGreaterThan(20);
  await applyPreset(page, "Quart tournant débillardé soudé");
  await expectDemoFraming(page);
  await expect.poll(() => materialLuminance(page, "steel-painted")).toBeGreaterThan(0.6);
  // Chêne foncé du loft (ton × 0,52 / 0,42 / 0,36 en linéaire, ≈ 0,69 en sRVB), puis préréglage
  // de base : teintes retirées (texture telle quelle, couleur blanche), cadrage conservé.
  await applyPreset(page, "Escalier droit loft sur UPN");
  await expectDemoFraming(page);
  await expect.poll(() => materialLuminance(page, "wood-oak")).toBeLessThan(0.85);
  await page.evaluate(() =>
    (window as Window & { __blondelViewer3D?: DemoViewerHook }).__blondelViewer3D!.orbit(70, -15),
  );
  const before = await viewAngles(page);
  await applyPreset(page, "Escalier droit");
  await expectOverlays(page, true);
  await expect.poll(() => materialLuminance(page, "wood-oak")).toBeGreaterThan(0.95);
  const after = await viewAngles(page);
  expect(Math.abs(after.azimuth - before.azimuth)).toBeLessThan(0.5);
  expect(Math.abs(after.elevation - before.elevation)).toBeLessThan(0.5);
});
