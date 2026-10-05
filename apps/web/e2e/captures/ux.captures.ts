/**
 * Captures d'écran de la documentation de l'existant pour le design (`docs/ux/EXISTANT.md`).
 *
 * Lancement : `pnpm ux:captures` (construit l'application, puis la sert comme les e2e). Les
 * images sont écrites dans `docs/ux/captures/` (`CAPTURES_DIR` pour un autre dossier) ; leurs
 * noms sont cités par la documentation : en renommer une, c'est aussi corriger le document.
 *
 * Chaque cas part d'une page vierge (stockage du navigateur vide : première visite) et attend la
 * fin des calculs avant la capture. La 3D est rendue par SwiftShader (sans GPU) : les teintes
 * et l'anticrénelage diffèrent un peu d'un poste réel.
 *
 * Vague 2 du parcours (ADR-0009) : adaptées a minima à la nouvelle mise en page (barre du haut,
 * rail et panneau unique, inspecteur) ; vague 3 : inspecteurs Marche et Règle (le mode expert
 * du plan est retiré) ; la refonte des captures et de `EXISTANT.md` est en vague 6.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  commitField,
  openApp,
  openMoreMenu,
  openProjectMenu,
  openSection,
  openTab,
  settle,
  structureSelect,
} from "../support.js";

const OUT = resolve(process.env["CAPTURES_DIR"] ?? "../../docs/ux/captures");
mkdirSync(OUT, { recursive: true });

/** Démo utilisée pour la plupart des vues : tournant, structure acier, garde-corps verre. */
const DEMO = "Quart tournant débillardé soudé";

const DESKTOP = { width: 1440, height: 900 };

async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  // Laisse le temps aux transitions et au premier rendu WebGL.
  await page.waitForTimeout(400);
  if (target) await target.screenshot({ path: `${OUT}/${name}.png` });
  else await page.screenshot({ path: `${OUT}/${name}.png` });
}

/** Ferme le message d'information au-dessus de la vue (« Démo … »), s'il est affiché. */
async function closeNotice(page: Page): Promise<void> {
  const close = page.locator(".notices .notice").getByRole("button", { name: "Fermer" });
  if (await close.count()) await close.click();
}

async function openDemo(page: Page, label = DEMO): Promise<void> {
  await openApp(page);
  await applyPreset(page, label);
  await closeNotice(page);
}

/** Déplie toutes les sections repliables d'un conteneur. */
async function expandAll(container: Locator): Promise<void> {
  await container.locator("details").evaluateAll((all) => {
    for (const d of all) (d as HTMLDetailsElement).open = true;
  });
}

/**
 * Capture d'un panneau à défilement propre sur toute sa hauteur : la fenêtre est agrandie jusqu'à
 * ce que le panneau n'ait plus rien à faire défiler (la mise en page suit la hauteur de fenêtre).
 */
async function shotWholePanel(page: Page, name: string, panel: Locator): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const { scroll, client } = await panel.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    if (scroll <= client) break;
    const height = page.viewportSize()?.height ?? DESKTOP.height;
    await page.setViewportSize({ width: DESKTOP.width, height: height + scroll - client + 40 });
    await settle(page);
  }
  await shot(page, name, panel);
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: DESKTOP });

test("01 accueil de la première visite", async ({ page }) => {
  await openApp(page);
  await shot(page, "01-accueil");
});

