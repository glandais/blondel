/**
 * Décisions A16 et A18 de l'utilisateur (2026-09-29, A18 (a) précisée le 2026-09-30) : bord de
 * mesure de la ligne de foulée d'un escalier droit, bouton « Recaler volées et trémie » (une
 * seule entrée d'annulation, position des tournants conservée, désactivé avec explication) et
 * édition des surcharges de règles avec justification obligatoire depuis le contrôle de
 * conception.
 */
import { expect, test } from "@playwright/test";
import { applyPreset, commitField, instrument, openApp, openSection, settle } from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test("recaler volées et trémie après modification de H, annulable en une fois", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openSection(page, "Tracé");
  const leg1 = page.getByRole("textbox", { name: "Volée 1 : longueur (bord extérieur)" });
  const leg2 = page.getByRole("textbox", { name: "Volée 2 : longueur (bord extérieur)" });
  const before = [await leg1.inputValue(), await leg2.inputValue()];
  await openSection(page, "Site");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2900");
  await openSection(page, "Tracé");
  await expect(leg2).toHaveValue(before[1]!);

  await page.getByRole("button", { name: "Recaler volées et trémie" }).click();
  await settle(page);
  const notice = page.locator(".notice", { hasText: "Dernière volée recalée" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Trémie recalée");
  // Position du tournant saisie conservée (A18 a, 2026-09-30) : seule la dernière volée change.
  await expect(leg1).toHaveValue(before[0]!);
  await expect(leg2).not.toHaveValue(before[1]!);
  await expect(page.locator(".figure-line__errors")).toHaveCount(0);

  // Une seule entrée d'annulation : H reste à 2 900, volées d'origine.
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(leg1).toHaveValue(before[0]!);
  await expect(leg2).toHaveValue(before[1]!);
  await openSection(page, "Site");
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue("2900");
});

test("recalage impossible : bouton désactivé avec la raison rendue par le cœur", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant avec palier");
  await openSection(page, "Site");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2900");
  await openSection(page, "Tracé");
  const button = page.getByRole("button", { name: "Recaler volées et trémie" });
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("realign-reason")).toContainText("nombre entier de girons");
});

test("escalier droit large : bord de mesure de la ligne de foulée réglable", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await openSection(page, "Tracé");
  await commitField(page, page.getByLabel("Emmarchement E"), "1400");
  const side = page.getByLabel("Bord de mesure de la ligne de foulée");
  await expect(side).toHaveValue("auto");
  await expect(side.locator("option[value=auto]")).toHaveText("Automatique (gauche)");
  await side.selectOption("right");
  await settle(page);
  await expect(side).toHaveValue("right");
  await expect(page.locator(".figure-line__errors")).toHaveCount(0);
  // Sans objet sur un tracé à tournants.
  await applyPreset(page, "Quart tournant à gauche");
  await openSection(page, "Tracé");
  await expect(page.getByLabel("Emmarchement E")).toBeVisible();
  await expect(page.getByLabel("Bord de mesure de la ligne de foulée")).toHaveCount(0);
});

test("surcharge d'une règle : justification obligatoire, liste des surcharges", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  // Contrôle de conception dans l'inspecteur : liste des règles respectées dépliée par son lien.
  const inspector = page.getByRole("complementary", { name: "Inspecteur" });
  const panel = page.locator(".inspector-control");
  await expect(panel.locator(".sev--ok")).toHaveCount(0);
  await panel.locator('.control-folds__link[data-fold="ok"]').click();
  await expect(panel.locator(".sev--ok")).toHaveAttribute("open", "");
  const item = panel.locator(".sev--ok li").first();
  const ruleId = (await item.getAttribute("data-rule"))!;
  // La ligne ouvre l'inspecteur Règle (2c), où se fait la surcharge.
  await item.locator("button.result").click();
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(inspector.locator(".rule-insp__ref")).toHaveText(ruleId);
  const form = inspector.getByRole("form", { name: `Surcharge de ${ruleId}` });
  const advice = form
    .getByRole("radiogroup", { name: "Nouvelle sévérité" })
    .getByRole("radio", { name: "Conseil", exact: true });
  await advice.click();
  await expect(advice).toHaveAttribute("aria-checked", "true");
  const save = form.getByRole("button", { name: "Surcharger", exact: true });
  await expect(save).toBeDisabled();
  await form.getByLabel(/Justification/).fill("Validé par le bureau d'études");
  await expect(save).toBeEnabled();
  await save.click();
  await settle(page);
  // Surcharge rappelée dans l'inspecteur Règle.
  await expect(form).toContainText("Surcharge : Conseil — Validé par le bureau d'études");
  await expect(form.getByRole("button", { name: "Lever la surcharge" })).toBeVisible();

  // Lien du compteur de surcharges (section Contexte) : retour à l'inspecteur « sans
  // sélection », liste des surcharges dépliée et focalisée.
  const context = await openSection(page, "Contexte");
  await context.getByRole("button", { name: "1 surcharge(s) de règle justifiée(s)." }).click();
  await expect(inspector).toHaveAttribute("data-template", "project");
  const list = panel.locator(".sev--overrides");
  const overridesLink = panel.locator('.control-folds__link[data-fold="overrides"]');
  await expect(overridesLink).toContainText("1 surcharge");
  await expect(list).toHaveAttribute("open", "");
  await expect(list.locator("summary")).toBeFocused();
  await expect(list.locator("summary .count")).toHaveText("1");
  await expect(list).toContainText(ruleId);
  await expect(list).toContainText("Validé par le bureau d'études");

  // Levée depuis la liste des surcharges (annulable).
  await list.getByRole("button", { name: "Lever la surcharge" }).click();
  await settle(page);
  await expect(panel.locator(".sev--overrides")).toHaveCount(0);
  await expect(overridesLink).toHaveCount(0);
  await expect(context.getByText("0 surcharge(s) de règle justifiée(s).")).toBeVisible();
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(overridesLink).toContainText("1 surcharge");

  // Le titre d'une surcharge de la liste ouvre l'inspecteur Règle, où elle se modifie.
  if ((await panel.locator(".sev--overrides[open]").count()) === 0) await overridesLink.click();
  await panel.locator(".sev--overrides .override-item__open").first().click();
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(inspector.locator(".rule-insp__ref")).toHaveText(ruleId);
  await expect(form).toContainText("Surcharge : Conseil — Validé par le bureau d'études");
});
