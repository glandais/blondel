/**
 * Petits écrans (ADR-0009 point 3, vague 6) :
 *
 * - 1 100 px : inspecteur en colonne, pas de tiroir, aucun défilement horizontal ;
 * - 760 px : libre disponible ; une sélection ouvre le tiroir de l'inspecteur, Échap le ferme et
 *   garde la sélection, le badge Contrôle l'ouvre sur la 2d ; tiroir fermé, la mention indicative
 *   reste visible sous la vue (760 et 1 024 px) ;
 * - 390 px : guidé imposé même si le libre était mémorisé, option Libre désactivée et expliquée
 *   en clair,
 *   barre d'étapes défilante (étape 7 atteignable au clavier), vue au-dessus du formulaire ;
 *   retour à 1 440 px : le libre est rétabli.
 *
 * Jamais de défilement horizontal du document (`scrollWidth` ≤ largeur de la fenêtre).
 */
import { expect, test } from "@playwright/test";
import {
  applyPreset,
  documentScrollWidth,
  inspectorPanel,
  journeyRadio,
  openApp,
  selectTreadOnPlan,
  setWidth,
} from "./support.js";

const DISCLAIMER = "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.";

test("1 100 px : inspecteur en colonne, pas de tiroir, pas de défilement horizontal", async ({
  page,
}) => {
  await openApp(page);
  await setWidth(page, 1100, 800);
  const app = page.locator(".app");
  await expect(app).toHaveAttribute("data-journey", "free");
  await expect(app).not.toHaveAttribute("data-inspector", /.*/);
  const inspector = inspectorPanel(page);
  await expect(inspector).toBeVisible();
  await expect(inspector).not.toHaveAttribute("data-drawer", /.*/);
  await expect(page.getByRole("button", { name: "Fermer l'inspecteur" })).toHaveCount(0);
  // Inspecteur à droite de la vue, sans la recouvrir.
  const view = (await page.locator("#view-panel").boundingBox())!;
  const insp = (await inspector.boundingBox())!;
  expect(insp.x).toBeGreaterThanOrEqual(view.x + view.width - 1);
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(1100);
  // Ligne de chiffres sur une seule ligne, panneau ouvert compris.
  await page.locator("#rail-tab-stepping").click();
  const line = (await page.locator(".figure-line").boundingBox())!;
  expect(line.height).toBeLessThan(30);
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(1100);
});

test("760 px : tiroir de l'inspecteur ouvert par la sélection, fermé par Échap ; badge Contrôle → 2d", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await setWidth(page, 760, 900);
  const app = page.locator(".app");
  await expect(app).toHaveAttribute("data-journey", "free");
  await expect(journeyRadio(page, "Libre")).toBeEnabled();
  await expect(app).toHaveAttribute("data-inspector", "closed");
  const inspector = inspectorPanel(page);
  await expect(inspector).toBeHidden();
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(760);
  // Tiroir fermé : la mention indicative du pied de l'inspecteur reste visible sous la vue,
  // à 760 comme à 1 024 px.
  for (const width of [760, 1024]) {
    await setWidth(page, width, 900);
    await expect(app).toHaveAttribute("data-inspector", "closed");
    await expect(page.locator(".workarea__disclaimer")).toBeVisible();
    await expect(page.locator(".workarea__disclaimer")).toHaveText(DISCLAIMER);
  }
  await setWidth(page, 760, 900);

  // Sélection d'une marche du plan : le tiroir s'ouvre sur l'inspecteur Marche.
  await selectTreadOnPlan(page, 3);
  await expect(app).toHaveAttribute("data-inspector", "open");
  await expect(inspector).toBeVisible();
  const close = page.getByRole("button", { name: "Fermer l'inspecteur" });
  await expect(close).toBeVisible();
  // Tiroir par-dessus la vue, sous la barre du haut, à droite.
  const box = (await inspector.boundingBox())!;
  const top = (await page.locator(".topbar").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
  expect(Math.round(box.x + box.width)).toBe(760);
  expect(Math.round(box.width)).toBe(340);
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(760);

  // Échap : le tiroir se ferme, la sélection reste (marche toujours surlignée).
  await page.locator("#view-panel").focus();
  await page.keyboard.press("Escape");
  await expect(app).toHaveAttribute("data-inspector", "closed");
  await expect(inspector).toBeHidden();
  await expect(inspector).toHaveAttribute("data-template", "tread");
  // Échap suivant : la sélection s'efface.
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveAttribute("data-template", "project");

  // Croix « Fermer l'inspecteur » après une nouvelle sélection.
  await selectTreadOnPlan(page, 2);
  await close.click();
  await expect(app).toHaveAttribute("data-inspector", "closed");

  // Badge Contrôle : tiroir ouvert sur l'inspecteur sans sélection (2d), bloc de contrôle montré.
  await page.locator(".control-badge").click();
  await expect(app).toHaveAttribute("data-inspector", "open");
  await expect(inspector).toHaveAttribute("data-template", "project");
  await expect(page.locator(".inspector-control__title")).toBeVisible();
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(760);

  // Fabrication : colonne de droite empilée, pas de défilement horizontal.
  await page
    .getByRole("radiogroup", { name: "Espace de travail" })
    .getByRole("radio", { name: "Fabrication", exact: true })
    .click();
  await expect(page.locator(".fab-aside")).toBeAttached();
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(760);
});

