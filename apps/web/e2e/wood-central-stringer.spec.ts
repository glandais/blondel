/**
 * Limon central bois (QUESTIONS A29, vague 2) dans l'interface :
 *
 * - escalier droit : choix de la structure « wood-central », aucune erreur de génération ; en
 *   Fabrication, la poutre LC1 (développé) et les sabots SP1 / ST1 ; visserie « Marche boulonnée
 *   au travers du limon central bois » dans la nomenclature ;
 * - quart tournant : « Bois massif » grisé avec sa raison (lamellé-collé cintré seulement sur une
 *   trace courbe), poutre LC1, règle « Rayon de cintrage du lamellé-collé » respectée une fois
 *   la filière « Lamelles cintrées sur moule » choisie (par défaut, b = 88 mm > 60 mm : couches
 *   empilées sans cintrage, QUESTIONS A33 (e)) ;
 * - refus lisible à petit rayon : moule et lamelles de 10 mm sur le quart tournant, erreur du
 *   cœur « Limon central bois : rayon de cintrage trop petit », aucune pièce LC1 ;
 * - suites du 2026-10-09 (QUESTIONS A33, A34) : platine à âme noyée par défaut sur l'hélicoïdal
 *   (PP1 / AP1 / PT1 / AT1, broches et chevilles, aucun constat `FAB_SABOT_EMPRISE`) ;
 *   tire-fonds des marches basses de l'escalier droit (plus de constat
 *   `FAB_LIMON_CENTRAL_BOIS_BOULONS` : aux règles des tire-fonds de A35 (l), un tire-fond ne
 *   garde autour du perçage d'un boulon de sabot que le jeu géométrique, QUESTIONS A36 (10)) ;
 *   couches empilées par défaut sur le quart tournant
 *   (LC1-1… ou leurs planches LC1-1.1… dans la nomenclature et en Fabrication, LC1 sans débit
 *   propre) ;
 * - décisions du 2026-10-09 (QUESTIONS A35) : escalier en U à poutre cintrée, âme de pied
 *   prolongée sous les marches 2 et 3, M1 fixée (aucun constat `FAB_LIMON_CENTRAL_BOIS_BOULONS`
 *   sur M1) ; hélicoïdal : couches composées de plusieurs planches (LC1-k.1… dans la
 *   nomenclature) ;
 * - démo « Quart tournant sur limon central bois lamellé-collé » ;
 * - parcours guidé : carte « Limon central bois » de l'étape Structure et résumé de l'étape ;
 * - comparateur sur l'hélicoïdal : variante « limon central hélicoïdal en lamellé-collé
 *   cintré » calculée, appliquée sans erreur, poutre LC1 ;
 * - décisions du 2026-10-09 (QUESTIONS A36) : exemple `j5c-limon-central-bois-droit` (marches de
 *   80 mm) importé, M1 fixée par ses tire-fonds (boulons du sabot de pied regroupés, A36 (10) :
 *   aucun constat `FAB_LIMON_CENTRAL_BOIS_BOULONS` sur M1) ; hélicoïdal en couches empilées :
 *   une planche LC1-k.j choisie dans la nomenclature renvoie à sa couche (« Planche de LC1-k »),
 *   la couche à la poutre (« Couche de LC1 »), couche composée et poutre comptent leurs
 *   « Pièces composantes » (A36 (9)).
 *
 * Textes français figés du cœur (`structure.woodCentral.error.bendRadius`, libellé de la démo) :
 * la CI change de langue système, l'interface reste en français (`openApp`).
 */
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  inspectorPanel,
  instrument,
  openApp,
  openSection,
  openTab,
  openWorkspace,
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

/** Déplie les replis et groupes fermés du panneau jusqu'à rendre `field` visible. */
async function reveal(panel: Locator, field: Locator): Promise<void> {
  for (let k = 0; k < 8 && !(await field.isVisible()); k++) {
    const closed = panel.locator("details:not([open]) > summary");
    if ((await closed.count()) === 0) break;
    await closed.first().click();
  }
  await expect(field).toBeVisible();
}

/**
 * Filière de la poutre cintrée (« Fabrication de la poutre cintrée ») : `mould` (lamelles
 * cintrées sur moule) ou `stacked` (couches empilées), QUESTIONS A33 (e).
 */
async function chooseCurvedMethod(page: Page, value: "mould" | "stacked"): Promise<void> {
  const panel = await openSection(page, "Structure");
  const select = panel.getByRole("combobox", {
    name: "Fabrication de la poutre cintrée",
    exact: true,
  });
  await reveal(panel, select);
  await select.selectOption(value);
  await settle(page);
  await expect(select).toHaveValue(value);
}

/** Repères de la nomenclature (première colonne du tableau des pièces). */
async function bomMarks(page: Page): Promise<string[]> {
  await openTab(page, "Nomenclature");
  const table = page.locator(".bom > table.table").first();
  await expect(table).toBeVisible();
  return (await table.locator("tbody th[scope=row]").allTextContents()).map((m) => m.trim());
}

