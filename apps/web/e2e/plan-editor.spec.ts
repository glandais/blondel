/**
 * Éditeur de plan en calques (ADR-0010, sous-lot 4a) : exemple cage-60 importé, plan « Site et
 * saisie » ; outil « Sélectionner » par défaut, sélection d'un tronçon puis d'une jonction au
 * clic (surbrillance, libellé), Échap et clic dans le vide désélectionnent, sélection au clavier
 * (Entrée) ; escalier et trémie pris par leur contour, intérieur de la trémie traversé jusqu'à la
 * jonction ; un glisser sur un élément déplace la vue sans sélectionner ; calque des conflits
 * d'adéquation au site (`Model.siteFit`) affiché ; la sélection ne crée aucune entrée
 * d'historique (une seule annulation ramène avant l'import) ; section Tracé d'une cage (résumé,
 * « Tracé libre », pas d'emmarchement global) ; budget des tâches longues respecté.
 *
 * Poignées (sous-lot 4b) : déplacer et pivoter l'escalier (souris, clavier, R), glisser la fin
 * d'un tronçon (accroche par girons entiers), la largeur d'arrivée (trapèze), l'angle d'une
 * jonction (accroche de 15°, 90° → 60°) ; un geste = une annulation ; Échap pendant le glisser
 * restaure ; budget des tâches longues respecté pendant les glissers.
 *
 * Retour en direct et conflits (sous-lot 4c) : cage-60 avec un mur devant l'arrivée, bulle d'un
 * conflit au survol et au focus, clic sur son contour (mur sélectionné), glisser d'une longueur
 * vers le mur : le conflit apparaît pendant le geste (aperçu du worker, aucun modèle complet),
 * un seul modèle complet au relâchement, annonce de la liste, Ctrl+Z le fait disparaître ;
 * exemple lourd (j3a) : aperçus pendant le glisser, un modèle au relâchement, budget respecté.
 *
 * Inspecteur (sous-lot 4d) : angle d'une jonction réglé à 60° au clavier (refus hors domaine
 * affiché sous le champ), raccord du jour, origine de l'escalier ; insérer un palier, couper un
 * tronçon (refus puis coupe), Suppr et « Supprimer le tronçon » retirent un tronçon, Suppr sur le
 * dernier tronçon refusé (sélection gardée) ; escalier à volées converti en tracé libre
 * (inspecteur, puis section Tracé, remarque par la notification), partie droite d'un tronçon
 * unique rendue à « auto » puis imposée à la valeur retenue, passage automatique annoncé,
 * annulations ; limons à la
 * française (sous-lot 6a) et crémaillères bois (sous-lot 6b) sur une cage : générés, sans
 * erreur ; limon central acier sur une cage : `structure.cageUnsupported` lisible et
 * « Reconvertir en volées » proposé, puis structure « aucune » : plus d'erreur ; budget des
 * tâches longues respecté.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  chooseStructure,
  describeTasks,
  instrument,
  openApp,
  openSection,
  openTab,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const CAGE_60 = fileURLToPath(new URL("../../../examples/cage-60.blondel.json", import.meta.url));
const CAGE_TRAPEZE = fileURLToPath(
  new URL("../../../examples/cage-trapeze.blondel.json", import.meta.url),
);

async function importProject(
  page: Page,
  file: string,
  name: string,
  edit?: (json: Record<string, unknown>) => void,
): Promise<void> {
  let buffer = readFileSync(file);
  if (edit) {
    const json = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
    edit(json);
    buffer = Buffer.from(JSON.stringify(json));
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer });
  await settle(page);
}

/**
 * Point de l'écran où l'élément `selector` du plan reçoit le clic : un point de son contour
 * (milieux et quarts des côtés) où `elementFromPoint` le désigne, éventuellement restreint à
 * l'intérieur d'un autre polygone (`inside`). `null` si aucun.
 */
async function hitPoint(
  plan: Locator,
  selector: string,
  where: "edge" | "fill",
  inside?: string,
): Promise<{ x: number; y: number } | null> {
  return plan.evaluate(
    (svg, args) => {
      const el = svg.querySelector<SVGPolygonElement>(args.selector);
      const box = args.inside ? svg.querySelector<SVGPolygonElement>(args.inside) : null;
      if (!el) return null;
      const ctm = el.getScreenCTM();
      if (!ctm) return null;
      const pts = Array.from(el.points);
      const candidates: DOMPoint[] = [];
      if (args.where === "edge") {
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % pts.length]!;
          for (const t of [0.5, 0.25, 0.75, 0.4, 0.6]) {
            candidates.push(new DOMPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
          }
        });
      } else {
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        for (const t of [0, 0.2, 0.4, 0.6]) {
          for (const p of pts)
            candidates.push(new DOMPoint(cx + (p.x - cx) * t, cy + (p.y - cy) * t));
        }
      }
      for (const q of candidates) {
        if (box && !box.isPointInFill(q)) continue;
        const sp = q.matrixTransform(ctm);
        const hit = document.elementFromPoint(sp.x, sp.y)?.closest("[data-plan-select]");
        if (hit === el) return { x: sp.x, y: sp.y };
      }
      return null;
    },
    { selector, where, inside },
  );
}

