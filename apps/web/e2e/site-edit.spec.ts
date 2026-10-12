/**
 * Site éditable dans l'éditeur de plan (ADR-0010, plan F, sous-lot 5a) : exemple cage-60 avec un
 * mur M1 devant l'arrivée, plan « Site et saisie ».
 *
 * - Mur : extrémité glissée (une annulation), épaisseur par la poignée d'un nu puis au clavier,
 *   coupe au milieu (inspecteur) et au double-clic (sous la poignée du mur entier), Suppr
 *   supprime le mur sélectionné, flèches sur le mur sélectionné (plan focalisé).
 * - Trémie : sommet glissé, sommet inséré au double-clic sur un côté puis retiré par Suppr,
 *   trémie translatée par sa poignée ; un geste = une annulation.
 * - Conflits : le mur rapproché de l'escalier crée un conflit « mur » dès le geste (aperçu du
 *   worker, aucun modèle complet), un modèle au relâchement, l'annulation le fait disparaître.
 * - Contour de pièce (sous-lot 5b) : tracé au clic (fermé sur le premier sommet), sommet glissé
 *   qui fait sortir l'escalier : conflit « hors pièce » en aperçu pendant le geste, gardé au
 *   relâchement, disparu à l'annulation ; retracer remplace le contour (une annulation) ; Échap
 *   abandonne le tracé ; Suppr supprime le contour sélectionné.
 * - Obstacles (sous-lot 5b, mur M2 adossé au flanc du tronçon 1) : poteau posé par un glisser
 *   sur la trajectoire (conflit obstacle, une annulation) puis par deux clics ; poteau glissé hors
 *   de l'escalier (conflit disparu en aperçu) ; porte sur M1, débattement dessiné, conflit quand
 *   il couvre l'escalier (sens d'ouverture changé dans l'inspecteur) ; fenêtre sur M2 (conseil) ;
 *   zone interdite fermée par Entrée ; Suppr supprime l'obstacle sélectionné.
 * - Budget des tâches longues respecté.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  describeTasks,
  instrument,
  openApp,
  openTab,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const CAGE_60 = fileURLToPath(new URL("../../../examples/cage-60.blondel.json", import.meta.url));

interface Pt {
  x: number;
  y: number;
}

/** Mur M1 (200 mm) perpendiculaire au tronçon 2 de cage-60, à 300 mm devant l'arrivée. */
function addWallNearArrival(json: Record<string, unknown>): void {
  const site = json["site"] as { walls: unknown[] };
  site.walls = [
    {
      id: "M1",
      a: { x: -2050, y: 2199 },
      b: { x: -1050, y: 3931 },
      thickness: 200,
      loadBearing: false,
    },
  ];
}

/** Mur M2 (200 mm) dont le nu touche le flanc droit du tronçon 1 (x = 900), y de −200 à 1 800. */
function addFlankWall(json: Record<string, unknown>): void {
  const site = json["site"] as { walls: unknown[] };
  site.walls.push({
    id: "M2",
    a: { x: 1000, y: -200 },
    b: { x: 1000, y: 1800 },
    thickness: 200,
    loadBearing: false,
  });
}

async function openSitePlan(page: Page, flankWall = false): Promise<Locator> {
  await openApp(page);
  const json = JSON.parse(readFileSync(CAGE_60, "utf8")) as Record<string, unknown>;
  addWallNearArrival(json);
  if (flankWall) addFlankWall(json);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
  await (
    await chooser
  ).setFiles({
    name: "cage-60-mur.blondel.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(json)),
  });
  await settle(page);
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  await settle(page);
  await takeLongTasks(page);
  return page.getByRole("group", {
    name: "Plan du site : calque de fond, murs, trémie et escalier",
  });
}

