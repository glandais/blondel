/**
 * Jalon 7 dans l'interface : plan « Site et saisie » — import d'un plan DXF (unité demandée
 * quand l'en-tête ne la donne pas), tracé de la trémie par clics avec accroche aux entités du
 * calque, relevé de trémie par 4 côtés + 2 diagonales, tracé d'un mur ; chaque saisie est
 * annulable et la trémie polygonale est reprise par le modèle (échappée, plan coté).
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, settle } from "./support.js";

/** DXF minimal sans `$INSUNITS` : un rectangle de 900 × 2 600 (unités : cm) et une diagonale. */
function dxfText(): string {
  const g = (...kv: (string | number)[]): string => kv.map(String).join("\n");
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    g(0, "LINE", 8, "MURS", 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0);
  return (
    [
      g(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1015", 0, "ENDSEC"),
      g(0, "SECTION", 2, "ENTITIES"),
      line(0, 100, 90, 100),
      line(90, 100, 90, 360),
      line(90, 360, 0, 360),
      line(0, 360, 0, 100),
      line(-30, 0, -30, 400),
      g(0, "ENDSEC", 0, "EOF"),
    ].join("\n") + "\n"
  );
}

async function openSite(page: Page): Promise<void> {
  await openApp(page);
  await openTab(page, "Plan 2D");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Outils de saisie du plan" })).toBeVisible();
}

/** Clique le point (x, y) du site (mm) : conversion par la matrice écran du SVG. */
async function clickSite(page: Page, x: number, y: number): Promise<void> {
  const svg = page.locator("svg.plan-site__svg");
  const pos = await svg.evaluate(
    (el, p) => {
      const s = el as SVGSVGElement;
      const pt = s.createSVGPoint();
      pt.x = p.x;
      pt.y = -p.y; // groupe `scale(1, -1)` : y SVG = −y du site
      const m = s.getScreenCTM()!;
      const q = pt.matrixTransform(m);
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
  await page.mouse.click(pos.x, pos.y);
}

test("import DXF (échelle demandée), trémie tracée avec accroches, annulable", async ({ page }) => {
  await openSite(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer un plan DXF…" }).click();
  await (
    await chooser
  ).setFiles({ name: "plan.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxfText()) });
  // Unité absente : l'échelle est demandée.
  await expect(page.getByText("n'indique pas son unité")).toBeVisible();
  await page.getByLabel("Unité du dessin", { exact: true }).selectOption({ label: "Centimètre" });
  await page.getByRole("button", { name: "Importer à cette échelle" }).click();
  await expect(page.getByRole("status").filter({ hasText: "« plan.dxf » importé" })).toContainText(
    "5 entités",
  );
  await settle(page);
  await expect(page.locator("path.plan-site__dxf")).toHaveCount(1);

  // Trémie tracée par clics légèrement décalés : les accroches ramènent aux coins du DXF.
  await page.getByRole("button", { name: "Tracer la trémie" }).click();
  await clickSite(page, 6, 1004);
  await clickSite(page, 897, 995);
  await clickSite(page, 903, 3597);
  await clickSite(page, 4, 3604);
  await page.getByRole("button", { name: "Fermer la trémie" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Trémie polygonale de 4 sommets" }),
  ).toBeVisible();
  await settle(page);
  await expect(page.locator("polygon.plan-site__opening")).toHaveAttribute(
    "points",
    "0,1000 900,1000 900,3600 0,3600",
  );
  await expect(page.getByText("Trémie polygonale (4 sommets)")).toBeVisible();

  // Le plan coté reprend la trémie ; la saisie s'annule.
  await page.getByRole("button", { name: "Plan coté", exact: true }).click();
  await expect(page.locator(".svg-export svg")).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(page.getByText("Trémie polygonale (4 sommets)")).toHaveCount(0);
});

test("relevé de trémie 4 côtés + 2 diagonales et tracé d'un mur", async ({ page }) => {
  await openSite(page);
  const d = Math.round(Math.hypot(900, 2600));
  for (const [label, v] of [
    ["Côté AB", 900],
    ["Côté BC", 2600],
    ["Côté CD", 900],
    ["Côté DA", 2600],
    ["Diagonale AC", d],
    ["Diagonale BD", d],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(String(v));
  }
  await expect(page.getByText(/Relevé cohérent/)).toBeVisible();
  // Relecture : la limite du contrôle par la sixième mesure est affichée.
  await expect(page.getByText(/Limite du contrôle/)).toBeVisible();
  await expect(page.locator("polygon.plan-site__preview")).toHaveCount(1);
  await page.getByRole("button", { name: "Remplacer la trémie par le relevé" }).click();
  await settle(page);
  await expect(page.getByText("Trémie polygonale (4 sommets)")).toBeVisible();

  // Incohérence signalée si une diagonale est fausse de 40 mm.
  await page.getByLabel("Diagonale BD", { exact: true }).fill(String(d + 40));
  await expect(page.getByText(/Relevé incohérent/)).toBeVisible();

  // Mur : deux clics.
  await page.getByRole("button", { name: "Tracer un mur" }).click();
  await clickSite(page, -300, 0);
  await clickSite(page, -300, 3000);
  await expect(page.getByRole("status").filter({ hasText: "Mur ajouté" })).toBeVisible();
  await settle(page);
  await expect(page.locator("polygon.plan-site__wall")).toHaveCount(1);
});
