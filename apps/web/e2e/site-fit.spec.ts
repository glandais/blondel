/**
 * Adéquation au site dans l'inspecteur « sans sélection » (ADR-0010, sous-lot 3b) : la liste
 * « Adéquation au site » du bloc Contrôle de conception lit `Model.siteFit` sans l'échappée
 * (déjà en carte de règle ECHAPPEE_*). Exemple j3a (limons bois) : le limon côté extérieur
 * affleure le bord de la trémie et passe sous la dalle haute à la marche 14 (avertissement).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { instrument, openApp, settle } from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const J3A = fileURLToPath(
  new URL("../../../examples/j3a-acceptance-01-bois.blondel.json", import.meta.url),
);

async function importProject(page: Page, file: string, name: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: "application/json", buffer: readFileSync(file) });
  await settle(page);
}

test("liste « Adéquation au site » : dalle en avertissement, échappée non répétée", async ({
  page,
}) => {
  await openApp(page);
  await importProject(page, J3A, "j3a.blondel.json");
  const inspector = page.getByRole("complementary", { name: "Inspecteur" });
  const list = inspector.getByRole("list", { name: "Conflits d'adéquation au site" });
  await expect(list).toBeVisible();
  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute("data-severity", "avertissement");
  await expect(items.first().locator("strong")).toHaveText("Avertissement");
  await expect(items.first()).toContainText(
    "La structure passe sous la dalle haute hors de la trémie au droit de la marche 14",
  );
  // L'échappée reste dans les cartes de règles, pas dans cette liste.
  await expect(list).not.toContainText("Échappée");
  await expect(inspector.locator('.rule-card[data-rule="ECHAPPEE_RECO_PRIVATIF"]')).toHaveCount(1);
});
