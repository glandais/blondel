import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, vec2, type Project, type Wall } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { installationSheet, wallOffset } from "./installation.js";
import { RecordingCanvas, helveticaMeasure } from "./pdf/canvas.js";
import { renderPdf } from "./pdf/document.js";
import { installationLines, openingEdgeLabel } from "./pdf/installation.js";
import { sampleProject, straightModel } from "./testing/fixtures.js";

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness: number,
  id = "W",
): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness,
  loadBearing: false,
});

describe("fiche de pose : cotes aux nus des murs", () => {
  it("mur horizontal d'axe y = −100, épaisseur 200 : nu en y = 0", () => {
    const w = wall(-1000, -100, 3000, -100, 200);
    expect(wallOffset(w, { x: 0, y: 0 })).toMatchObject({
      distance: 0,
      onWall: true,
      foot: { x: 0, y: 0 },
    });
    expect(wallOffset(w, { x: 500, y: 300 })!.distance).toBeCloseTo(300, 12);
    expect(wallOffset(w, { x: 5000, y: 300 })).toMatchObject({ onWall: false });
    // De l'autre côté : nu en y = −200.
    expect(wallOffset(w, { x: 0, y: -450 })!.distance).toBeCloseTo(250, 12);
    expect(wallOffset(w, { x: 0, y: -450 })!.foot.y).toBeCloseTo(-200, 12);
    expect(wallOffset(wall(0, 0, 0, 0, 100), { x: 1, y: 1 })).toBeUndefined();
  });

  it("propriété : le pied est sur le nu, à la distance annoncée, perpendiculairement au mur", () => {
    const c = fc.double({ min: -5000, max: 5000, noNaN: true });
    fc.assert(
      fc.property(
        c,
        c,
        c,
        c,
        fc.integer({ min: 50, max: 500 }),
        c,
        c,
        (ax, ay, bx, by, t, px, py) => {
          fc.pre(Math.hypot(bx - ax, by - ay) > 10);
          const w = wall(ax, ay, bx, by, t);
          const p = { x: px, y: py };
          const o = wallOffset(w, p)!;
          const u = vec2.normalize(vec2.sub(w.b, w.a));
          // Pied à t/2 de l'axe ; segment point → pied perpendiculaire au mur.
          const n = vec2.perpLeft(u);
          expect(Math.abs(Math.abs(vec2.dot(vec2.sub(o.foot, w.a), n)) - t / 2)).toBeLessThan(1e-6);
          expect(Math.abs(vec2.dot(vec2.sub(p, o.foot), u))).toBeLessThan(1e-6);
          expect(Math.abs(vec2.distance(p, o.foot) - Math.abs(o.distance))).toBeLessThan(1e-6);
        },
      ),
    );
  });
});

describe("fiche de pose : données", () => {
  it("modèle synthétique : départ, arrivée, trémie, hauteurs", () => {
    const project: Project = {
      ...sampleProject(),
      site: { ...sampleProject().site, walls: [wall(-100, -500, -100, 5000, 200, "M1")] },
    };
    const model = straightModel();
    const s = installationSheet(model, project);
    expect(s.points.map((p) => p.id)).toEqual([
      "start-inner",
      "start-outer",
      "start-walkline",
      "end-inner",
      "end-outer",
    ]);
    expect(s.startWidth).toBeCloseTo(vec2.distance(s.points[0]!.at, s.points[1]!.at), 12);
    expect(s.diagonals).toHaveLength(2);
    // Mur d'axe x = −100, épaisseur 200 : nu en x = 0 ; distance = abscisse du point.
    for (const o of s.walls) {
      const p = s.points.find((q) => q.id === o.pointId)!;
      expect(o.wallId).toBe("M1");
      expect(o.distance).toBeCloseTo(p.at.x, 9);
    }
    expect(s.opening?.outline).toHaveLength(4);
    expect(s.heights.count).toBe(model.stepping.riserCount);
    expect(s.heights.total).toBe(2700);
    expect(s.nosings).toHaveLength(model.stepping.nosings.length);
    expect(s.hasSite).toBe(true);
    const bare = installationSheet(model);
    expect(bare.walls).toEqual([]);
    expect(bare.opening).toBeUndefined();
    expect(bare.hasSite).toBe(false);
  });

  it("critère n° 1 : points au nu des murs du relevé, tolérance de la 1re marche lue dans le contrôle", () => {
    const project = parseProjectText(
      readFileSync(join(EXAMPLES, "j4-acceptance-01-garde-corps.blondel.json"), "utf8"),
    );
    const model = buildModel(project);
    const s = installationSheet(model, project);
    expect(s.startWidth).toBeCloseTo(
      project.stair.layout.kind === "helical" ? 0 : project.stair.layout.width,
      6,
    );
    expect(s.wallIds.length).toBe(project.site.walls.length);
    expect(s.walls.length).toBe(4 * project.site.walls.length);
    const rule = model.compliance.results.find((r) => r.ruleId === "H_PREMIERE_MARCHE_TOL");
    if (rule && typeof rule.min === "number" && typeof rule.max === "number") {
      expect(s.heights.firstTolerance).toEqual({
        min: rule.min,
        max: rule.max,
        source: rule.source,
      });
    }
    // Dossier : la fiche de pose imprime les points, cotes, diagonales et hauteurs.
    const cv = new RecordingCanvas(297, 210, helveticaMeasure());
    const pages = renderPdf(cv, model, {
      project,
      pages: {
        toc: false,
        plan: false,
        elevation: false,
        bom: false,
        cutsheet: false,
        compliance: false,
        flats: false,
        templates: false,
      },
    });
    expect(pages.map((p) => p.kind)).toEqual(["installation", "installation"]);
    expect(pages[0]!.scale).toBeGreaterThan(0);
    const text = cv.pageTexts().flat().join("\n");
    for (const t of [
      "Départ, rive",
      "Arrivée, rive",
      "Diagonale",
      "Cotes aux nus des murs",
      "Hauteur à monter H",
      "Épure au sol",
    ]) {
      expect(text).toContain(t);
    }
    for (const w of project.site.walls) expect(text).toContain(w.id);
    // Chaque bord de trémie cité dans les cotes est repéré sur le plan (texte seul = repère).
    const pageTexts = cv.pageTexts()[0]!;
    for (const o of s.opening!.offsets) {
      expect(text).toContain(`bord ${openingEdgeLabel(o.edge)} :`);
      expect(pageTexts).toContain(openingEdgeLabel(o.edge));
    }
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it("tolérance de la 1re marche : écarts signés, jamais « +- »", () => {
    const base = installationSheet(straightModel());
    const line = (min: number, max: number): string =>
      installationLines({
        ...base,
        heights: { ...base.heights, firstTolerance: { min, max, source: "S" } },
      }).find((l) => l.text.startsWith("Tolérance de la 1re marche"))!.text;
    expect(line(-30, 10)).toContain(": -30 / +10 mm (S)");
    expect(line(-30, -5)).toContain(": -30 / -5 mm (S)");
    expect(line(-30, -5)).not.toContain("+-");
  });
});
