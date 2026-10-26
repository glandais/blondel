/**
 * Décisions de l'utilisateur du 2026-09-29 (QUESTIONS A14, A20, A23, A24) dans l'interface :
 * panneau « Profil d'atelier » (barème hors projet, euros du comparateur), dossiers PDF filtrés
 * par famille de gabarits, filtre des marqueurs 3D par famille de règles, mur tracé au nu par
 * un troisième clic ; tolérance d'identité des pièces repérées (réglage du projet, F10 (21)) dans
 * le même dialogue.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  openApp,
  openMoreMenu,
  openSection,
  openTab,
  openWorkspace,
  settle,
  useFreeJourney,
  viewTab,
} from "./support.js";

const RATES: readonly (readonly [RegExp, string])[] = [
  [/^Taux horaire/, "55"],
  [/^Temps par coupe/, "2"],
  [/^Temps par mètre de cordon/, "12"],
  [/^Temps par pli/, "1,5"],
  [/^Temps par perçage/, "0,5"],
  [/^Temps par pièce unique/, "10"],
  [/^Prix de l'acier/, "1,6"],
  [/^Prix du bois/, "1800"],
  [/^Finition/, "25"],
];

function costRow(page: Page) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /^Coût/ }) });
}

test("profil d'atelier : barème hors projet, euros du comparateur, persistance", async ({
  page,
}) => {
  await openApp(page);
  // Structure du projet parmi les variantes comparées : la colonne de Fabrication affiche le
  // coût de la variante courante (sans structure, aucune variante n'est courante : « – »).
  await chooseStructure(page, "wood-housed");
  await openTab(page, "Comparer");
  const costs = costRow(page).getByRole("cell");
  await expect(costs.first()).toBeVisible();
  for (const c of await costs.all()) await expect(c).not.toContainText("€");
  // Colonne de Fabrication (« Coût estimé ») : barème incomplet, lien vers le profil d'atelier.
  const outputs = page.getByRole("region", { name: "Sorties" });
  await expect(
    outputs.getByRole("button", { name: "Compléter le profil d'atelier (0 / 9)" }),
  ).toBeVisible();

  // Profil d'atelier : menu ⋯ « Plus d'options », bouton « Atelier… ».
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Atelier…" }).click();
  const dialog = page.getByRole("dialog", { name: "Profil d'atelier" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status", { name: "État du barème" })).toContainText(
    "Barème incomplet (0 / 9)",
  );
  // Aucune valeur par défaut.
  for (const [label] of RATES) await expect(dialog.getByLabel(label)).toHaveValue("");
  // Saisie invalide signalée.
  await dialog.getByLabel(/^Taux horaire/).fill("-3");
  await dialog.getByLabel(/^Taux horaire/).press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("Nombre positif ou nul attendu");
  for (const [label, v] of RATES) {
    await dialog.getByLabel(label).fill(v);
    await dialog.getByLabel(label).press("Enter");
  }
  await expect(dialog.getByRole("status", { name: "État du barème" })).toContainText(
    "coûts affichés",
  );
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Exporter (JSON)" }).click();
  expect((await pending).suggestedFilename()).toBe("bareme-atelier.json");
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(dialog).toBeHidden();

  await settle(page);
  await expect(costRow(page).getByRole("cell").filter({ hasText: "€" }).first()).toBeVisible();
  // Barème complet : la colonne de Fabrication affiche le coût de la variante courante ;
  // en Conception, l'inspecteur (sans sélection) renvoie au coût du comparateur.
  await expect(outputs.locator(".fab-cost__value")).toContainText("€");
  await openWorkspace(page, "Conception");
  const inspector = page.getByRole("complementary", { name: "Inspecteur" });
  await expect(
    inspector.getByRole("button", { name: "Voir le coût dans le comparateur" }),
  ).toBeVisible();
  // Sans structure, aucune variante n'est courante : la colonne de Fabrication renvoie au
  // comparateur (pas de « – »).
  await chooseStructure(page, "none");
  await openTab(page, "Pièces");
  await settle(page);
  await outputs.getByRole("button", { name: "Voir le coût dans le comparateur" }).click();
  await expect(viewTab(page, "Comparer")).toHaveAttribute("aria-selected", "true");

  // Barème mémorisé dans le navigateur, hors du projet : relu au rechargement.
  await page.reload();
  await expect(page.getByRole("toolbar", { name: "Barre d'outils" })).toBeVisible();
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Atelier…" }).click();
  await expect(page.getByLabel(/^Taux horaire/)).toHaveValue("55");
  await page.getByRole("button", { name: "Effacer le barème" }).click();
  await expect(page.getByLabel(/^Taux horaire/)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Profil d'atelier" })).toBeHidden();
  // Barème effacé : le lien de l'inspecteur rouvre le profil d'atelier.
  await openWorkspace(page, "Conception");
  const complete = inspector.getByRole("button", { name: "Compléter le profil d'atelier (0 / 9)" });
  await complete.click();
  await expect(page.getByRole("dialog", { name: "Profil d'atelier" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Profil d'atelier" })).toBeHidden();
});

test("profil d'atelier : tolérance d'identité du projet (F10 (21)), hors barème", async ({
  page,
}) => {
  await openApp(page);
  // Projet bois, sans pièce repérée : réglage éditable, sans ◆ ni rappel du représentant (38).
  await settle(page);
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Atelier…" }).click();
  const dialog = page.getByRole("dialog", { name: "Profil d'atelier" });
  const project = dialog.getByRole("group", {
    name: "Repérage des pièces (enregistré dans le projet)",
  });
  await expect(project.getByLabel("Tolérance d'identité des pièces repérées")).toHaveValue("0,5");
  await expect(project).not.toContainText("la plus courte");
  await expect(project).not.toContainText("aire nette");
  // Aide de T (G-Q9) : présente sur tout projet, comme le champ.
  await expect(project).toContainText("comparés sur ces facettes");
  await expect(project.locator(".tiered__item--tv")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(dialog).toBeHidden();

  await chooseStructure(page, "steel-flat");
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Atelier…" }).click();
  await expect(project).toBeVisible();
  await expect(project.locator(".tiered__item--tv")).toHaveCount(1);
  await expect(project).toContainText("la plus courte");
  // Limons plats : platines repérées (développés), second rappel (G-Q7).
  await expect(project).toContainText("la plus petite par l'aire nette");
  const field = project.getByLabel("Tolérance d'identité des pièces repérées");
  await expect(field).toHaveValue("0,5");
  await field.fill("0,3");
  await field.press("Enter");
  await settle(page);
  await expect(field).toHaveValue("0,3");
  // Le barème n'est pas touché.
  await expect(dialog.getByRole("status", { name: "État du barème" })).toContainText(
    "Barème incomplet (0 / 9)",
  );
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(dialog).toBeHidden();

  // Liste ◆ : valeur du projet ; annulation : défaut rétabli.
  await openTab(page, "À valider");
  const list = page.getByRole("region", { name: "Valeurs à valider", exact: true });
  const row = list.locator("tbody tr").filter({
    hasText: "Repérage des pièces · Tolérance d'identité des pièces repérées",
  });
  await expect(row.locator(".tv-list__value")).toHaveText(/^0,3\s?mm$/u);
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(row.locator(".tv-list__value")).toHaveText(/^0,5\s?mm$/u);
});

test("repérage (G-Q7) : une ligne ◆ par règle de représentant", async ({ page }) => {
  const TOLERANCE = "Repérage des pièces · Tolérance d'identité des pièces repérées";
  const BARS =
    "Repérage des pièces · Représentant d'un repère de barres (cornières, supports, garde-corps)";
  const AREA = "Repérage des pièces · Représentant d'un repère de développés ou de panneaux";
  await openApp(page);
  // Projet bois d'ouverture, sans garde-corps : aucune pièce repérée, aucune ligne ni réglage.
  await openTab(page, "À valider");
  const list = page.getByRole("region", { name: "Valeurs à valider", exact: true });
  await expect(list.locator("tbody tr").filter({ hasText: "Repérage des pièces" })).toHaveCount(0);
  await openWorkspace(page, "Conception");
  await openSection(page, "Structure");
  await expect(page.getByTestId("part-marks-settings")).toHaveCount(0);

  // Bois à garde-corps de verre : barres (poteaux, lisses, mains courantes) et panneaux.
  await applyPreset(page, "Quart tournant à palier, frêne et verre");
  await useFreeJourney(page);
  await openTab(page, "À valider");
  for (const [label, value] of [
    [TOLERANCE, /^0,5\s?mm$/u],
    [BARS, "la plus courte"],
    [AREA, "la plus petite par l'aire nette"],
  ] as const) {
    const row = list.locator("tbody tr").filter({ hasText: label });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".tv-list__value")).toHaveText(value);
    await expect(row.locator(".tv-list__section")).toHaveText("Structure");
  }
  // « Ouvrir » sur la ligne des panneaux mène à son rappel, dans la section Structure.
  await list
    .locator("tbody tr")
    .filter({ hasText: AREA })
    .getByRole("button", { name: /^Ouvrir / })
    .click();
  await expect(page.locator(".app")).toHaveAttribute("data-workspace", "design");
  const note = page.locator(
    '.free-panel [data-param="ui:workshop.markRepresentativeArea"] .part-marks__representative',
  );
  await expect(note).toBeFocused();
  await expect(note).toContainText("à confirmer par un atelier");

  // Dialogue « Atelier… » : les deux rappels.
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Atelier…" }).click();
  const dialog = page.getByRole("dialog", { name: "Profil d'atelier" });
  const project = dialog.getByRole("group", {
    name: "Repérage des pièces (enregistré dans le projet)",
  });
  await expect(project).toContainText("la plus courte");
  await expect(project).toContainText("la plus petite par l'aire nette");
  await dialog.getByRole("button", { name: "Fermer" }).click();
  await expect(dialog).toBeHidden();
});

test("export : dossiers PDF filtrés par famille de gabarits", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: /^Exporter/ }).click();
  for (const name of [
    "Dossier PDF complet (gabarits 1:1 en A4)",
    "Dossier PDF, gabarits 1:1 des limons et de la structure (A4)",
    "Dossier PDF, gabarits 1:1 des marches (A4)",
    "Dossier PDF, gabarits 1:1 des garde-corps (A4)",
  ]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  // Aucune pièce de garde-corps n'a de développé : entrée indisponible, motif en bulle.
  const guards = page.getByRole("menuitem", {
    name: "Dossier PDF, gabarits 1:1 des garde-corps (A4)",
    exact: true,
  });
  await expect(guards).toBeDisabled();
  await expect(guards).toHaveAttribute("title", /famille/);
});

test("vue 3D : filtre des marqueurs par famille de règles", async ({ page }) => {
  await openApp(page);
  await openTab(page, "3D");
  const families = page.getByRole("group", { name: "Familles de règles" });
  await expect(families).toBeVisible();
  const boxes = families.getByRole("checkbox");
  await expect(boxes).toHaveCount(3);
  for (const name of [/^Géométrie/, /^Fabrication/, /^Garde-corps/]) {
    const box = families.getByRole("checkbox", { name });
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect(box).not.toBeChecked();
  }
  // Toutes les familles masquées : aucune violation localisée affichée.
  await expect(page.locator(".viewer3d__controls")).toContainText("Aucune violation localisée");
  await families.getByRole("checkbox", { name: /^Garde-corps/ }).check();
  await expect(families.getByRole("checkbox", { name: /^Garde-corps/ })).toBeChecked();
});

/** Clique le point (x, y) du site (mm) : conversion par la matrice écran du SVG. */
async function sitePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.locator("svg.plan-site__svg").evaluate(
    (el, p) => {
      const s = el as SVGSVGElement;
      const pt = s.createSVGPoint();
      pt.x = p.x;
      pt.y = -p.y;
      const q = pt.matrixTransform(s.getScreenCTM()!);
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}

async function clickSite(page: Page, x: number, y: number): Promise<void> {
  const p = await sitePoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

test("site : mur tracé au nu, côté du mur donné par un troisième clic", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  await page.getByRole("button", { name: "Tracer un mur" }).click();
  await page.getByLabel("Épaisseur du mur tracé", { exact: true }).fill("200");
  const mode = page.getByLabel("Ligne tracée");
  await expect(mode.locator("option")).toHaveText([
    "Axe du mur",
    "Nu du mur (3e clic du côté du mur)",
  ]);
  await mode.selectOption({ label: "Nu du mur (3e clic du côté du mur)" });

  await clickSite(page, -300, 0);
  await clickSite(page, -300, 3000);
  await expect(page.getByRole("status").filter({ hasText: "cliquer du côté du mur" })).toHaveCount(
    1,
  );
  // Aperçu du mur du côté du pointeur (à gauche du nu, x < −300).
  const hover = await sitePoint(page, -800, 1500);
  await page.mouse.move(hover.x, hover.y);
  await expect(page.locator("polygon.plan-site__wall-preview")).toHaveCount(1);
  await clickSite(page, -800, 1500);
  await expect(page.getByRole("status").filter({ hasText: "Mur ajouté" })).toBeVisible();
  await settle(page);
  const wall = page.locator("polygon.plan-site__wall");
  await expect(wall).toHaveCount(1);
  await expect(wall.locator("title")).toHaveText(/200 mm/);
  // Mur entre x = −500 et −300 (nu sur la ligne tracée, corps du côté cliqué).
  const pts = (await wall.getAttribute("points"))!
    .trim()
    .split(/\s+/)
    .map((p) => p.split(",").map(Number) as [number, number]);
  const xs = pts.map(([x]) => x);
  // Nu à la résolution du pointeur près (une fraction de pixel du plan : l'échelle du dessin est
  // limitée par la hauteur utile sous l'accueil et les outils de saisie ; les deux clics peuvent
  // donc donner un nu très légèrement oblique), épaisseur exacte (distance entre les deux nus,
  // contour gauche a → b puis droit b → a), corps du côté cliqué.
  // Tolérance : 1 mm, ou un pixel du plan s'il est plus grand (l'accueil liste toutes les démos,
  // dix-neuf depuis le sous-lot K2h du limon coudé, et réduit la hauteur utile du plan).
  const pixelMm = await page
    .locator("svg.plan-site__svg")
    .evaluate((el) => 1 / Math.abs((el as SVGSVGElement).getScreenCTM()!.a));
  const [min, max] = [Math.min(...xs), Math.max(...xs)];
  expect(Math.abs(max - -300)).toBeLessThanOrEqual(Math.max(1, pixelMm));
  expect(min).toBeLessThan(-450);
  const [l0, , , r0] = pts as [[number, number], unknown, unknown, [number, number]];
  expect(Math.hypot(l0[0] - r0[0], l0[1] - r0[1])).toBeCloseTo(200, 3);
});
