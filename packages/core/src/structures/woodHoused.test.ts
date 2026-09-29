import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Model, Part, Tread } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { housingsInside, minCheek } from "./development.js";
import { area, isSimplePolygon } from "./geom.js";
import { QUANTITY_MASS_KG, QUANTITY_VOLUME_M3 } from "./quantities.js";
import {
  EN16481_MIN_HOUSING_DEPTH,
  WoodHousedParamsSchema,
  buildWoodHoused,
  type HousedResult,
  type HousedStringer,
} from "./woodHoused.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

function withStructure(
  p: Project,
  params: Record<string, unknown> = {},
  kind = "wood-housed",
): Project {
  return { ...p, stair: { ...p.stair, structure: { kind, params } } };
}

function housed(p: Project, params: Record<string, unknown> = {}): { m: Model; r: HousedResult } {
  const project = withStructure(p, params);
  const m = buildModel(project, { memo: false });
  const r = buildWoodHoused(
    { project, layout: m.layout, stepping: m.stepping },
    WoodHousedParamsSchema.parse(params),
  );
  return { m, r };
}

const blocking = (m: Model) =>
  m.compliance.results.filter((r) => r.status === "violation" && r.severity === "bloquant");

/** Marches dont le contour (débord compris) a une arête posée sur la face du limon. */
function carriedTreads(s: HousedStringer, treads: readonly Tread[]): number[] {
  const { face, development } = s;
  const a = V.addScaled(face.a, face.dir, development.uLo);
  const len = development.uHi - development.uLo;
  const on = (p: { x: number; y: number }): boolean => {
    const w = V.sub(p, a);
    const along = V.dot(w, face.dir);
    return Math.abs(V.cross(face.dir, w)) <= 1e-5 && along >= -1e-5 && along <= len + 1e-5;
  };
  return treads
    .filter((t) =>
      t.outline.some((p, i) => {
        const q = t.outline[(i + 1) % t.outline.length]!;
        return V.distance(p, q) > 1e-5 && on(p) && on(q) && on(V.lerp(p, q, 0.5));
      }),
    )
    .map((t) => t.number);
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

describe("wood-housed — cas d'acceptation n° 1 (quart tournant bas, poteau d'angle)", () => {
  const project = loadExample("acceptance-01-quart-tournant.blondel.json");
  const { m, r } = housed(project);

  it("deux limons par côté et un poteau, sans violation bloquante ni erreur", () => {
    expect(m.errors).toEqual([]);
    const marks = m.parts.filter((p) => p.category === "stringer").map((p) => p.mark);
    expect(marks.sort()).toEqual(["LE1", "LE2", "LI1", "LI2"]);
    expect(m.parts.filter((p) => p.category === "post").map((p) => p.mark)).toEqual(["PT1"]);
    expect(blocking(m)).toEqual([]);
    expect(new Set(m.parts.map((p) => p.id)).size).toBe(m.parts.length);
  });

  it("contrôles du plugin dans le rapport (épaisseur DTU évaluée, fabrication)", () => {
    const thick = m.compliance.results.filter((x) => x.ruleId === "LIMON_EPAISSEUR_MIN_DTU");
    expect(thick).toHaveLength(1);
    expect(thick[0]!.status).toBe("ok");
    expect(thick[0]!.message).not.toMatch(/sans évaluateur/);
    const ids = new Set(m.compliance.results.map((x) => x.ruleId));
    for (const id of [
      "LIMON_ENTAILLE_MIN",
      "FAB_LIMON_LARGEUR_PERP_MIN",
      "FAB_LIMON_BOIS_ENTRE_MORTAISES",
      "FAB_LIMON_JOUE_MIN",
      "FAB_PLATEAU_LONGUEUR_MAX",
      "FAB_DEBIT_DISPONIBLE",
      "FAB_POTEAU_RECEPTION",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    const summary = { bloquant: 0, avertissement: 0, conseil: 0 };
    for (const x of m.compliance.results) if (x.status === "violation") summary[x.severity]++;
    expect(m.compliance.summary).toEqual(summary);
  });

  it("marches portées : chaque marche est encastrée côté mur et côté jour (limon ou poteau)", () => {
    const post = m.parts.find((p) => p.category === "post")!;
    const postLabels = new Set(
      post.flat!.lines.filter((l) => l.feature === "mortise" && l.label).map((l) => l.label!),
    );
    for (const t of m.stepping.treads) {
      const mark = m.parts.find((p) => p.id === `tread-${t.number}`)!.mark;
      const outer = r.stringers.filter(
        (s) => s.face.side === "outer" && s.development.housings.some((h) => h.tread === t.number),
      );
      const inner = r.stringers.filter(
        (s) => s.face.side === "inner" && s.development.housings.some((h) => h.tread === t.number),
      );
      expect(outer.length, `marche ${t.number} côté mur`).toBeGreaterThan(0);
      expect(inner.length > 0 || postLabels.has(mark), `marche ${t.number} côté jour`).toBe(true);
    }
    // Le poteau reçoit les tenons des deux limons de jour.
    expect([...postLabels].filter((l) => l.startsWith("Mortaise")).sort()).toEqual([
      "Mortaise LI1",
      "Mortaise LI2",
    ]);
  });

  it("instantané des cotes principales", () => {
    const post = r.posts[0]!;
    expect({
      resolved: r.resolved,
      stringers: r.stringers.map((s) => ({
        mark: s.part.mark,
        start: s.face.start,
        end: s.face.end,
        mirrored: s.mirrored,
        length: r1(s.development.box.length),
        width: r1(s.development.box.width),
        perpendicularWidth: r1(s.development.minPerpendicularWidth),
        housings: s.development.housings.map((h) => h.label).join(" "),
        tenons: s.development.tenons.length,
        stock: {
          length: r1(s.part.stock!.length),
          width: r1(s.part.stock!.width),
          thickness: s.part.stock!.thickness,
        },
        section: s.part.section,
      })),
      post: {
        section: post.section,
        height: r1(post.stock!.length),
        mortises: post
          .flat!.lines.filter((l) => l.feature === "mortise" && l.label)
          .map((l) => l.label),
      },
    }).toMatchSnapshot();
  });

  it("marches prolongées dans les limons de la profondeur d'encastrement", () => {
    const depth = r.resolved.housingDepth;
    const base = buildModel(project, { memo: false });
    const t1 = m.parts.find((p) => p.id === "tread-1")!;
    const b1 = base.parts.find((p) => p.id === "tread-1")!;
    // Marche droite : longueur E + 2p.
    expect(t1.stock!.length).toBeCloseTo(project.stair.layout.width + 2 * depth, 6);
    expect(t1.quantities[QUANTITY_VOLUME_M3]!).toBeGreaterThan(b1.quantities["volume"]!);
  });

  it("développés : fibre de référence déclarée, mortaises dans le contour, repère gravé", () => {
    for (const p of m.parts.filter((x) => x.category === "stringer" || x.category === "post")) {
      const flat = p.flat!;
      expect(flat.reference?.kind).toBe("face");
      expect(signedArea(flat.outline.outer)).toBeGreaterThan(0);
      expect(isSimplePolygon(flat.outline.outer)).toBe(true);
      for (const l of flat.lines.filter((x) => x.feature === "mortise")) {
        for (const q of [l.a, l.b])
          expect(pointInPolygon(q, flat.outline.outer, 1e-3)).not.toBe("outside");
      }
      expect(flat.lines.some((l) => l.kind === "text" && l.label === p.mark)).toBe(true);
    }
  });

  it("nomenclature : grandeurs normalisées sur toutes les pièces bois", () => {
    for (const p of m.parts) {
      const v = p.quantities[QUANTITY_VOLUME_M3];
      expect(v, p.id).toBeGreaterThan(0);
      expect(p.quantities[QUANTITY_MASS_KG]).toBeCloseTo(v! * 700, 9);
      expect(p.quantities["length_mm"]).toBeGreaterThan(0);
      expect(p.quantities["surface_m2"]).toBeGreaterThan(0);
      expect(p.stock).toBeDefined();
    }
  });

  it("escalier miroir (tournant à droite) : mêmes limons", () => {
    const mirrored: Project = {
      ...project,
      stair: {
        ...project.stair,
        layout: {
          ...project.stair.layout,
          turns: project.stair.layout.turns.map((t) => ({ ...t, direction: "right" as const })),
        },
      },
    };
    const { r: rm } = housed(mirrored);
    const dims = (x: HousedResult) =>
      x.stringers.map((s) => [
        s.part.mark,
        r1(s.development.box.length),
        r1(s.development.box.width),
      ]);
    expect(dims(rm)).toEqual(dims(r));
    expect(rm.stringers.map((s) => s.mirrored)).toEqual(r.stringers.map((s) => !s.mirrored));
  });
});

describe("wood-housed — paramètres et configurations", () => {
  it("escalier droit : longueur développée de la ligne des nez = hypoténuse", () => {
    const p = loadExample("straight.blondel.json");
    const { m, r } = housed(p);
    expect(m.errors).toEqual([]);
    const n = m.stepping.nosings;
    const run = n[n.length - 1]!.s - n[0]!.s;
    const rise = n[n.length - 1]!.z - n[0]!.z;
    for (const s of r.stringers) {
      const u0 = n[0]!.sigmaInner - s.face.sigmaA;
      const pts = s.development.pitchLine;
      // Longueur de la ligne des nez entre le premier et le dernier nez.
      let len = 0;
      for (let i = 0; i + 1 < pts.length; i++) len += V.distance(pts[i]!, pts[i + 1]!);
      const extra = s.development.uHi - s.development.uLo - run;
      const slope = rise / run;
      expect(len).toBeCloseTo(Math.hypot(run, rise) + extra * Math.sqrt(1 + slope * slope), 6);
      expect(s.development.box.length).toBeGreaterThanOrEqual(Math.hypot(run, rise) - 1e-6);
      expect(u0).toBeCloseTo(0, 9);
    }
  });

  it("épaisseur sous le minimum DTU : violation LIMON_EPAISSEUR_MIN_DTU (avertissement)", () => {
    const { m } = housed(loadExample("straight.blondel.json"), { thickness: 25 });
    const res = m.compliance.results.filter((x) => x.ruleId === "LIMON_EPAISSEUR_MIN_DTU");
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((x) => x.status === "violation" && x.severity === "avertissement")).toBe(true);
  });

  it("encastrement sous 14 mm (NF EN 16481) : avertissement", () => {
    const { m } = housed(loadExample("straight.blondel.json"), { housingDepth: 10 });
    const res = m.compliance.results.find((x) => x.ruleId === "LIMON_ENTAILLE_MIN")!;
    expect(res.status).toBe("violation");
    expect(res.min).toBe(EN16481_MIN_HOUSING_DEPTH);
  });

  it("paramètres invalides : erreur de modèle, pièces de base conservées, aucune exception", () => {
    const p = withStructure(loadExample("straight.blondel.json"), { thickness: -3 });
    const m = buildModel(p, { memo: false });
    expect(m.errors.join(" ")).toMatch(/paramètres invalides/);
    expect(m.parts.some((x) => x.category === "tread")).toBe(true);
    expect(m.parts.some((x) => x.category === "stringer")).toBe(false);
  });

  it("jour à angle vif et jour en arc : erreur explicite, limons muraux seuls", () => {
    const sharp = housed(loadExample("quarter-left.blondel.json"));
    expect(sharp.m.errors.join(" ")).toMatch(/angle vif/);
    expect(sharp.r.stringers.map((s) => s.part.mark)).toEqual(["LE1", "LE2"]);
    const arcProject = makeSteppingProject({
      width: 900,
      legs: [1500, 3200],
      inner: { kind: "arc", radius: 200 },
    });
    const arc = housed(arcProject);
    expect(arc.m.errors.join(" ")).toMatch(/jalon 5/);
    expect(arc.r.stringers.every((s) => s.face.side === "outer")).toBe(true);
    expect(blocking(arc.m)).toEqual([]);
  });

  it("assemblage bout à bout et poteau pendant", () => {
    const p = loadExample("acceptance-01-quart-tournant.blondel.json");
    const { r } = housed(p, { newel: { joint: "butt", foot: "hanging" } });
    expect(r.stringers.every((s) => s.development.tenons.length === 0)).toBe(true);
    const post = r.posts[0]!;
    expect(post.flat!.lines.some((l) => l.label?.startsWith("Mortaise"))).toBe(false);
    const ex = post.solid.kind === "extrusion" ? post.solid.frame.origin.z : Number.NaN;
    expect(ex).toBeGreaterThanOrEqual(0);
  });
});

describe("wood-housed — régressions (contre-exemples fast-check)", () => {
  const regression = (
    legs: number[],
    E: number,
    H: number,
    sizes: [number, number],
    nosing: number,
    method: "M1" | "M3",
  ) =>
    makeSteppingProject({
      width: E,
      legs,
      floorToFloor: H,
      inner: sizes.map((size) => ({ kind: "newel" as const, size })),
      balancing: { method, variant: "cubic" },
      treads: { thickness: 30, nosing, risers: "full" },
    });

  it.each([
    // Marche dont l'arête arrière passe à moins de p de l'angle mural.
    ["angle mural", regression([1232, 1688, 2802], 708, 2582, [114, 126], 17, "M3")],
    // Poteaux jointifs (volée centrale sans partie droite côté jour).
    ["poteaux jointifs", regression([1562, 1609, 3989], 752, 3413, [120, 90], 0, "M1")],
  ])("%s : chaque marche portée a sa mortaise", (_label, project) => {
    const { m, r } = housed(project);
    for (const s of r.stringers) {
      const withTread = s.development.housings
        .filter((h) => h.tread !== undefined)
        .map((h) => h.tread);
      expect(withTread.sort((a, b) => a! - b!)).toEqual(carriedTreads(s, m.stepping.treads));
      expect(housingsInside(s.development, 1e-3)).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ Propriétés

/** Escaliers droits et tournants à poteau(x) d'angle, réglages de marche variés. */
const housedArb = fc
  .tuple(
    fc.oneof(
      stairArb(["M1", "M3"])
        .filter((g) => g.project.stair.layout.turns.every((t) => t.inner.kind === "newel"))
        .map((g) => g.project),
      fc
        .record({
          H: fc.integer({ min: 2200, max: 3500 }),
          E: fc.integer({ min: 700, max: 1200 }),
        })
        .map(({ H, E }) => makeSteppingProject({ width: E, legs: ["auto"], floorToFloor: H })),
    ),
    fc.record({
      nosing: fc.integer({ min: 0, max: 30 }),
      risers: fc.constantFrom("full" as const, "none" as const),
      thickness: fc.integer({ min: 30, max: 50 }),
    }),
    // Relecture : tournants en palier d'angle aussi (le générateur ne produit que des balancés).
    fc.boolean(),
  )
  .map(([p, t, landing]) => ({
    ...p,
    stair: {
      ...p.stair,
      treads: { ...p.stair.treads, ...t },
      layout: {
        ...p.stair.layout,
        turns: p.stair.layout.turns.map((x) => (landing ? { ...x, mode: "landing" as const } : x)),
      },
    },
  }));

describe("wood-housed — propriétés des développés", () => {
  it("contour fermé, simple, d'aire > 0 ; mortaises dans le contour ; une mortaise par marche portée", () => {
    fc.assert(
      fc.property(housedArb, (project) => {
        const { m, r } = housed(project);
        if (m.stepping.nosings.length < 2) return;
        expect(r.stringers.length).toBeGreaterThanOrEqual(2);
        for (const s of r.stringers) {
          const o = s.development.outline;
          expect(o.length).toBeGreaterThanOrEqual(3);
          expect(V.equals(o[0]!, o[o.length - 1]!)).toBe(false);
          expect(isSimplePolygon(o)).toBe(true);
          expect(area(o)).toBeGreaterThan(0);
          expect(signedArea(s.part.flat!.outline.outer)).toBeGreaterThan(0);
          expect(housingsInside(s.development, 1e-3)).toBe(true);
          const withTread = s.development.housings.filter((h) => h.tread !== undefined);
          const carried = carriedTreads(s, m.stepping.treads);
          expect(withTread.map((h) => h.tread).sort((a, b) => a! - b!)).toEqual(carried);
          expect(withTread.length).toBe(carried.length);
        }
        expect(
          blocking(m).filter((x) => x.ruleId.startsWith("FAB_") || x.ruleId.startsWith("LIMON")),
        ).toEqual([]);
      }),
      { numRuns: 60 },
    );
  }, 120_000);

  it("toute pièce générée est valide (solide extrudé, débit, grandeurs)", () => {
    fc.assert(
      fc.property(housedArb, (project) => {
        const { m } = housed(project);
        for (const p of m.parts as readonly Part[]) {
          expect(p.solid.kind).toBe("extrusion");
          if (p.solid.kind === "extrusion") {
            expect(p.solid.depth).toBeGreaterThan(0);
            expect(Math.abs(signedArea(p.solid.profile.outer))).toBeGreaterThan(0);
          }
          expect(p.quantities[QUANTITY_VOLUME_M3]).toBeGreaterThan(0);
        }
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});

// ------------------------------------------------------------------ Relecture adverse

describe("wood-housed — relecture (extrémités, angle mural, joues)", () => {
  it("d_b saisi trop petit : mortaises débouchantes → joue négative et violation (non « conforme »)", () => {
    const { m, r } = housed(loadExample("straight.blondel.json"), { lowerOffset: 120 });
    for (const s of r.stringers) {
      expect(housingsInside(s.development, 1e-3)).toBe(false);
      expect(minCheek(s.development)!.value).toBeLessThan(0);
    }
    const cheek = m.compliance.results.filter((x) => x.ruleId === "FAB_LIMON_JOUE_MIN");
    expect(cheek.length).toBeGreaterThan(0);
    expect(cheek.every((x) => x.status === "violation")).toBe(true);
  });

  it("arrivée : coupe de niveau de la rive haute à d_h au-dessus du sol fini d'arrivée", () => {
    const p = loadExample("straight.blondel.json");
    const { m, r } = housed(p);
    const zN = m.stepping.nosings.at(-1)!.z;
    for (const s of r.stringers) {
      const top = zN + r.resolved.upperOffset[s.face.side];
      const maxY = Math.max(...s.development.outline.map((q) => q.y));
      expect(maxY).toBeCloseTo(top, 6);
      expect(s.development.upperRive.at(-1)!.y).toBeCloseTo(top, 6);
      expect(housingsInside(s.development, 1e-3)).toBe(true);
    }
  });

  it("angle mural : limons prolongés jusqu'à l'arête extérieure du coin, rives de niveau et raccordées", () => {
    const project = loadExample("acceptance-01-quart-tournant.blondel.json");
    const { r } = housed(project);
    const e = WoodHousedParamsSchema.parse({}).thickness;
    const le1 = r.stringers.find((s) => s.part.mark === "LE1")!;
    const le2 = r.stringers.find((s) => s.part.mark === "LE2")!;
    expect(le1.development.uHi).toBeCloseTo(le1.face.faceLength + e, 9);
    expect(le2.development.uLo).toBeCloseTo(-e, 9);
    // Arête extérieure du coin : même point en plan pour les deux limons…
    const outerCorner = (s: HousedStringer, u: number) =>
      V.addScaled(V.addScaled(s.face.a, s.face.dir, u), s.face.into, e);
    expect(
      V.distance(outerCorner(le1, le1.development.uHi), outerCorner(le2, le2.development.uLo)),
    ).toBeLessThan(1e-6);
    // … et mêmes altitudes de rives (zone des queues de niveau).
    expect(le1.development.upperRive.at(-1)!.y).toBeCloseTo(le2.development.upperRive[0]!.y, 6);
    expect(le1.development.lowerRive.at(-1)!.y).toBeCloseTo(le2.development.lowerRive[0]!.y, 6);
    // Trait de joint à l'angle intérieur (face du limon voisin), pas en bout de pièce.
    const joint = le1.part.flat!.lines.find((l) => l.kind === "joint")!;
    const x = le1.mirrored ? le1.development.uHi - le1.face.faceLength : le1.face.faceLength;
    const uMin = Math.min(...le1.development.outline.map((q) => q.x));
    const expected = le1.mirrored ? x : x - uMin;
    expect(joint.a.x).toBeCloseTo(expected, 6);
  });
});

describe("wood-housed — relecture (poteaux)", () => {
  const mortisesInside = (m: Model): void => {
    for (const part of m.parts.filter((x) => x.category === "post" || x.category === "stringer")) {
      for (const l of part.flat!.lines.filter(
        (x) => x.feature === "mortise" || x.feature === "tenon",
      ))
        for (const q of [l.a, l.b])
          expect(
            pointInPolygon(q, part.flat!.outline.outer, 1e-3),
            `${part.id} ${l.label}`,
          ).not.toBe("outside");
    }
  };

  it("limon partant d'un poteau proche du sol : tenon et mortaise au-dessus du sol (contre-exemple)", () => {
    // Volée 1 sans limon de jour : LI2 part du poteau avec une rive basse sous le sol.
    const p = makeSteppingProject({
      width: 700,
      legs: [745, 3649],
      floorToFloor: 2200,
      inner: { kind: "newel", size: 90 },
      balancing: { method: "M1", variant: "cubic" },
      treads: { thickness: 40, nosing: 30, risers: "full" },
    });
    const { m, r } = housed(p);
    const li2 = r.stringers.find((s) => s.part.mark === "LI2")!;
    expect(li2.development.tenons.every((t) => t.zBottom >= 0)).toBe(true);
    mortisesInside(m);
  });

  it("poteau pendant jointif : pied sous les encastrements de marches (contre-exemple)", () => {
    const p = makeSteppingProject({
      width: 700,
      legs: [1170, 1490, 2580],
      floorToFloor: 2200,
      inner: { kind: "newel", size: 90 },
      balancing: { method: "M1", variant: "cubic" },
      treads: { thickness: 40, nosing: 30, risers: "full" },
    });
    const { m } = housed(p, { newel: { foot: "hanging" } });
    mortisesInside(m);
  });

  it("propriété : mortises et tenons dans le développé des poteaux et limons (pied, assemblage)", () => {
    fc.assert(
      fc.property(
        stairArb(["M1", "M3"])
          .filter((g) => g.project.stair.layout.turns.every((t) => t.inner.kind === "newel"))
          .map((g) => g.project),
        fc.constantFrom("floor" as const, "hanging" as const),
        fc.constantFrom("tenon" as const, "butt" as const),
        (p, foot, joint) => {
          const { m } = housed(p, { newel: { foot, joint } });
          mortisesInside(m);
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
