/**
 * Éditeur de plan en calques (ADR-0010, sous-lot 4a) : exemple cage-60 importé, plan « Site et
 * saisie » ; outil « Sélectionner » par défaut, sélection d'un tronçon puis d'une jonction au
 * clic (surbrillance, libellé), Échap et clic dans le vide désélectionnent, sélection au clavier
 * (Entrée) ; escalier et trémie pris par leur contour, intérieur de la trémie traversé jusqu'à la
 * jonction ; un glisser sur un élément déplace la vue sans sélectionner ; calque des conflits
 * d'adéquation au site (`Model.siteFit`) affiché ; la sélection ne crée aucune entrée
 * d'historique (une seule annulation ramène avant l'import) ; section Tracé d'une cage (résumé,
 * « Tracé libre », pas d'emmarchement global) ; budget des tâches longues respecté.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
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

async function importProject(page: Page, file: string, name: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Projet (.blondel.json)…" }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: "application/json", buffer: readFileSync(file) });
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