/** Cartes de constats d'une règle dans l'inspecteur « sans sélection » (badge Contrôle). */
async function ruleCards(page: Page, ruleId: string): Promise<Locator> {
  await page.locator(".control-badge").click();
  const inspector = page.getByRole("complementary", { name: "Inspecteur" });
  await expect(inspector).toHaveAttribute("data-template", "project");
  return inspector.locator(`.rule-card[data-rule="${ruleId}"]`);
}

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
  // Cintrage sur moule (le défaut, b = 88 mm, est la filière des couches empilées sans k_r).
  await chooseCurvedMethod(page, "mould");

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
  // Lamelles cintrées sur moule (sans quoi l'épaisseur des lamelles est sans objet).
  await chooseCurvedMethod(page, "mould");

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

test("hélicoïdal : platine à âme noyée par défaut, broches et chevilles, sans sabot", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal à fût central");
  await chooseStructure(page, "wood-central");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Ancrage automatique : platine à âme noyée sur une poutre cintrée (A34 (c)).
  const panel = await openSection(page, "Structure");
  const kind = panel.getByRole("combobox", { name: "Type d'ancrage", exact: true });
  await reveal(panel, kind);
  await expect(kind).toHaveValue("auto");

  // Nomenclature : platines PP1 / PT1 et leurs âmes AP1 / AT1, aucun sabot SP1 / ST1.
  const marks = await bomMarks(page);
  for (const m of ["PP1", "AP1", "PT1", "AT1"]) expect(marks, m).toContain(m);
  for (const m of ["SP1", "ST1"]) expect(marks, m).not.toContain(m);
  // Visserie : broches au travers de la poutre, chevilles au sol et au chevêtre.
  const fasteners = page.locator("table.bom__fasteners");
  await expect(fasteners).toBeVisible();
  await expect(fasteners).toContainText("Broche");
  await expect(fasteners).toContainText("Cheville");
  await expect(fasteners).toContainText("Âme de platine brochée dans la poutre bois");

  // Contrôle : aucun constat d'emprise du sabot (le sabot n'est pas choisi).
  await expect(await ruleCards(page, "FAB_SABOT_EMPRISE")).toHaveCount(0);
});

test("escalier droit : marches basses fixées par tire-fonds, plus de constat « boulons »", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Visserie : boulons traversants en partie haute, tire-fonds pour les marches basses.
  await openTab(page, "Nomenclature");
  const fasteners = page.locator("table.bom__fasteners");
  await expect(fasteners).toBeVisible();
  await expect(fasteners).toContainText("Marche boulonnée au travers du limon central bois");
  await expect(fasteners).toContainText("Tire-fond");
  await expect(fasteners).toContainText("Marche fixée par tire-fonds dans le limon central bois");

  // Contrôle : plus d'avertissement « boulon ou tire-fond impossible » (M1, M2) ; autour du
  // perçage d'un boulon de sabot, un tire-fond ne garde que le jeu géométrique (A36 (10)).
  await expect(await ruleCards(page, "FAB_LIMON_CENTRAL_BOIS_BOULONS")).toHaveCount(0);
});

test("quart tournant : couches empilées par défaut, LC1-1… au débit, LC1 sans débit propre", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Filière automatique : couches empilées (b = 88 mm > 60 mm) ; épaisseur des couches réglable.
  const panel = await openSection(page, "Structure");
  const method = panel.getByRole("combobox", {
    name: "Fabrication de la poutre cintrée",
    exact: true,
  });
  await reveal(panel, method);
  await expect(method).toHaveValue("auto");
  await reveal(
    panel,
    panel.getByRole("group", { name: "Épaisseur des couches empilées", exact: true }),
  );

  // Nomenclature (liste de débit) : les couches (ou leurs planches LC1-k.j quand la couche est
  // composée, QUESTIONS A35 (h)), pas la poutre finie.
  const marks = await bomMarks(page);
  const first = marks.find((m) => /^LC1-1(\.1)?$/.test(m));
  expect(first, "première couche").toBeDefined();
  expect(marks.some((m) => /^LC1-2(\.\d+)?$/.test(m))).toBe(true);
  expect(marks).not.toContain("LC1");

  // Fabrication : gabarit de la première couche ; la poutre finie reste dessinée (développé).
  const stringers = await marksOf(page, "Limons");
  await expect(markButton(stringers, "LC1")).toHaveCount(1);
  const layer = markButton(stringers, first!.replace(".", "\\."));
  await expect(layer).toHaveCount(1);
  await layer.click();
  await settle(page);
  await expect(page.locator(".fab-sheet__mark")).toHaveText(first!);
  await expect(page.locator(".fab-sheet__drawing .svg-export svg")).toBeVisible();

  // Contrôle : pas de cintrage, aucun constat de rayon de cintrage.
  await expect(await ruleCards(page, "LAMELLE_CINTRE_KR")).toHaveCount(0);
});