test("cage-60 : sélection d'un tronçon puis d'une jonction, Échap, calque des conflits", async ({
  page,
}) => {
  await openApp(page);
  await importProject(page, CAGE_60, "cage-60.blondel.json");
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  const tools = page.getByRole("toolbar", { name: "Outils de saisie du plan" });
  await expect(tools.getByRole("button", { name: "Sélectionner", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await settle(page);
  await takeLongTasks(page);
  // L'import est la seule entrée d'historique : une annulation y ramène (vérifié à la fin).
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  await expect(undo).toBeEnabled();

  const plan = page.getByRole("group", {
    name: "Plan du site : calque de fond, murs, trémie et escalier",
  });
  const section = plan.getByRole("button", { name: "Tronçon 1", exact: true });
  const junction = plan.getByRole("button", { name: "Jonction 1", exact: true });
  const status = page.getByTestId("plan-selection");
  await expect(status).toHaveText(/Aucune sélection/);
  await expect(plan.getByRole("button", { name: "Tronçon 2", exact: true })).toHaveCount(1);

  // Clic sur un tronçon : sélectionné (surbrillance), libellé dans le panneau.
  await section.click();
  await expect(section).toHaveAttribute("aria-pressed", "true");
  await expect(section).toHaveAttribute("data-selected", "true");
  await expect(status).toHaveText("Sélection : Tronçon 1");

  // Clic sur la jonction : elle remplace le tronçon.
  await junction.click();
  await expect(junction).toHaveAttribute("aria-pressed", "true");
  await expect(section).toHaveAttribute("aria-pressed", "false");
  await expect(status).toHaveText("Sélection : Jonction 1");

  // Échap désélectionne.
  await page.keyboard.press("Escape");
  await expect(junction).toHaveAttribute("aria-pressed", "false");
  await expect(status).toHaveText(/Aucune sélection/);
  await expect(plan.locator('[data-selected="true"]')).toHaveCount(0);

  // Clavier : focus sur le tronçon, Entrée le sélectionne ; clic dans le vide désélectionne.
  await section.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Tronçon 1");
  const box = (await plan.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + 8);
  await expect(status).toHaveText(/Aucune sélection/);

  // Escalier : tronçons et jonctions couvrent l'emprise, il se prend par son contour.
  const stairEdge = await hitPoint(plan, '[data-plan-select="stair"]', "edge");
  expect(stairEdge, "point du contour de l'escalier").not.toBeNull();
  await page.mouse.click(stairEdge!.x, stairEdge!.y);
  await expect(status).toHaveText("Sélection : Escalier");
  await expect(plan.locator(".plan-site__stair")).toHaveAttribute("data-selected", "true");

  // Trémie : prise par son contour ; ses sommets apparaissent.
  const openingEdge = await hitPoint(plan, '[data-plan-select="opening"]', "edge");
  expect(openingEdge, "point du contour de la trémie").not.toBeNull();
  await page.mouse.click(openingEdge!.x, openingEdge!.y);
  await expect(status).toHaveText("Sélection : Trémie");
  await expect(
    plan.getByRole("button", { name: "Sommet 1 de la trémie", exact: true }),
  ).toHaveCount(1);
  // L'intérieur de la trémie laisse passer le clic jusqu'à la jonction qu'elle recouvre.
  const underOpening = await hitPoint(
    plan,
    '[data-plan-select="junction:0"]',
    "fill",
    ".plan-site__opening",
  );
  expect(underOpening, "point de la jonction 1 sous la trémie").not.toBeNull();
  await page.mouse.click(underOpening!.x, underOpening!.y);
  await expect(status).toHaveText("Sélection : Jonction 1");

  // Un glisser commencé sur un élément déplace la vue sans le sélectionner.
  await page.keyboard.press("Escape");
  await expect(status).toHaveText(/Aucune sélection/);
  const viewBox = await plan.getAttribute("viewBox");
  const s1 = (await section.boundingBox())!;
  await page.mouse.move(s1.x + s1.width / 2, s1.y + s1.height / 2);
  await page.mouse.down();
  await page.mouse.move(s1.x + s1.width / 2 + 40, s1.y + s1.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect(plan).not.toHaveAttribute("viewBox", viewBox!);
  await expect(status).toHaveText(/Aucune sélection/);
  await tools.getByRole("button", { name: "Recadrer", exact: true }).click();

  // Calque des conflits : la zone de chaque conflit de `Model.siteFit`, colorée par sévérité.
  const conflicts = plan.locator(".plan-editor__layer--conflicts polygon.plan-editor__conflict");
  await expect(conflicts.first()).toBeAttached();
  expect(await conflicts.count()).toBeGreaterThan(0);
  for (const severity of await conflicts.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-severity")),
  )) {
    expect(["erreur", "avertissement", "conseil"]).toContain(severity);
  }

  // Un outil de tracé : les éléments ne sont plus des boutons, le clic trace (comportement
  // inchangé de la saisie du site).
  await tools.getByRole("button", { name: "Tracer un mur" }).click();
  await expect(plan.getByRole("button", { name: "Tronçon 1", exact: true })).toHaveCount(0);

  // Section Tracé d'une cage : « Tracé libre », résumé des tronçons, pas d'emmarchement global
  // (dérivé des tronçons, une saisie y serait ignorée).
  const panel = await openSection(page, "Tracé");
  await expect(panel.getByLabel("Type de tracé", { exact: true })).toHaveValue("cage");
  const summary = panel.getByRole("list", { name: "Tronçons et jonctions du tracé libre" });
  await expect(summary.getByRole("listitem")).toHaveCount(3);
  await expect(summary.getByRole("listitem").nth(1)).toHaveText(/^Jonction 1 : 60°/);
  await expect(panel.getByLabel("Emmarchement E", { exact: true })).toHaveCount(0);

  // La sélection est un état d'interface : seule l'entrée de l'import est dans l'historique.
  await undo.click();
  await expect(undo).toBeDisabled();

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

// ------------------------------------------------------------------ Poignées (sous-lot 4b)

interface Pt {
  x: number;
  y: number;
}

async function center(loc: Locator): Promise<Pt> {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Glisser de `from` à `to` (pas intermédiaires), Maj enfoncée si `shift` (sans accroche). */
async function dragFromTo(
  page: Page,
  from: Pt,
  to: Pt | readonly Pt[],
  { shift = false, steps = 8 }: { shift?: boolean; steps?: number } = {},
): Promise<void> {
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const p of Array.isArray(to) ? to : [to]) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

async function openSitePlan(
  page: Page,
  file: string,
  name: string,
  edit?: (json: Record<string, unknown>) => void,
): Promise<Locator> {
  await openApp(page);
  await importProject(page, file, name, edit);
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  await settle(page);
  await takeLongTasks(page);
  return page.getByRole("group", {
    name: "Plan du site : calque de fond, murs, trémie et escalier",
  });
}

const valueOf = async (loc: Locator): Promise<number> =>
  Number(await loc.getAttribute("aria-valuenow"));

test("cage-60 : poignées de l'escalier et d'un tronçon, un geste = une annulation, Échap", async ({
  page,
}) => {
  const plan = await openSitePlan(page, CAGE_60, "cage-60.blondel.json");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const status = page.getByTestId("plan-selection");
  const dragStatus = page.getByTestId("plan-drag-status");

  // Escalier sélectionné (par son contour) : poignées de déplacement et de rotation.
  const stairEdge = await hitPoint(plan, '[data-plan-select="stair"]', "edge");
  await page.mouse.click(stairEdge!.x, stairEdge!.y);
  await expect(status).toHaveText("Sélection : Escalier");
  const move = plan.getByRole("slider", { name: "Déplacer l'escalier", exact: true });
  const rotate = plan.getByRole("slider", { name: "Pivoter l'escalier", exact: true });
  await expect(move).toHaveAttribute("aria-valuetext", "x 0 mm, y 0 mm");
  await expect(rotate).toHaveAttribute("aria-valuenow", "0");

  // Souris, Maj (sans accroche) : glisser la poignée centrale à droite ; une annulation défait
  // tout le geste. Pendant le geste (sous-lot 4c, niveau 1) : dessin reporté par une
  // transformation SVG, poignée sous le pointeur, ni aperçu ni modèle calculés ; un seul modèle
  // au relâchement.
  const c = await center(move);
  await settle(page);
  const stats0 = await modelStats(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 90, c.y, { steps: 12 });
  await expect(plan.locator('.plan-editor__layer--stair[data-transformed="true"]')).toHaveCount(1);
  const c1 = await center(move);
  expect(Math.hypot(c1.x - (c.x + 90), c1.y - c.y)).toBeLessThan(4);
  const statsDuring = await modelStats(page);
  expect(statsDuring.builds).toBe(stats0.builds);
  expect(statsDuring.previews).toBe(stats0.previews);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  expect((await modelStats(page)).builds).toBe(stats0.builds + 1);
  await expect(plan.locator('.plan-editor__layer--stair[data-transformed="true"]')).toHaveCount(0);
  expect(await valueOf(move)).toBeGreaterThan(100);
  await expect(move).toHaveAttribute("aria-valuetext", /y 0 mm$/);
  await undo.click();
  await expect(move).toHaveAttribute("aria-valuetext", "x 0 mm, y 0 mm");
  await settle(page);

  // L'emprise se glisse aussi (escalier sélectionné) ; un clic sans glisser sélectionne encore.
  const fill = await hitPoint(plan, '[data-plan-select="junction:0"]', "fill");
  expect(fill, "point de l'emprise (jonction 1)").not.toBeNull();
  await dragFromTo(page, fill!, { x: fill!.x, y: fill!.y - 60 }, { shift: true });
  await settle(page);
  await expect(move).toHaveAttribute("aria-valuetext", /^x 0 mm, y [1-9]\d* mm$/);
  await undo.click();
  await expect(move).toHaveAttribute("aria-valuetext", "x 0 mm, y 0 mm");
  await settle(page);

  // Échap pendant le glisser de l'emprise : escalier rendu, et la suite du glisser (bouton
  // encore enfoncé) ne déplace pas la vue.
  const viewBox = await plan.getAttribute("viewBox");
  await page.keyboard.down("Shift");
  await page.mouse.move(fill!.x, fill!.y);
  await page.mouse.down();
  await page.mouse.move(fill!.x, fill!.y - 60, { steps: 8 });
  await expect(move).not.toHaveAttribute("aria-valuetext", "x 0 mm, y 0 mm");
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await expect(move).toHaveAttribute("aria-valuetext", "x 0 mm, y 0 mm");
  await page.mouse.move(fill!.x + 80, fill!.y - 120, { steps: 6 });
  await page.mouse.up();
  await expect(plan).toHaveAttribute("viewBox", viewBox!);
  await expect(move).toHaveAttribute("aria-valuetext", "x 0 mm, y 0 mm");
  await expect(status).toHaveText("Sélection : Escalier");
  await settle(page);

  // Clavier : flèches 10 mm, Maj 100 mm ; R / Maj+R ±15°.
  await move.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowUp");
  await expect(move).toHaveAttribute("aria-valuetext", "x 110 mm, y 10 mm");
  await page.keyboard.press("r");
  await expect(rotate).toHaveAttribute("aria-valuenow", "15");
  await page.keyboard.press("Shift+R");
  await expect(rotate).toHaveAttribute("aria-valuenow", "0");
  await settle(page);

  // Rotation à la souris, accroche de 15° : un quart de tour (sens trigonométrique à l'écran).
  const pivot = await center(move);
  const r0 = await center(rotate);
  const v = { x: r0.x - pivot.x, y: r0.y - pivot.y };
  const arc = [30, 60, 88].map((deg) => {
    const a = (-deg * Math.PI) / 180;
    return {
      x: pivot.x + v.x * Math.cos(a) - v.y * Math.sin(a),
      y: pivot.y + v.x * Math.sin(a) + v.y * Math.cos(a),
    };
  });
  await dragFromTo(page, r0, arc, { steps: 4 });
  await settle(page);
  await expect(rotate).toHaveAttribute("aria-valuenow", "90");
  await undo.click();
  await expect(rotate).toHaveAttribute("aria-valuenow", "0");
  await settle(page);

  // Tronçon 2 : poignée de fin (longueur), accroche par girons entiers.
  await page.keyboard.press("Escape");
  await plan.getByRole("button", { name: "Tronçon 2", exact: true }).click();
  await expect(status).toHaveText("Sélection : Tronçon 2");
  const end = plan.getByRole("slider", { name: "Longueur du tronçon 2", exact: true });
  await expect(end).toHaveAttribute("aria-valuenow", "1650");
  const startLeft = await center(
    plan.getByRole("slider", { name: "Largeur au départ du tronçon 2 (bord gauche)" }),
  );
  const startRight = await center(
    plan.getByRole("slider", { name: "Largeur au départ du tronçon 2 (bord droit)" }),
  );
  const e0 = await center(end);
  const mid = { x: (startLeft.x + startRight.x) / 2, y: (startLeft.y + startRight.y) / 2 };
  const n = Math.hypot(e0.x - mid.x, e0.y - mid.y);
  const u = { x: (e0.x - mid.x) / n, y: (e0.y - mid.y) / n };
  const along = (d: number): Pt => ({ x: e0.x + u.x * d, y: e0.y + u.y * d });
  await dragFromTo(page, e0, along(45), { steps: 15 });
  await settle(page);
  await expect(dragStatus).toHaveText(/^Accroche : \d+ girons \(\d[\d\s\u202f]* mm\)$/);
  const snapped = await valueOf(end);
  expect(snapped).toBeGreaterThan(1650);
  // Un geste (15 pas) = une annulation.
  await undo.click();
  await expect(end).toHaveAttribute("aria-valuenow", "1650");
  await settle(page);

  // Échap pendant le glisser : retour à l'état d'avant le geste.
  await page.mouse.move(e0.x, e0.y);
  await page.mouse.down();
  await page.mouse.move(along(60).x, along(60).y, { steps: 10 });
  await expect(end).not.toHaveAttribute("aria-valuenow", "1650");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(end).toHaveAttribute("aria-valuenow", "1650");
  await expect(dragStatus).toHaveText("Geste annulé : retour à l'état d'avant le glisser.");
  await expect(status).toHaveText("Sélection : Tronçon 2");
  await settle(page);

  // Largeur d'arrivée (bord extérieur, Maj) : le tronçon devient un trapèze.
  const endRight = plan.getByRole("slider", {
    name: "Largeur à l'arrivée du tronçon 2 (bord droit)",
  });
  const endLeft = plan.getByRole("slider", {
    name: "Largeur à l'arrivée du tronçon 2 (bord gauche)",
  });
  await expect(endRight).toHaveAttribute("aria-valuenow", "900");
  const er = await center(endRight);
  const el = await center(endLeft);
  const w = Math.hypot(er.x - el.x, er.y - el.y);
  const out = { x: er.x + ((er.x - el.x) / w) * 30, y: er.y + ((er.y - el.y) / w) * 30 };
  await dragFromTo(page, er, out, { shift: true });
  await settle(page);
  expect(await valueOf(endRight)).toBeGreaterThan(900);
  await expect(
    plan.getByRole("slider", { name: "Largeur au départ du tronçon 2 (bord droit)" }),
  ).toHaveAttribute("aria-valuenow", "900");

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test("cage-trapeze : angle de jonction glissé de 90° à 60° (accroche), clavier", async ({
  page,
}) => {
  const plan = await openSitePlan(page, CAGE_TRAPEZE, "cage-trapeze.blondel.json");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  await plan.getByRole("button", { name: "Jonction 1", exact: true }).click();
  const angle = plan.getByRole("slider", { name: "Angle de la jonction 1", exact: true });
  await expect(angle).toHaveAttribute("aria-valuenow", "90");
  await expect(angle).toHaveAttribute("aria-valuetext", "90°");

  // Trajet de la poignée autour du pivot (trait de rappel), dans le repère du site : −10°,
  // −20°, −28° (sens horaire vu de dessus), projeté à l'écran.
  const path = await plan.evaluate((svg) => {
    const line = svg.querySelector<SVGLineElement>(".plan-editor__handle-guide")!;
    const ctm = line.getScreenCTM()!;
    const [x1, y1, x2, y2] = [line.x1, line.y1, line.x2, line.y2].map((a) => a.baseVal.value);
    const at = (deg: number) => {
      const a = (-deg * Math.PI) / 180;
      const p = new DOMPoint(
        x1! + (x2! - x1!) * Math.cos(a) - (y2! - y1!) * Math.sin(a),
        y1! + (x2! - x1!) * Math.sin(a) + (y2! - y1!) * Math.cos(a),
      ).matrixTransform(ctm);
      return { x: p.x, y: p.y };
    };
    return [at(0), at(10), at(20), at(28)];
  });
  await dragFromTo(page, path[0]!, path.slice(1), { steps: 4 });
  await settle(page);
  await expect(angle).toHaveAttribute("aria-valuenow", "60");
  await expect(page.getByTestId("plan-drag-status")).toHaveText("Accroche : 60°");

  // Clavier : 1°, 15° avec Maj.
  await angle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(angle).toHaveAttribute("aria-valuenow", "61");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(angle).toHaveAttribute("aria-valuenow", "46");
  await settle(page);

  // Tracé : la jonction est à 46°, le tracé reste libre ; annulations : clavier, puis le geste.
  const panel = await openSection(page, "Tracé");
  await expect(panel.getByLabel("Type de tracé", { exact: true })).toHaveValue("cage");
  const summary = panel.getByRole("list", { name: "Tronçons et jonctions du tracé libre" });
  await expect(summary.getByRole("listitem").nth(1)).toHaveText(/^Jonction 1 : 46°/);
  await undo.click();
  await expect(summary.getByRole("listitem").nth(1)).toHaveText(/^Jonction 1 : 60°/);
  await undo.click();
  await expect(summary.getByRole("listitem").nth(1)).toHaveText(/^Jonction 1 : 90°/);

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

// ------------------------------------------------- Aperçu et conflits interactifs (sous-lot 4c)

const J3A = fileURLToPath(
  new URL("../../../examples/j3a-acceptance-01-bois.blondel.json", import.meta.url),
);

interface ModelStats {
  builds: number;
  previews: number;
  previewsPublished: number;
}

const modelStats = (page: Page): Promise<ModelStats> =>
  page.evaluate(() =>
    (window as Window & { __blondelModelStats?: () => ModelStats }).__blondelModelStats!(),
  );

/**
 * Mur M1 (200 mm) perpendiculaire au tronçon 2 de cage-60, à 300 mm de son nu devant la ligne
 * d'arrivée : dégagement d'arrivée insuffisant (avertissement), et le tronçon allongé de 450 mm
 * environ l'atteint (erreur « mur »).
 */
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

/** Point de l'écran d'un point du repère du site, par le repère d'un élément du plan. */
async function screenPoint(plan: Locator, selector: string, kind: "centroid" | "hit") {
  return plan.evaluate(
    (svg, args) => {
      const el = svg.querySelector<SVGPolygonElement>(args.selector);
      const ctm = el?.getScreenCTM();
      if (!el || !ctm) return null;
      const pts = Array.from(el.points);
      if (args.kind === "centroid") {
        const c = new DOMPoint(
          pts.reduce((s, p) => s + p.x, 0) / pts.length,
          pts.reduce((s, p) => s + p.y, 0) / pts.length,
        ).matrixTransform(ctm);
        return { x: c.x, y: c.y };
      }
      // Point de la zone qu'aucun élément de l'escalier ou du site ne recouvre.
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      for (const t of [0.5, 0.7, 0.3, 0.85, 0.15, 0.95]) {
        for (const p of pts) {
          const q = new DOMPoint(cx + (p.x - cx) * t, cy + (p.y - cy) * t).matrixTransform(ctm);
          if (document.elementFromPoint(q.x, q.y) === el) return { x: q.x, y: q.y };
        }
      }
      return null;
    },
    { selector, kind },
  );
}

test("cage-60 et un mur : bulle et sélection d'un conflit, conflit en aperçu pendant le glisser, un modèle au relâchement, Ctrl+Z", async ({
  page,
}) => {
  const plan = await openSitePlan(page, CAGE_60, "cage-60-mur.blondel.json", addWallNearArrival);
  const status = page.getByTestId("plan-selection");
  const tooltip = page.getByTestId("plan-conflict-tooltip");
  const conflictsStatus = page.getByTestId("plan-conflicts-status");
  const wallConflict = plan.locator('.plan-editor__conflict[data-kind="wall"]');
  const arrival = '.plan-editor__conflict[data-kind="arrivalClearance"]';
  await expect(plan.locator(arrival)).toHaveCount(1);
  await expect(wallConflict).toHaveCount(0);
  await expect(conflictsStatus).toContainText("Dégagement d'arrivée insuffisant");

  // Survol de la zone du conflit : bulle avec la sévérité et le message traduit.
  const inside = await screenPoint(plan, arrival, "centroid");
  await page.mouse.move(inside!.x, inside!.y);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(
    /^Avertissement : Dégagement d'arrivée insuffisant : le mur « M1 »/,
  );
  await page.mouse.move(5, 5);
  await expect(tooltip).toHaveCount(0);

  // Clic dans la zone du conflit, hors de l'escalier et du mur : le mur visé est sélectionné.
  const hit = '.plan-editor__conflict-hit[data-kind="arrivalClearance"]';
  const free = await screenPoint(plan, hit, "hit");
  expect(free, "point libre de la zone du conflit").not.toBeNull();
  await page.mouse.click(free!.x, free!.y);
  await expect(status).toHaveText("Sélection : Mur M1");
  // Clavier : focus de la zone (bulle), Entrée sélectionne.
  await page.keyboard.press("Escape");
  await expect(status).toHaveText(/Aucune sélection/);
  const button = plan.getByRole("button", { name: /^Avertissement : Dégagement d'arrivée/ });
  await button.focus();
  await expect(tooltip).toHaveText(/^Avertissement : Dégagement/);
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Sélection : Mur M1");
  // Le tronçon reste sélectionnable par-dessus les zones (règle d'empilement).
  await page.keyboard.press("Escape");
  await plan.getByRole("button", { name: "Tronçon 2", exact: true }).click();
  await expect(status).toHaveText("Sélection : Tronçon 2");
  // Bulle de survol, tronçon focalisé : masquée quand le pointeur quitte le plan.
  await page.mouse.move(inside!.x, inside!.y);
  await expect(tooltip).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(tooltip).toHaveCount(0);
  await settle(page);
  await takeLongTasks(page);

  // Glisser de la fin du tronçon 2 (Maj : sans accroche) vers le mur, bouton maintenu.
  const end = plan.getByRole("slider", { name: "Longueur du tronçon 2", exact: true });
  const sl = await center(
    plan.getByRole("slider", { name: "Largeur au départ du tronçon 2 (bord gauche)" }),
  );
  const sr = await center(
    plan.getByRole("slider", { name: "Largeur au départ du tronçon 2 (bord droit)" }),
  );
  const pxPerMm = Math.hypot(sr.x - sl.x, sr.y - sl.y) / 900;
  const e0 = await center(end);
  const mid = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 };
  const n = Math.hypot(e0.x - mid.x, e0.y - mid.y);
  const target = {
    x: e0.x + ((e0.x - mid.x) / n) * 560 * pxPerMm,
    y: e0.y + ((e0.y - mid.y) / n) * 560 * pxPerMm,
  };
  const before = await modelStats(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(e0.x, e0.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 20 });
  // Pendant le geste : le conflit avec le mur apparaît (aperçu), sans modèle complet.
  await expect(wallConflict).toHaveCount(1);
  await expect(conflictsStatus).toHaveAttribute("data-preview", "true");
  await expect(conflictsStatus).not.toContainText("empiète sur le mur");
  const during = await modelStats(page);
  expect(during.previews).toBeGreaterThan(before.previews);
  expect(during.previewsPublished).toBeGreaterThan(before.previewsPublished);
  expect(during.builds).toBe(before.builds);
  // Les poignées suivent l'aperçu : la fin du tronçon est sous le pointeur.
  const e1 = await center(end);
  expect(Math.hypot(e1.x - target.x, e1.y - target.y)).toBeLessThan(6);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  // Un seul modèle complet au relâchement ; la liste annoncée change à la fin du geste.
  expect((await modelStats(page)).builds).toBe(before.builds + 1);
  await expect(wallConflict).toHaveCount(1);
  await expect(conflictsStatus).not.toHaveAttribute("data-preview", "true");
  await expect(conflictsStatus).toContainText(
    "Erreur : L'escalier (structure comprise) empiète sur le mur « M1 »",
  );
  expect(await valueOf(end)).toBeGreaterThan(2100);

  // Annulation (Ctrl+Z) : le conflit disparaît.
  await page.keyboard.press("Control+z");
  await expect(end).toHaveAttribute("aria-valuenow", "1650");
  await expect(wallConflict).toHaveCount(0);
  await expect(conflictsStatus).not.toContainText("empiète sur le mur");
  await settle(page);

  // Déplacement de l'escalier (report d'affichage) : les conflits liés au site (dégagement
  // devant le mur) ne suivent pas l'escalier, ils sont masqués jusqu'au modèle suivant.
  await page.keyboard.press("Escape");
  const stairEdge = await hitPoint(plan, '[data-plan-select="stair"]', "edge");
  await page.mouse.click(stairEdge!.x, stairEdge!.y);
  await expect(status).toHaveText("Sélection : Escalier");
  const move = plan.getByRole("slider", { name: "Déplacer l'escalier", exact: true });
  const m0 = await center(move);
  await page.keyboard.down("Shift");
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m0.x + 4, m0.y, { steps: 4 });
  await expect(plan.locator('.plan-editor__layer--stair[data-transformed="true"]')).toHaveCount(1);
  await expect(plan.locator(arrival)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
  await expect(plan.locator(arrival)).toHaveCount(1);

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test(`glisser d'une longueur, cage-60 et j3a : aperçus pendant le geste, un modèle au relâchement (tâches ≤ 200 ms)`, async ({
  page,
}) => {
  for (const [file, name, section] of [
    [CAGE_60, "cage-60.blondel.json", "Tronçon 2"],
    [J3A, "j3a.blondel.json", "Tronçon 2"],
  ] as const) {
    const plan = await openSitePlan(page, file, name);
    await plan.getByRole("button", { name: section, exact: true }).click();
    const end = plan.getByRole("slider", {
      name: `Longueur du ${section.toLowerCase()}`,
      exact: true,
    });
    await expect(end).toBeVisible();
    // Position de la poignée (j3a : tracé à volées avec poteau, valeur sans curseur ARIA).
    const at0 = await end.evaluate((c) => `${c.getAttribute("cx")} ${c.getAttribute("cy")}`);
    await settle(page);
    await takeLongTasks(page);
    const before = await modelStats(page);
    const e0 = await center(end);
    // Aller-retour le long du plan (Maj : sans accroche), 40 pas.
    await page.keyboard.down("Shift");
    await page.mouse.move(e0.x, e0.y);
    await page.mouse.down();
    await page.mouse.move(e0.x + 40, e0.y - 30, { steps: 20 });
    await page.mouse.move(e0.x - 30, e0.y + 20, { steps: 20 });
    await expect
      .poll(async () => (await modelStats(page)).previewsPublished)
      .toBeGreaterThan(before.previewsPublished);
    // Un aperçu avec tracé est affiché (pas un aperçu en échec), et la poignée l'a suivi.
    await expect(page.getByTestId("plan-conflicts-status"), name).toHaveAttribute(
      "data-preview",
      "true",
    );
    expect(
      await end.evaluate((c) => `${c.getAttribute("cx")} ${c.getAttribute("cy")}`),
      name,
    ).not.toBe(at0);
    expect((await modelStats(page)).builds, name).toBe(before.builds);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await settle(page);
    const after = await modelStats(page);
    expect(after.previews, name).toBeGreaterThan(before.previews);
    expect(after.builds - before.builds, name).toBe(1);
    expect(
      await end.evaluate((c) => `${c.getAttribute("cx")} ${c.getAttribute("cy")}`),
      name,
    ).not.toBe(at0);
    const tasks = await takeLongTasks(page);
    const over = overBudget(tasks);
    expect(over, `${name}\n${describeTasks(over, tasks)}`).toEqual([]);
  }
});

// ------------------------------------------------------------- Inspecteur du plan (sous-lot 4d)

/** Inspecteur de la sélection (panneau de l'éditeur de plan). */
const inspector = (page: Page): Locator =>
  page.getByRole("region", { name: "Propriétés de la sélection", exact: true });

test("inspecteur : angle de jonction à 60°, refus sous le champ, origine de l'escalier, une validation = une annulation", async ({
  page,
}) => {
  const plan = await openSitePlan(page, CAGE_TRAPEZE, "cage-trapeze.blondel.json");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  await plan.getByRole("button", { name: "Jonction 1", exact: true }).click();
  const panel = inspector(page);
  await expect(panel.getByRole("group", { name: "Jonction 1", exact: true })).toBeVisible();
  const angleField = panel.getByLabel("Angle de la jonction", { exact: true });
  await expect(angleField).toHaveValue("90");
  const angle = plan.getByRole("slider", { name: "Angle de la jonction 1", exact: true });

  // Hors domaine : refus affiché sous le champ, projet inchangé.
  await angleField.fill("200");
  await angleField.press("Enter");
  await expect(panel.getByRole("alert")).toContainText("hors domaine");
  await expect(angleField).toHaveAttribute("aria-invalid", "true");
  await expect(angle).toHaveAttribute("aria-valuenow", "90");

  // 60° au clavier : une entrée d'historique, la poignée suit.
  await angleField.fill("60");
  await angleField.press("Enter");
  await settle(page);
  await expect(angle).toHaveAttribute("aria-valuenow", "60");
  await expect(angleField).toHaveValue("60");
  await expect(panel.getByRole("alert")).toHaveCount(0);

  // Raccord du jour en arc : rayon repris d'une valeur de départ, réglable.
  await panel.getByLabel("Raccord côté jour", { exact: true }).selectOption("arc");
  await settle(page);
  const radius = panel.getByLabel("Rayon du raccord côté jour", { exact: true });
  await expect(radius).toBeVisible();
  await undo.click();
  await settle(page);
  await expect(radius).toHaveCount(0);

  // Escalier : origine saisie au clavier, la poignée de déplacement suit.
  const stairEdge = await hitPoint(plan, '[data-plan-select="stair"]', "edge");
  await page.mouse.click(stairEdge!.x, stairEdge!.y);
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Escalier");
  const x = panel.getByLabel("Origine de l'escalier : X", { exact: true });
  await x.fill("250");
  await x.press("Enter");
  await settle(page);
  await expect(
    plan.getByRole("slider", { name: "Déplacer l'escalier", exact: true }),
  ).toHaveAttribute("aria-valuetext", /^x 250 mm/);
  // Tracé libre : pas de conversion proposée.
  await expect(panel.getByRole("button", { name: "Convertir en tracé libre" })).toHaveCount(0);

  // Deux validations, deux annulations : retour à 90°, puis à l'import seul.
  await undo.click();
  await undo.click();
  await settle(page);
  await plan.getByRole("button", { name: "Jonction 1", exact: true }).click();
  await expect(panel.getByLabel("Angle de la jonction", { exact: true })).toHaveValue("90");
  await undo.click();
  await expect(undo).toBeDisabled();

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test("inspecteur : insérer un palier, couper un tronçon (refus puis coupe), Suppr retire un tronçon", async ({
  page,
}) => {
  const plan = await openSitePlan(page, CAGE_60, "cage-60.blondel.json");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const panel = inspector(page);
  const sectionBtn = (n: number) => plan.getByRole("button", { name: `Tronçon ${n}`, exact: true });
  await expect(sectionBtn(3)).toHaveCount(0);

  // Tronçon 2 : palier droit inséré au milieu (montée allongée) → trois tronçons.
  await sectionBtn(2).click();
  const actions = panel.getByRole("group", { name: "Actions sur le tronçon 2", exact: true });
  await actions.getByRole("button", { name: "Insérer un palier", exact: true }).click();
  await settle(page);
  await expect(sectionBtn(3)).toHaveCount(1);
  await expect(plan.getByRole("button", { name: "Jonction 2", exact: true })).toHaveCount(1);

  // Couper le tronçon 2 (825 mm) par un palier de 900 mm : refusé, motif affiché, rien ne change.
  await actions.getByRole("button", { name: "Couper le tronçon", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Modification refusée");
  await expect(sectionBtn(4)).toHaveCount(0);

  // Couper le tronçon 1 (1 650 mm) : palier pris sur la partie droite → quatre tronçons.
  await sectionBtn(1).click();
  await panel
    .getByRole("group", { name: "Actions sur le tronçon 1", exact: true })
    .getByRole("button", { name: "Couper le tronçon", exact: true })
    .click();
  await settle(page);
  await expect(sectionBtn(4)).toHaveCount(1);

  // Suppr sur le tronçon 4 sélectionné (au plan) : retiré, sélection effacée.
  await sectionBtn(4).click();
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Tronçon 4");
  await page.keyboard.press("Delete");
  await settle(page);
  await expect(sectionBtn(4)).toHaveCount(0);
  await expect(page.getByTestId("plan-selection")).toHaveText(/Aucune sélection/);

  // Bouton « Supprimer le tronçon » de l'inspecteur : même chemin que Suppr.
  await sectionBtn(3).click();
  await panel
    .getByRole("group", { name: "Actions sur le tronçon 3", exact: true })
    .getByRole("button", { name: "Supprimer le tronçon", exact: true })
    .click();
  await settle(page);
  await expect(sectionBtn(3)).toHaveCount(0);
  await expect(page.getByTestId("plan-selection")).toHaveText(/Aucune sélection/);
  await sectionBtn(2).click();
  await page.keyboard.press("Delete");
  await settle(page);
  await expect(sectionBtn(2)).toHaveCount(0);

  // Suppr sur le dernier tronçon : refusé, motif affiché, sélection et tracé gardés.
  await sectionBtn(1).click();
  await page.keyboard.press("Delete");
  await expect(
    page
      .getByRole("complementary", { name: "Import et saisie du site", exact: true })
      .getByRole("alert"),
  ).toContainText("Modification refusée");
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Tronçon 1");
  await expect(sectionBtn(1)).toHaveCount(1);

  // Cinq modifications, cinq annulations, puis l'import.
  for (const n of [2, 3, 4, 3, 2]) {
    await undo.click();
    await settle(page);
    await expect(sectionBtn(n)).toHaveCount(1);
    await expect(sectionBtn(n + 1)).toHaveCount(0);
  }
  await undo.click();
  await expect(undo).toBeDisabled();

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});

test("convertir un escalier à volées en tracé libre, annuler ; limons à la française, crémaillères puis limon central sur une cage : erreur lisible, puis « aucune »", async ({
  page,
}) => {
  await openApp(page);
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  await settle(page);
  await takeLongTasks(page);
  const plan = page.getByRole("group", {
    name: "Plan du site : calque de fond, murs, trémie et escalier",
  });
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  const panel = inspector(page);

  // Escalier droit (volées) sélectionné : « Convertir en tracé libre », annulable.
  const stairEdge = await hitPoint(plan, '[data-plan-select="stair"]', "edge");
  await page.mouse.click(stairEdge!.x, stairEdge!.y);
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Escalier");
  await panel.getByRole("button", { name: "Convertir en tracé libre", exact: true }).click();
  await expect(panel.getByTestId("plan-inspector-remark")).toHaveText(
    "Tracé converti en tracé libre (annulable).",
  );
  await expect(panel.getByRole("button", { name: "Convertir en tracé libre" })).toHaveCount(0);

  // Tronçon unique « auto » : la partie droite retenue par le calcul est affichée, « Imposer »
  // fixe cette valeur (et non une valeur de départ).
  await plan.getByRole("button", { name: "Tronçon 1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Tronçon 1");
  await panel.getByRole("button", { name: "Partie droite : automatique", exact: true }).click();
  await settle(page);
  const computedLength = panel.getByRole("button", { name: /^Partie droite : imposer \d/ });
  await expect(computedLength).toBeVisible();
  const retained = ((await computedLength.textContent()) ?? "").replace(/\D/g, "");
  expect(Number(retained)).toBeGreaterThan(1000);
  await panel.getByRole("button", { name: "Imposer", exact: true }).click();
  await settle(page);
  await expect(panel.getByRole("textbox", { name: "Partie droite", exact: true })).toHaveValue(
    retained,
  );
  await undo.click();
  await settle(page);
  await expect(computedLength).toBeVisible();
  await undo.click();
  await settle(page);

  const layout = await openSection(page, "Tracé");
  const kind = layout.getByLabel("Type de tracé", { exact: true });
  await expect(kind).toHaveValue("cage");
  await undo.click();
  await settle(page);
  await expect(kind).toHaveValue("flights");

  // Modification qui ne s'écrit plus en volées (largeur d'arrivée différente) : passage en tracé
  // libre annoncé, annulable.
  await openTab(page, "Plan");
  // Au clavier (la poignée de déplacement de l'escalier sélectionné couvre le milieu du tronçon).
  await plan.getByRole("button", { name: "Tronçon 1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Tronçon 1");
  const widthEnd = panel.getByLabel("Largeur à l'arrivée", { exact: true });
  await widthEnd.fill("1000");
  await widthEnd.press("Enter");
  await expect(panel.getByTestId("plan-inspector-remark")).toHaveText(
    /^Le tracé est passé en tracé libre/,
  );
  await settle(page);
  await expect(kind).toHaveValue("cage");
  await undo.click();
  await settle(page);
  await expect(kind).toHaveValue("flights");

  // Section Tracé : même action ; la section passe au résumé du tracé libre.
  await layout.getByRole("button", { name: "Convertir en tracé libre", exact: true }).click();
  await settle(page);
  await expect(kind).toHaveValue("cage");
  // Le bouton disparaît avec la conversion : la remarque passe par la notification du store.
  await expect(
    page.getByRole("status").filter({ hasText: "Tracé converti en tracé libre (annulable)." }),
  ).toBeVisible();
  await expect(
    layout.getByRole("list", { name: "Tronçons et jonctions du tracé libre" }),
  ).toBeVisible();

  // Limons à la française sur la cage (sous-lot 6a) : générés, sans erreur.
  const errors = page.locator(".figure-line__errors");
  await chooseStructure(page, "wood-housed");
  await expect(errors).toHaveCount(0);

  // Crémaillères bois sur la cage (sous-lot 6b, tronçon droit unique) : générées, sans erreur.
  await chooseStructure(page, "wood-cut");
  await expect(errors).toHaveCount(0);

  // Limon central acier sur la cage : structure non générée, erreur lisible.
  await chooseStructure(page, "steel-central");
  await expect(errors).toHaveAttribute("title", /pas encore disponible pour ce tracé libre/);

  // Inspecteur de l'escalier : correction « Reconvertir en volées » proposée.
  // La sélection du plan (tronçon 1) survit au changement d'onglet, de tracé et de structure.
  await openTab(page, "Plan");
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Tronçon 1");
  const edge = await hitPoint(plan, '[data-plan-select="stair"]', "edge");
  await page.mouse.click(edge!.x, edge!.y);
  await expect(page.getByTestId("plan-selection")).toHaveText("Sélection : Escalier");
  await expect(
    panel.getByRole("button", { name: /^Reconvertir le tracé libre en volées/ }),
  ).toBeVisible();

  // Structure « aucune » : plus d'erreur, plus de correction.
  await chooseStructure(page, "none");
  await expect(errors).toHaveCount(0);
  await openTab(page, "Plan");
  await expect(panel.getByRole("button", { name: /^Reconvertir le tracé libre/ })).toHaveCount(0);

  await settle(page);
  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  expect(over, describeTasks(over, tasks)).toEqual([]);
});
