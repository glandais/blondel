/**
 * Projet de bout en bout : import d'un exemple par le bouton « Importer… » (b), annuler /
 * rétablir par les boutons et les raccourcis clavier (c), autosauvegarde relue au
 * rechargement.
 */
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { applyPreset, blockingCount, commitField, openApp, settle } from "./support.js";

const EXAMPLE = fileURLToPath(
  new URL("../../../examples/j4-acceptance-01-garde-corps.blondel.json", import.meta.url),
);

test("import d'un exemple par le bouton Importer", async ({ page }) => {
  await openApp(page);
  // Le bouton ouvre le sélecteur de fichiers du champ caché.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer…" }).click();
  await (await chooser).setFiles(EXAMPLE);
  await settle(page);

  await expect(page.getByRole("status").filter({ hasText: "importé" })).toContainText(
    "Jalon 4 — cas d'acceptation n° 1, garde-corps barreaudé",
  );
  await expect(page.getByLabel("Projet", { exact: true })).toHaveValue(
    "Jalon 4 — cas d'acceptation n° 1, garde-corps barreaudé",
  );
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue("2700");
  await expect(page.getByLabel("Structure", { exact: true })).toHaveValue("wood-housed");
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("newel");
  expect(await blockingCount(page)).toBe(0);
  // Garde-corps de l'exemple : balustres et poteaux dans la nomenclature.
  await page.getByRole("tab", { name: "Nomenclature", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText(/[Bb]alustre/);

  // L'import est une seule étape d'historique.
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(page.getByLabel("Projet", { exact: true })).not.toHaveValue(/Jalon 4/);
});

test("fichier invalide : message d'erreur, projet inchangé", async ({ page }) => {
  await openApp(page);
  const before = await page.getByLabel("Projet", { exact: true }).inputValue();
  const h = await page.getByLabel("Hauteur à monter H").inputValue();
  const undo = page.getByRole("button", { name: "Annuler", exact: true });
  await expect(undo).toBeDisabled();
  // Même chemin que l'utilisateur : bouton « Importer… », puis sélecteur de fichiers.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer…" }).click();
  await (
    await chooser
  ).setFiles({
    name: "casse.blondel.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion": 1, "name": 42}'),
  });
  // Le message d'erreur est celui de l'import (et non une autre alerte de la page).
  const notice = page.locator(".notice--error");
  await expect(notice).toHaveAttribute("role", "alert");
  await expect(notice).toBeVisible();
  await expect(page.locator(".notice--info")).toHaveCount(0);
  await expect(page.getByLabel("Projet", { exact: true })).toHaveValue(before);
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue(h);
  // Aucune étape d'historique créée par l'échec.
  await expect(undo).toBeDisabled();
});

test("annuler / rétablir : boutons et raccourcis clavier", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  const h = page.getByLabel("Hauteur à monter H");
  const undo = page.getByRole("button", { name: "Annuler", exact: true });
  const redo = page.getByRole("button", { name: "Rétablir", exact: true });
  const riseCell = page.locator('.statusbar__item[title="Hauteur de marche"] dd');

  await expect(h).toHaveValue("2700");
  const rise2700 = await riseCell.textContent();
  await commitField(page, h, "2900");
  await expect(riseCell).not.toHaveText(rise2700 ?? "");
  const rise2900 = await riseCell.textContent();

  // Bouton « Annuler » : H et le modèle reviennent (résultat mis en cache, sans recalcul).
  await undo.click();
  await settle(page);
  await expect(h).toHaveValue("2700");
  await expect(riseCell).toHaveText(rise2700 ?? "");
  await expect(redo).toBeEnabled();

  // Bouton « Rétablir ».
  await redo.click();
  await settle(page);
  await expect(h).toHaveValue("2900");
  await expect(riseCell).toHaveText(rise2900 ?? "");

  // Raccourcis hors des champs : Ctrl+Z, puis Ctrl+Maj+Z et Ctrl+Y.
  await page.getByRole("tab", { name: "Plan 2D", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(h).toHaveValue("2700");
  await page.keyboard.press("Control+Shift+z");
  await settle(page);
  await expect(h).toHaveValue("2900");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  await settle(page);
  await expect(h).toHaveValue("2900");

  // Retour jusqu'au préréglage droit d'origine, puis plus rien à annuler.
  await undo.click();
  await undo.click();
  await settle(page);
  await expect(page.getByLabel("Jour", { exact: true })).toHaveCount(0);
  await expect(undo).toBeDisabled();
});

test("autosauvegarde relue au rechargement", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Deux quarts tournants (U)");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2850");
  await page.reload();
  await settle(page);
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue("2850");
  await expect(page.locator("fieldset.turn")).toHaveCount(2);
});