test("02 à 11 vues centrales sur une démo", async ({ page }) => {
  await openDemo(page);
  await openTab(page, "Plan");
  await shot(page, "02-plan-cote");
  await page.getByRole("button", { name: "Site et saisie" }).click();
  await settle(page);
  await shot(page, "03-plan-site-et-saisie");
  // Inspecteur Marche (2a, vague 3) : clic sur une marche du plan coté (il remplace l'ancien
  // mode expert du plan), puis retour à l'inspecteur « sans sélection » par le badge Contrôle.
  await page.getByRole("button", { name: "Plan coté" }).click();
  await settle(page);
  await page.locator('#view-panel [data-tread="3"]').first().click();
  await expect(page.locator('.inspector[data-template="tread"]')).toBeVisible();
  await settle(page);
  await shot(page, "04-inspecteur-marche");
  await page.locator(".control-badge").click();
  await expect(page.locator('.inspector[data-template="project"]')).toBeVisible();

  await openTab(page, "3D");
  await shot(page, "05-vue-3d");
  await page.getByRole("checkbox", { name: "Contrôles sur les pièces" }).check();
  await page.getByRole("checkbox", { name: "Cotes principales" }).check();
  await settle(page);
  await shot(page, "06-vue-3d-controles-et-cotes");

  await openTab(page, "Élévation");
  await shot(page, "07-elevation");

  await openTab(page, "Développés");
  await shot(page, "08-developpes-liste");
  await page.locator(".view").getByRole("button").filter({ hasText: "LD2" }).first().click();
  await settle(page);
  await shot(page, "09-developpes-piece");

  await openTab(page, "Nomenclature");
  await shot(page, "10-nomenclature");

  await openTab(page, "Comparateur");
  await shot(page, "11-comparateur");
});

test("12 panneau des paramètres, entièrement déplié", async ({ page }) => {
  await openDemo(page);
  const left = await openSection(page, "Structure");
  await expandAll(left);
  await settle(page);
  await shotWholePanel(page, "12-parametres-complet", left);
});

test("13 contrôle de conception et prédimensionnement, inspecteur Règle et surcharge", async ({
  page,
}) => {
  await openDemo(page);
  const right = page.getByRole("complementary", { name: "Inspecteur" });
  // Toutes les sections, sauf les longues listes « Respectées » et « Non évaluées » (fermées
  // par défaut) : une centaine de lignes, plusieurs mètres d'écran.
  await expandAll(right);
  await right.locator("details.sev--ok, details.sev--na").evaluateAll((all) => {
    for (const d of all) (d as HTMLDetailsElement).open = false;
  });
  await settle(page);
  await shotWholePanel(page, "13-controle-complet", right);
  // Inspecteur Règle (2c) ouvert par une carte, formulaire de surcharge ouvert.
  await right.locator('.rule-card[data-severity="avertissement"] button.result').first().click();
  await expect(page.locator('.inspector[data-template="rule"]')).toBeVisible();
  await expect(right.locator("form.override-editor")).toBeVisible();
  await settle(page);
  await shotWholePanel(page, "13-inspecteur-regle-surcharge", right);
});

test("14 et 15 assistant d'initialisation", async ({ page }) => {
  await openApp(page);
  await openProjectMenu(page);
  await page.getByRole("button", { name: "Assistant…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await shot(page, "14-assistant-saisie");
  await dialog.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Choisir" }).first()).toBeVisible();
  await settle(page);
  await shot(page, "15-assistant-propositions");
});

test("16 profil d'atelier", async ({ page }) => {
  await openApp(page);
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Atelier…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "16-profil-atelier");
});

test("17 et 18 menus Importer et Exporter", async ({ page }) => {
  await openDemo(page);
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await shot(page, "17-menu-importer");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Exporter/ }).click();
  await shot(page, "18-menu-exporter");
});

test("19 contrôle bloquant", async ({ page }) => {
  await openApp(page);
  await openSection(page, "Découpage");
  await commitField(page, page.getByLabel("Hauteur de marche cible"), "215");
  await shot(page, "19-controle-bloquant");
});

test("20 erreur de génération", async ({ page }) => {
  await openApp(page);
  await openSection(page, "Structure");
  await structureSelect(page).selectOption("helical-core");
  await settle(page);
  await shot(page, "20-erreur-generation");
});

test("21 thème sombre", async ({ page }) => {
  await openDemo(page);
  await openMoreMenu(page);
  await page.getByLabel("Thème").selectOption("dark");
  await settle(page);
  await shot(page, "21-theme-sombre");
});

test("22 et 23 écrans étroits", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await openDemo(page);
  await shot(page, "22-largeur-900");
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/23-mobile-390-page-entiere.png`, fullPage: true });
});
