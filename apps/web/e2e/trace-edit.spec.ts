/**
 * Décisions A16 et A18 de l'utilisateur (2026-09-29, A18 (a) précisée le 2026-09-30) : bord de
 * mesure de la ligne de foulée d'un escalier droit, bouton « Recaler volées et trémie » (une
 * seule entrée d'annulation, position des tournants conservée, désactivé avec explication) et
 * édition des surcharges de règles avec justification obligatoire depuis le contrôle de
 * conception.
 */
import { expect, test } from "@playwright/test";
import { applyPreset, commitField, instrument, openApp, settle } from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test("recaler volées et trémie après modification de H, annulable en une fois", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const leg1 = page.getByRole("textbox", { name: "Volée 1 (bord extérieur)" });
  const leg2 = page.getByRole("textbox", { name: "Volée 2 (bord extérieur)" });
  const before = [await leg1.inputValue(), await leg2.inputValue()];
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2900");
  await expect(leg2).toHaveValue(before[1]!);

  await page.getByRole("button", { name: "Recaler volées et trémie" }).click();
  await settle(page);
  const notice = page.locator(".notice", { hasText: "Dernière volée recalée" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Trémie recalée");
  // Position du tournant saisie conservée (A18 a, 2026-09-30) : seule la dernière volée change.
  await expect(leg1).toHaveValue(before[0]!);
  await expect(leg2).not.toHaveValue(before[1]!);
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);

  // Une seule entrée d'annulation : H reste à 2 900, volées d'origine.
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(leg1).toHaveValue(before[0]!);
  await expect(leg2).toHaveValue(before[1]!);
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue("2900");
});

test("recalage impossible : bouton désactivé avec la raison rendue par le cœur", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant avec palier");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2900");
  const button = page.getByRole("button", { name: "Recaler volées et trémie" });
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("realign-reason")).toContainText("nombre entier de girons");
});

test("escalier droit large : bord de mesure de la ligne de foulée réglable", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await commitField(page, page.getByLabel("Emmarchement E"), "1400");
  const side = page.getByLabel("Bord de mesure de la ligne de foulée");
  await expect(side).toHaveValue("auto");
  await expect(side.locator("option[value=auto]")).toHaveText("Automatique (gauche)");
  await side.selectOption("right");
  await settle(page);
  await expect(side).toHaveValue("right");
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);
  // Sans objet sur un tracé à tournants.
  await applyPreset(page, "Quart tournant à gauche");
  await expect(page.getByLabel("Bord de mesure de la ligne de foulée")).toHaveCount(0);
});

test("surcharge d'une règle : justification obligatoire, liste des surcharges", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const panel = page.locator(".compliance");
  await panel.locator(".sev--ok > summary").click();
  const item = panel.locator(".sev--ok li").first();
  const ruleId = (await item.locator("code").first().textContent())!;
  await item.getByRole("button", { name: "Surcharger la règle…" }).click();
  const form = item.getByRole("form", { name: `Surcharge de ${ruleId}` });
  await form.getByLabel(`Sévérité retenue pour ${ruleId}`).selectOption("conseil");
  const save = form.getByRole("button", { name: "Enregistrer la surcharge" });
  await expect(save).toBeDisabled();
  await form.getByLabel(/Justification/).fill("Validé par le bureau d'études");
  await expect(save).toBeEnabled();
  await save.click();
  await settle(page);

  const list = panel.locator(".sev--overrides");
  await expect(list.locator("summary .count")).toHaveText("1");
  await expect(list).toContainText(ruleId);
  await expect(list).toContainText("Validé par le bureau d'études");

  // Retrait depuis la liste des surcharges.
  await list.getByRole("button", { name: "Modifier la surcharge" }).click();
  await list.getByRole("button", { name: "Retirer la surcharge" }).click();
  await settle(page);
  await expect(panel.locator(".sev--overrides")).toHaveCount(0);
});