/** Point de l'écran d'un point du site (mm), par la matrice du groupe du plan. */
async function screenOf(plan: Locator, p: Pt): Promise<Pt> {
  return plan.evaluate((svg, q) => {
    const g = svg.querySelector<SVGGElement>(":scope > g")!;
    const s = new DOMPoint(q.x, q.y).matrixTransform(g.getScreenCTM()!);
    return { x: s.x, y: s.y };
  }, p);
}

/** Clic en un point du site. */
async function clickAt(page: Page, plan: Locator, p: Pt): Promise<void> {
  const s = await screenOf(plan, p);
  await page.mouse.click(s.x, s.y);
}

async function center(loc: Locator): Promise<Pt> {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Glisser de `from` à `to`, Maj enfoncée (sans accroche). */
async function shiftDrag(page: Page, from: Pt, to: Pt, steps = 10): Promise<void> {
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

/**
 * Point de l'écran où l'élément `selector` du plan reçoit le clic, sur son contour (`edge`) ou
 * à l'intérieur (`fill`) ; `null` si aucun.
 */
async function hitPoint(
  plan: Locator,
  selector: string,
  where: "edge" | "fill",
): Promise<Pt | null> {
  return plan.evaluate(
    (svg, args) => {
      const el = svg.querySelector<SVGPolygonElement>(args.selector);
      const ctm = el?.getScreenCTM();
      if (!el || !ctm) return null;
      const pts = Array.from(el.points);
      const candidates: DOMPoint[] = [];
      if (args.where === "edge") {
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % pts.length]!;
          for (const t of [0.5, 0.3, 0.7, 0.4, 0.6]) {
            candidates.push(new DOMPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
          }
        });
      } else {
        // Le long de l'axe du polygone (milieux des côtés opposés).
        const n = pts.length;
        for (const t of [0.3, 0.4, 0.6, 0.7, 0.2, 0.8]) {
          for (let i = 0; i < n; i++) {
            const a = pts[i]!;
            const b = pts[(i + 1) % n]!;
            const c = pts[(i + 2) % n]!;
            const d = pts[(i + 3) % n]!;
            const m1 = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
            const m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
            candidates.push(new DOMPoint(m1.x + (m2.x - m1.x) * t, m1.y + (m2.y - m1.y) * t));
          }
        }
      }
      for (const q of candidates) {
        const sp = q.matrixTransform(ctm);
        const hit = document.elementFromPoint(sp.x, sp.y)?.closest("[data-plan-select]");
        if (hit === el) return { x: sp.x, y: sp.y };
      }
      return null;
    },
    { selector, where },
  );
}

interface ModelStats {
  builds: number;
  previews: number;
  previewsPublished: number;
}

const modelStats = (page: Page): Promise<ModelStats> =>
  page.evaluate(() =>
    (window as Window & { __blondelModelStats?: () => ModelStats }).__blondelModelStats!(),
  );

const valueOf = async (loc: Locator): Promise<number> =>
  Number(await loc.getAttribute("aria-valuenow"));

