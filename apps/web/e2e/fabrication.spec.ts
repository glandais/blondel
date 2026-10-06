/**
 * Mode Fabrication (ADR-0009, vague 4 ; wireframe « Parcours libre · Fabrication, avec retour
 * vers la Conception ») : pièce choisie gardée d'un espace à l'autre, liste des pièces par
 * famille et filtre, réglage d'atelier modifié sur place puis annulé, « Ouvrir dans
 * Conception », valeurs ◆ à valider (bande, rail, annulation, « Tout valider »), dossier PDF
 * généré malgré des ◆ restantes, fiche de pose, nomenclature, comparateur, coût, Échap.
 */
import { readFile } from "node:fs/promises";
import { constants, inflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyPreset,
  chooseStructure,
  openApp,
  openTab,
  openWorkspace,
  sectionTab,
  settle,
  viewTab,
  type SectionName,
} from "./support.js";

const aside = (page: Page): Locator => page.locator("aside.fab-aside");
const sheet = (page: Page): Locator => page.getByRole("region", { name: "Pièce choisie" });
const partsList = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Pièces par famille" });
const partInspector = (page: Page): Locator => page.locator('.inspector[data-template="part"]');
const undoButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });

/** Déplie le groupe `group` de la liste des pièces (s'il ne l'est pas) et rend ses repères. */
async function openGroup(page: Page, group: string): Promise<Locator> {
  const head = partsList(page).getByRole("button", { name: new RegExp(`^${group}\\b`) });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return partsList(page).getByRole("list", { name: `Repères : ${group}` });
}

/** Choisit le premier repère du groupe `group` ; rend le repère et l'identifiant de la pièce. */
async function chooseFirstPart(page: Page, group: string): Promise<{ mark: string; id: string }> {
  await openTab(page, "Pièces");
  const marks = await openGroup(page, group);
  const button = marks.getByRole("button").first();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const mark = ((await button.locator("strong").textContent()) ?? "").trim();
  expect(mark).not.toBe("");
  await expect(sheet(page).locator(".fab-sheet__mark")).toHaveText(mark);
  const id = await sheet(page).getAttribute("data-part");
  expect(id).not.toBeNull();
  return { mark, id: id! };
}

/**
 * Texte brut des flux d'un PDF (flux FlateDecode décompressés, les autres tels quels), lu en
 * latin1 : assez pour retrouver les chaînes écrites par jsPDF (`(…) Tj`).
 */
function pdfStreams(bytes: Buffer): string {
  const src = bytes.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const start = m.index + m[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = bytes.subarray(start, end);
    try {
      out.push(inflateSync(chunk, { finishFlush: constants.Z_SYNC_FLUSH }).toString("latin1"));
    } catch {
      out.push(chunk.toString("latin1"));
    }
    re.lastIndex = end + "endstream".length;
  }
  return out.join("\n");
}

/** « à » tel que jsPDF peut l'écrire dans une chaîne PDF (octet latin1 ou échappement octal). */
const A_GRAVE = "(?:à|\\340)";

/** Nombre de valeurs ◆ restantes lu dans la bande de chiffres. */
async function bandRemaining(page: Page): Promise<number> {
  const text = (await page.locator(".fab-figures__remaining").textContent()) ?? "";
  const m = /◆\s*(\d+)/.exec(text);
  if (!m) throw new Error(`bande : « ${text} »`);
  return Number(m[1]);
}

/** Compteur ◆ du rail pour une section (0 s'il est vide) ; bascule en Conception. */
async function railCount(page: Page, section: SectionName): Promise<number> {
  await openWorkspace(page, "Conception");
  const text = ((await sectionTab(page, section).locator(".rail__count").textContent()) ?? "")
    .replace(/\s/g, "")
    .replace("◆", "");
  return text === "" ? 0 : Number(text);
}

test.describe.configure({ retries: 1 });

