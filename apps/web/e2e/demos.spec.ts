/**
 * Préréglages de démonstration : le sélecteur présente deux groupes (« Basiques », « Démo ») ;
 * choisir chaque démo applique un escalier complet (une entrée d'annulation), passe sur l'onglet
 * 3D, sans erreur de génération ni contrôle bloquant (sauf le prédimensionnement indicatif de la
 * démo du limon central bois lamellé-collé, QUESTIONS A36 (8)), et sans tâche longue au-delà du
 * budget.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  boxesOverlap,
  PRESETS,
  setWidth,
  useGuidedJourney,
  closeProjectMenu,
  describeTasks,
  instrument,
  openApp,
  openProjectMenu,
  overBudget,
  settle,
  takeLongTasks,
  useFreeJourney,
  viewTab,
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
  "Quart tournant sur limon central débillardé",
  "Quart tournant sur limon central bois lamellé-collé",
] as const;

/** Démo dont le prédimensionnement indicatif est en violation bloquante (QUESTIONS A36 (8)). */
const GLULAM_CENTRAL_DEMO = "Quart tournant sur limon central bois lamellé-collé";

// Mesures de temps : une reprise absorbe un pic de charge ponctuel de la machine.
test.describe.configure({ retries: 1 });

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test("sélecteur : deux groupes, Basiques puis Démo, description d'une ligne", async ({ page }) => {
  await openApp(page);
  const menu = await openProjectMenu(page);
  const select = menu.getByLabel("Préréglage");
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

test(`chaque démo : onglet 3D, aucun bloquant hors prédimensionnement de la démo lamellé-collé (A36 (8)), une entrée d'annulation (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openApp(page);
  await settle(page);
  await takeLongTasks(page);
  const problems: string[] = [];
  // Nom du projet : bouton du menu du projet (barre du haut).
  const name = page.locator(".topbar__project-name");
  const demoTag = page.locator(".topbar__demo");
  await expect(demoTag).toHaveCount(0);
  for (const label of DEMOS) {
    const before = (await name.textContent()) ?? "";
    const menu = await openProjectMenu(page);
    await expect(menu.getByLabel("Projet", { exact: true })).toHaveValue(before);
    await menu.getByLabel("Préréglage").selectOption({ label });
    await menu.getByRole("button", { name: "Appliquer", exact: true }).click();
    await settle(page);
    await expect(menu.getByLabel("Projet", { exact: true })).toHaveValue(label);
    await closeProjectMenu(page);
    await expect(viewTab(page, "3D")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".viewer3d canvas")).toBeVisible();
    await expect(page.locator(".viewer3d__empty")).toHaveCount(0);
    await expect(name).toHaveText(label);
    // Étiquette « Démo » de la barre du haut.
    await expect(demoTag).toHaveText("Démo");
    // Une démo ouvre le parcours guidé à l'étape 1 (ADR-0009), la vue 3D gardée.
    await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
    await expect(page.locator("#step-tab-1")).toHaveAttribute("aria-selected", "true");
    // Aucune erreur de génération, aucun bloquant (pied du guidé : bouton absent à zéro).
    await expect(page.locator(".errors-bar__errors")).toHaveCount(0);
    const footer = page.locator(".guided-footer");
    // Comptes calculés (bouton d'une sévérité non nulle, ou « Aucun constat ») ; jamais de
    // compte nul affiché.
    await expect(footer.locator(".guided-footer__count").first()).toBeVisible();
    await expect(footer.getByRole("button", { name: /^0 / })).toHaveCount(0);
    // Exception : la démo du limon central bois lamellé-collé garde les deux bloquants de son
    // prédimensionnement indicatif (couches empilées réduites par la formule de Hankinson,
    // QUESTIONS A35 (j), A36 (8)).
    if (label !== GLULAM_CENTRAL_DEMO) {
      await expect(footer.locator('[data-severity="bloquant"]'), label).toHaveCount(0);
    }
    await expect(page.locator(".notice")).toContainText(label);
    // La page tient dans la fenêtre, sans défilement horizontal ni vertical du document : seuls
    // les panneaux défilent (régression : `.visually-hidden` du panneau de droite agrandissait
    // le document).
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { x: de.scrollWidth - de.clientWidth, y: de.scrollHeight - de.clientHeight };
    });
    expect(overflow, `${label} : débordement du document`).toEqual({ x: 0, y: 0 });
    await settle(page);
    const tasks = await takeLongTasks(page);
    const over = overBudget(tasks);
    if (over.length > 0) problems.push(`${label}\n${describeTasks(over, tasks)}`);
    // Une seule entrée d'annulation : « Annuler » rend le projet précédent.
    await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
    await settle(page);
    await expect(name).toHaveText(before);
    await page.getByRole("button", { name: "Rétablir (Ctrl+Maj+Z)", exact: true }).click();
    await settle(page);
    await expect(name).toHaveText(label);
    await takeLongTasks(page);
  }
  expect(problems.join("\n\n"), `tâches > ${LONG_TASK_BUDGET_MS} ms`).toBe("");
});

test("avis de démo : libellé et description, ne recouvre ni la vue, ni ses commandes, ni le pied, ni le formulaire, ni l'inspecteur", async ({
  page,
}) => {
  const label = DEMOS[1];
  await openApp(page);
  /** Zones que l'avis ne doit jamais recouvrir, selon le parcours. */
  const zones = [
    "#view-panel",
    ".view-bar",
    ".figure-line",
    ".guided-footer",
    ".guided-form",
    "aside.inspector",
    ".step-bar",
    ".topbar",
  ];
  const check = async (where: string): Promise<void> => {
    const notice = page.locator(".notice", { hasText: label });
    await expect(notice).toBeVisible();
    // Texte lisible en entier, sans troncature (pas d'ellipse, pas d'info-bulle seule).
    const clipped = await notice
      .locator(".notice__text")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `${where} : texte de l'avis tronqué`).toBe(false);
    const box = (await notice.boundingBox())!;
    for (const sel of zones) {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0 || !(await el.isVisible())) continue;
      const other = (await el.boundingBox())!;
      expect(boxesOverlap(box, other), `${where} : avis sur ${sel}`).toBe(false);
    }
  };
  await applyPreset(page, label);
  const notice = page.locator(".notice", { hasText: label });
  // Libellé et description de la démo, affichés en entier.
  await expect(notice).toContainText(`Démo « ${label} »`);
  const text = (await notice.locator(".notice__text").textContent()) ?? "";
  expect(text.length).toBeGreaterThan(`Démo « ${label} » : `.length);
  for (const [width, height] of [
    [1440, 900],
    [1100, 800],
    [760, 900],
    [390, 844],
  ] as const) {
    await setWidth(page, width, height);
    await check(`guidé ${width} px`);
    if (width >= 760) {
      await useFreeJourney(page);
      await check(`libre ${width} px`);
      await useGuidedJourney(page);
    }
  }
  // L'avis reste jusqu'à « Fermer ».
  await setWidth(page, 1440, 900);
  await notice.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.locator(".notice", { hasText: label })).toHaveCount(0);
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
  // Aucune pièce teintée ni cote dessinée ; le panneau de contrôle garde les avertissements
  // (inspecteur du parcours libre : la démo a ouvert le guidé).
  await expect(page.locator(".viewer3d__overlay [data-annotation]")).toHaveCount(0);
  await useFreeJourney(page);
  await expect(page.locator(".result--violation").first()).toBeAttached();
  // Réactivation par l'utilisateur, conservée en changeant d'onglet.
  await page.getByRole("checkbox", { name: "Contrôles sur les pièces", exact: true }).check();
  await page.getByRole("checkbox", { name: "Cotes principales", exact: true }).check();
  await viewTab(page, "Plan").click();
  await viewTab(page, "3D").click();
  await expectOverlays(page, true);
  await expect(page.locator(".viewer3d__overlay [data-annotation]").first()).toBeAttached();
  // Nouvelle démo : de nouveau masqués ; préréglage de base : rétablis.
  await applyPreset(page, "Hélicoïdal à jour central");
  await expectOverlays(page, false);
  await applyPreset(page, "Hélicoïdal à fût central");
  await viewTab(page, "3D").click();
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
