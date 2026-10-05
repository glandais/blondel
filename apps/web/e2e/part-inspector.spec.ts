/**
 * Inspecteur « Pièce » (maquette 2b, ADR-0009, vague 3) : une pièce cliquée en 3D ouvre le
 * gabarit Pièce ; « Développé → » bascule en Fabrication sur le développé de la pièce ;
 * « Isoler en 3D » / « Tout réafficher » (isolation partagée avec la vue 3D) ; un réglage
 * d'atelier modifié depuis l'inspecteur est annulable (Ctrl+Z) ; un lien « Assemblée avec »
 * sélectionne une autre pièce.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { applyPreset, chooseStructure, openApp, openTab, settle, viewTab } from "./support.js";

test.describe.configure({ retries: 1 });

/** Clique dans le canevas 3D, décalé du centre (le cadrage initial vise le centre de l'escalier). */
async function clickCanvas(page: Page, dx = 0, dy = 0): Promise<void> {
  const box = await page.locator(".viewer3d canvas").boundingBox();
  if (!box) throw new Error("canevas 3D introuvable");
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await settle(page);
}

const partInspector = (page: Page): Locator => page.locator('.inspector[data-template="part"]');

/**
 * Sélectionne en 3D une pièce qui a un développé (bouton « Développé » actif) : essaie
 * quelques points du canevas (limons de part et d'autre des marches).
 */
async function selectFlatPartIn3d(page: Page): Promise<Locator> {
  const offsets: readonly [number, number][] = [
    [0, 0],
    [-60, 0],
    [60, 0],
    [-120, 20],
    [120, 20],
    [-90, -40],
    [90, -40],
    [-40, 60],
    [40, 60],
  ];
  const inspector = partInspector(page);
  for (const [dx, dy] of offsets) {
    await clickCanvas(page, dx, dy);
    if ((await inspector.count()) === 0) continue;
    const flat = inspector.getByRole("button", { name: /^Développé/ });
    if (await flat.isEnabled()) return inspector;
  }
  throw new Error("aucune pièce à développé trouvée dans le canevas 3D");
}

test("pièce choisie dans les développés : DXF R12 téléchargé, pièces regroupées", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-flat");
  // Sélection déterministe : liste des pièces à développé (Fabrication).
  await openTab(page, "Développés");
  await page
    .getByRole("navigation", { name: "Pièces à développé" })
    .getByRole("button")
    .first()
    .click();
  const inspector = partInspector(page);
  await expect(inspector).toBeVisible();
  const mark = (await inspector.locator(".insp-title").textContent())?.trim() ?? "";
  const dxf = inspector.getByRole("button", { name: /DXF R12/ });
  await expect(dxf).toBeEnabled();
  const download = page.waitForEvent("download");
  await dxf.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.dxf$/);
  expect(file.suggestedFilename()).toContain(mark);
  // « Assemblée avec » : supports identiques regroupés en une ligne (« CR1–CRn … ×k »).
  const links = inspector.getByRole("list", { name: "Assemblée avec" });
  if ((await links.count()) > 0) {
    await expect(links.getByRole("button", { name: /×\d+/ }).first()).toBeVisible();
  }
});

test("marche cliquée en 3D → inspecteur Marche ; pièce de marche → lien vers la marche", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await openTab(page, "3D");
  const inspector = page.getByRole("complementary", { name: "Inspecteur" });
  const offsets: readonly [number, number][] = [
    [0, 0],
    [0, -30],
    [0, 30],
    [-40, 0],
    [40, 0],
    [0, -60],
    [0, 60],
  ];
  for (const [dx, dy] of offsets) {
    await clickCanvas(page, dx, dy);
    if ((await inspector.getAttribute("data-template")) === "tread") break;
  }
  await expect(inspector).toHaveAttribute("data-template", "tread");
  await expect(inspector.getByRole("region", { name: "Ligne de nez" })).toBeVisible();
  const n = await inspector.locator("[data-tread-number]").getAttribute("data-tread-number");
  // « Pièces de cette marche » → 2b de la marche → « Marche n et ligne de nez » → 2a.
  await inspector
    .getByRole("list", { name: "Pièces de cette marche" })
    .getByRole("button")
    .first()
    .click();
  await expect(inspector).toHaveAttribute("data-template", "part");
  await inspector.getByRole("button", { name: `Marche ${n} et ligne de nez` }).click();
  await expect(inspector).toHaveAttribute("data-template", "tread");
  await expect(inspector.locator(`[data-tread-number="${n}"]`)).toBeVisible();
});