test("pièce gardée d'un espace à l'autre ; groupes par famille et filtre", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-flat");

  // Fabrication : colonne de pièces, bande de chiffres, pièce choisie au centre.
  await openTab(page, "Pièces");
  await expect(page.locator(".fab-figures")).toContainText(/\d+ pièces · \d+ kg · EXC\d/);
  // La bande affiche la classe d'exécution : la mention du contrôle reste visible.
  await expect(
    aside(page).getByText(
      "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
    ),
  ).toBeVisible();
  await expect(sheet(page)).toContainText("Choisissez une pièce dans la liste.");
  const { mark, id } = await chooseFirstPart(page, "Limons");
  await expect(page.getByLabel(`Développé de la pièce ${mark}`)).toBeVisible();
  await expect(sheet(page).locator(".fab-sheet__drawing .svg-export svg")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /DXF R12/ })).toBeEnabled();
  await expect(aside(page).locator(".fab-aside__body")).toHaveAttribute("data-part", id);

  // Conception : l'inspecteur Pièce (2b) montre la même pièce.
  await openWorkspace(page, "Conception");
  await expect(partInspector(page).locator(".insp-template--part")).toHaveAttribute(
    "data-part",
    id,
  );
  // Et inversement : une autre pièce choisie en Conception (« Assemblée avec ») est ouverte en
  // Fabrication, son repère enfoncé dans la liste.
  const link = partInspector(page)
    .getByRole("list", { name: "Assemblée avec" })
    .getByRole("button")
    .first();
  const other = await link.getAttribute("data-part");
  expect(other).not.toBe(id);
  await link.click();
  await settle(page);
  await openWorkspace(page, "Fabrication");
  await expect(viewTab(page, "Pièces")).toHaveAttribute("aria-selected", "true");
  await expect(sheet(page)).toHaveAttribute("data-part", other!);
  await expect(partsList(page).locator('.fab-mark[aria-pressed="true"]')).toHaveCount(1);

  // Filtre : repère (celui du limon choisi plus haut, en minuscules), matériau, puis une
  // correspondance absente, puis effacé.
  const groups = partsList(page).locator(".fab-group");
  const all = await groups.count();
  expect(all).toBeGreaterThan(1);
  const filter = partsList(page).getByPlaceholder("Filtrer : repère, matériau…");
  await filter.fill(mark.toLowerCase());
  await expect(
    partsList(page).getByRole("button", { name: new RegExp(`^${mark}\\b`) }),
  ).toBeVisible();
  // Désignations comprises (« Cornière soudée sous M1 (LI1) ») : supports possibles aussi.
  await expect(groups.filter({ hasText: "Limons" })).toHaveCount(1);
  expect(await groups.count()).toBeLessThan(all);
  await filter.fill("acier");
  await expect(groups.first()).toBeVisible();
  expect(await groups.count()).toBeLessThanOrEqual(all);
  for (const head of await partsList(page).locator(".fab-group__head").all()) {
    await expect(head).toHaveAttribute("aria-expanded", "true");
  }
  await filter.fill("zzzz");
  await expect(partsList(page)).toContainText("Aucune pièce ne correspond au filtre.");
  await expect(groups).toHaveCount(0);
  await filter.fill("");
  await expect(groups).toHaveCount(all);

  // Échap (hors saisie) efface la sélection : invitations à choisir une pièce.
  await viewTab(page, "Pièces").focus();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toContainText("Choisissez une pièce dans la liste.");
  await expect(aside(page)).toContainText(
    "Choisissez une pièce dans la liste : ses réglages d'atelier et sa forme s'affichent ici.",
  );
});

test("réglage d'atelier modifié sur place puis annulé ; « Ouvrir dans Conception »", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-curved");
  const { mark, id } = await chooseFirstPart(page, "Limons");

  // Colonne de droite : réglages d'atelier de la pièce (niveau Atelier), note de portée.
  const settings = aside(page).getByRole("region", {
    name: `Réglages d'atelier de la pièce ${mark}`,
  });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("Réglages d'atelier de la pièce");
  await expect(settings).toContainText(
    "Modifiés ici, ils s'appliquent à toute la structure (section Structure).",
  );
  const field = settings.getByRole("textbox").first();
  const before = await field.inputValue();
  const next = String(Number(before.replace(/\s/g, "").replace(",", ".")) + 5);
  await field.fill(next);
  await field.press("Enter");
  await settle(page);
  await expect(field).toHaveValue(next);
  await expect(undoButton(page)).toBeEnabled();
  await undoButton(page).click();
  await settle(page);
  await expect(field).toHaveValue(before);

  // Encart « Forme du limon » : retour vers la Conception, panneau Structure, même pièce.
  const shape = aside(page).getByRole("region", { name: "Forme du limon" });
  await expect(shape).toContainText("Épaisseur, rives, jour : réglages de conception.");
  await shape.getByRole("button", { name: "Ouvrir dans Conception" }).click();
  await settle(page);
  await expect(page.locator(".app")).toHaveAttribute("data-workspace", "design");
  await expect(sectionTab(page, "Structure")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#free-panel")).toBeVisible();
  await expect(partInspector(page).locator(".insp-template--part")).toHaveAttribute(
    "data-part",
    id,
  );
});

