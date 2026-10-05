/**
 * Contrôle « Auto | Imposer » (ADR-0009, spécification de contenu § 1) sur « Nombre de
 * hauteurs n » : valeur calculée affichée à côté d'« Auto », « Imposer » donne le focus au champ
 * avec cette valeur, saisie validée par Entrée, Échap rétablit, chaque étape annulable, clic sur
 * la valeur calculée pour l'imposer, « Auto » rend la main au calcul.
 */
import { expect, test } from "@playwright/test";
import { applyPreset, instrument, openApp, openSection, settle } from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test("nombre de hauteurs : Auto, Imposer, saisie, Échap, annuler, retour à Auto", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await openSection(page, "Découpage");
  const label = "Nombre de hauteurs n";
  const group = page.getByRole("group", { name: label });
  const auto = group.getByRole("button", { name: `${label} : automatique` });
  const impose = group.getByRole("button", { name: "Imposer", exact: true });
  const input = page.getByRole("textbox", { name: label, exact: true });
  const computedButton = page.getByRole("button", {
    name: new RegExp(`^${label} : imposer \\d+$`),
  });
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });

  // Mode Auto : valeur calculée par le cœur affichée (« n hauteurs calculées »), aucun champ.
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await expect(input).toHaveCount(0);
  await expect(computedButton).toHaveText(/^\d+ hauteurs calculées$/);
  const n = Number(/\d+/.exec((await computedButton.textContent()) ?? "")![0]);
  expect(n).toBeGreaterThanOrEqual(2);

  // Imposer : la valeur calculée est fixée, le focus passe dans le champ.
  await impose.click();
  await settle(page);
  await expect(impose).toHaveAttribute("aria-pressed", "true");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(String(n));

  // Saisie validée par Entrée.
  await input.fill(String(n - 1));
  await input.press("Enter");
  await settle(page);
  await expect(input).toHaveValue(String(n - 1));

  // Échap rétablit la valeur en cours.
  await input.fill("42");
  await input.press("Escape");
  await expect(input).toHaveValue(String(n - 1));

  // Annuler : la saisie, puis l'imposition (retour à Auto).
  await undo.click();
  await settle(page);
  await expect(input).toHaveValue(String(n));
  await undo.click();
  await settle(page);
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await expect(input).toHaveCount(0);

  // Clic sur la valeur calculée : imposée telle quelle ; « Auto » rend la main au calcul.
  await computedButton.click();
  await settle(page);
  await expect(input).toHaveValue(String(n));
  await auto.click();
  await settle(page);
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await expect(input).toHaveCount(0);
  await expect(computedButton).toHaveText(`${n} hauteurs calculées`);
});
