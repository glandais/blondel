/**
 * Projet de bout en bout : import d'un exemple par le menu « Importer » (b), annuler /
 * rétablir par les boutons et les raccourcis clavier (c), autosauvegarde relue au
 * rechargement.
 */
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  applyPreset,
  blockingCount,
  commitField,
  openApp,
  openSection,
  openTab,
  settle,
  structureSelect,
  viewTab,
} from "./support.js";

/** Nom du projet, affiché sur le bouton du menu du projet (barre du haut). */
const PROJECT_NAME = ".topbar__project-name";

const EXAMPLE = fileURLToPath(
  new URL("../../../examples/j4-acceptance-01-garde-corps.blondel.json", import.meta.url),
);

test("import d'un exemple par le menu Importer", async ({ page }) => {
  await openApp(page);
  // Le menu « Importer » ouvre le sélecteur de fichiers du champ caché.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
  await (await chooser).setFiles(EXAMPLE);
  await settle(page);

  await expect(page.getByRole("status").filter({ hasText: "importé" })).toContainText(
    "Jalon 4 — cas d'acceptation n° 1, garde-corps barreaudé",
  );
  await expect(page.locator(PROJECT_NAME)).toHaveText(
    "Jalon 4 — cas d'acceptation n° 1, garde-corps barreaudé",
  );
  await openSection(page, "Site");
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue("2700");
  await openSection(page, "Structure");
  await expect(structureSelect(page)).toHaveValue("wood-housed");
  await openSection(page, "Tracé");
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("newel");
  expect(await blockingCount(page)).toBe(0);
  // Garde-corps de l'exemple : balustres et poteaux dans la nomenclature.
  await openTab(page, "Nomenclature");
  await expect(page.locator("#view-panel")).toContainText(/[Bb]alustre/);

  // L'import est une seule étape d'historique.
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(page.locator(PROJECT_NAME)).not.toHaveText(/Jalon 4/);
});

test("fichier invalide : message d'erreur, projet inchangé", async ({ page }) => {
  await openApp(page);
  const before = (await page.locator(PROJECT_NAME).textContent()) ?? "";
  await openSection(page, "Site");
  const h = await page.getByLabel("Hauteur à monter H").inputValue();
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  await expect(undo).toBeDisabled();
  // Même chemin que l'utilisateur : menu « Importer », entrée « Projet », sélecteur de fichiers.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
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
  await expect(page.locator(PROJECT_NAME)).toHaveText(before);
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue(h);
  // Aucune étape d'historique créée par l'échec.
  await expect(undo).toBeDisabled();
});

test("annuler / rétablir : boutons et raccourcis clavier", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openSection(page, "Site");
  const h = page.getByLabel("Hauteur à monter H");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const redo = page.getByRole("button", { name: "Rétablir (Ctrl+Maj+Z)", exact: true });
  const riseCell = page.locator(
    '.figure-line__item[data-figure="h"][title="Hauteur de marche"] dd',
  );

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
  await viewTab(page, "Plan").focus();
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
  await openSection(page, "Tracé");
  await expect(page.getByLabel("Jour", { exact: true })).toHaveCount(1);
  await undo.click();
  await undo.click();
  await settle(page);
  await expect(page.getByLabel("Jour", { exact: true })).toHaveCount(0);
  await expect(undo).toBeDisabled();
});

test("autosauvegarde relue au rechargement", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Deux quarts tournants (U)");
  await openSection(page, "Site");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2850");
  await page.reload();
  await settle(page);
  // Panneau ouvert mémorisé : la section « Site » est rouverte au rechargement.
  await expect(page.locator("#free-panel")).toBeVisible();
  await expect(page.getByLabel("Hauteur à monter H")).toHaveValue("2850");
  await openSection(page, "Tracé");
  await expect(page.locator("fieldset.turn")).toHaveCount(2);
});

test("autosauvegarde illisible : message, copie de secours, jamais écrasée en silence", async ({
  page,
}) => {
  await openApp(page);
  // Autosauvegarde d'une version plus récente de Blondel (format 2).
  await page.evaluate(() => {
    const key = "blondel.autosave.project";
    const json = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({ ...json, name: "Mon escalier client", schemaVersion: 2 }),
    );
  });
  await page.reload();
  await settle(page);
  const notice = page.locator(".notice--error[role=alert]");
  await expect(notice).toContainText("n'a pas pu être rouverte");
  await expect(notice).toContainText("format 2, plus récent");
  const actions = page.getByRole("group", { name: "Autosauvegarde refusée" });
  await expect(actions).toBeVisible();

  // Première modification : l'original reste disponible sous la clé de secours.
  await openSection(page, "Site");
  await commitField(page, page.getByLabel("Hauteur à monter H"), "2800");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const stored = await page.evaluate(() => ({
    rejected: localStorage.getItem("blondel.autosave.rejected") ?? "",
    current: localStorage.getItem("blondel.autosave.project") ?? "",
  }));
  expect(stored.rejected).toContain("Mon escalier client");
  expect(stored.current).not.toContain("Mon escalier client");

  // Téléchargement du texte brut, intact.
  const pending = page.waitForEvent("download");
  await actions.getByRole("button", { name: "Télécharger le texte brut" }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe("autosauvegarde-refusee.blondel.json");

  // Congé explicite : la copie est libérée.
  await actions.getByRole("button", { name: "Oublier cette sauvegarde" }).click();
  await expect(actions).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("blondel.autosave.rejected"))).toBeNull();
});

test("copie de secours d'un démarrage antérieur : bandeau restaurer / exporter / supprimer", async ({
  page,
}) => {
  await openApp(page);
  // Copie de secours laissée par un démarrage antérieur (format plus récent, illisible ici),
  // autosauvegarde courante lisible.
  await page.evaluate(() => {
    const json = JSON.parse(localStorage.getItem("blondel.autosave.project") ?? "{}") as Record<
      string,
      unknown
    >;
    localStorage.setItem(
      "blondel.autosave.rejected",
      JSON.stringify({ ...json, name: "Mon escalier client", schemaVersion: 2 }),
    );
  });
  await page.reload();
  await settle(page);
  const banner = page.getByRole("group", { name: "Copie de secours d'autosauvegarde" });
  await expect(banner).toBeVisible();
  // Aucune erreur de démarrage : le projet courant est ouvert normalement.
  await expect(page.locator(".notice--error[role=alert]")).toHaveCount(0);
  // Illisible par cette version : pas de restauration (et pas de lecture seule).
  await expect(banner.getByRole("button", { name: "Restaurer" })).toBeDisabled();

  // Toujours signalée au démarrage suivant.
  await page.reload();
  await settle(page);
  await expect(banner).toBeVisible();

  const pending = page.waitForEvent("download");
  await banner.getByRole("button", { name: "Exporter" }).click();
  expect((await pending).suggestedFilename()).toBe("autosauvegarde-refusee.blondel.json");

  await banner.getByRole("button", { name: "Supprimer" }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("blondel.autosave.rejected"))).toBeNull();
  await page.reload();
  await settle(page);
  await expect(banner).toHaveCount(0);
});
