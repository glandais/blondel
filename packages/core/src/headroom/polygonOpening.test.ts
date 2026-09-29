/**
 * Trémie polygonale dans le pipeline (jalon 7) : échappée et garde-corps de trémie calculés
 * sur un contour quelconque (sommets dans un ordre et à partir d'un sommet quelconques, sens
 * horaire, sommets alignés, contour concave, trémie relevée par 4 côtés + 2 diagonales).
 */
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { computeGuards } from "../guards/compute.js";
import { computeLayout } from "../layout/layout.js";
import type { Model } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import { ProjectSchema, type Opening, type Project } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { createProject, PRESET_IDS } from "../project/presets.js";
import { openingFromSurvey } from "../site/survey.js";
import { computeStepping } from "../stepping/stepping.js";
import { computeHeadroom, openingPolygon } from "./headroom.js";

beforeEach(() => clearModelCache());

const withOpening = (p: Project, opening: Opening): Project =>
  ProjectSchema.parse({ ...p, site: { ...p.site, opening } });

/** Projet de préréglage avec garde-corps (trémie comprise). */
const guarded = (id: (typeof PRESET_IDS)[number]): Project =>
  ProjectSchema.parse({ ...createProject(id), guards: {} });

function rectPoints(o: Opening): Vec2[] {
  if (o.kind !== "rect") throw new Error("rect attendu");
  return [
    { x: o.x, y: o.y },
    { x: o.x + o.sizeX, y: o.y },
    { x: o.x + o.sizeX, y: o.y + o.sizeY },
    { x: o.x, y: o.y + o.sizeY },
  ];
}

/** Résumé comparable d'un modèle : échappées, pièces de garde-corps, contrôles de trémie. */
function summary(m: Model) {
  const guardParts = m.parts
    .filter((p) => p.id.startsWith("guard-") || /^(PG|BA|MC)/.test(p.mark ?? ""))
    .map((p) => p.id)
    .sort();
  const checks = m.compliance.results
    .filter((r) => /^(ECHAPPEE|GC_|MC_)/.test(r.ruleId))
    .map(
      (r) =>
        `${r.ruleId}:${r.status}:${r.measured === undefined ? "" : Math.round(r.measured * 1000) / 1000}`,
    )
    .sort();
  return {
    errors: m.errors,
    headroom: m.headroom ? Math.round(m.headroom.min * 1e6) / 1e6 : null,
    headroomWidth: m.headroomWidth ? Math.round(m.headroomWidth.min * 1e6) / 1e6 : null,
    guardParts,
    checks,
  };
}

describe("trémie polygonale — équivalence avec la trémie rectangulaire", () => {
  const ids = PRESET_IDS.filter((id) => createProject(id).site.opening?.kind === "rect");

  it.each(ids)(
    "%s : même échappée, mêmes garde-corps et contrôles, quel que soit le premier sommet et le sens",
    (id) => {
      const base = guarded(id);
      const rect = base.site.opening!;
      const ref = summary(buildModel(base));
      expect(ref.errors).toEqual([]);
      const pts = rectPoints(rect);
      for (let start = 0; start < 4; start++) {
        for (const reversed of [false, true]) {
          let poly = [...pts.slice(start), ...pts.slice(0, start)];
          if (reversed) poly = poly.reverse();
          clearModelCache();
          const got = summary(buildModel(withOpening(base, { kind: "polygon", points: poly })));
          expect(got, `départ ${start}, ${reversed ? "horaire" : "trigonométrique"}`).toEqual(ref);
        }
      }
    },
  );

  it("sommets alignés ajoutés sur les côtés : même échappée, garde-corps de même longueur", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ids),
        fc.array(fc.double({ min: 0.05, max: 0.95, noNaN: true }), { minLength: 4, maxLength: 4 }),
        (id, ts) => {
          const base = guarded(id);
          const pts = rectPoints(base.site.opening!);
          const dense = pts.flatMap((p, i) => [p, V.lerp(p, pts[(i + 1) % 4]!, ts[i]!)]);
          const a = buildModel(base);
          const b = buildModel(withOpening(base, { kind: "polygon", points: dense }));
          expect(b.errors).toEqual([]);
          if (a.headroom) expect(b.headroom?.min).toBeCloseTo(a.headroom.min, 6);
          else expect(b.headroom).toBeUndefined();
          if (a.headroomWidth) expect(b.headroomWidth?.min).toBeCloseTo(a.headroomWidth.min, 6);
          const len = (p: Project) => {
            const layout = computeLayout(p);
            const g = computeGuards(p, layout, computeStepping(p, layout));
            return g.runs
              .filter((r) => r.kind === "opening")
              .reduce((s, r) => s + r.horizontalLength, 0);
          };
          expect(len(withOpening(base, { kind: "polygon", points: dense }))).toBeCloseTo(
            len(base),
            6,
          );
        },
      ),
      { numRuns: 20 },
    );
  });

  it("régression : sommet aligné à moins d'un millimètre de la fin d'un mur couvrant", () => {
    // Contre-exemple fast-check (droit, ts = [0,05 ; 0,05 ; 0,09 ; 0,05]) : le seuil de 1 mm
    // des portions libres, appliqué côté par côté, coupait 1 mm de garde-corps de trémie.
    const base = guarded("straight");
    const pts = rectPoints(base.site.opening!);
    const ts = [0.05, 0.05, 0.09, 0.05];
    const len = (p: Project) => {
      const layout = computeLayout(p);
      const g = computeGuards(p, layout, computeStepping(p, layout));
      return g.runs.filter((r) => r.kind === "opening").reduce((s, r) => s + r.horizontalLength, 0);
    };
    for (const t3 of [0.08, 0.085, 0.09, 0.095]) {
      ts[2] = t3;
      const dense = pts.flatMap((p, i) => [p, V.lerp(p, pts[(i + 1) % 4]!, ts[i]!)]);
      expect(len(withOpening(base, { kind: "polygon", points: dense })), `t = ${t3}`).toBeCloseTo(
        len(base),
        6,
      );
    }
  });
});

