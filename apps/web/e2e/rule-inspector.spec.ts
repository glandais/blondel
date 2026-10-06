/**
 * Inspecteur « Règle » (maquette 2c, ADR-0009, vague 3) : une carte du contrôle ouvre la 2c
 * (titre court, référence) ; « Pour corriger » applique une correction du cœur, annulable
 * (Ctrl+Z : la règle est de nouveau en défaut) ; « Où » ouvre l'inspecteur de l'élément ; la
 * surcharge exige une justification ; le badge Contrôle ramène l'inspecteur « sans sélection ».
 *
 * Scénario GC_CONFLIT_DALLE (packages/core/src/project/fixes.test.ts) : quart tournant dont le
 * garde-corps rampant, décalé de 120 mm vers le vide, passe sous la dalle haute ; le cœur propose
 * « Élargir la trémie » (correction `opening-clearance`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  applyPreset,
  instrument,
  openApp,
  openSection,
  settle,
  useFreeJourney,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const QUARTER_LEFT = fileURLToPath(
  new URL("../../../examples/quarter-left.blondel.json", import.meta.url),
);

/** Importe le quart tournant de l'exemple, garde-corps de volée décalé de 120 mm vers le vide. */
async function importSlabConflict(page: Page): Promise<void> {
  const project = JSON.parse(readFileSync(QUARTER_LEFT, "utf8")) as Record<string, unknown>;
  const conflict = {
    ...project,
    name: "Garde-corps sous la dalle",
    guards: { flight: { enabled: true, edgeOffset: 120 } },
  };
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
  await (
    await chooser
  ).setFiles({
    name: "conflit-dalle.blondel.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(conflict)),
  });
  await settle(page);
}

const inspectorOf = (page: Page) => page.getByRole("complementary", { name: "Inspecteur" });

/** Ouvre l'inspecteur Règle de la règle `ruleId` par sa carte (inspecteur « sans sélection »). */
async function openRuleCard(page: Page, ruleId: string): Promise<void> {
  const inspector = inspectorOf(page);
  const card = inspector.locator(`.rule-card[data-rule="${ruleId}"]`).first();
  await expect(card).toBeVisible();
  // Carte de la 2d : titre court et localisation, sans identifiant.
  await expect(card.locator("code")).toHaveCount(0);
  await expect(card.locator(".rule-card__loc")).not.toBeEmpty();
  await card.locator("button.result").click();
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(inspector.locator(".rule-insp__ref")).toHaveText(ruleId);
}

test("carte → inspecteur Règle → correction appliquée, puis annulée", async ({ page }) => {
  await openApp(page);
  await importSlabConflict(page);
  const inspector = inspectorOf(page);
  await openRuleCard(page, "GC_CONFLIT_DALLE");
  await expect(inspector.locator(".insp-title")).toHaveText("Garde-corps et plancher haut");
  await expect(inspector.locator(".rule-insp__status")).toContainText("Avertissement");
  await expect(inspector).toContainText(
    "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
  );

  // « Pour corriger » : correction du cœur (annulable) et section du panneau libre.
  const fixes = inspector.locator(".rule-insp__fixes");
  await expect(fixes).toContainText("Pour corriger");
  await expect(fixes.getByRole("button", { name: "Ouvrir Garde-corps" })).toBeVisible();
  const fix = fixes.locator('[data-fix="opening-clearance"]');
  await expect(fix).toContainText("Élargir la trémie de");
  await expect(fix).toContainText("annulable");
  await fix.click();
  await settle(page);
  // Règle levée par la correction : elle n'a plus de résultat.
  await expect(inspector.locator(".rule-insp--missing")).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Retour au projet" })).toBeVisible();

  // Annuler (Ctrl+Z) : la règle est de nouveau en défaut, l'inspecteur la montre.
  await page.locator("body").press("Control+z");
  await settle(page);
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(inspector.locator(".rule-insp__ref")).toHaveText("GC_CONFLIT_DALLE");
  await expect(inspector.locator(".rule-insp__status")).toContainText("Avertissement");

  // « Ouvrir Garde-corps » : panneau libre de la section.
  await fixes.getByRole("button", { name: "Ouvrir Garde-corps" }).click();
  await expect(page.locator("#free-panel")).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: "Garde-corps" }),
  ).toHaveAttribute("aria-selected", "true");

  // Badge Contrôle : retour à l'inspecteur « sans sélection ».
  await page.locator(".control-badge").click();
  await expect(inspector).toHaveAttribute("data-template", "project");
  await expect(inspector.locator(".inspector-control__title")).toBeFocused();
});

