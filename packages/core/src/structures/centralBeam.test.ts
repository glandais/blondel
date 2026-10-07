import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Part } from "../model/derived.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { solidProblem } from "../parts/solidChecks.js";
import { createProject } from "../project/presets.js";
import {
  SAME_SIDE_TYPOLOGIES,
  ALL_TYPOLOGIES,
  makeSteppingProject,
  stairArb,
} from "../stepping/test-helpers.js";
import { WorkshopProfileSchema } from "../workshop/profile.js";
import {
  beamOf,
  centralContext,
  centralParams,
  fakeSpans,
  traceOf,
} from "./central.test-helpers.js";
import {
  CENTRAL_BEAM_RULES,
  boxSection,
  buildCentralBeam,
  sectionProblems,
  tubeSection,
  type CentralBeamResult,
  type SigmaSpan,
} from "./centralBeam.js";
import type { CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { isSimplePolygon } from "./geom.js";
import { QUANTITY_BUTT_WELD_MM, QUANTITY_WELD_MM } from "./steelCommon.js";
import { QUANTITY_ROLLED_LENGTH_MM } from "./steelCurved.js";

const BOX = { section: { kind: "box" } };

const byId = (beam: CentralBeamResult, id: string): Part | undefined =>
  beam.parts.find((p) => p.id === id);

/** Invariants communs : tronçons contigus, joints hors supports, solides et développés valides. */
function checkBeam(
  beam: CentralBeamResult,
  trace: CentralTrace,
  spans: readonly SigmaSpan[],
  margin: number,
  footprint?: readonly { x: number; y: number }[],
  width?: number,
): void {
  const segs = beam.segments;
  expect(segs.length).toBeGreaterThan(0);
  expect(segs[0]!.sigma0).toBeCloseTo(beam.extent!.sigma0, 9);
  expect(segs[segs.length - 1]!.sigma1).toBeCloseTo(beam.extent!.sigma1, 9);
  for (let i = 1; i < segs.length; i++) expect(segs[i]!.sigma0).toBe(segs[i - 1]!.sigma1);
  expect(beam.joints.map((j) => j.sigma)).toEqual(segs.slice(1).map((s) => s.sigma0));
  for (const j of beam.joints) {
    for (const sp of spans) {
      const inside = j.sigma > sp.sigma0 - margin + 1e-3 && j.sigma < sp.sigma1 + margin - 1e-3;
      expect(inside).toBe(false);
    }
  }
  const hasButt = beam.joints.some((j) => j.kind === "butt-weld");
  expect(beam.buttWeld > 0).toBe(hasButt);
  const buttParts = beam.parts.reduce((s, p) => s + (p.quantities[QUANTITY_BUTT_WELD_MM] ?? 0), 0);
  expect(buttParts).toBeCloseTo(beam.buttWeld, 6);
  for (const p of beam.parts) {
    expect(solidProblem(p.solid), `${p.id}`).toBeUndefined();
    if (p.flat) {
      expect(isSimplePolygon(p.flat.outline.outer), `${p.id}`).toBe(true);
      expect(p.flat.outline.outer.every((q) => q.x >= -1e-6 && q.y >= -1e-6)).toBe(true);
    }
    expect(p.quantities["mass_kg"]!).toBeGreaterThan(0);
  }
  for (const s of segs) expect(s.partIds.every((id) => byId(beam, id))).toBe(true);
  // Projection en plan de la poutre (± b/2) dans l'emprise, entre les nez extrêmes.
  if (footprint && width !== undefined) {
    const lo = Math.max(beam.extent!.sigma0, trace.nosingSigma[0]!);
    const hi = Math.min(beam.extent!.sigma1, trace.nosingSigma[trace.nosingSigma.length - 1]!);
    for (let s = lo; s <= hi; s += 10) {
      for (const off of [width / 2, -width / 2]) {
        const p = V.addScaled(trace.point(s), trace.left(s), off);
        expect(pointInPolygon(p, footprint, 0.5)).not.toBe("outside");
      }
    }
  }
}

describe("sections", () => {
  it("tube creux et caisson : aire, inertie, module", () => {
    const t = tubeSection(200, 100, 5);
    expect(t.area).toBeCloseTo(200 * 100 - 190 * 90, 9);
    expect(t.i).toBeCloseTo((100 * 200 ** 3 - 90 * 190 ** 3) / 12, 6);
    expect(t.w).toBeCloseTo(t.i / 100, 9);
    const b = boxSection(200, 100, 8, 8);
    // Âmes pleine hauteur + semelles entre âmes = rectangle plein moins le vide intérieur.
    const solid = (100 * 200 ** 3 - 84 * 184 ** 3) / 12;
    expect(b.i).toBeCloseTo(solid, 6);
    expect(b.area).toBeCloseTo(100 * 200 - 84 * 184, 9);
  });
});

describe("poutre en tube", () => {
  it("escalier droit : une barre, platines de pied et de tête, aucun joint", () => {
    const { beam, trace } = beamOf(createProject("straight"));
    expect(beam.errors).toEqual([]);
    expect(beam.parts.map((p) => p.id)).toEqual([
      "central-tube-1",
      "plate-foot-central",
      "plate-head-central",
    ]);
    const tube = byId(beam, "central-tube-1")!;
    expect(tube.category).toBe("stringer");
    expect(tube.name.key).toBe("structure.steelCentral.part.tubeWhole");
    expect(beam.joints).toEqual([]);
    expect(beam.buttWeld).toBe(0);
    expect(beam.partAt(1000)).toBe("central-tube-1");
    expect(beam.spanH).toBeGreaterThan(3000);
    expect(beam.section.area).toBeCloseTo(tubeSection(200, 100, 5).area, 9);
    // Dessus de poutre : ligne des nez − topOffset.
    expect(beam.topAt(trace.nosingSigma[3]!)).toBeCloseTo(
      trace.nosingZ(trace.nosingSigma[3]!) - 260,
      9,
    );
    expect(byId(beam, "plate-foot-central")!.category).toBe("fixing");
    expect(byId(beam, "plate-foot-central")!.assembledWith).toEqual(["central-tube-1"]);
    // Ancrages au gros œuvre déclarés (A27) : chevilles au sol et au chevêtre.
    expect(byId(beam, "plate-foot-central")!.fixings).toEqual([
      { joint: "plateFloor", points: 4, holeDiameter: 13 },
    ]);
    expect(byId(beam, "plate-head-central")!.fixings?.map((f) => f.joint)).toEqual([
      "plateTrimmer",
    ]);
    checkBeam(beam, trace, fakeSpans(trace), 20);
  });

  it("barre plus longue que le profil d'atelier : aboutage soudé (EXC2) ou éclissé", () => {
    const base = createProject("straight");
    const project: Project = {
      ...base,
      workshop: WorkshopProfileSchema.parse({ metal: { barLengths: [1500] } }),
    };
    const welded = beamOf(project);
    expect(welded.beam.joints.length).toBeGreaterThanOrEqual(2);
    expect(welded.beam.joints.every((j) => j.reason === "bar" && j.kind === "butt-weld")).toBe(
      true,
    );
    expect(welded.beam.segments.every((s) => s.fits)).toBe(true);
    expect(welded.beam.buttWeld).toBeGreaterThan(0);
    checkBeam(welded.beam, welded.trace, fakeSpans(welded.trace), 20);
    const bolted = beamOf(project, { beam: { splice: "bolted" } });
    expect(bolted.beam.joints.every((j) => j.kind === "bolted-splice" && j.weld === 0)).toBe(true);
    expect(bolted.beam.buttWeld).toBe(0);
    checkBeam(bolted.beam, bolted.trace, fakeSpans(bolted.trace), 20);
  });

  it("tube sur trace courbe : erreur explicite et contrôle bloquant, aucune pièce", () => {
    for (const id of ["quarter-left", "helical"] as const) {
      const { beam, checks } = beamOf(createProject(id), { section: { kind: "tube" } });
      expect(beam.parts).toEqual([]);
      expect(beam.errors.map((e) => e.key)).toEqual(["structure.steelCentral.error.tubeOnCurve"]);
      const r = checks.results.find((x) => x.ruleId === CENTRAL_BEAM_RULES.tubeOnCurve.id)!;
      expect(r.status).toBe("violation");
      expect(r.severity).toBe("bloquant");
    }
  });

  it("galvanisé : évents aux deux extrémités du tube", () => {
    const { beam, checks } = beamOf(createProject("straight"), { finish: "galvanized" });
    expect(byId(beam, "central-tube-1")!.flat!.outline.holes).toHaveLength(2);
    const r = checks.results.filter((x) => x.ruleId === "FAB_CAISSON_EVENTS");
    expect(r.map((x) => x.status)).toEqual(["ok"]);
  });
});

describe("poutre en caisson", () => {
  it("escalier droit : flasques, semelles, entretoises ≤ entraxe, sans roulage", () => {
    const { beam, trace, params } = beamOf(createProject("straight"), BOX);
    expect(beam.errors).toEqual([]);
    const ids = beam.parts.map((p) => p.id);
    for (const id of [
      "central-web-left-1",
      "central-web-right-1",
      "central-flange-top-1",
      "central-flange-bottom-1",
      "central-diaphragm-1",
      "plate-foot-central",
      "plate-head-central",
    ]) {
      expect(ids).toContain(id);
    }
    expect(byId(beam, "central-web-left-1")!.name.key).toBe(
      "structure.steelCentral.part.webLeftWhole",
    );
    for (const p of beam.parts) {
      expect(p.flat?.lines.some((l) => l.kind === "roll") ?? false).toBe(false);
    }
    // Entretoises : entraxe ≤ diaphragmSpacing (le long de l'axe, hors pointe au sol).
    const diaphragms = beam.parts.filter((p) => p.id.startsWith("central-diaphragm-"));
    expect(diaphragms.length).toBeGreaterThanOrEqual(
      Math.floor((beam.extent!.sigma1 - beam.extent!.sigma0) / params.section.diaphragmSpacing),
    );
    expect(diaphragms.every((d) => d.category === "stringer" && d.mark.startsWith("EC"))).toBe(
      true,
    );
    // Cordons d'angle : semelles sur leurs deux rives, entretoises sur leur périmètre.
    const fillet = beam.parts.reduce((s, p) => s + (p.quantities[QUANTITY_WELD_MM] ?? 0), 0);
    expect(fillet).toBeCloseTo(beam.weld, 6);
    checkBeam(beam, trace, fakeSpans(trace), 20);
  });

  it("quart tournant : flasques roulées (R ∓ (b/2 − t_w/2))·θ, joints aux naissances hors supports", () => {
    const { beam, trace, params, checks } = beamOf(createProject("quarter-left"), BOX);
    expect(beam.errors).toEqual([]);
    expect(beam.joints.length).toBeGreaterThan(0);
    expect(beam.joints.every((j) => j.kind === "butt-weld")).toBe(true);
    expect(beam.joints.some((j) => j.reason === "naissance")).toBe(true);
    const arc = trace.arcs[0]!;
    const theta = (arc.sigma1 - arc.sigma0) / arc.radius;
    const dw = params.section.width / 2 - params.section.webThickness / 2;
    const rolled = (side: "left" | "right"): number =>
      beam.parts
        .filter((p) => p.id.startsWith(`central-web-${side}-`))
        .reduce((s, p) => s + (p.quantities[QUANTITY_ROLLED_LENGTH_MM] ?? 0), 0);
    // Tournant à gauche : flasque gauche côté centre.
    expect(rolled("left")).toBeCloseTo((arc.radius - dw) * theta, 6);
    expect(rolled("right")).toBeCloseTo((arc.radius + dw) * theta, 6);
    // Lignes de roulage seulement sur les flasques qui portent de l'arc.
    for (const p of beam.parts) {
      const roll = p.flat?.lines.some((l) => l.kind === "roll") ?? false;
      expect(roll).toBe((p.quantities[QUANTITY_ROLLED_LENGTH_MM] ?? 0) > 0);
    }
    // Lignes de joint dans les développés des tronçons voisins.
    const left2 = byId(beam, "central-web-left-2")!;
    expect(left2.flat!.lines.filter((l) => l.kind === "joint")).toHaveLength(
      beam.segments.length > 2 ? 2 : 1,
    );
    // Contrôles de roulage présents (rayon intérieur R − b/2).
    const radius = checks.results.find((r) => r.ruleId === CENTRAL_BEAM_RULES.rollingRadius.id)!;
    expect(radius.status).toBe("ok");
    expect(beam.notes.map((n) => n.key)).toContain("structure.steelCentral.note.warpedFlanges");
    checkBeam(beam, trace, fakeSpans(trace), params.beam.jointSupportMargin);
  });

  it("hélicoïdal : flasques développées en bandes exactes (rives droites), coupes de format", () => {
    const { beam, trace, params } = beamOf(createProject("helical"), BOX);
    expect(beam.errors).toEqual([]);
    const R = trace.arcs[0]!.radius;
    const dw = params.section.width / 2 - params.section.webThickness / 2;
    const theta = trace.length / R;
    const rolled = beam.parts
      .filter((p) => p.id.startsWith("central-web-right-"))
      .reduce((s, p) => s + (p.quantities[QUANTITY_ROLLED_LENGTH_MM] ?? 0), 0);
    // Flasque extérieure (montée à gauche : centre à gauche) sur la fenêtre de la poutre.
    const window = beam.extent!.sigma1 - Math.max(0, beam.extent!.sigma0);
    expect(rolled).toBeCloseTo(((R + dw) / R) * window, 3);
    expect(theta).toBeGreaterThan(0);
    // Rive haute d'une flasque : droite (pente constante) sur le développé hors coupes.
    const web = byId(beam, "central-web-left-1")!;
    expect(web.flat!.reference!.kind).toBe("neutral-fiber");
    checkBeam(beam, trace, fakeSpans(trace), params.beam.jointSupportMargin);
  });

  it("formats de tôle réduits : coupes supplémentaires, tronçons qui tiennent", () => {
    const base = createProject("quarter-left");
    const project: Project = {
      ...base,
      workshop: WorkshopProfileSchema.parse({
        metal: { sheetFormats: [{ length: 1500, width: 1000 }] },
      }),
    };
    const { beam, trace } = beamOf(project, BOX);
    expect(beam.joints.some((j) => j.reason === "format")).toBe(true);
    expect(beam.segments.every((s) => s.fits)).toBe(true);
    checkBeam(beam, trace, fakeSpans(trace), 20);
  });

  it("galvanisé : évents dans chaque entretoise et aux extrémités, contrôle ok", () => {
    const { beam, checks } = beamOf(createProject("quarter-left"), {
      ...BOX,
      finish: "galvanized",
    });
    const diaphragms = beam.parts.filter((p) => p.id.startsWith("central-diaphragm-"));
    expect(diaphragms.every((d) => d.flat!.outline.holes.length === 1)).toBe(true);
    const left = beam.parts.filter((p) => p.id.startsWith("central-web-left-"));
    expect(left.reduce((s, p) => s + p.flat!.outline.holes.length, 0)).toBe(2);
    const r = checks.results.filter((x) => x.ruleId === "FAB_CAISSON_EVENTS");
    expect(r.map((x) => x.status)).toEqual(["ok"]);
  });

  it("platines selon plates.foot / plates.head", () => {
    for (const [foot, head] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      const { beam } = beamOf(createProject("quarter-left"), { ...BOX, plates: { foot, head } });
      const ids = beam.parts.map((p) => p.id);
      expect(ids.includes("plate-foot-central")).toBe(foot);
      expect(ids.includes("plate-head-central")).toBe(head);
    }
  });

  it("escalier en S : joints aux quatre naissances, tronçons contigus", () => {
    const { beam, trace, params } = beamOf(createProject("two-quarters-s"), BOX);
    expect(beam.errors).toEqual([]);
    checkBeam(beam, trace, fakeSpans(trace), params.beam.jointSupportMargin);
  });
});

describe("section incohérente", () => {
  it("parois trop épaisses : erreur explicite, aucune pièce", () => {
    expect(sectionProblems(centralParams().section)).toEqual([]);
    expect(sectionProblems(centralParams(BOX).section)).toEqual([]);
    const cases: [Record<string, unknown>, string][] = [
      [{ section: { kind: "tube", wallThickness: 50 } }, "tubeWallTooThick"],
      [{ section: { kind: "box", webThickness: 60, flangeThickness: 8 } }, "websTooThick"],
      [{ section: { kind: "box", height: 10, width: 20 } }, "flangesTooThick"],
      [{ section: { kind: "box", flangeThickness: 120 } }, "flangesTooThick"],
    ];
    for (const [over, key] of cases) {
      const { beam } = beamOf(createProject("straight"), over);
      expect(beam.parts).toEqual([]);
      expect(beam.errors.map((e) => e.key)).toContain(`structure.steelCentral.error.${key}`);
      expect(beam.partAt(1000)).toBeUndefined();
    }
  });

  it("entretoises jointives (entraxe ≤ épaisseur) : erreur, entretoises d'extrémité et de joint seules", () => {
    const { beam: ref } = beamOf(createProject("quarter-left"), BOX);
    const { beam } = beamOf(createProject("quarter-left"), {
      section: { kind: "box", diaphragmSpacing: 1 },
    });
    expect(beam.errors.map((e) => e.key)).toEqual([
      "structure.steelCentral.error.diaphragmSpacing",
    ]);
    const count = (b: CentralBeamResult) =>
      b.parts.filter((p) => p.id.startsWith("central-diaphragm-")).length;
    expect(count(beam)).toBeLessThanOrEqual(count(ref));
    expect(count(beam)).toBeLessThanOrEqual(beam.joints.length + 2);
  });

  it("développé d'une flasque roulée : libellé de roulage au milieu de la zone roulée", () => {
    const { beam } = beamOf(createProject("quarter-left"), BOX);
    let rolled = 0;
    for (const p of beam.parts.filter((x) => x.id.startsWith("central-web-"))) {
      const rolls = (p.flat?.lines ?? []).filter((l) => l.kind === "roll");
      if (rolls.length === 0) continue;
      rolled++;
      const xs = rolls.map((l) => l.a.x);
      const labelled = rolls.filter((l) => l.label !== undefined);
      expect(labelled).toHaveLength(1);
      // Ligne intérieure : ni à la naissance ni au bout de la zone roulée (repères, joints).
      expect(labelled[0]!.a.x).toBeGreaterThan(Math.min(...xs) + 1);
      expect(labelled[0]!.a.x).toBeLessThan(Math.max(...xs) - 1);
    }
    expect(rolled).toBeGreaterThan(0);
  });

  it("caisson : la pièce qui reçoit un support est la semelle haute du tronçon", () => {
    const { beam, trace } = beamOf(createProject("quarter-left"), BOX);
    for (const s of trace.nosingSigma) {
      expect(beam.partAt(s)).toMatch(/^central-flange-top-\d+$/);
    }
  });
});

/** Escalier en U balancé (jour vif puis poteau), dessus de poutre bas : contre-exemple fixé. */
const U_LOW_TOP = ProjectSchema.parse({
  schemaVersion: 1,
  site: { floorToFloor: 2200, upperSlabThickness: 200 },
  stair: {
    placement: { origin: { x: 0, y: 0 } },
    layout: {
      width: 797,
      legs: [{ length: 1188 }, { length: 1886 }, { length: 2361 }],
      turns: [
        { direction: "left", mode: "winders", inner: { kind: "sharp" } },
        { direction: "left", mode: "winders", inner: { kind: "newel", size: 90 } },
      ],
    },
    treads: { thickness: 40, nosing: 10, risers: "full", riserThickness: 20 },
  },
});

/** Escaliers hélicoïdaux tirés : rayon extérieur, fût (poteau ou jour), sens, hauteur. */
const helicalArb = fc
  .record({
    outer: fc.integer({ min: 800, max: 1300 }),
    core: fc.constantFrom("column" as const, "well" as const),
    coreRadius: fc.integer({ min: 60, max: 250 }),
    direction: fc.constantFrom("left" as const, "right" as const),
    H: fc.integer({ min: 2300, max: 3100 }),
  })
  .map((g) => {
    const base = createProject("helical");
    return ProjectSchema.parse({
      ...base,
      site: { ...base.site, floorToFloor: g.H },
      stair: {
        ...base.stair,
        layout: {
          ...base.stair.layout,
          outerRadius: g.outer,
          core: { kind: g.core, radius: g.coreRadius },
          direction: g.direction,
        },
      },
    });
  });

describe("ne lève jamais", () => {
  it("U balancé à jour vif, dessus de poutre bas : flasques du premier tronçon valides", () => {
    for (const topOffset of [180, 200]) {
      for (const width of [80, 160]) {
        const { beam, trace } = beamOf(
          U_LOW_TOP,
          { section: { kind: "box", width }, finish: "painted" },
          { topOffset },
        );
        expect(beam.errors).toEqual([]);
        for (const id of ["central-web-left-1", "central-web-right-1"]) {
          const p = byId(beam, id)!;
          expect(solidProblem(p.solid), `${id} (${topOffset}, ${width})`).toBeUndefined();
        }
        checkBeam(beam, trace, fakeSpans(trace), 20);
      }
    }
  });

  it("tracés hélicoïdaux générés (caisson) : invariants des tronçons, joints, solides", () => {
    let built = 0;
    fc.assert(
      fc.property(helicalArb, fc.integer({ min: 180, max: 320 }), (project, topOffset) => {
        let ctx;
        try {
          ctx = centralContext(project);
        } catch {
          return;
        }
        const params = centralParams(BOX);
        const r = (() => {
          try {
            return traceOf(ctx, params);
          } catch {
            return null;
          }
        })();
        if (!r) return;
        const spans = fakeSpans(r);
        const checks = new CheckCollector(project, ctx.stepping);
        let beam: CentralBeamResult | undefined;
        expect(() => {
          beam = buildCentralBeam({
            ctx,
            params,
            trace: r,
            topOffset,
            supportSpans: spans,
            checks,
          });
        }).not.toThrow();
        if (beam!.parts.length === 0) return;
        built++;
        checkBeam(beam!, r, spans, params.beam.jointSupportMargin);
      }),
      { numRuns: 12 },
    );
    // Propriété non vide : la plupart des hélicoïdaux tirés portent une poutre.
    expect(built).toBeGreaterThanOrEqual(6);
  });

  it("entrées incohérentes : erreurs, pas d'exception", () => {
    const ctx = centralContext(createProject("straight"));
    const params = centralParams(BOX);
    const trace = traceOf(ctx, params);
    const checks = new CheckCollector(ctx.project, ctx.stepping);
    // Poutre entièrement sous le sol.
    const r = buildCentralBeam({ ctx, params, trace, topOffset: 1e5, supportSpans: [], checks });
    expect(r.parts).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
    // Trace corrompue : exception interne rattrapée.
    const broken = { ...trace, nosingZ: () => Number.NaN } as CentralTrace;
    const r2 = buildCentralBeam({
      ctx,
      params,
      trace: broken,
      topOffset: 200,
      supportSpans: [],
      checks,
    });
    expect(r2.errors.length).toBeGreaterThan(0);
  });

  it("tracés générés (caisson) : invariants des tronçons, joints, solides, emprise", () => {
    let built = 0;
    fc.assert(
      fc.property(
        stairArb(["M1", "M3"], ALL_TYPOLOGIES),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: 80, max: 160 }),
        fc.integer({ min: 180, max: 320 }),
        fc.constantFrom("painted" as const, "galvanized" as const),
        ({ project }, offset, width, topOffset, finish) => {
          let ctx;
          try {
            ctx = centralContext(project);
          } catch {
            fc.pre(false);
            return;
          }
          const params = centralParams({
            ...BOX,
            finish,
            trace: { lateralOffset: offset },
            section: { kind: "box", width },
          });
          const tr = (() => {
            try {
              return traceOf(ctx, params);
            } catch {
              return null;
            }
          })();
          fc.pre(tr !== null);
          const spans = fakeSpans(tr!);
          const checks = new CheckCollector(project, ctx.stepping);
          let beam: CentralBeamResult | undefined;
          expect(() => {
            beam = buildCentralBeam({
              ctx,
              params,
              trace: tr!,
              topOffset,
              supportSpans: spans,
              checks,
            });
          }).not.toThrow();
          if (beam!.parts.length === 0) return;
          built++;
          checkBeam(beam!, tr!, spans, params.beam.jointSupportMargin, ctx.layout.footprint, width);
        },
      ),
      { numRuns: 30 },
    );
    // Propriété non vide : une régression qui ne produirait plus de poutre ne passe pas.
    expect(built).toBeGreaterThanOrEqual(10);
  });

  it("jour en arc et poteau : poutre valide", () => {
    for (const inner of [
      { kind: "arc" as const, radius: 250 },
      { kind: "newel" as const, size: 100 },
    ]) {
      const project = makeSteppingProject({ width: 900, legs: [1800, 2830], inner });
      const { beam, trace } = beamOf(project, BOX);
      expect(beam.errors).toEqual([]);
      checkBeam(beam, trace, fakeSpans(trace), 20);
    }
    expect(SAME_SIDE_TYPOLOGIES.length).toBeGreaterThan(0);
  });
});