test("390 px : guidé imposé, Libre désactivé et expliqué, étapes défilantes, vue au-dessus ; retour à 1 440 px", async ({
  page,
}) => {
  // Libre mémorisé (openApp), puis fenêtre étroite.
  await openApp(page);
  await expect(page.locator('.app[data-journey="free"]')).toBeVisible();
  await setWidth(page, 390, 844);
  const app = page.locator(".app");
  await expect(app).toHaveAttribute("data-journey", "guided");
  const free = journeyRadio(page, "Libre");
  await expect(free).toBeDisabled();
  await expect(free).toHaveAttribute(
    "title",
    "Parcours libre disponible à partir de 760 px de large.",
  );
  await expect(page.getByRole("radiogroup", { name: "Parcours" })).toHaveAccessibleDescription(
    "Parcours libre disponible à partir de 760 px de large.",
  );
  // Explication lisible sans survol (téléphone) : en clair dans la barre du haut.
  await expect(page.locator(".topbar__journey-note")).toBeVisible();
  await expect(page.locator(".topbar__journey-note")).toHaveText(
    "Parcours libre disponible à partir de 760 px de large.",
  );
  // La préférence mémorisée reste « libre ».
  const stored = await page.evaluate(() => localStorage.getItem("blondel.ui.journey"));
  expect(JSON.parse(stored ?? "{}")).toMatchObject({ journey: "free" });
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(390);

  // Barre d'étapes défilante : Fin puis Entrée, l'étape 7 est choisie et visible.
  const current = page.locator('.step-bar [role="tab"][aria-selected="true"]');
  await current.focus();
  await page.keyboard.press("End");
  const last = page.locator("#step-tab-7");
  await expect(last).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect(last).toBeInViewport({ ratio: 0.9 });
  const list = (await page.locator(".step-bar__list").boundingBox())!;
  const tab = (await last.boundingBox())!;
  expect(tab.x).toBeGreaterThanOrEqual(list.x - 1);
  expect(tab.x + tab.width).toBeLessThanOrEqual(list.x + list.width + 1);
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(390);

  // Retour à l'étape 1 : vue au-dessus du formulaire.
  await page.locator("#step-tab-1").click();
  const view = (await page.locator(".guided-view").boundingBox())!;
  const form = (await page.locator(".guided-form").boundingBox())!;
  expect(view.y + view.height).toBeLessThanOrEqual(form.y + 1);
  expect(view.height).toBeGreaterThanOrEqual(280);
  expect(await documentScrollWidth(page)).toBeLessThanOrEqual(390);
  // Pied : mention indicative présente.
  await expect(page.locator(".guided-footer__disclaimer")).toHaveText(
    "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
  );

  // Retour à une fenêtre large : le libre est rétabli.
  await setWidth(page, 1440, 900);
  await expect(app).toHaveAttribute("data-journey", "free");
  await expect(free).toBeEnabled();
  await expect(free).toHaveAttribute("aria-checked", "true");
});