test("valeurs ◆ à valider : bande et rail, annulation, « Tout valider » en une action", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-flat");
  await openTab(page, "Pièces");
  const n = await bandRemaining(page);
  expect(n).toBeGreaterThan(0);

  // Le compteur de la bande ouvre l'onglet « À valider ».
  await page.locator(".fab-figures__remaining").click();
  await expect(viewTab(page, "À valider")).toHaveAttribute("aria-selected", "true");
  const list = page.getByRole("region", { name: "Valeurs ◆ à valider" });
  await expect(list.getByRole("status")).toHaveText(`◆ ${n} restantes`);

  // Première ligne restante et calculable : sa section, son compteur dans le rail.
  const row = list
    .locator("tbody tr")
    .filter({ has: page.locator('input[type="checkbox"]:not([disabled]):not(:checked)') })
    .first();
  const section = ((await row.locator(".tv-list__section").textContent()) ?? "").trim();
  const box = row.getByRole("checkbox", { name: /^Valider : / });
  const boxName = (await box.getAttribute("aria-label")) ?? "";
  const k = await railCount(page, section as SectionName);
  expect(k).toBeGreaterThan(0);
  await openWorkspace(page, "Fabrication");
  await expect(viewTab(page, "À valider")).toHaveAttribute("aria-selected", "true");

  // Valider : la bande et le rail baissent de 1.
  const checkbox = list.getByRole("checkbox", { name: boxName, exact: true });
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  expect(await bandRemaining(page)).toBe(n - 1);
  await expect(list.getByRole("status")).toHaveText(
    n - 1 > 1 ? `◆ ${n - 1} restantes` : n - 1 === 1 ? "◆ 1 restante" : /validées/,
  );
  expect(await railCount(page, section as SectionName)).toBe(k - 1);

  // Ctrl+Z (hors champ de saisie) : les compteurs remontent.
  await sectionTab(page, "Site").focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  expect(await railCount(page, section as SectionName)).toBe(k);
  await openWorkspace(page, "Fabrication");
  expect(await bandRemaining(page)).toBe(n);
  await expect(checkbox).not.toBeChecked();

  // Ctrl+Z depuis la case elle-même (le focus reste sur la case après le clic).
  await checkbox.check();
  expect(await bandRemaining(page)).toBe(n - 1);
  await checkbox.press("Control+z");
  await expect(checkbox).not.toBeChecked();
  expect(await bandRemaining(page)).toBe(n);

  // « Tout valider » : une seule action, annulée d'un coup.
  const disabled = await list.locator('input[type="checkbox"][disabled]').count();
  await list.getByRole("button", { name: "Tout valider" }).click();
  expect(await bandRemaining(page)).toBe(disabled);
  if (disabled === 0) {
    await expect(list.getByRole("status")).toHaveText("Toutes les valeurs ◆ sont validées");
  }
  await undoButton(page).click();
  await settle(page);
  expect(await bandRemaining(page)).toBe(n);

  // Lien d'une ligne : section ouverte en Conception, champ de la valeur atteint (repli déplié,
  // focus).
  await row.getByRole("button", { name: /^Ouvrir / }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-workspace", "design");
  await expect(sectionTab(page, section as SectionName)).toHaveAttribute("aria-selected", "true");
  const focused = page.locator(".free-panel [data-param] :focus");
  await expect(focused).toHaveCount(1);
  await expect(focused).toBeVisible();
});

test("sorties : dossier PDF malgré des ◆ restantes, fiche de pose, coût ; nomenclature et comparateur", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "steel-flat");
  await openTab(page, "Pièces");
  // Pas de menu « Exporter » dans la barre du haut en Fabrication.
  await expect(page.locator(".topbar").getByRole("button", { name: /^Exporter/ })).toHaveCount(0);
  const n = await bandRemaining(page);
  expect(n).toBeGreaterThan(0);

  const outputs = aside(page).getByRole("region", { name: "Sorties" });
  await expect(outputs).toContainText("Dossier PDF");
  const open = outputs.getByRole("button", { name: "Générer…" });
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  const form = outputs.getByRole("group", { name: "Options du dossier PDF" });
  await form.getByRole("radiogroup", { name: "Format" }).getByRole("radio", { name: "A3" }).click();
  await form
    .getByRole("radiogroup", { name: "Gabarits 1:1" })
    .getByRole("radio", { name: "Limons et structure" })
    .click();
  await expect(form).toContainText(
    `◆ ${n} restante${n > 1 ? "s" : ""} : listée${n > 1 ? "s" : ""} dans le dossier, la génération n'est pas bloquée.`,
  );
  const generate = form.getByRole("button", { name: "Générer le dossier" });
  await expect(generate).toBeEnabled();
  const pending = page.waitForEvent("download");
  await generate.click();
  const pdf = await pending;
  expect(pdf.suggestedFilename()).toMatch(/a3\.pdf$/);
  const bytes = await readFile((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(20_000);
  // Le dossier produit par l'application (worker) contient la page « Valeurs à valider » et le
  // décompte des valeurs restantes.
  const text = pdfStreams(bytes);
  expect(text).toMatch(new RegExp(`Valeurs ${A_GRAVE} valider`));
  expect(text).toMatch(new RegExp(`0 valid\\S* \\S* ${n} restante`));

  // Fiche de pose (PDF) et liste de débit (CSV).
  const pose = page.waitForEvent("download");
  await outputs.getByRole("button", { name: "Fiche de pose (PDF)" }).click();
  expect((await pose).suggestedFilename()).toMatch(/\.pdf$/);
  const cut = page.waitForEvent("download");
  await outputs.getByRole("button", { name: "Liste de débit (CSV)" }).click();
  expect((await cut).suggestedFilename()).toMatch(/\.csv$/);

  // Coût estimé : barème incomplet par défaut → lien vers le profil d'atelier.
  await expect(outputs).toContainText("Coût estimé");
  await outputs
    .getByRole("button", { name: /^Compléter le profil d'atelier \(\d+ \/ 9\)$/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Profil d'atelier" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Nomenclature et Comparer atteignables.
  await openTab(page, "Nomenclature");
  await expect(page.locator("#view-panel table").first()).toBeVisible();
  await openTab(page, "Comparer");
  await expect(page.locator(".compare caption")).toContainText(" ms)");
});
