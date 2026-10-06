/**
 * Parcours guidé (maquette 1a, ADR-0009, vague 5) : ouverture en guidé à la première visite ;
 * barre d'étapes (onglets ARIA, résumés, coche ✓) ; navigation précédente / suivante avec la vue
 * conseillée appliquée au changement d'étape ; jauge 2h + g de l'étape Découpage ; cartes de
 * forme ; bascule libre ↔ guidé sans perte (historique, vue, sélection ; panneau de l'étape) ;
 * encart « Vous connaissez le métier ? » dont la fermeture est mémorisée ; liste du contrôle
 * ouverte depuis le pied ; étape 7 (valeurs ◆, pièce → développé) ; import → libre ; assistant
 * → guidé à l'étape 1.
 */
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  commitField,
  inspectorPanel,
  journeyRadio,
  openAppFresh,
  openProjectMenu,
  openSection,
  settle,
  treadClickPoint,
  useFreeJourney,
  useGuidedJourney,
  viewHighlight,
  viewTab,
} from "./support.js";

const DISCLAIMER = "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.";

/** Titres des 7 étapes, dans l'ordre. */
const STEPS = [
  "Site",
  "Forme",
  "Découpage",
  "Marches",
  "Structure",
  "Garde-corps",
  "Fabrication",
] as const;

/** Vue conseillée de chaque étape (onglet de la vue sélectionné au changement d'étape). */
const RECOMMENDED_TAB = ["Plan", "Plan", "Élévation", "3D", "3D", "3D", "Pièces"] as const;

const EXAMPLE = fileURLToPath(
  new URL("../../../examples/j4-acceptance-01-garde-corps.blondel.json", import.meta.url),
);

function stepBar(page: Page): Locator {
  return page.getByRole("tablist", { name: "Étapes du parcours" });
}

function stepTab(page: Page, n: number): Locator {
  return page.locator(`#step-tab-${n}`);
}

function stepSummary(page: Page, n: number): Locator {
  return stepTab(page, n).locator(".step-bar__summary");
}

function undoButton(page: Page): Locator {
  return page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
}

/** Va à l'étape `n` par son onglet de la barre d'étapes. */
async function goToStep(page: Page, n: number): Promise<void> {
  await stepTab(page, n).click();
  await expect(stepTab(page, n)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".step-form h2").first()).toHaveText(STEPS[n - 1]!);
  await settle(page);
}

test("première visite : parcours guidé, 7 étapes, mention indicative dans le pied", async ({
  page,
}) => {
  await openAppFresh(page);
  await expect(journeyRadio(page, "Guidé")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  const tabs = stepBar(page).getByRole("tab");
  await expect(tabs).toHaveCount(7);
  await expect(stepTab(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: /^Site/ })).toBeVisible();
  const footer = page.getByRole("contentinfo", { name: "Contrôle et étapes" });
  await expect(footer).toContainText(DISCLAIMER);
  // Barre du haut guidée : ni espace de travail, ni Exporter.
  await expect(page.getByRole("radiogroup", { name: "Espace de travail" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Exporter/ })).toHaveCount(0);
  // L'accueil de la première visite est intégré au guidé.
  await expect(page.getByRole("region", { name: "Accueil" })).toBeVisible();
  // Étape vue sans bloquant rattaché : cochée ✓ (texte accessible « étape faite »).
  await expect(stepTab(page, 1)).toHaveAttribute("data-done", "true");
  await expect(stepTab(page, 1)).toContainText("étape faite");
  await expect(stepTab(page, 4)).not.toHaveAttribute("data-done", "true");
});