describe("trémie polygonale non rectangulaire", () => {
  it("contour concave en L : échappée et garde-corps de trémie sans erreur, chevêtre en biais compris", () => {
    const base = guarded("quarter-left");
    const [p0, p1, p2, p3] = rectPoints(base.site.opening!);
    // Coin opposé à l'arrivée entaillé (trémie en L) et côté d'arrivée en biais.
    const cut = 300;
    const L: Vec2[] = [
      p0!,
      p1!,
      { x: p2!.x, y: p2!.y - cut },
      { x: p2!.x - cut, y: p2!.y - cut },
      { x: p2!.x - cut, y: p2!.y },
      p3!,
    ];
    const project = withOpening(base, { kind: "polygon", points: L });
    const m = buildModel(project);
    expect(m.errors).toEqual([]);
    const layout = computeLayout(project);
    const stepping = computeStepping(project, layout);
    const h = computeHeadroom(project.site, layout, stepping)!;
    expect(h.opening).toEqual(openingPolygon(project.site.opening));
    const g = computeGuards(project, layout, stepping);
    const runs = g.runs.filter((r) => r.kind === "opening");
    expect(runs.length).toBeGreaterThan(0);
    // Le garde-corps de trémie longe le contour sur le plancher (recul vers l'extérieur).
    for (const r of runs) {
      for (const p of r.path) {
        const inside = h.opening!;
        expect(pointOutsideOrOn(p, inside)).toBe(true);
      }
    }
  });

  it("trémie relevée (4 côtés + 2 diagonales, hors d'équerre) : pipeline complet", () => {
    const base = guarded("straight");
    const rect = base.site.opening!;
    if (rect.kind !== "rect") throw new Error("rect attendu");
    const d = Math.hypot(rect.sizeX, rect.sizeY + 20);
    const r = openingFromSurvey(
      {
        ab: rect.sizeX,
        bc: rect.sizeY + 20,
        cd: rect.sizeX,
        da: rect.sizeY + 20,
        ac: d,
        bd: d - 15,
      },
      { origin: { x: rect.x, y: rect.y } },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = buildModel(withOpening(base, { kind: "polygon", points: [...r.points] }));
    expect(m.errors).toEqual([]);
    expect(m.headroom).toBeDefined();
  });
});

/** Vrai si p n'est pas strictement à l'intérieur du polygone (tolérance 1e-6). */
function pointOutsideOrOn(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    // Sur un côté : accepté.
    const ab = V.sub(b, a);
    const t = V.dot(V.sub(p, a), ab) / V.dot(ab, ab);
    if (t >= 0 && t <= 1 && V.distance(V.addScaled(a, ab, t), p) < 1e-6) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return !inside;
}
