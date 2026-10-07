/**
 * Limon central bois (QUESTIONS A29, vague 2) dans l'interface :
 *
 * - escalier droit : choix de la structure « wood-central », aucune erreur de génération ; en
 *   Fabrication, la poutre LC1 (développé) et les sabots SP1 / ST1 ; visserie « Marche boulonnée
 *   au travers du limon central bois » dans la nomenclature ;
 * - quart tournant : « Bois massif » grisé avec sa raison (lamellé-collé cintré seulement sur une
 *   trace courbe), poutre LC1, règle « Rayon de cintrage du lamellé-collé » respectée ;
 * - refus lisible à petit rayon : lamelles de 10 mm sur le quart tournant, erreur du cœur
 *   « Limon central bois : rayon de cintrage trop petit », aucune pièce LC1 ;
 * - démo « Quart tournant sur limon central bois lamellé-collé » ;
 * - parcours guidé : carte « Limon central bois » de l'étape Structure et résumé de l'étape ;
 * - comparateur sur l'hélicoïdal : variante « limon central hélicoïdal en lamellé-collé
 *   cintré » calculée, appliquée sans erreur, poutre LC1.
 *
 * Textes français figés du cœur (`structure.woodCentral.error.bendRadius`, libellé de la démo) :
 * la CI change de langue système, l'interface reste en français (`openApp`).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  instrument,
  openApp,
  openSection,
  openTab,
  settle,
  structureSelect,
  useGuidedJourney,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const partsList = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Pièces par famille" });

/** Repères d'un groupe de la liste des pièces (Fabrication, onglet Pièces), groupe déplié. */
async function marksOf(page: Page, group: string): Promise<Locator> {
  await openTab(page, "Pièces");
  const head = partsList(page).getByRole("button", { name: new RegExp(`^${group}\\b`) });
  await expect(head).toBeVisible();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  return partsList(page)
    .getByRole("list", { name: `Repères : ${group}` })
    .getByRole("button");
}

/** Bouton d'un repère dans la liste d'un groupe. */
const markButton = (marks: Locator, mark: string): Locator =>
  marks.filter({ has: marks.page().locator("strong", { hasText: new RegExp(`^${mark}$`) }) });

/** Liste « Section de la poutre » (lamellé-collé ou massif), dans son groupe déplié. */
async function sectionKind(page: Page): Promise<Locator> {
  const panel = await openSection(page, "Structure");
  const select = panel.getByRole("combobox", { name: "Section de la poutre", exact: true });
  if (!(await select.isVisible())) {
    const group = panel.locator("details.structure-params__group", {
      has: page.locator("summary", { hasText: "Section de la poutre" }),
    });
    if ((await group.count()) > 0 && (await group.first().getAttribute("open")) === null) {
      await group.first().locator("summary").click();
    }
  }
  await expect(select).toBeVisible();
  return select;
}

test("escalier droit : poutre LC1, sabots SP1 / ST1 et marches boulonnées au travers", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "wood-central");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);
  // Escalier droit : les deux sections sont proposées.
  const kind = await sectionKind(page);
  await expect(kind.locator('option[value="solid"]')).toBeEnabled();
  await expect(kind).toHaveValue("glulam");

  // Fabrication : la poutre (développé) et les sabots en pied et en tête.
  const stringers = await marksOf(page, "Limons");
  const lc1 = markButton(stringers, "LC1");
  await expect(lc1).toHaveCount(1);
  await lc1.click();
  await settle(page);
  await expect(page.locator(".fab-sheet__mark")).toHaveText("LC1");
  await expect(page.locator(".fab-sheet__eyebrow")).toContainText(/développé/i);
  await expect(page.locator(".fab-sheet__drawing .svg-export svg")).toBeVisible();
  const plates = await marksOf(page, "Platines");
  await expect(markButton(plates, "SP1")).toHaveCount(1);
  await expect(markButton(plates, "ST1")).toHaveCount(1);

  // Visserie : boulons traversants des marches, dans la nomenclature.
  await openTab(page, "Nomenclature");
  const fasteners = page.locator("table.bom__fasteners");
  await expect(fasteners).toBeVisible();
  await expect(fasteners).toContainText("Marche boulonnée au travers du limon central bois");
});