test("les 7 étapes : suivante puis précédente, vue conseillée appliquée", async ({ page }) => {
  await openAppFresh(page);
  for (let n = 1; n <= 7; n++) {
    if (n > 1) {
      await page.getByRole("button", { name: `Étape suivante : ${STEPS[n - 1]}` }).click();
      await settle(page);
    }
    await expect(page.locator(".step-form h2").first()).toHaveText(STEPS[n - 1]!);
    await expect(page.locator(".step-form .eyebrow").first()).toHaveText(`Étape ${n} sur 7`);
    await expect(stepTab(page, n)).toHaveAttribute("aria-selected", "true");
    if (n > 1) {
      // Vue conseillée proposée au changement d'étape (l'étape 1 garde la vue d'ouverture).
      await expect(viewTab(page, RECOMMENDED_TAB[n - 1]!)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText("Vue conseillée pour cette étape")).toBeVisible();
    }
  }
  await expect(page.getByRole("button", { name: /^Étape suivante/ })).toHaveCount(0);
  // Étape 7 : onglets de Fabrication.
  for (const name of ["Pièces", "Nomenclature", "Comparer", "3D"] as const) {
    await expect(viewTab(page, name)).toBeVisible();
  }
  // L'utilisateur change de vue : la mention disparaît, la vue choisie reste.
  await viewTab(page, "Nomenclature").click();
  await expect(page.getByText("Vue conseillée pour cette étape")).toHaveCount(0);
  for (let n = 6; n >= 1; n--) {
    await page.getByRole("button", { name: `Étape précédente : ${STEPS[n - 1]}` }).click();
    await settle(page);
    await expect(page.locator(".step-form h2").first()).toHaveText(STEPS[n - 1]!);
    await expect(stepTab(page, n)).toHaveAttribute("aria-selected", "true");
    await expect(viewTab(page, RECOMMENDED_TAB[n - 1]!)).toHaveAttribute("aria-selected", "true");
  }
  await expect(page.getByRole("button", { name: /^Étape précédente/ })).toHaveCount(0);
  // Étapes visitées sans bloquant : cochées.
  await expect(stepBar(page).locator('[role="tab"][data-done="true"]')).not.toHaveCount(0);
  // Clavier (onglets ARIA, activation manuelle) : flèche puis Entrée.
  await stepTab(page, 1).focus();
  await page.keyboard.press("ArrowRight");
  await expect(stepTab(page, 2)).toBeFocused();
  await expect(stepTab(page, 1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(stepTab(page, 2)).toHaveAttribute("aria-selected", "true");
});

test("Découpage : n imposé, la jauge 2h + g et le résumé suivent ; annulable", async ({ page }) => {
  await openAppFresh(page);
  await goToStep(page, 3);
  const meter = page.getByRole("meter", { name: "Module 2h + g" });
  await expect(meter).toBeVisible();
  const before = await meter.getAttribute("aria-valuenow");
  const summaryBefore = (await stepSummary(page, 3).textContent()) ?? "";
  const label = "Nombre de hauteurs n";
  const group = page.locator(".step-form").getByRole("group", { name: label });
  await group.getByRole("button", { name: "Imposer", exact: true }).click();
  await settle(page);
  const input = page.locator(".step-form").getByRole("textbox", { name: label, exact: true });
  const n = Number(await input.inputValue());
  await commitField(page, input, String(n + 2));
  await expect(meter).not.toHaveAttribute("aria-valuenow", before ?? "");
  await expect(stepSummary(page, 3)).not.toHaveText(summaryBefore);
  await expect(stepSummary(page, 3)).toContainText(`${n + 2} hauteurs`);
  // Ctrl+Z (hors champ) : la saisie, puis l'imposition.
  await page.locator("#view-panel").focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(meter).toHaveAttribute("aria-valuenow", before ?? "");
  await expect(stepSummary(page, 3)).toHaveText(summaryBefore);
});

test("Forme : carte « ¼ droite » appliquée, résumé de l'étape, annulable", async ({ page }) => {
  await openAppFresh(page);
  await goToStep(page, 2);
  const shapes = page.getByRole("group", { name: "Forme" });
  const quarter = shapes.getByRole("button", { name: "¼ droite", exact: true });
  await expect(quarter).toHaveAttribute("aria-pressed", "false");
  const before = (await stepSummary(page, 2).textContent()) ?? "";
  await quarter.click();
  await settle(page);
  await expect(quarter).toHaveAttribute("aria-pressed", "true");
  await expect(stepSummary(page, 2)).not.toHaveText(before);
  await expect(stepSummary(page, 2)).toContainText("Quart tournant à droite");
  await undoButton(page).click();
  await settle(page);
  await expect(quarter).toHaveAttribute("aria-pressed", "false");
  await expect(stepSummary(page, 2)).toHaveText(before);
});

test("bascule libre puis guidé : panneau de l'étape, historique, vue et sélection gardés", async ({
  page,
}) => {
  await openAppFresh(page);
  await goToStep(page, 2);
  await page
    .getByRole("group", { name: "Forme" })
    .getByRole("button", { name: "¼ gauche" })
    .click();
  await settle(page);
  await expect(undoButton(page)).toBeEnabled();
  // Sélection d'une marche sur le plan coté (vue conseillée de l'étape Forme).
  await expect(viewTab(page, "Plan")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-panel .svg-export svg")).toBeVisible();
  const { x, y } = await treadClickPoint(page, 2);
  await page.mouse.click(x, y);
  await expect.poll(() => viewHighlight(page)).not.toBe("");

  await useFreeJourney(page);
  // Panneau de l'étape (Forme → Tracé), avec la note.
  await expect(
    page.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: "Tracé" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#free-panel")).toContainText(
    "Ouvert sur la section où vous étiez dans le parcours guidé",
  );
  await expect(undoButton(page)).toBeEnabled();
  await expect(viewTab(page, "Plan")).toHaveAttribute("aria-selected", "true");
  // Sélection gardée : l'inspecteur montre la marche.
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "tread");
  await expect(inspectorPanel(page).locator('[data-tread-number="2"]')).toBeVisible();

  // Retour au guidé : même étape, historique intact.
  await useGuidedJourney(page);
  await expect(stepTab(page, 2)).toHaveAttribute("aria-selected", "true");
  await expect(undoButton(page)).toBeEnabled();
  await expect(viewTab(page, "Plan")).toHaveAttribute("aria-selected", "true");
  await undoButton(page).click();
  await settle(page);
  await expect(
    page.getByRole("group", { name: "Forme" }).getByRole("button", { name: "Droit", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("bascule Guidé ↔ Libre au clavier : le focus reste sur le segmenté Parcours", async ({
  page,
}) => {
  await openAppFresh(page);
  await journeyRadio(page, "Guidé").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.app[data-journey="free"]')).toBeVisible();
  await expect(journeyRadio(page, "Libre")).toHaveAttribute("aria-checked", "true");
  await expect(journeyRadio(page, "Libre")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  await expect(journeyRadio(page, "Guidé")).toHaveAttribute("aria-checked", "true");
  await expect(journeyRadio(page, "Guidé")).toBeFocused();
});

test("lien « Réglage avancé… » : visible sans défiler, ouvre les réglages repliés", async ({
  page,
}) => {
  await openAppFresh(page);
  await goToStep(page, 3);
  const link = page.locator(".step-form").getByRole("button", { name: /^Réglage avancé/ });
  await expect(link).toBeInViewport();
  await expect(link).toHaveAttribute("aria-expanded", "false");
  // Résumés « Plus de réglages » masqués : le lien est le seul accès.
  await expect(
    page.locator(".step-form summary").filter({ hasText: "Plus de réglages" }).first(),
  ).toBeHidden();
  const field = page.locator(".step-form").getByText("Correction de la 1re hauteur").first();
  await expect(field).toBeHidden();
  await link.click();
  await expect(link).toHaveAttribute("aria-expanded", "true");
  await expect(field).toBeVisible();
  await link.click();
  await expect(link).toHaveAttribute("aria-expanded", "false");
  await expect(field).toBeHidden();
  // Étape 7 : un seul repli, sans « Plus de réglages » imbriqué.
  await goToStep(page, 7);
  await expect(link).toBeInViewport();
  await expect(page.locator(".step-form details.tiered__fold--more")).toHaveCount(1);
});

test("encart « Vous connaissez le métier ? » : fermeture mémorisée, passage en libre", async ({
  page,
}) => {
  await openAppFresh(page);
  const hint = page.getByRole("complementary", { name: "Vous connaissez le métier ?" });
  await expect(hint).toBeVisible();
  await hint.getByRole("button", { name: "Fermer l'encart" }).click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  await settle(page);
  await expect(hint).toHaveCount(0);

  // Nouveau contexte de navigation : l'encart propose le parcours libre.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(hint).toBeVisible();
  await hint.getByRole("button", { name: "Passer en parcours libre" }).click();
  await expect(page.locator('.app[data-journey="free"]')).toBeVisible();
  await expect(journeyRadio(page, "Libre")).toHaveAttribute("aria-checked", "true");
});

test("pied : liste du contrôle par-dessus la vue, carte → Règle, Échap, Échap", async ({
  page,
}) => {
  await openAppFresh(page);
  await applyPreset(page, "Quart tournant débillardé soudé");
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  const footer = page.getByRole("contentinfo", { name: "Contrôle et étapes" });
  const warnings = footer.getByRole("button", { name: /^\d+ avertissements?$/ });
  await expect(warnings).toBeVisible();
  await warnings.click();
  const control = page.getByRole("dialog", { name: "Contrôle de conception" });
  await expect(control).toBeVisible();
  // Le Contexte de contrôle (sans étape) est modifiable en tête de la liste.
  const context = control.locator("details.control-overlay__context");
  await expect(context.locator("summary")).toHaveText("Contexte de contrôle");
  await context.locator("summary").click();
  await expect(context).toHaveAttribute("open", "");
  // Lien « Profil » (Strict ▾) du bloc de contrôle : le repli Contexte, même replié puis
  // défilé hors de vue, est déplié, ramené en tête de la liste et focalisé.
  await context.locator("summary").click();
  await expect(context).not.toHaveAttribute("open", "");
  const profile = control.locator(".inspector-control__profile");
  await profile.scrollIntoViewIfNeeded();
  await profile.click();
  await expect(context).toHaveAttribute("open", "");
  await expect(context.locator("summary")).toBeFocused();
  await expect(context.locator("summary")).toBeInViewport();
  // Carte → inspecteur Règle.
  const card = control.locator(".rule-card").first();
  await expect(card).toBeVisible();
  await card.locator("button.result").click();
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "rule");
  // Échap : retour à la liste (sélection effacée), puis fermeture ; focus rendu au bouton.
  await page.keyboard.press("Escape");
  await expect(inspectorPanel(page)).not.toHaveAttribute("data-template", "rule");
  await expect(control).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(control).toHaveCount(0);
  await expect(warnings).toBeFocused();
});

test("étape 7 : valeur ◆ cochée, pièce choisie → développé dans la vue", async ({ page }) => {
  await openAppFresh(page);
  await applyPreset(page, "Quart tournant débillardé soudé");
  await goToStep(page, 7);
  const summary = stepSummary(page, 7);
  await expect(summary).toHaveAttribute("data-to-validate", "true");
  const count = async (): Promise<number> =>
    Number(/◆ (\d+) à valider/.exec((await summary.textContent()) ?? "")?.[1] ?? NaN);
  const before = await count();
  expect(before).toBeGreaterThan(0);
  const box = page
    .locator(".step-form")
    .getByRole("checkbox", { name: /^Valider : / })
    .first();
  await box.check();
  await settle(page);
  await expect.poll(count).toBe(before - 1);
  // Accessible : le glyphe est décoratif, le compte est dit en toutes lettres.
  await expect(stepTab(page, 7)).toContainText(`${before - 1} valeurs à valider`);

  // Pièces par famille : un repère → son développé dans la vue (onglet Pièces).
  await expect(viewTab(page, "Pièces")).toHaveAttribute("aria-selected", "true");
  const parts = page.locator(".step-form").getByRole("navigation", { name: "Pièces par famille" });
  const head = parts.locator(".fab-group__head").first();
  await head.click();
  const mark = parts.locator(".fab-mark").first();
  await mark.click();
  await expect(mark).toHaveAttribute("aria-pressed", "true");
  const markText = ((await mark.locator("strong").textContent()) ?? "").trim();
  await expect(
    page.locator("#view-panel").getByRole("region", { name: "Pièce choisie" }),
  ).toBeVisible();
  await expect(page.locator("#view-panel .fab-sheet__mark")).toHaveText(markText);
});

test("mise en page 1440 × 900 : formulaire de 400 px, aucun débordement horizontal", async ({
  page,
}) => {
  await openAppFresh(page);
  await applyPreset(page, "Quart tournant débillardé soudé");
  for (let n = 1; n <= 7; n++) {
    await goToStep(page, n);
    const box = await page.locator(".guided-form").boundingBox();
    expect(Math.round(box?.width ?? 0), `étape ${n}`).toBe(400);
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      const form = document.querySelector<HTMLElement>(".guided-form")!;
      return {
        page: de.scrollWidth - de.clientWidth,
        form: form.scrollWidth - form.clientWidth,
      };
    });
    expect(overflow, `étape ${n} : débordement horizontal`).toEqual({ page: 0, form: 0 });
  }
});

test("import d'un projet → parcours libre", async ({ page }) => {
  await openAppFresh(page);
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  const menu = await openProjectMenu(page);
  const chooser = page.waitForEvent("filechooser");
  await menu.getByRole("button", { name: "Ouvrir…", exact: true }).click();
  await (await chooser).setFiles(EXAMPLE);
  await settle(page);
  await expect(page.locator(".topbar__project-name")).toHaveText(/Jalon 4/);
  await expect(page.locator('.app[data-journey="free"]')).toBeVisible();
  await expect(journeyRadio(page, "Libre")).toHaveAttribute("aria-checked", "true");
  // Le panneau libre montre le projet importé.
  await openSection(page, "Site");
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue("2700");
});

test("assistant validé depuis le libre → parcours guidé à l'étape 1", async ({ page }) => {
  await openAppFresh(page);
  await goToStep(page, 4);
  await useFreeJourney(page);
  await openProjectMenu(page);
  await page.getByRole("button", { name: "Assistant…" }).click();
  const d = page.getByRole("dialog", { name: "Assistant d'initialisation" });
  await d.getByLabel("Longueur de trémie (X)").fill("2800");
  await d.getByLabel("Largeur de trémie (Y)").fill("900");
  await d.getByRole("button", { name: "Proposer", exact: true }).click();
  const choose = d
    .locator(".assistant__card")
    .first()
    .getByRole("button", { name: /^Choisir/ });
  await expect(choose).toBeVisible({ timeout: 30_000 });
  await choose.click();
  await expect(d).toHaveCount(0);
  await settle(page);
  await expect(page.locator('.app[data-journey="guided"]')).toBeVisible();
  await expect(stepTab(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(undoButton(page)).toBeEnabled();
});