test("escalier en U : âme de pied prolongée, M1 fixée, aucun constat de fixation sur M1", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Deux quarts tournants (U)");
  await chooseStructure(page, "wood-central");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Poutre cintrée : platine à âme noyée par défaut (PP1 / AP1).
  const marks = await bomMarks(page);
  for (const m of ["PP1", "AP1"]) expect(marks, m).toContain(m);

  // Contrôle : aucun constat « boulon ou tire-fond impossible » sur la marche M1 (A35 (a)).
  const cards = await ruleCards(page, "FAB_LIMON_CENTRAL_BOIS_BOULONS");
  await expect(cards.filter({ hasText: /\bM1\b/ })).toHaveCount(0);
});

test("hélicoïdal : couches composées de plusieurs planches LC1-k.j au débit", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal à fût central");
  await chooseStructure(page, "wood-central");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Nomenclature (liste de débit) : des planches LC1-k.1, LC1-k.2… (A35 (h)).
  const marks = await bomMarks(page);
  expect(marks.some((m) => /^LC1-\d+\.1$/.test(m))).toBe(true);
  expect(marks.some((m) => /^LC1-\d+\.2$/.test(m))).toBe(true);
  expect(marks).not.toContain("LC1");
  // Contrôle (non-régression) : aucun débit indisponible. La preuve de « plus de
  // FAB_DEBIT_DISPONIBLE dû à une couche trop large » est la propriété (v) de
  // `woodCentralLayers.test.ts` (profil aux plateaux étroits) : ce préréglage n'en levait pas.
  await expect(await ruleCards(page, "FAB_DEBIT_DISPONIBLE")).toHaveCount(0);
});

const WOOD_CENTRAL_STRAIGHT = fileURLToPath(
  new URL("../../../examples/j5c-limon-central-bois-droit.blondel.json", import.meta.url),
);

test("exemple droit (marches de 80 mm) : M1 fixée, aucun constat « boulons » sur M1", async ({
  page,
}) => {
  await openApp(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
  await (await chooser).setFiles(WOOD_CENTRAL_STRAIGHT);
  await settle(page);
  await openSection(page, "Structure");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Boulons du sabot de pied dans ses 100 premiers millimètres (A36 (10)) : les deux tire-fonds
  // de M1 trouvent leur place, plus de constat « boulon ou tire-fond impossible » sur M1.
  const cards = await ruleCards(page, "FAB_LIMON_CENTRAL_BOIS_BOULONS");
  await expect(cards.filter({ hasText: /\bM1\b/ })).toHaveCount(0);
});

test("hélicoïdal : planche LC1-k.j → « Planche de LC1-k » → « Couche de LC1 », pièces composantes", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Hélicoïdal à fût central");
  await chooseStructure(page, "wood-central");
  await expect(structureSelect(page)).toHaveValue("wood-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Nomenclature : une planche LC1-k.j d'une couche composée (A35 (h), A36 (9)).
  const marks = await bomMarks(page);
  const board = marks.find((m) => /^LC1-\d+\.\d+$/.test(m));
  expect(board, "planche d'une couche composée").toBeDefined();
  const layerMark = board!.replace(/\.\d+$/, "");
  await page
    .locator(".bom > table.table")
    .first()
    .locator("tbody th[scope=row]")
    .getByRole("button", { name: board!, exact: true })
    .first()
    .click();
  await settle(page);

  // Inspecteur de la planche (Conception, sélection gardée) : lien vers sa couche.
  await openWorkspace(page, "Conception");
  const inspector = inspectorPanel(page);
  await expect(inspector).toHaveAttribute("data-template", "part");
  await expect(inspector.locator(".insp-title")).toHaveText(board!);
  const toLayer = inspector.getByRole("button", { name: `Planche de ${layerMark}` });
  await expect(toLayer).toBeVisible();
  await toLayer.click();
  await settle(page);

  // Couche composée : renvoie à LC1, compte ses planches, débit porté par elles.
  await expect(inspector.locator(".insp-title")).toHaveText(layerMark);
  const components = inspector.locator('tr[data-value="components"]');
  await expect(components).toContainText("Pièces composantes");
  await expect(inspector.locator('tr[data-value="stock"]')).toContainText(
    "porté par ses pièces composantes",
  );
  const toBeam = inspector.getByRole("button", { name: "Couche de LC1" });
  await expect(toBeam).toBeVisible();
  await toBeam.click();
  await settle(page);

  // Poutre : ses couches comptées comme pièces composantes.
  await expect(inspector.locator(".insp-title")).toHaveText("LC1");
  await expect(inspector.locator('tr[data-value="components"]')).toContainText(
    "Pièces composantes",
  );
});
