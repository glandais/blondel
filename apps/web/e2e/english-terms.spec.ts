/**
 * Termes anglais des décisions A26 à A28 (2026-10-06) dans l'interface : le parcours est préparé
 * en français (aides partagées des specs), puis la langue passe à l'anglais par le sélecteur du
 * menu ⋯ ; on vérifie alors :
 *
 * - A26 (a) : « Development » (inspecteur Pièce) pour un limon bois, « Flat pattern » pour un
 *   limon acier ;
 * - A27 : groupe « Fixings » du mode Fabrication, tableau « Fixings » de la nomenclature ;
 * - A28 : inspecteur « Top nosing » du nez d'arrivée ;
 * - A29 : « mono-stringer » pour le limon central (choix de la structure, glossaire-en.md).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  inspectorPanel,
  instrument,
  openApp,
  openTab,
  openWorkspace,
  settle,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

/** Passe l'interface en anglais (menu ⋯ « Plus d'options », sélecteur « Langue »). */
async function switchToEnglish(page: Page): Promise<void> {
  const more = page.getByRole("button", { name: "Plus d'options", exact: true });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  await page.getByLabel("Langue", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // Menu refermé par son bouton (Échap effacerait la sélection).
  const close = page.getByRole("button", { name: "More options", exact: true });
  if ((await close.getAttribute("aria-expanded")) === "true") await close.click();
  await settle(page);
}

const partsList = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Pièces par famille" });

/** Choisit le premier limon dans la liste des pièces (Fabrication, onglet Pièces). */
async function selectFirstStringer(page: Page): Promise<void> {
  await openTab(page, "Pièces");
  const group = partsList(page).getByRole("button", { name: /^Limons\b/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const mark = partsList(page).getByRole("list", { name: "Repères : Limons" }).getByRole("button");
  await mark.first().click();
  await expect(mark.first()).toHaveAttribute("aria-pressed", "true");
  await openWorkspace(page, "Conception");
}

test("limon bois : bouton « Development » de l'inspecteur Pièce en anglais", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "wood-housed");
  await selectFirstStringer(page);
  await switchToEnglish(page);
  const inspector = page.locator('.inspector[data-template="part"]');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("button", { name: /^Development/ })).toBeEnabled();
  await expect(inspector.getByRole("button", { name: /^Flat pattern/ })).toHaveCount(0);
});

test("escalier acier : « Flat pattern », groupe et nomenclature « Fixings » en anglais", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-flat");
  await selectFirstStringer(page);
  await switchToEnglish(page);
  const inspector = page.locator('.inspector[data-template="part"]');
  await expect(inspector.getByRole("button", { name: /^Flat pattern/ })).toBeEnabled();
  await expect(inspector.getByRole("button", { name: /^Development/ })).toHaveCount(0);

  // Fabrication : groupe « Fixings » de la liste des pièces, tableau de la nomenclature.
  await page.getByRole("radio", { name: "Fabrication", exact: true }).click();
  const views = page.getByRole("tablist", { name: "Views" });
  await views.getByRole("tab", { name: "Parts", exact: true }).click();
  await settle(page);
  const list = page.getByRole("navigation", { name: "Parts by family" });
  const group = list.locator('.fab-group[data-group="fasteners"]');
  await expect(group.getByRole("button", { name: /^Fixings\b/ })).toBeVisible();
  await views.getByRole("tab", { name: "Bill of materials", exact: true }).click();
  await settle(page);
  await expect(page.locator("table.bom__fasteners caption")).toHaveText(/^Fixings: \d+ mark/);
});

test("nez d'arrivée : inspecteur « Top nosing » en anglais", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openTab(page, "Élévation");
  const target = page.locator("#view-panel .svg-export [data-nosing-target]");
  await expect(target).toHaveCount(1);
  await target.click();
  await settle(page);
  await switchToEnglish(page);
  const inspector = inspectorPanel(page);
  await expect(inspector).toHaveAttribute("data-template", "nosing");
  await expect(inspector.getByRole("heading", { level: 3 })).toHaveText("Top nosing");
  await expect(inspector.getByRole("region", { name: "Nosing line" })).toBeVisible();
  await expect(inspector.getByText(/^The angle cannot be changed/)).toBeVisible();
});

test("limon central : « mono-stringer » en anglais (A29)", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-central");
  await switchToEnglish(page);
  const select = page.getByRole("combobox", { name: "Structure", exact: true });
  await expect(select).toHaveValue("steel-central");
  await expect(select.locator('option[value="steel-central"]')).toContainText(/mono-stringer/i);
  await expect(select.locator('option[value="steel-central"]')).not.toContainText(/limon/i);
});