test("inspecteur Pièce : sélection 3D, développé, isolation, réglage annulable, voisins", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-flat");
  await openTab(page, "3D");

  // Pièce cliquée en 3D → gabarit Pièce : repère, valeurs, mention.
  const inspector = await selectFlatPartIn3d(page);
  await expect(inspector).toBeVisible();
  const template = inspector.locator(".insp-template--part");
  const partId = await template.getAttribute("data-part");
  expect(partId).not.toBeNull();
  const mark = (await inspector.locator(".insp-title").textContent())?.trim() ?? "";
  expect(mark).not.toBe("");
  await expect(inspector.locator(".insp-eyebrow")).toHaveText(/^Pièce/);
  await expect(inspector.getByRole("table", { name: `Valeurs de la pièce ${mark}` })).toContainText(
    "Matériau",
  );
  await expect(inspector.locator(".inspector-disclaimer")).toHaveText(
    "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
  );

  // « Développé → » : Fabrication, onglet Développés, développé de la pièce affiché.
  await inspector.getByRole("button", { name: /^Développé/ }).click();
  await settle(page);
  await expect(viewTab(page, "Développés")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel(`Développé de la pièce ${mark}`)).toBeVisible();
  // La sélection reste la pièce : l'inspecteur Pièce reste ouvert.
  await expect(partInspector(page).locator(".insp-template--part")).toHaveAttribute(
    "data-part",
    partId!,
  );

  // « Isoler en 3D » : retour en Conception, vue 3D, pièce isolée ; « Tout réafficher ».
  await partInspector(page).getByRole("button", { name: "Isoler en 3D" }).click();
  await settle(page);
  await expect(viewTab(page, "3D")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Tout afficher" })).toBeVisible();
  const showAll = partInspector(page).getByRole("button", { name: "Tout réafficher" });
  await expect(showAll).toHaveAttribute("aria-pressed", "true");
  await showAll.click();
  await settle(page);
  await expect(page.getByRole("button", { name: "Isoler la pièce" })).toBeVisible();
  await expect(partInspector(page).getByRole("button", { name: "Isoler en 3D" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Réglage d'atelier modifié depuis l'inspecteur, puis annulé (Ctrl+Z).
  const settings = partInspector(page).getByRole("region", {
    name: `Réglages d'atelier de la pièce ${mark}`,
  });
  await expect(settings).toBeVisible();
  const field = settings.getByRole("textbox").first();
  const before = await field.inputValue();
  const next = String(Number(before.replace(/\s/g, "")) + 5);
  await field.fill(next);
  await field.press("Enter");
  await settle(page);
  await expect(field).toHaveValue(next);
  // Raccourci hors des champs (focus sur un onglet de vue).
  await viewTab(page, "3D").focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(field).toHaveValue(before);

  // « Assemblée avec » : un lien sélectionne une autre pièce (inspecteur Pièce de cette pièce).
  const links = partInspector(page).getByRole("list", { name: "Assemblée avec" });
  await expect(links).toBeVisible();
  const link = links.getByRole("button").first();
  const other = await link.getAttribute("data-part");
  expect(other).not.toBe(partId);
  await link.click();
  await settle(page);
  await expect(partInspector(page).locator(".insp-template--part")).toHaveAttribute(
    "data-part",
    other!,
  );
});
