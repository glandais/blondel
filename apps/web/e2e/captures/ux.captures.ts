/**
 * Captures d'écran de la refonte de l'interface (ADR-0009, parcours guidé et parcours libre),
 * citées par la documentation (`docs/ARCHITECTURE.md`, `docs/ACCEPTATION.md`, ADR-0009).
 *
 * Lancement : `pnpm ux:captures` (construit l'application, puis la sert comme les e2e). Les
 * images sont écrites dans `docs/ux/captures-refonte/` (`CAPTURES_DIR` pour un autre dossier) ;
 * leurs noms sont cités par la documentation : en renommer une, c'est aussi corriger le
 * document. Les captures de l'interface d'avant la refonte (`docs/ux/captures/`, illustrations
 * de `docs/ux/EXISTANT.md`) ne sont plus produites : ce dossier reste tel quel.
 *
 * Chaque cas part d'une page vierge (stockage du navigateur vide : première visite), ouvre la
 * démo « Quart tournant débillardé soudé » (tournant, structure acier, garde-corps), ferme
 * l'avis de démo et attend la fin des calculs avant chaque capture. La 3D est rendue par
 * SwiftShader (sans GPU) : les teintes et l'anticrénelage diffèrent un peu d'un poste réel.
 *
 * Écrans (noms fixés) : 01 et 02 guidé (Site, Découpage : maquette 1a), 03 libre (panneau
 * Découpage : 1b), 04 à 07 inspecteurs Marche, Pièce, Règle, sans sélection (2a à 2d), 08 et 09
 * Fabrication (Pièces, À valider), 10 étape 7 du guidé, 11 thème sombre, 12 largeur 1 024 px
 * (inspecteur en tiroir), 13 mobile 390 px (page entière, guidé imposé).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  inspectorPanel,
  openAppFresh,
  openMoreMenu,
  openSection,
  openTab,
  openWorkspace,
  selectTreadOnPlan,
  settle,
  useFreeJourney,
  useGuidedJourney,
} from "../support.js";

const OUT = resolve(process.env["CAPTURES_DIR"] ?? "../../docs/ux/captures-refonte");
mkdirSync(OUT, { recursive: true });

/** Démo de toutes les captures : quart tournant, limon débillardé soudé, garde-corps. */
const DEMO = "Quart tournant débillardé soudé";

const DESKTOP = { width: 1440, height: 900 };

async function shot(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  // Laisse le temps aux transitions et au premier rendu WebGL.
  await settle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: options.fullPage ?? false });
}

/** Ferme l'avis de démo (libellé et description de la démo), s'il est affiché. */
async function closeNotice(page: Page): Promise<void> {
  const close = page.locator(".notice").getByRole("button", { name: "Fermer" });
  if (await close.count()) await close.first().click();
  await expect(page.locator(".notice")).toHaveCount(0);
}

/**
 * Première visite (stockage vide), puis la démo : le menu du projet est dans la barre du libre ;
 * la démo rouvre le parcours guidé à l'étape 1 (ADR-0009). Sous 760 px de large, le guidé est
 * imposé : la démo est alors choisie en largeur de bureau, puis la fenêtre est réduite.
 */
async function openDemoFresh(page: Page): Promise<void> {
  await openAppFresh(page);
  await useFreeJourney(page);
  await applyPreset(page, DEMO);
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  await closeNotice(page);
  await settle(page);
}

/** Onglet de l'étape `n` de la barre d'étapes du guidé. */
function stepTab(page: Page, n: number): Locator {
  return page.locator(`#step-tab-${n}`);
}

async function goToStep(page: Page, n: number): Promise<void> {
  await stepTab(page, n).click();
  await expect(stepTab(page, n)).toHaveAttribute("aria-selected", "true");
  await settle(page);
}

/** Retour à l'inspecteur « sans sélection » (2d) : Échap jusqu'à la vider, panneau fermé. */
async function clearSelection(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if ((await inspectorPanel(page).getAttribute("data-template")) === "project") break;
    await page.keyboard.press("Escape");
    await settle(page);
  }
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "project");
}