test("« Où » : l'étiquette de la pièce ouvre son inspecteur", async ({ page }) => {
  await openApp(page);
  await importSlabConflict(page);
  const inspector = inspectorOf(page);
  await openRuleCard(page, "GC_CONFLIT_DALLE");
  const tags = inspector.locator(".rule-insp__where button.rule-insp__tag");
  await expect(tags.first()).toBeVisible();
  await tags.first().click();
  await expect(inspector).toHaveAttribute("data-template", "part");
});

test("surcharge : justification obligatoire, puis levée (annulable)", async ({ page }) => {
  await openApp(page);
  await importSlabConflict(page);
  const inspector = inspectorOf(page);
  // Une carte par main courante en conflit (MC1, MC2) : la surcharge vaut pour toutes.
  const cards = inspector.locator('.rule-card[data-rule="GC_CONFLIT_DALLE"]');
  await expect(cards.first()).toBeVisible();
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);
  await openRuleCard(page, "GC_CONFLIT_DALLE");
  // Formulaire ouvert d'emblée (maquette 2c).
  const form = inspector.getByRole("form", { name: "Surcharge de GC_CONFLIT_DALLE" });
  await expect(form).toContainText("Surcharger la règle");
  const severities = form.getByRole("radiogroup", { name: "Nouvelle sévérité" });
  await expect(severities.getByRole("radio")).toHaveText([
    "Bloquant",
    "Avert.",
    "Conseil",
    "Ignorer",
  ]);
  // Échap sur une saisie en cours la rétablit sans quitter l'inspecteur Règle.
  await severities.getByRole("radio", { name: "Ignorer" }).click();
  await expect(severities.getByRole("radio", { name: "Ignorer" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(severities.getByRole("radio", { name: "Conseil" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await severities.getByRole("radio", { name: "Ignorer" }).click();
  const save = form.getByRole("button", { name: "Surcharger", exact: true });
  await expect(save).toBeDisabled();
  const justification = form.getByLabel("Justification (obligatoire, reprise dans le dossier PDF)");
  await justification.fill("   ");
  await expect(save).toBeDisabled();
  await justification.fill("Main courante arrêtée avant la dalle sur chantier");
  await expect(save).toBeEnabled();
  await save.click();
  await settle(page);
  await expect(form).toContainText(
    "Surcharge : Ignorée — Main courante arrêtée avant la dalle sur chantier",
  );
  // Règle ignorée : plus de carte dans l'inspecteur « sans sélection ».
  await page.locator(".control-badge").click();
  await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(cards).toHaveCount(cardCount);

  // Surcharge reposée puis levée depuis la 2c.
  await openRuleCard(page, "GC_CONFLIT_DALLE");
  await form.getByRole("radio", { name: "Avert.", exact: true }).click();
  await form.getByRole("radio", { name: "Conseil", exact: true }).click();
  await justification.fill("Avis du bureau de contrôle");
  await save.click();
  await settle(page);
  await expect(inspector.locator(".rule-insp__status")).toContainText("Conseil");
  await form.getByRole("button", { name: "Lever la surcharge" }).click();
  await settle(page);
  await expect(inspector.locator(".rule-insp__status")).toContainText("Avertissement");
  await expect(form.getByRole("button", { name: "Lever la surcharge" })).toHaveCount(0);
  await openSection(page, "Contexte");
  await expect(page.locator("#free-panel")).toContainText("0 surcharge(s) de règle justifiée(s).");
});

test("démo débillardé : appui localisé « LE1 · M6 », « Où » cliquable, règle sur la marche", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant débillardé soudé");
  // Une démo ouvre le parcours guidé : l'inspecteur est celui du libre.
  await useFreeJourney(page);
  const inspector = inspectorOf(page);
  const card = inspector.locator('.rule-card[data-rule="FAB_SUPPORT_LONGUEUR_MIN"]').first();
  await expect(card.locator(".rule-card__loc")).toHaveText("LE1 · M6");
  // Échappée rattachée au nez le plus proche, plus « Point ».
  await expect(
    inspector.locator('.rule-card[data-rule="ECHAPPEE_RECO_PRIVATIF"] .rule-card__loc'),
  ).toHaveText(/^Nez \d+$/);
  await openRuleCard(page, "FAB_SUPPORT_LONGUEUR_MIN");
  const tags = inspector.locator(".rule-insp__where button.rule-insp__tag");
  await expect(tags.first()).toContainText("LE1");
  await inspector.locator(".rule-insp__where").getByRole("button", { name: "Marche 6" }).click();
  await expect(inspector).toHaveAttribute("data-template", "tread");
  await expect(inspector.locator('[data-tread-number="6"]')).toBeVisible();
  await expect(inspector.locator('.rule-card[data-rule="FAB_SUPPORT_LONGUEUR_MIN"]')).toHaveCount(
    1,
  );
});