test("murs éditables : extrémité, épaisseur, couper, supprimer ; un geste = une annulation", async ({
  page,
}) => {
  const plan = await openSitePlan(page);
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const status = page.getByTestId("plan-selection");

  // Sélection du mur au clavier (son corps peut être recouvert par une zone de conflit).
  await plan.getByRole("button", { name: "Mur M1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Mur M1");
  const endB = plan.getByRole("slider", { name: "Déplacer l'extrémité B du mur M1", exact: true });
  const faceLeft = plan.getByRole("slider", { name: "Épaisseur du mur M1 (nu gauche)" });
  const faceRight = plan.getByRole("slider", { name: "Épaisseur du mur M1 (nu droit)" });
  await expect(endB).toBeVisible();
  await expect(faceLeft).toHaveAttribute("aria-valuenow", "200");
  const endText = (await endB.getAttribute("aria-valuetext"))!;

  // Extrémité B glissée (Maj : sans accroche) : une annulation défait le geste entier.
  const b0 = await center(endB);
  await shiftDrag(page, b0, { x: b0.x + 40, y: b0.y + 25 }, 12);
  await settle(page);
  await expect(endB).not.toHaveAttribute("aria-valuetext", endText);
  await undo.click();
  await expect(endB).toHaveAttribute("aria-valuetext", endText);
  await settle(page);

  // Épaisseur : nu gauche tiré vers l'extérieur ; nu droit conservé.
  const l0 = await center(faceLeft);
  const r0 = await center(faceRight);
  const w = Math.hypot(l0.x - r0.x, l0.y - r0.y);
  const out = { x: l0.x + ((l0.x - r0.x) / w) * 20, y: l0.y + ((l0.y - r0.y) / w) * 20 };
  await shiftDrag(page, l0, out);
  await settle(page);
  const thick = await valueOf(faceLeft);
  expect(thick).toBeGreaterThan(200);
  const r1 = await center(faceRight);
  expect(Math.hypot(r1.x - r0.x, r1.y - r0.y)).toBeLessThan(2);
  // Clavier : flèche haut = 10 mm de plus.
  await faceLeft.focus();
  await page.keyboard.press("ArrowUp");
  await expect(faceLeft).toHaveAttribute("aria-valuenow", String(thick + 10));
  await undo.click();
  await undo.click();
  await expect(faceLeft).toHaveAttribute("aria-valuenow", "200");
  await settle(page);

  // Couper au milieu (inspecteur) : un nouveau mur, une annulation.
  await page.getByRole("button", { name: "Couper au milieu", exact: true }).click();
  await settle(page);
  await expect(page.getByText("Mur M1 coupé : nouveau mur wall-2.")).toBeVisible();
  await expect(plan.getByRole("button", { name: "Mur wall-2", exact: true })).toHaveCount(1);
  await undo.click();
  await expect(plan.getByRole("button", { name: "Mur wall-2", exact: true })).toHaveCount(0);
  await settle(page);

  // Double-clic sur le mur sélectionné, au milieu, sous la poignée « mur entier » (les poignées
  // sont traversées) : coupe au point cliqué.
  const onWall = await center(
    plan.getByRole("slider", { name: "Déplacer le mur M1", exact: true }),
  );
  await page.mouse.dblclick(onWall.x, onWall.y);
  await settle(page);
  await expect(plan.getByRole("button", { name: "Mur wall-2", exact: true })).toHaveCount(1);
  await expect(status).toHaveText("Sélection : Mur M1");

  // Suppr : le mur sélectionné est supprimé, la sélection effacée.
  await plan.focus();
  await page.keyboard.press("Delete");
  await settle(page);
  await expect(page.getByText("Mur M1 supprimé.")).toBeVisible();
  await expect(plan.getByRole("button", { name: "Mur M1", exact: true })).toHaveCount(0);
  await expect(status).toHaveText(/Aucune sélection/);
  await undo.click();
  await undo.click();
  await expect(plan.getByRole("button", { name: "Mur M1", exact: true })).toHaveCount(1);
  await expect(plan.getByRole("button", { name: "Mur wall-2", exact: true })).toHaveCount(0);
  await settle(page);

  // Flèches sur le mur sélectionné, plan focalisé (sans poignée) : le mur entier se déplace,
  // 10 mm puis 100 mm (Maj) ; les pas consécutifs forment une seule annulation.
  await plan.getByRole("button", { name: "Mur M1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Mur M1");
  await expect(endB).toHaveAttribute("aria-valuetext", endText);
  await plan.focus();
  await page.keyboard.press("ArrowRight");
  const afterRight = (await endB.getAttribute("aria-valuetext"))!;
  expect(afterRight).not.toBe(endText);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(endB).not.toHaveAttribute("aria-valuetext", afterRight);
  await undo.click();
  await expect(endB).toHaveAttribute("aria-valuetext", endText);

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test("trémie éditable : sommet glissé, sommet inséré puis supprimé, trémie translatée", async ({
  page,
}) => {
  const plan = await openSitePlan(page);
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const status = page.getByTestId("plan-selection");
  const vertexSliders = plan.getByRole("slider", { name: /^Déplacer le sommet \d+ de la trémie$/ });

  const edge = await hitPoint(plan, '[data-plan-select="opening"]', "edge");
  expect(edge, "point du contour de la trémie").not.toBeNull();
  await page.mouse.click(edge!.x, edge!.y);
  await expect(status).toHaveText("Sélection : Trémie");
  const count = await vertexSliders.count();
  expect(count).toBeGreaterThanOrEqual(3);
  const v1 = plan.getByRole("slider", { name: "Déplacer le sommet 1 de la trémie", exact: true });
  const v1Text = (await v1.getAttribute("aria-valuetext"))!;

  // Sommet 1 glissé (Maj) : une annulation.
  const p1 = await center(v1);
  await shiftDrag(page, p1, { x: p1.x - 25, y: p1.y + 15 });
  await settle(page);
  await expect(v1).not.toHaveAttribute("aria-valuetext", v1Text);
  await undo.click();
  await expect(v1).toHaveAttribute("aria-valuetext", v1Text);
  await settle(page);

  // Double-clic sur un côté : un sommet inséré et sélectionné ; Suppr le retire.
  const side = await hitPoint(plan, '[data-plan-select="opening"]', "edge");
  await page.mouse.dblclick(side!.x, side!.y);
  await settle(page);
  await expect(vertexSliders).toHaveCount(count + 1);
  await expect(page.getByText(/^Sommet \d+ inséré dans la trémie\.$/)).toBeVisible();
  await expect(status).toHaveText(/^Sélection : Sommet \d+ de la trémie$/);
  await plan.focus();
  await page.keyboard.press("Delete");
  await settle(page);
  await expect(vertexSliders).toHaveCount(count);
  await expect(page.getByText(/^Sommet \d+ de la trémie supprimé\.$/)).toBeVisible();
  await expect(status).toHaveText("Sélection : Trémie");

  // Trémie translatée par sa poignée centrale : tous les sommets suivent, une annulation.
  const move = plan.getByRole("slider", { name: "Déplacer la trémie", exact: true });
  const m0 = await center(move);
  await shiftDrag(page, m0, { x: m0.x + 30, y: m0.y - 20 });
  await settle(page);
  await expect(v1).not.toHaveAttribute("aria-valuetext", v1Text);
  await undo.click();
  await expect(v1).toHaveAttribute("aria-valuetext", v1Text);
  // Clavier sur la poignée centrale : flèche droite = 10 mm.
  await move.focus();
  await page.keyboard.press("ArrowRight");
  await expect(v1).not.toHaveAttribute("aria-valuetext", v1Text);
  await undo.click();
  await expect(v1).toHaveAttribute("aria-valuetext", v1Text);

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test("mur rapproché de l'escalier : conflit en aperçu pendant le geste, un modèle au relâchement, annulation", async ({
  page,
}) => {
  const plan = await openSitePlan(page);
  const status = page.getByTestId("plan-selection");
  const conflictsStatus = page.getByTestId("plan-conflicts-status");
  const wallConflict = plan.locator('.plan-editor__conflict[data-kind="wall"]');
  await expect(wallConflict).toHaveCount(0);

  await plan.getByRole("button", { name: "Mur M1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Mur M1");
  const body = plan.getByRole("slider", { name: "Déplacer le mur M1", exact: true });
  const l = await center(plan.getByRole("slider", { name: "Épaisseur du mur M1 (nu gauche)" }));
  const r = await center(plan.getByRole("slider", { name: "Épaisseur du mur M1 (nu droit)" }));
  const pxPerMm = Math.hypot(l.x - r.x, l.y - r.y) / 200;
  // Vers le centre du tronçon 2 (l'arrivée est devant le mur), de 700 mm.
  const section = await center(plan.locator('[data-plan-select="section:1"]'));
  const c0 = await center(body);
  const d = Math.hypot(section.x - c0.x, section.y - c0.y);
  const target = {
    x: c0.x + ((section.x - c0.x) / d) * 700 * pxPerMm,
    y: c0.y + ((section.y - c0.y) / d) * 700 * pxPerMm,
  };
  await settle(page);
  await takeLongTasks(page);
  const before = await modelStats(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 20 });
  // Pendant le geste : conflit avec le mur dans l'aperçu du worker, aucun modèle complet.
  await expect(wallConflict).toHaveCount(1);
  await expect(conflictsStatus).toHaveAttribute("data-preview", "true");
  const during = await modelStats(page);
  expect(during.previews).toBeGreaterThan(before.previews);
  expect(during.builds).toBe(before.builds);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  expect((await modelStats(page)).builds).toBe(before.builds + 1);
  await expect(wallConflict).toHaveCount(1);
  await expect(conflictsStatus).toContainText("empiète sur le mur « M1 »");

  // Une annulation : mur rendu, conflit disparu.
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(wallConflict).toHaveCount(0);
  await expect(conflictsStatus).not.toContainText("empiète sur le mur");

  // Échap pendant le geste : retour à l'état d'avant, sans conflit.
  const c1 = await center(body);
  await page.keyboard.down("Shift");
  await page.mouse.move(c1.x, c1.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(wallConflict).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  await expect(wallConflict).toHaveCount(0);
  await expect(page.getByTestId("plan-drag-status")).toHaveText(
    "Geste annulé : retour à l'état d'avant le glisser.",
  );

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test("contour de pièce : tracé, sommet glissé hors de l'escalier (conflit en aperçu), annulation, remplacement", async ({
  page,
}) => {
  const plan = await openSitePlan(page);
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const status = page.getByTestId("plan-selection");
  const outside = plan.locator('.plan-editor__conflict[data-kind="outsideRoom"]');
  const room = plan.locator(".plan-editor__room");
  const ROOM = [
    { x: -1900, y: -100 },
    { x: 950, y: -100 },
    { x: 950, y: 3900 },
    { x: -1900, y: 3900 },
  ];

  await page.getByRole("button", { name: "Contour de pièce", exact: true }).click();
  // Échap abandonne le tracé en cours.
  await clickAt(page, plan, ROOM[0]!);
  await clickAt(page, plan, ROOM[1]!);
  await expect(plan.locator(".plan-site__draft")).toHaveCount(1);
  await plan.focus();
  await page.keyboard.press("Escape");
  await expect(plan.locator(".plan-site__draft")).toHaveCount(0);
  // Tracé fermé sur le premier sommet : une entrée d'historique.
  for (const p of ROOM) await clickAt(page, plan, p);
  await clickAt(page, plan, ROOM[0]!);
  await settle(page);
  await expect(
    page.getByText("Contour de pièce de 4 sommets enregistré (annulable)."),
  ).toBeVisible();
  await expect(room).toHaveCount(1);
  await expect(outside).toHaveCount(0);

  // Sélection du contour (clavier), poignées de ses sommets.
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await plan.getByRole("button", { name: "Contour de la pièce", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Contour de la pièce");
  const v2 = plan.getByRole("slider", {
    name: "Déplacer le sommet 2 du contour de la pièce",
    exact: true,
  });
  // Points cliqués à l'écran : au mm près des points visés (arrondi des pixels).
  await expect(v2).toHaveAttribute("aria-valuetext", /^x 9[45]\d mm, y .(9\d|10\d) mm$/);
  const v2Text = (await v2.getAttribute("aria-valuetext"))!;

  // Sommet 2 glissé vers l'intérieur : l'escalier sort du contour, conflit dès l'aperçu.
  await settle(page);
  await takeLongTasks(page);
  const before = await modelStats(page);
  const from = await center(v2);
  const to = await screenOf(plan, { x: 400, y: -100 });
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await expect(outside).toHaveCount(1);
  expect((await modelStats(page)).builds).toBe(before.builds);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  await expect(outside).toHaveCount(1);
  await expect(page.getByTestId("plan-conflicts-status")).toContainText(
    "sort du contour de la pièce",
  );
  // Une annulation défait le geste entier : conflit disparu.
  await undo.click();
  await settle(page);
  await expect(outside).toHaveCount(0);
  await expect(v2).toHaveAttribute("aria-valuetext", v2Text);

  // Double-clic sur un côté du contour sélectionné : sommet inséré (une annulation le retire).
  const vertices = plan.getByRole("slider", {
    name: /^Déplacer le sommet \d+ du contour de la pièce$/,
  });
  await expect(vertices).toHaveCount(4);
  const side = await screenOf(plan, { x: -1900, y: 1900 });
  await page.mouse.dblclick(side.x, side.y);
  await settle(page);
  await expect(vertices).toHaveCount(5);
  await expect(page.getByText("Sommet 5 inséré dans le contour de la pièce.")).toBeVisible();
  await expect(status).toHaveText("Sélection : Sommet 5 du contour de la pièce");
  // Annulation : le sommet disparaît, sa sélection aussi.
  await undo.click();
  await expect(status).toHaveText(/Aucune sélection/);
  await plan.getByRole("button", { name: "Contour de la pièce", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(vertices).toHaveCount(4);

  // Retracer remplace le contour (une annulation le rend).
  await page.getByRole("button", { name: "Contour de pièce", exact: true }).click();
  await expect(
    page.getByText("Le projet a déjà un contour de pièce : le nouveau tracé le remplacera"),
  ).toBeVisible();
  for (const p of [ROOM[0]!, ROOM[1]!, { x: -400, y: 3900 }]) await clickAt(page, plan, p);
  await plan.focus();
  await page.keyboard.press("Enter");
  await settle(page);
  await expect(page.getByText("Contour de pièce remplacé : 3 sommets (annulable).")).toBeVisible();
  // Le triangle coupe l'escalier : hors pièce.
  await expect(outside).toHaveCount(1);
  await undo.click();
  await settle(page);
  await expect(outside).toHaveCount(0);

  // Suppr sur le contour sélectionné : supprimé.
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await plan.getByRole("button", { name: "Contour de la pièce", exact: true }).focus();
  await page.keyboard.press("Enter");
  await plan.focus();
  await page.keyboard.press("Delete");
  await settle(page);
  await expect(page.getByText("Contour de pièce supprimé.")).toBeVisible();
  await expect(room).toHaveCount(0);
  await undo.click();
  await expect(room).toHaveCount(1);

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test("obstacles : poteau, porte, fenêtre, zone interdite ; conflits, déplacement, suppression", async ({
  page,
}) => {
  const plan = await openSitePlan(page, true);
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const status = page.getByTestId("plan-selection");
  const conflict = (kind: string) => plan.locator(`.plan-editor__conflict[data-kind="${kind}"]`);
  const kind = page.getByLabel("Type d'obstacle", { exact: true });

  await page.getByRole("button", { name: "Obstacle", exact: true }).click();
  // Accroches coupées : points posés tels quels.
  await page.getByRole("checkbox", { name: "Accroches" }).uncheck();
  await expect(kind).toHaveValue("post");

  // Poteau posé par un glisser (centre puis coin) sur la trajectoire : conflit obstacle.
  const c = await screenOf(plan, { x: 450, y: 800 });
  const corner = await screenOf(plan, { x: 550, y: 900 });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(corner.x, corner.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  await expect(page.getByText("Obstacle obstacle-1 ajouté (annulable).")).toBeVisible();
  await expect(conflict("obstacle")).toHaveCount(1);
  await undo.click();
  await settle(page);
  await expect(conflict("obstacle")).toHaveCount(0);
  // Le même poteau par deux clics.
  await clickAt(page, plan, { x: 450, y: 800 });
  await clickAt(page, plan, { x: 550, y: 900 });
  await settle(page);
  await expect(conflict("obstacle")).toHaveCount(1);

  // Porte sur M1 (deux clics le long du mur), ouverture à gauche : débattement dessiné, hors de
  // l'escalier.
  await kind.selectOption("door");
  await clickAt(page, plan, { x: -1800, y: 2632 });
  await clickAt(page, plan, { x: -1350, y: 3411 });
  await settle(page);
  await expect(page.getByText("Obstacle obstacle-2 ajouté (annulable).")).toBeVisible();
  await expect(plan.locator(".plan-editor__obstacle--door .plan-editor__swing")).toHaveCount(1);
  await expect(conflict("doorSwing")).toHaveCount(0);

  // Fenêtre sur M2 (allège et linteau saisis) : conseil.
  await kind.selectOption("window");
  await clickAt(page, plan, { x: 1000, y: 300 });
  await expect(page.getByText("Saisir l'allège et le linteau de la fenêtre")).toBeVisible();
  await page.getByLabel("Allège", { exact: true }).fill("900");
  await page.getByLabel("Linteau", { exact: true }).fill("2100");
  await clickAt(page, plan, { x: 1000, y: 300 });
  await clickAt(page, plan, { x: 1000, y: 1300 });
  await settle(page);
  await expect(conflict("window")).toHaveCount(1);
  await expect(conflict("window")).toHaveAttribute("data-severity", "conseil");

  // Zone interdite sur le tronçon 2, fermée par Entrée.
  await kind.selectOption("zone");
  for (const p of [
    { x: -900, y: 2300 },
    { x: -500, y: 2300 },
    { x: -700, y: 2700 },
  ])
    await clickAt(page, plan, p);
  await plan.focus();
  await page.keyboard.press("Enter");
  await settle(page);
  await expect(page.getByText("Obstacle obstacle-4 ajouté (annulable).")).toBeVisible();
  await expect(conflict("obstacle")).toHaveCount(2);

  // Porte : ouverture à droite dans l'inspecteur, le débattement couvre l'escalier.
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await plan.getByRole("button", { name: "Obstacle obstacle-2", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Obstacle obstacle-2");
  await page
    .getByRole("combobox", { name: "Ouverture", exact: true })
    .selectOption({ label: "À droite (vu de A vers B)" });
  await settle(page);
  await expect(conflict("doorSwing")).toHaveCount(1);

  // Poteau glissé hors de l'escalier : conflit disparu dès l'aperçu ; une annulation le rend.
  await plan.getByRole("button", { name: "Obstacle obstacle-1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Obstacle obstacle-1");
  const move = plan.getByRole("slider", { name: "Déplacer l'obstacle obstacle-1", exact: true });
  const m0 = await center(move);
  const away = await screenOf(plan, { x: 450, y: -700 });
  await page.keyboard.down("Shift");
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 12 });
  await expect(conflict("obstacle")).toHaveCount(1);
  await expect(page.getByTestId("plan-conflicts-status")).toHaveAttribute("data-preview", "true");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  await expect(conflict("obstacle")).toHaveCount(1);
  await undo.click();
  await settle(page);
  await expect(conflict("obstacle")).toHaveCount(2);

  // Suppr : l'obstacle sélectionné est supprimé (une annulation le rend).
  await plan.focus();
  await page.keyboard.press("Delete");
  await settle(page);
  await expect(page.getByText("Obstacle obstacle-1 supprimé.")).toBeVisible();
  await expect(status).toHaveText(/Aucune sélection/);
  await expect(conflict("obstacle")).toHaveCount(1);
  await undo.click();
  await settle(page);
  await expect(conflict("obstacle")).toHaveCount(2);

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});
