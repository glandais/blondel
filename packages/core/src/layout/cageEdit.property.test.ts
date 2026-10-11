/**
 * Propriétés des mutateurs du tracé (sous-lot 3a) sur des cages et des tracés à volées générés :
 * résultat relu à l'identique par `ProjectSchema`, cotes au mm et angles au degré entiers,
 * partage structurel, glisser idempotent, `insertSection` / `removeSection` réciproques,
 * `splitSection` qui garde la longueur et la ligne de foulée, `buildModel` sans exception.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveLength, curvePointAt } from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import type { EditResult } from "../model/edit.js";
import type { Layout } from "../model/derived.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { cageFeatures } from "../model/cageFeatures.js";
import { buildModel } from "../pipeline/build.js";
import {
  convertToCage,
  dragJunctionAngle,
  dragSectionEnd,
  dragWidth,
  insertLanding,
  insertSection,
  junctionFrame,
  removeSection,
  setJunctionAngle,
  setSectionLength,
  setSectionWidth,
  setWallJoint,
  setWellJoint,
  splitSection,
  withPlacement,
} from "./cageEdit.js";
import { computeLayout } from "./layout.js";

function project(layout: unknown, rotation: number): Project | null {
  const r = ProjectSchema.safeParse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200, walls: [] },
    stair: { placement: { origin: { x: 100, y: -50 }, rotation }, layout },
  });
  return r.success ? r.data : null;
}

const arbAnchor = fc.constantFrom(undefined, "left" as const, "right" as const, "center" as const);

const arbSection = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("straight" as const),
      length: fc.integer({ min: 0, max: 2500 }),
      width: fc.integer({ min: 600, max: 1300 }),
      widthEnd: fc.option(fc.integer({ min: 600, max: 1300 }), { nil: undefined }),
      anchor: arbAnchor,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("arc" as const),
      radius: fc.integer({ min: 1400, max: 4000 }),
      sweep: fc.integer({ min: 10, max: 200 }).chain((v) => fc.constantFrom(v, -v)),
      width: fc.integer({ min: 600, max: 1300 }),
      anchor: arbAnchor,
    }),
  },
);

const arbCage: fc.Arbitrary<CageLayoutSpecInput> = fc
  .integer({ min: 1, max: 4 })
  .chain((n) =>
    fc.record({
      sections: fc.array(arbSection, { minLength: n, maxLength: n }),
      junctions: fc.array(
        fc.oneof(fc.constantFrom(90, -90, 0), fc.integer({ min: -150, max: 150 })),
        { minLength: n - 1, maxLength: n - 1 },
      ),
    }),
  )
  .map(({ sections, junctions }) => ({
    kind: "cage" as const,
    sections: sections.map((s) => ({
      axis:
        s.kind === "straight"
          ? { kind: "straight" as const, length: s.length }
          : { kind: "arc" as const, radius: s.radius, sweep: s.sweep },
      width: s.width,
      ...(s.kind === "straight" && s.widthEnd !== undefined && s.length > 0
        ? { widthEnd: s.widthEnd }
        : {}),
      ...(s.anchor !== undefined ? { anchor: s.anchor } : {}),
    })),
    junctions: junctions.map((angle) => ({
      angle,
      mode: angle === 0 ? ("landing" as const) : ("winders" as const),
    })),
  }));

const arbFlights = fc
  .integer({ min: 1, max: 3 })
  .chain((n) =>
    fc.record({
      width: fc.integer({ min: 600, max: 1200 }),
      legs: fc.array(fc.integer({ min: 1300, max: 3500 }), { minLength: n, maxLength: n }),
      turns: fc.array(fc.constantFrom("left", "right"), { minLength: n - 1, maxLength: n - 1 }),
    }),
  )
  .map((f) => ({
    width: f.width,
    legs: f.legs.map((length) => ({ length })),
    turns: f.turns.map((direction) => ({ direction, mode: "winders" as const })),
  }));

const arbProject = fc
  .tuple(fc.oneof(arbCage, arbFlights), fc.integer({ min: -180, max: 180 }))
  .map(([layout, rot]) => project(layout, rot))
  .filter((p): p is Project => p !== null);

const isInt = (v: unknown) => typeof v !== "number" || (Number.isInteger(v) && !Object.is(v, -0));

/** Toutes les valeurs numériques du tracé et du placement sont entières. */
function expectIntegers(p: Project): void {
  const walk = (v: unknown): void => {
    if (typeof v === "number") expect(isInt(v)).toBe(true);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(p.stair.layout);
  walk(p.stair.placement);
}

function cageOf(p: Project): CageLayoutSpec {
  const c = p.stair.layout.kind === "cage" ? p : convertToCage(p).project;
  if (!c) throw new Error("tracé non convertible");
  return c.stair.layout as CageLayoutSpec;
}

function tryLayout(p: Project): Layout | null {
  try {
    return computeLayout(p);
  } catch {
    return null;
  }
}

/** Nombre de tronçons (volées ou tronçons d'une cage). */
function sectionCount(p: Project): number {
  const l = p.stair.layout;
  return l.kind === "cage" ? l.sections.length : l.kind === "helical" ? 1 : l.legs.length;
}

/** Indice tiré parmi `count` (au moins un : `count` = 0 donne un indice hors domaine). */
const pick = (a: number, count: number) => a % Math.max(1, count);

type Op = (p: Project, a: number, b: number) => EditResult;
const OPS: Record<string, Op> = {
  placement: (p, a, b) =>
    withPlacement(p, { origin: { x: a * 7.3, y: b * -3.1 }, rotation: a / 3 }),
  length: (p, a, b) => setSectionLength(p, pick(a, sectionCount(p)), b * 13.7),
  width: (p, a, b) => setSectionWidth(p, pick(a, sectionCount(p)), { width: 500 + b * 7.9 }),
  widthAll: (p, _a, b) => setSectionWidth(p, "all", { width: 500 + b * 7.9 }),
  widthEnd: (p, a, b) =>
    setSectionWidth(p, pick(a, sectionCount(p)), { widthEnd: 500 + b * 7.9, anchor: "right" }),
  angle: (p, a, b) => setJunctionAngle(p, pick(a, sectionCount(p) - 1), b * 1.7 - 170),
  well: (p, a, b) =>
    setWellJoint(p, pick(a, sectionCount(p) - 1), { kind: "arc", radius: 10 + b * 2.3 }),
  wall: (p, a, b) =>
    setWallJoint(p, pick(a, sectionCount(p) - 1), { kind: "arc", radius: 10 + b * 5.1 }),
  insert: (p, a, b) =>
    insertSection(p, pick(a, sectionCount(p) + 1), { length: b * 9.4, angle: (b % 3) * 45 }),
  remove: (p, a) => removeSection(p, pick(a, sectionCount(p))),
  split: (p, a, b) => splitSection(p, pick(a, sectionCount(p)), b * 11.1),
  landing: (p, a, b) => insertLanding(p, pick(a, sectionCount(p)), b * 11.1, 900 + b),
};

/**
 * Refus attendus : messages dédiés du tracé (`layout.edit.*`, `layout.cage.*`, volée trop
 * courte), jamais un problème de schéma générique (`project.issue.line`, texte zod non traduit).
 */
const EXPECTED_REFUSAL = /^layout\.(edit|cage)\.|^layout\.legTooShort$/;

describe("mutateurs du tracé : propriétés", () => {
  it("résultat relu à l'identique, entier, partagé ; sans effet = même projet", () => {
    fc.assert(
      fc.property(
        arbProject,
        fc.constantFrom(...Object.keys(OPS)),
        fc.nat(200),
        fc.nat(200),
        (p, name, a, b) => {
          const r = OPS[name]!(p, a, b);
          if (r.error) {
            expect(r.error.key).toMatch(EXPECTED_REFUSAL);
            return;
          }
          const q = r.project;
          expect(ProjectSchema.parse(JSON.parse(JSON.stringify(q)))).toStrictEqual(q);
          expectIntegers(q);
          expect(q.site).toBe(p.site);
          expect(q.stair.stepping).toBe(p.stair.stepping);
          expect(q.compliance).toBe(p.compliance);
          if (name !== "placement") expect(q.stair.placement).toBe(p.stair.placement);
          else expect(q.stair.layout).toBe(p.stair.layout);
          // Partage : une cage modifiée garde les tronçons et jonctions intacts (même objet).
          if (q !== p && p.stair.layout.kind === "cage" && q.stair.layout.kind === "cage") {
            const before = p.stair.layout;
            const after = q.stair.layout;
            if (name === "length") {
              after.sections.forEach((s, k) => {
                if (k !== pick(a, before.sections.length)) expect(s).toBe(before.sections[k]);
              });
              expect(after.junctions).toBe(before.junctions);
            }
            if (name === "angle") expect(after.sections).toBe(before.sections);
            // Largeur commune : aucune largeur d'arrivée écrite, tronçon déjà à cette largeur
            // gardé tel quel.
            if (name === "widthAll") {
              after.sections.forEach((s, k) => {
                expect(s.widthEnd).toBeUndefined();
                const old = before.sections[k]!;
                if (old.width === s.width && old.widthEnd === undefined) expect(s).toBe(old);
              });
            }
          }
          // Rejouer la même opération sur le résultat : idempotence des réglages absolus.
          if (
            [
              "length",
              "width",
              "widthAll",
              "widthEnd",
              "angle",
              "well",
              "wall",
              "placement",
            ].includes(name)
          ) {
            expect(OPS[name]!(q, a, b).project).toBe(q);
          }
        },
      ),
      { numRuns: 600 },
    );
  });

  it("insertSection puis removeSection rend la cage de départ", () => {
    fc.assert(
      fc.property(arbProject, fc.nat(10), fc.integer({ min: 0, max: 3000 }), (p, k, length) => {
        const start = convertToCage(p).project ?? null;
        if (start === null) return;
        const i = k % (cageOf(start).sections.length + 1);
        const q = insertSection(start, i, { length });
        if (q.error) return;
        const back = removeSection(q.project, i);
        if (back.error) {
          // Cage de départ déjà refusée par le moteur (partie droite nulle sans étendue) : le
          // retour y est refusé de même.
          expect(back.error.key).toBe("layout.cage.invalidSectionLength");
          expect(
            cageOf(start).sections.some((s) => s.axis.kind === "straight" && s.axis.length === 0),
          ).toBe(true);
          return;
        }
        expect(back.project).toStrictEqual(start);
      }),
      { numRuns: 300 },
    );
  });

  it("splitSection garde la longueur totale et la ligne de foulée (largeur constante)", () => {
    let checked = 0;
    fc.assert(
      fc.property(arbProject, fc.nat(3), fc.nat(1000), (p, k, at) => {
        if (convertToCage(p).error) return;
        const spec = cageOf(p);
        const i = k % spec.sections.length;
        const s = spec.sections[i]!;
        if (s.widthEnd !== undefined || s.axis.kind !== "straight" || s.axis.length === "auto")
          return;
        // Largeur uniforme (sinon Γ peut être oblique dans la partie droite, F1, et un palier
        // droit la redresse) et sans transition de Γ (S / Z, E > 1 200 mm).
        if (cageFeatures(spec).includes("variableWidth")) return;
        const before = tryLayout(p);
        if (!before || (before.walklineTransitions?.length ?? 0) > 0) return;
        const r = splitSection(p, i, Math.min(at, Math.max(0, s.axis.length - s.width)));
        if (r.error) {
          expect(r.error.key).toBe("layout.edit.splitOutside");
          return;
        }
        const c = cageOf(r.project);
        const l1 = c.sections[i]!.axis as { length: number };
        const l2 = c.sections[i + 1]!.axis as { length: number };
        expect(l1.length + s.width + l2.length).toBe(s.axis.length);
        const after = tryLayout(r.project);
        expect(after).not.toBeNull();
        const la = curveLength(before.walkline);
        const lb = curveLength(after!.walkline);
        expect(Math.abs(la - lb)).toBeLessThanOrEqual(1);
        for (let t = 0; t <= 20; t++) {
          expect(
            V.distance(
              curvePointAt(before.walkline, (la * t) / 20),
              curvePointAt(after!.walkline, (lb * t) / 20),
            ),
          ).toBeLessThanOrEqual(1);
        }
        checked++;
      }),
      { numRuns: 300 },
    );
    expect(checked).toBeGreaterThan(20);
  });

  it("glisser au point actuel est sans effet (cages et volées calculables)", () => {
    fc.assert(
      fc.property(arbProject, (p) => {
        const layout = tryLayout(p);
        if (!layout) return;
        const spec = cageOf(p);
        layout.sections!.forEach((s, i) => {
          const anchor = spec.sections[i]!.anchor ?? "center";
          const at =
            anchor === "left"
              ? s.end.left
              : anchor === "right"
                ? s.end.right
                : V.lerp(s.end.left, s.end.right, 0.5);
          expect(dragSectionEnd(p, layout, i, at).project).toBe(p);
          for (const end of ["start", "end"] as const) {
            for (const edge of ["left", "right"] as const) {
              expect(dragWidth(p, layout, i, end, edge, s[end][edge]).project).toBe(p);
            }
          }
        });
        spec.junctions.forEach((_, j) => {
          const f = junctionFrame(layout, j)!;
          expect(
            dragJunctionAngle(p, layout, j, V.addScaled(f.pivot, f.outgoing, 700)).project,
          ).toBe(p);
        });
      }),
      { numRuns: 200 },
    );
  });

  it("glisser est monotone (longueur, balayage d'un arc, angle)", () => {
    const length = (q: Project, i: number) => {
      const a = cageOf(q).sections[i]!.axis;
      return a.kind === "straight" && a.length !== "auto" ? a.length : NaN;
    };
    const sweep = (q: Project, i: number) => {
      const a = cageOf(q).sections[i]!.axis;
      return a.kind === "arc" ? a.sweep : NaN;
    };
    let arcs = 0;
    fc.assert(
      fc.property(
        arbProject,
        fc.nat(3),
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: -3000, max: 3000 }),
        (p, k, d1, d2) => {
          const layout = tryLayout(p);
          if (!layout) return;
          const spec = cageOf(p);
          const i = k % spec.sections.length;
          const s = layout.sections![i]!;
          const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
          const axis = spec.sections[i]!.axis;
          if (axis.kind === "straight") {
            const u = V.perpLeft(V.normalize(V.sub(s.start.right, s.start.left)));
            const r1 = dragSectionEnd(p, layout, i, V.addScaled(s.end.left, u, lo));
            const r2 = dragSectionEnd(p, layout, i, V.addScaled(s.end.left, u, hi));
            if (!r1.error && !r2.error) {
              expect(length(r1.project, i)).toBeLessThanOrEqual(length(r2.project, i));
            }
          } else if (s.arc) {
            // Point tourné autour du centre, depuis le départ d'ancrage, dans le sens de l'arc :
            // |balayage| croît avec l'angle (1° à 358°).
            const anchor = spec.sections[i]!.anchor ?? "center";
            const a0 =
              anchor === "left"
                ? s.start.left
                : anchor === "right"
                  ? s.start.right
                  : V.lerp(s.start.left, s.start.right, 0.5);
            const sign = Math.sign(axis.sweep);
            const at = (d: number) =>
              V.rotate(
                a0,
                (sign * (1.5 + ((d + 3000) / 6000) * 356) * Math.PI) / 180,
                s.arc!.center,
              );
            const r1 = dragSectionEnd(p, layout, i, at(lo));
            const r2 = dragSectionEnd(p, layout, i, at(hi));
            if (!r1.error && !r2.error) {
              expect(sign * sweep(r1.project, i)).toBeLessThanOrEqual(sign * sweep(r2.project, i));
              expect(Math.sign(sweep(r1.project, i))).toBe(sign);
              arcs++;
            }
          }
          if (spec.junctions.length > 0) {
            const j = k % spec.junctions.length;
            const f = junctionFrame(layout, j)!;
            const at = (deg: number) =>
              V.addScaled(f.pivot, V.rotate(f.incoming, (deg * Math.PI) / 180), 600);
            const [a1, a2] = [lo / 17, hi / 17];
            const j1 = dragJunctionAngle(p, layout, j, at(a1));
            const j2 = dragJunctionAngle(p, layout, j, at(a2));
            if (!j1.error && !j2.error) {
              expect(cageOf(j1.project).junctions[j]!.angle).toBeLessThanOrEqual(
                cageOf(j2.project).junctions[j]!.angle,
              );
            }
          }
        },
      ),
      { numRuns: 300 },
    );
    expect(arcs).toBeGreaterThan(10);
  });

  it("glisser suit le pointeur : bord et poignée d'angle au droit du point, même point = même projet", () => {
    let widths = 0;
    let angles = 0;
    fc.assert(
      fc.property(
        arbProject,
        fc.nat(3),
        fc.constantFrom("start" as const, "end" as const),
        fc.constantFrom("left" as const, "right" as const),
        fc.integer({ min: -400, max: 400 }),
        fc.integer({ min: -179, max: 179 }),
        (p, k, end, edge, d, deg) => {
          const layout = tryLayout(p);
          if (!layout) return;
          const spec = cageOf(p);
          const i = k % spec.sections.length;
          const line = layout.sections![i]![end];
          const v = V.normalize(V.sub(line.right, line.left));
          const point = V.addScaled(line[edge], v, d);
          const r = dragWidth(p, layout, i, end, edge, point);
          if (r.error) {
            expect(r.error.key).toMatch(EXPECTED_REFUSAL);
          } else {
            const after = tryLayout(r.project);
            const width = (q: Project) => {
              const sec = cageOf(q).sections[i]!;
              return end === "end" && q.stair.layout.kind === "cage" && sec.axis.kind === "straight"
                ? (sec.widthEnd ?? sec.width)
                : sec.width;
            };
            // Largeur bornée à 1 mm : le bord ne peut pas toujours rejoindre le point.
            if (after && width(r.project) > 1) {
              const l = after.sections![i]![end];
              const dir = V.normalize(V.sub(l.right, l.left));
              expect(Math.abs(V.dot(V.sub(l[edge], point), dir))).toBeLessThanOrEqual(1.01);
              expect(dragWidth(r.project, after, i, end, edge, point).project).toBe(r.project);
              widths++;
            }
          }
          if (spec.junctions.length > 0) {
            const j = k % spec.junctions.length;
            const f = junctionFrame(layout, j)!;
            const target = V.addScaled(f.pivot, V.rotate(f.incoming, (deg * Math.PI) / 180), 700);
            const q = dragJunctionAngle(p, layout, j, target);
            if (q.error) {
              expect(q.error.key).toMatch(EXPECTED_REFUSAL);
              return;
            }
            expect(cageOf(q.project).junctions[j]!.angle).toBe(deg);
            const after = tryLayout(q.project);
            if (!after) return;
            const g = junctionFrame(after, j)!;
            expect(V.distance(g.pivot, f.pivot)).toBeLessThan(1e-6);
            expect(Math.abs(V.signedAngle(g.outgoing, V.sub(target, g.pivot)))).toBeLessThan(1e-6);
            expect(dragJunctionAngle(q.project, after, j, target).project).toBe(q.project);
            angles++;
          }
        },
      ),
      { numRuns: 300 },
    );
    expect(widths).toBeGreaterThan(30);
    expect(angles).toBeGreaterThan(30);
  });

  it("buildModel ne lève jamais sur les projets produits", () => {
    fc.assert(
      fc.property(
        arbProject,
        fc.constantFrom(...Object.keys(OPS)),
        fc.nat(200),
        fc.nat(200),
        (p, name, a, b) => {
          const r = OPS[name]!(p, a, b);
          if (r.error) return;
          expect(() => buildModel(r.project)).not.toThrow();
        },
      ),
      { numRuns: 40 },
    );
  });
});
