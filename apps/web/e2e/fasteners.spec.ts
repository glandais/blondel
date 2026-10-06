/**
 * Visserie (QUESTIONS A27, décision du 2026-10-06) sur un escalier métal (limons plats acier,
 * platines percées) : groupe « Visserie » de la liste des pièces du mode Fabrication (un clic
 * sélectionne une pièce de l'assemblage), tableau « Visserie » de la nomenclature, liste de
 * visserie CSV proposée par le menu des exports, réglage ◆ du profil d'atelier (longueur d'un
 * assemblage) modifié puis annulé.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  commitField,
  exportMenuButton,
  openApp,
  openSection,
  openTab,
  settle,
} from "./support.js";

const partsList = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Pièces par famille" });
const sheet = (page: Page): Locator => page.getByRole("region", { name: "Pièce choisie" });
const undoButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });

async function metalStair(page: Page): Promise<void> {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-flat");
}

test("groupe « Visserie » en Fabrication, tableau de la nomenclature, liste CSV", async ({
  page,
}) => {
  await metalStair(page);

  // Liste des pièces : groupe « Visserie », replié d'office, en dernier.
  await openTab(page, "Pièces");
  const group = partsList(page).locator('.fab-group[data-group="fasteners"]');
  await expect(group).toHaveCount(1);
  await expect(partsList(page).locator(".fab-group").last()).toHaveAttribute(
    "data-group",
    "fasteners",
  );
  const head = group.getByRole("button", { name: /^Visserie\b/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  const marks = partsList(page).getByRole("list", { name: "Repères : Visserie" });
  const first = marks.getByRole("button").first();
  await expect(first.locator("strong")).toHaveText(/^\S+$/);
  await expect(first).toContainText(/×\d+/);
  // Un clic sélectionne une pièce de l'assemblage (sélection partagée).
  await first.click();
  await settle(page);
  await expect(sheet(page)).toHaveAttribute("data-part", /.+/);

  // Filtre sans correspondance : le groupe disparaît avec les autres.
  const filter = partsList(page).getByPlaceholder("Filtrer : repère, matériau…");
  await filter.fill("zzzz");
  await expect(group).toHaveCount(0);
  await filter.fill("");
  await expect(group).toHaveCount(1);

  // Nomenclature : tableau « Visserie » sous celui des pièces.
  await openTab(page, "Nomenclature");
  const table = page.locator("table.bom__fasteners");
  await expect(table).toBeVisible();
  await expect(table.locator("caption")).toHaveText(/^Visserie : \d+ repère/);
  for (const col of ["Repère", "Désignation", "Qté", "Assemblages", "Pièces"]) {
    await expect(table.getByRole("columnheader", { name: col, exact: true })).toBeVisible();
  }
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(0);

  // Menu des exports (« Autres exports » en Fabrication) : liste de visserie CSV.
  const pending = page.waitForEvent("download");
  await exportMenuButton(page).click();
  const item = page.getByRole("menuitem", { name: "Liste de visserie (CSV)", exact: true });
  await expect(item).toBeEnabled();
  await item.click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/-visserie\.csv$/);
  const csv = (await readFile(await download.path())).toString("utf8");
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain("Repère;Désignation;Nature;Diamètre (mm);Longueur (mm)");
  expect(csv).not.toMatch(/NaN|undefined/);
});

test("réglage ◆ de la visserie : longueur modifiée puis annulée", async ({ page }) => {
  await metalStair(page);
  const panel = await openSection(page, "Structure");
  const fasteners = panel.locator("fieldset.fasteners");
  await expect(fasteners.locator("legend").first()).toHaveText("Visserie");
  // Parcours libre : réglages repliés sous « Réglages d'atelier », compteur ◆.
  const fold = fasteners.locator("details.tiered__fold--workshop");
  await expect(fold.locator("summary")).toContainText("Réglages d'atelier");
  await expect(fold.locator("summary .tv-mark")).toContainText(/◆ \d+/);
  await fold.locator("summary").click();
  const joint = fold.locator("fieldset.fasteners__joint").first();
  await expect(joint).toBeVisible();
  const length = joint.getByLabel("Longueur", { exact: true });
  const before = await length.inputValue();
  expect(Number(before)).toBeGreaterThan(0);
  const next = String(Number(before) + 20);
  await commitField(page, length, next);
  await expect(length).toHaveValue(next);
  // Champ ◆ : marque toujours présente (valeur non validée).
  await expect(joint.locator(".tiered__item--tv").first()).toBeVisible();

  // La liste « À valider » montre la nouvelle valeur.
  await openTab(page, "À valider");
  await expect(page.locator(".fab-validate")).toContainText("Visserie ·");

  // Annuler : valeur d'origine rétablie.
  await undoButton(page).click();
  await settle(page);
  const again = await openSection(page, "Structure");
  const reopened = again.locator("fieldset.fasteners details.tiered__fold--workshop");
  if ((await reopened.getAttribute("open")) === null) await reopened.locator("summary").click();
  await expect(
    reopened.locator("fieldset.fasteners__joint").first().getByLabel("Longueur", { exact: true }),
  ).toHaveValue(before);
});