/** Choisit le premier repère du groupe « Limons » de la liste des pièces (Fabrication). */
async function chooseFirstStringer(page: Page): Promise<void> {
  await openTab(page, "Pièces");
  const list = page.getByRole("navigation", { name: "Pièces par famille" });
  const group = list.getByRole("button", { name: /^Limons\b/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const mark = list.getByRole("list", { name: "Repères : Limons" }).getByRole("button").first();
  await mark.click();
  await expect(mark).toHaveAttribute("aria-pressed", "true");
  await settle(page);
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: DESKTOP });

test("01 à 11 : parcours guidé, parcours libre, inspecteurs, Fabrication, thème sombre", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openDemoFresh(page);

  // 1a : guidé, étapes Site puis Découpage.
  await goToStep(page, 1);
  await shot(page, "01-guide-site");
  await goToStep(page, 3);
  await shot(page, "02-guide-decoupage");

  // 1b : libre, panneau Découpage ouvert, inspecteur sans sélection (2d).
  await useFreeJourney(page);
  await openSection(page, "Découpage");
  await clearSelection(page);
  await shot(page, "03-libre-conception");

  // 2a : marche du plan coté (panneau fermé par Échap).
  await page.keyboard.press("Escape");
  await selectTreadOnPlan(page, 3);
  await shot(page, "04-inspecteur-marche");

  // 2b : limon choisi en Fabrication, montré par l'inspecteur Pièce en Conception, vue 3D.
  await chooseFirstStringer(page);
  await openWorkspace(page, "Conception");
  await openTab(page, "3D");
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "part");
  await shot(page, "05-inspecteur-piece");

  // 2c : règle ouverte par une carte de la 2d (sinon une règle respectée de la liste repliée).
  await openTab(page, "Plan");
  await clearSelection(page);
  const inspector = inspectorPanel(page);
  const card = inspector.locator(".rule-card button.result").first();
  if ((await card.count()) > 0) {
    await card.click();
  } else {
    const passed = inspector.locator('button[data-fold="ok"]');
    if ((await passed.getAttribute("aria-expanded")) !== "true") await passed.click();
    await inspector.locator(".results button.result").first().click();
  }
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await shot(page, "06-inspecteur-regle");

  // 2d : inspecteur sans sélection.
  await clearSelection(page);
  await shot(page, "07-inspecteur-projet");

  // Fabrication : pièce choisie (développé, réglages d'atelier, sorties), puis « À valider ».
  await chooseFirstStringer(page);
  await shot(page, "08-fabrication-pieces");
  await openTab(page, "À valider");
  await shot(page, "09-fabrication-a-valider");

  // Guidé, étape 7 « Fabrication » : liste ◆, pièces, sorties.
  await useGuidedJourney(page);
  await goToStep(page, 7);
  await shot(page, "10-guide-fabrication");

  // Thème sombre, parcours libre, panneau Découpage.
  await useFreeJourney(page);
  await openWorkspace(page, "Conception");
  await openMoreMenu(page);
  await page.getByLabel("Thème").selectOption("dark");
  await page.keyboard.press("Escape");
  await openSection(page, "Découpage");
  await openTab(page, "Plan");
  await shot(page, "11-theme-sombre");
});

test("12 : largeur 1 024 px, inspecteur en tiroir ouvert par une sélection", async ({ page }) => {
  await openDemoFresh(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await settle(page);
  await useFreeJourney(page);
  await expect(page.locator(".app")).toHaveAttribute("data-viewport", "medium");
  await selectTreadOnPlan(page, 3);
  await expect(page.locator(".app")).toHaveAttribute("data-inspector", "open");
  await shot(page, "12-largeur-1024-tiroir");
});

test("13 : mobile 390 px, parcours guidé imposé, page entière", async ({ page }) => {
  await openDemoFresh(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await expect(page.locator(".app")).toHaveAttribute("data-viewport", "narrow");
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  await goToStep(page, 3);
  await shot(page, "13-mobile-390", { fullPage: true });
});
