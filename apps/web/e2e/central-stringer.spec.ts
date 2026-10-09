/**
 * Limon central métal (QUESTIONS A29) dans l'interface, sur un quart tournant : choix de la
 * structure « Limon central », section tube grisée avec sa raison (tube réservé au tracé droit),
 * passage en caisson, tronçons du limon débillardé et leurs joints en Fabrication, justification
 * du double porte-à-faux et de la torsion saisie dans l'inspecteur de la règle
 * LIMON_CENTRAL_PORTE_A_FAUX (l'avertissement reste), entraxe des entretoises du caisson sous
 * sa borne basse (QUESTIONS A32 (a) : erreur lisible), démo « Limon central débillardé ».
 */
import { expect, test, type Page } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  commitField,
  instrument,
  openApp,
  openProjectMenu,
  openSection,
  openTab,
  settle,
  structureSelect,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const inspectorOf = (page: Page) => page.getByRole("complementary", { name: "Inspecteur" });

/** Liste « Section » (type de section) du limon central, dans son groupe déplié. */
async function sectionKind(page: Page) {
  const panel = await openSection(page, "Structure");
  const group = panel.locator("details.structure-params__group", {
    has: page.locator("summary", { hasText: "Section de la poutre" }),
  });
  const select = panel.getByRole("combobox", { name: "Section", exact: true });
  if (!(await select.isVisible())) {
    if ((await group.count()) > 0 && (await group.first().getAttribute("open")) === null) {
      await group.first().locator("summary").click();
    }
  }
  await expect(select).toBeVisible();
  return select;
}

test("quart tournant : limon central en caisson, tronçons et joints, justification de la torsion", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "steel-central");
  await expect(structureSelect(page)).toHaveValue("steel-central");

  // Section : le tube est grisé sur un tracé tournant, sa raison écrite dans le choix.
  const kind = await sectionKind(page);
  const tube = kind.locator('option[value="tube"]');
  await expect(tube).toBeDisabled();
  await expect(tube).toContainText("Tube rectangulaire — indisponible");
  await expect(kind.locator('option[value="box"]')).toBeEnabled();
  if ((await kind.inputValue()) !== "box") {
    await kind.selectOption("box");
    await settle(page);
  }
  await expect(kind).toHaveValue("box");

  // Fabrication : les tronçons du limon central (développés) et leurs joints repérés.
  await openTab(page, "Pièces");
  const list = page.getByRole("navigation", { name: "Pièces par famille" });
  const group = list.getByRole("button", { name: /^Limons\b/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const marks = list.getByRole("list", { name: "Repères : Limons" }).getByRole("button");
  expect(await marks.count()).toBeGreaterThan(1);
  await marks.first().click();
  const joints = page.locator(".flat-view__joints");
  await expect(joints.first()).toBeVisible();
  await expect(joints.first().locator("[data-joint]").first()).toContainText(/J\d+ : \S+ ↔ \S+/);
  await expect(page.locator(".fab-sheet__drawing .svg-export svg")).toBeVisible();

  // Contrôle : double porte-à-faux et torsion, justification saisie sur place.
  // Badge Contrôle : inspecteur « sans sélection », cartes des résultats.
  await openSection(page, "Structure");
  const inspector = inspectorOf(page);
  await page.locator(".control-badge").click();
  await expect(inspector).toHaveAttribute("data-template", "project");
  const card = inspector.locator('.rule-card[data-rule="LIMON_CENTRAL_PORTE_A_FAUX"]').first();
  await expect(card).toBeVisible();
  await card.locator("button.result").click();
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(inspector.locator(".rule-insp__ref")).toHaveText("LIMON_CENTRAL_PORTE_A_FAUX");
  await expect(inspector.locator(".rule-insp__status")).toContainText("Avertissement");
  const field = inspector.getByRole("textbox", {
    name: "Justification du double porte-à-faux et de la torsion",
  });
  await field.fill("Note de calcul NC-12");
  await field.press("Enter");
  await settle(page);
  // Une justification n'est pas une vérification : l'avertissement reste, la saisie aussi.
  await expect(inspector.locator(".rule-insp__ref")).toHaveText("LIMON_CENTRAL_PORTE_A_FAUX");
  await expect(inspector.locator(".rule-insp__status")).toContainText("Avertissement");
  await expect(field).toHaveValue("Note de calcul NC-12");
});

test("caisson : entraxe des entretoises sous la hauteur de la section, erreur lisible (A32 a)", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "steel-central");
  const kind = await sectionKind(page);
  if ((await kind.inputValue()) !== "box") {
    await kind.selectOption("box");
    await settle(page);
  }
  await expect(page.locator(".errors-bar")).toHaveCount(0);

  // Entraxe des entretoises de 100 mm, sous la borne basse par défaut (hauteur de la section).
  const panel = await openSection(page, "Structure");
  const field = panel.getByRole("textbox", {
    name: "Entraxe maximal des entretoises",
    exact: true,
  });
  for (let k = 0; k < 8 && !(await field.isVisible()); k++) {
    const closed = panel.locator("details:not([open]) > summary");
    if ((await closed.count()) === 0) break;
    await closed.first().click();
  }
  await expect(field).toBeVisible();
  await commitField(page, field, "100");
  await expect(field).toHaveValue("100");

  // Erreur lisible du cœur (pas d'exception), le limon reste généré.
  const bar = page.locator(".errors-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/entretoises/i);
  await openTab(page, "Pièces");
  const list = page.getByRole("navigation", { name: "Pièces par famille" });
  await expect(list.getByRole("button", { name: /^Limons\b/ })).toBeVisible();
});

test("démo « Limon central débillardé » : limon central, aucune erreur de génération", async ({
  page,
}) => {
  await openApp(page);
  const menu = await openProjectMenu(page);
  const labels = await menu
    .getByLabel("Préréglage")
    .locator("option")
    .evaluateAll((os) => os.map((o) => o.textContent ?? ""));
  const label = labels.find((l) => /limon central débillardé/i.test(l));
  expect(label, labels.join(" | ")).toBeDefined();
  await applyPreset(page, label!.trim());
  await openSection(page, "Structure");
  await expect(structureSelect(page)).toHaveValue("steel-central");
  await expect(page.locator(".errors-bar")).toHaveCount(0);
});