test("quart tournant : bois massif grisé avec sa raison, LC1, rayon de cintrage respecté", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "wood-central");
  await expect(structureSelect(page)).toHaveValue("wood-central");

  // Section : le massif est grisé sur une trace courbe, sa raison écrite dans le choix.
  const kind = await sectionKind(page);
  const solid = kind.locator('option[value="solid"]');
  await expect(solid).toBeDisabled();
  await expect(solid).toContainText("Bois massif — indisponible : Bois massif réservé");
  await expect(kind.locator('option[value="glulam"]')).toBeEnabled();
  await expect(kind).toHaveValue("glulam");

  // Contrôle de conception : règle LAMELLE_CINTRE_KR parmi les règles respectées.
  const control = page.locator(".inspector-control");
  await control.locator('.control-folds__link[data-fold="ok"]').click();
  const kr = control.locator('.sev--ok li[data-rule="LAMELLE_CINTRE_KR"]');
  await expect(kr).toHaveCount(1);
  await expect(kr).toContainText("Rayon de cintrage du lamellé-collé");

  // Fabrication : la poutre cintrée.
  const stringers = await marksOf(page, "Limons");
  await expect(markButton(stringers, "LC1")).toHaveCount(1);
});

test("refus lisible à petit rayon : lamelles de 10 mm sur le quart tournant, aucune poutre", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Épaisseur des lamelles imposée à 10 mm (« Imposer » puis saisie).
  const panel = await openSection(page, "Structure");
  const label = "Épaisseur des lamelles";
  const group = panel.getByRole("group", { name: label, exact: true });
  if (!(await group.isVisible())) {
    const details = panel.locator("details.structure-params__group", {
      has: page.locator("summary", { hasText: "Section de la poutre" }),
    });
    if ((await details.count()) > 0 && (await details.first().getAttribute("open")) === null) {
      await details.first().locator("summary").click();
    }
  }
  await group.getByRole("button", { name: "Imposer", exact: true }).click();
  await settle(page);
  const input = panel.getByRole("textbox", { name: label, exact: true });
  await input.fill("10");
  await input.press("Enter");
  await settle(page);
  await expect(input).toHaveValue("10");

  // Erreur lisible du cœur (pas d'exception), aucune pièce de poutre.
  const bar = page.locator(".errors-bar");
  await expect(bar).toContainText("Limon central bois : rayon de cintrage trop petit");
  await openTab(page, "Pièces");
  await expect(
    partsList(page).locator("strong", { hasText: /^LC1$/ }),
    "aucune poutre LC1",
  ).toHaveCount(0);
});

test("démo « Quart tournant sur limon central bois lamellé-collé » : aucune erreur", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant sur limon central bois lamellé-collé");
  await openSection(page, "Structure");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);
});

test("parcours guidé : carte « Limon central bois » à l'étape Structure, résumé de l'étape", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await useGuidedJourney(page);
  const step = page.locator("#step-tab-5");
  await step.click();
  await expect(step).toHaveAttribute("aria-selected", "true");
  await settle(page);
  const card = page
    .getByRole("group", { name: "Bois", exact: true })
    .getByRole("button", { name: /^Limon central bois/ });
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await card.click();
  await settle(page);
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(step.locator(".step-bar__summary")).toContainText("Limon central bois · Chêne");
  await expect(page.locator(".errors-bar")).toHaveCount(0);
});

test("comparateur sur l'hélicoïdal : variante « limon central bois » calculée et appliquée", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal à fût central");
  await openTab(page, "Comparer");
  const table = page.locator(".compare table");
  const label = "limon central hélicoïdal en lamellé-collé cintré";
  await expect(table.locator("thead th", { hasText: label })).toBeVisible();
  const col = await table
    .locator("thead th")
    .evaluateAll((ths, l) => ths.findIndex((th) => (th.textContent ?? "").includes(l)), label);
  expect(col).toBeGreaterThan(0);
  const apply = table
    .locator("tfoot tr")
    .last()
    .locator("td")
    .nth(col - 1)
    .getByRole("button", { name: "Appliquer" });
  await expect(apply).toBeEnabled();
  await apply.click();
  await settle(page);
  await openSection(page, "Structure");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);
  const stringers = await marksOf(page, "Limons");
  await expect(markButton(stringers, "LC1")).toHaveCount(1);
});
