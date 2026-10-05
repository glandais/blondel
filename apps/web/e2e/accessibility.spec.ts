/**
 * Accessibilité clavier et lecteur d'écran : fenêtre modale de l'assistant (focus piégé et
 * rendu, arrière-plan inerte, annuler sans effet derrière la fenêtre) et champs numériques
 * (saisie refusée puis rétablie à la perte de focus : champ valide, message transitoire).
 */
import { expect, test } from "@playwright/test";
import { commitField, openApp, openProjectMenu, openSection, settle, viewTab } from "./support.js";

test("assistant : focus piégé dans la fenêtre, rendu à l'ouverture, Ctrl+Z sans effet", async ({
  page,
}) => {
  await openApp(page);
  await openSection(page, "Site");
  const h = page.getByLabel("Hauteur à monter H");
  await commitField(page, h, "2800");

  // L'assistant s'ouvre depuis le menu du projet ; le focus revient au bouton du projet.
  const menu = await openProjectMenu(page);
  await menu.getByRole("button", { name: "Assistant…" }).click();
  const opener = page.locator(".topbar__project");
  const dialog = page.getByRole("dialog", { name: "Assistant d'initialisation" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Fermer l'assistant" });
  await expect(close).toBeFocused();

  // Maj+Tab et Tab bouclent dans la fenêtre (jamais vers l'arrière-plan).
  const insideDialog = () =>
    page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await insideDialog()).toBe(true);
  }
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await insideDialog()).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  // Arrière-plan inerte.
  await expect(page.locator(".app > .topbar")).toHaveAttribute("inert", "");

  // Ctrl+Z pendant la fenêtre : le projet ne change pas derrière elle.
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(dialog.getByLabel("Hauteur à monter H")).toHaveValue("2800");

  // Échap : fenêtre fermée, focus rendu au bouton d'ouverture, arrière-plan réactivé.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(h).toHaveValue("2800");
  await expect(page.locator(".app > .topbar")).not.toHaveAttribute("inert", "");
  // Hors de la fenêtre, Ctrl+Z annule de nouveau.
  await viewTab(page, "Plan").focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(h).toHaveValue("2700");
});

test("champ numérique : saisie refusée puis rétablie au blur, champ non marqué invalide", async ({
  page,
}) => {
  await openApp(page);
  await openSection(page, "Site");
  const h = page.getByLabel("Hauteur à monter H");
  await expect(h).toHaveValue("2700");
  await h.fill("abc");
  // Pendant la saisie : erreur annoncée.
  await expect(h).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("Tab");
  await expect(h).toHaveValue("2700");
  await expect(h).not.toHaveAttribute("aria-invalid", /.*/);
  const note = page.locator(".field__note").filter({ hasText: "valeur précédente rétablie" });
  await expect(note).toHaveCount(1);
  await expect(page.locator(".field__error")).toHaveCount(0);
  // Nouvelle saisie : le message transitoire disparaît.
  await commitField(page, h, "2750");
  await expect(note).toHaveCount(0);
});
