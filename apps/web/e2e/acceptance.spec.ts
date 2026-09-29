/**
 * Critère d'acceptation n° 1 de bout en bout (a) : depuis une page vierge, concevoir un quart
 * tournant bois (limons à la française) à poteau d'angle avec garde-corps, sans contrôle
 * bloquant, puis télécharger le dossier PDF et le plan DXF, en moins de 20 interactions.
 *
 * Interactions comptées (voir `Interactions`, journal joint au rapport) : choix et application
 * du préréglage (2), jour « Poteau » (1), structure (1), ouverture du panneau « Garde-corps »
 * (1), activation des garde-corps (1), côté extérieur contre un mur (1), menu « Exporter » et
 * entrée PDF (2), menu et entrée DXF (2) : 11.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import {
  Interactions,
  applyPreset,
  blockingCount,
  chooseStructure,
  openApp,
  settle,
} from "./support.js";

/** Plafond d'interactions du critère n° 1 (conception + exports). */
const MAX_INTERACTIONS = 20;

async function download(page: Page, entry: RegExp, ix: Interactions): Promise<Download> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Exporter/ }).click();
  ix.count("menu Exporter");
  const item = page.getByRole("menuitem", { name: entry });
  await expect(item).toBeEnabled();
  await item.click();
  ix.count(`export ${entry.source}`);
  return pending;
}

async function bytesOf(d: Download): Promise<Buffer> {
  const path = await d.path();
  return readFile(path);
}

test("critère n° 1 : quart tournant bois à poteau avec garde-corps, PDF et DXF", async ({
  page,
}, info) => {
  const ix = new Interactions();
  await openApp(page);

  // Tracé : quart tournant à gauche (préréglage), jour à poteau d'angle.
  await applyPreset(page, "Quart tournant à gauche", ix);
  await page.getByLabel("Jour", { exact: true }).selectOption("newel");
  ix.count("jour Poteau");
  await settle(page);
  await expect(page.getByLabel("Côté du poteau")).toHaveValue("100");

  // Structure bois : limons à la française.
  await chooseStructure(page, "wood-housed", ix);

  // Garde-corps : côté jour vide (automatique, aucun mur), côté extérieur contre un mur.
  await page.locator("summary", { hasText: "Garde-corps" }).click();
  ix.count("panneau Garde-corps");
  await page.getByLabel("Garde-corps et mains courantes").check();
  ix.count("garde-corps activés");
  await settle(page);
  await page.getByLabel("Côté extérieur").selectOption("wall");
  ix.count("côté extérieur : mur");
  await settle(page);

  // Conception conforme : aucun contrôle bloquant, pièces de garde-corps dans la nomenclature.
  const blocking = await blockingCount(page);
  const listed = await page
    .locator(".compliance .sev--bloquant code")
    .allTextContents()
    .catch(() => []);
  expect(blocking, `contrôles bloquants : ${listed.join(", ")}`).toBe(0);
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);
  await page.getByRole("tab", { name: "Nomenclature", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText(/[Bb]alustre/);
  await expect(page.getByRole("tabpanel")).toContainText(/[Pp]oteau/);

  // Exports : dossier PDF (worker de calcul) et plan coté DXF 2007.
  const pdf = await download(page, /^Dossier PDF complet \(gabarits 1:1 en A4\)/, ix);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfBytes = await bytesOf(pdf);
  expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(pdfBytes.subarray(-1024).toString("latin1")).toContain("%%EOF");
  expect(pdfBytes.length).toBeGreaterThan(10_000);

  const dxf = await download(page, /^Plan coté \(DXF 2007/, ix);
  expect(dxf.suggestedFilename()).toMatch(/\.dxf$/);
  const dxfText = (await bytesOf(dxf)).toString("utf8");
  // DXF lisible : paires code / valeur, en-tête AC1021, entités, fin de fichier.
  const lines = dxfText.split(/\r?\n/);
  expect(lines[0]?.trim()).toBe("0");
  expect(lines[1]?.trim()).toBe("SECTION");
  expect(dxfText).toContain("AC1021");
  expect(dxfText).toMatch(/\n\s*ENTITIES\r?\n/);
  expect(dxfText).toMatch(/\n\s*(LINE|LWPOLYLINE|POLYLINE)\r?\n/);
  expect(
    lines
      .filter((l) => l.trim() !== "")
      .at(-1)
      ?.trim(),
  ).toBe("EOF");

  await info.attach("interactions", {
    body: `${ix.total} interactions\n${ix.log.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
    contentType: "text/plain",
  });
  expect(ix.total).toBeLessThanOrEqual(MAX_INTERACTIONS);
});
