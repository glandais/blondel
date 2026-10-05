/**
 * Langue de l'interface (ADR-0007) : premier lancement avec un navigateur anglais (`en-US`,
 * **sans** le forçage français d'`openApp`), passage au français par le sélecteur du menu ⋯ de
 * la barre du haut, mémorisation au rechargement ; contrôle de conception et export CSV dans la langue.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  LANG_KEY,
  LONG_TASK_BUDGET_MS,
  describeTasks,
  instrument,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

/** Ouvre l'application sans choix mémorisé : la langue vient du navigateur. */
async function openWithBrowserLanguage(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.getByRole("toolbar", { name: "Toolbar" })).toBeVisible();
  await settle(page);
}

/** Ouvre le menu ⋯ de la barre du haut (nom accessible selon la langue). */
async function openMore(page: Page, name: string): Promise<void> {
  const button = page.getByRole("button", { name, exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
}

/**
 * Message affiché du contrôle BLONDEL_DTU dans l'inspecteur (liste des contrôles satisfaits
 * dépliée par son lien « … respectées ▸ »).
 */
async function blondelRuleText(page: Page): Promise<string> {
  const panel = page.locator(".inspector-control");
  if ((await panel.locator(".sev--ok").count()) === 0) {
    await panel.locator('.control-folds__link[data-fold="ok"]').click();
  }
  await expect(panel.locator(".sev--ok")).toHaveAttribute("open", "");
  const item = panel.locator("li", { has: page.locator("code", { hasText: /^BLONDEL_DTU$/ }) });
  await expect(item.first()).toBeVisible();
  return (await item.first().locator(".result__msg").textContent()) ?? "";
}

test(`navigateur anglais : interface, contrôle et export en anglais, puis français mémorisé (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openWithBrowserLanguage(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await takeLongTasks(page);

  // Interface en anglais : barre du haut, onglets des deux espaces, sélecteur de langue (menu ⋯),
  // contrôle de conception.
  await expect(page.getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })).toBeVisible();
  const views = page.getByRole("tablist", { name: "Views" });
  await expect(views.getByRole("tab", { name: "Plan", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Fabrication", exact: true }).click();
  await expect(views.getByRole("tab", { name: "Bill of materials", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Design", exact: true }).click();
  await expect(views.getByRole("tab", { name: "Plan", exact: true })).toBeVisible();
  await openMore(page, "More options");
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
  await expect(page.getByText("Design check", { exact: true }).first()).toBeVisible();
  const english = await blondelRuleText(page);
  expect(english).toMatch(/Blondel formula|walking line|\b2R\b/i);
  expect(english).not.toMatch(/[éèàç]|foulée|marche/i);

  // Export de la liste de débit : nom de fichier et en-têtes en anglais, séparateur « , ».
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export/ }).click();
  const item = page.getByRole("menuitem", { name: "Cutting list (CSV)", exact: true });
  await expect(item).toBeEnabled();
  await item.click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/cutting-list.*\.csv$/);
  const csv = (await readFile(await download.path())).toString("utf8").replace(/^﻿/, "");
  const header = csv.split(/\r?\n/)[0]!;
  expect(header.split(",").slice(0, 3)).toEqual(["Mark", "Description", "Material"]);
  expect(header).not.toMatch(/Repère|Désignation|Matériau/);
  await settle(page);

  // Passage au français par le sélecteur : texte français, html[lang=fr], aucun recalcul lourd.
  await openMore(page, "More options");
  await page.getByLabel("Language", { exact: true }).selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("toolbar", { name: "Barre d'outils" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true })).toBeVisible();
  await openMore(page, "Plus d'options");
  await expect(page.getByLabel("Langue", { exact: true })).toHaveValue("fr");
  await page.getByRole("radio", { name: "Fabrication", exact: true }).click();
  await expect(
    page.getByRole("tablist", { name: "Vues" }).getByRole("tab", { name: "Nomenclature" }),
  ).toBeVisible();
  await expect(page.getByText("Contrôle de conception", { exact: true }).first()).toBeVisible();
  const french = await blondelRuleText(page);
  expect(french).not.toBe(english);
  expect(french).toMatch(/foulée|Module|2h\+g/);
  await settle(page);

  const tasks = await takeLongTasks(page);
  expect(describeTasks(overBudget(tasks), tasks)).toBe("");

  // Choix mémorisé : le rechargement garde le français malgré le navigateur anglais.
  expect(await page.evaluate((key) => window.localStorage.getItem(key), LANG_KEY)).toBe("fr");
  await page.reload();
  await expect(page.getByRole("toolbar", { name: "Barre d'outils" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await openMore(page, "Plus d'options");
  await expect(page.getByLabel("Langue", { exact: true })).toHaveValue("fr");
  await page.getByRole("radio", { name: "Conception", exact: true }).click();
  await expect(
    page.getByRole("tablist", { name: "Vues" }).getByRole("tab", { name: "Plan", exact: true }),
  ).toBeVisible();
});
