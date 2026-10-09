/**
 * Plugin `steel-central` (limon central métal, QUESTIONS A29) : supports de marche, marches,
 * contrôles (porte-à-faux et torsion, marche portée, hauteur des supports), prédimensionnement,
 * classe d'exécution, capacités ; propriétés sur générateurs contraints.
 */
import fc from "fast-check";
import { textMessage, translatorFor, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Model, Part, SolidDesc } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { buildModel, deepMerge } from "../pipeline/build.js";
import { createProject, type PresetId } from "../project/presets.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import type { CentralBeamResult } from "./centralBeam.js";
import { buildCentralTrace, type CentralTrace } from "./centralTrace.js";
import { structureUnsupportedOptions } from "./registry.js";
import {
  CENTRAL_RULES,
  STEEL_CENTRAL,
  SteelCentralParamsSchema,
  buildSteelCentral,
  lineInterval,
  type SteelCentralResult,
} from "./steelCentral.js";
import { QUANTITY_BUTT_WELD_MM, QUANTITY_HOLES, QUANTITY_WELD_MM } from "./steelCommon.js";
import { treadSupportJoint } from "./treadFixing.js";
import "./index.js";

const EN = translatorFor("en");
const CANTILEVER = CENTRAL_RULES.cantilever.id;

/** Projet d'un préréglage avec la structure `steel-central` de paramètres `params`. */
function preset(id: PresetId, params: Record<string, unknown> = {}): Project {
  const p = createProject(id);
  return { ...p, stair: { ...p.stair, structure: { kind: "steel-central", params } } };
}

function withCentral(p: Project, params: Record<string, unknown> = {}): Project {
  return { ...p, stair: { ...p.stair, structure: { kind: "steel-central", params } } };
}

/** Modèle et résultat détaillé du plugin (mêmes paramètres résolus que le pipeline). */
function run(project: Project): { m: Model; r: SteelCentralResult; ctx: StructureContext } {
  const m = buildModel(project, { memo: false });
  const ctx: StructureContext = { project, layout: m.layout, stepping: m.stepping };
  const params = SteelCentralParamsSchema.parse(
    deepMerge(
      STEEL_CENTRAL.defaults(ctx) as Record<string, unknown>,
      project.stair.structure.params,
    ),
  );
  return { m, r: buildSteelCentral(ctx, params), ctx };
}

/** Points en plan (repère monde) d'un solide. */
function planPoints(s: SolidDesc): Vec2[] {
  if (s.kind === "extrusion") {
    const f = s.frame;
    const out: Vec2[] = [];
    for (const ring of [s.profile.outer, ...s.profile.holes]) {
      for (const p of ring) {
        for (const d of [0, s.depth]) {
          out.push(
            V.vec(
              f.origin.x + f.xAxis.x * p.x + f.yAxis.x * p.y + f.zAxis.x * d,
              f.origin.y + f.xAxis.y * p.x + f.yAxis.y * p.y + f.zAxis.y * d,
            ),
          );
        }
      }
    }
    return out;
  }
  if (s.kind === "ruled") {
    return [...s.a, ...s.b].flatMap((p, i) => {
      const n = s.normals[i % s.normals.length]!;
      return [V.vec(p.x, p.y), V.vec(p.x + n.x * s.thickness, p.y + n.y * s.thickness)];
    });
  }
  return s.path.map((p) => V.vec(p.x, p.y));
}

/** Altitudes extrêmes d'un solide extrudé. */
function zRange(s: SolidDesc): { lo: number; hi: number } {
  if (s.kind !== "extrusion") return { lo: NaN, hi: NaN };
  const f = s.frame;
  const zs: number[] = [];
  for (const p of s.profile.outer) {
    for (const d of [0, s.depth]) {
      zs.push(f.origin.z + f.xAxis.z * p.x + f.yAxis.z * p.y + f.zAxis.z * d);
    }
  }
  return { lo: Math.min(...zs), hi: Math.max(...zs) };
}

/**
 * Abscisse de la trace la plus proche de `p` (recherche indépendante de l'implémentation :
 * balayage au pas de 5 mm autour de `guess`, puis dichotomie ternaire).
 */
function nearestSigma(trace: CentralTrace, p: Vec2, guess: number): number {
  const d = (x: number): number => V.distance(trace.point(x), p);
  let best = guess;
  for (let x = guess - 400; x <= guess + 400; x += 5) if (d(x) < d(best)) best = x;
  let a = best - 5;
  let b = best + 5;
  for (let k = 0; k < 60; k++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (d(m1) < d(m2)) b = m2;
    else a = m1;
  }
  return (a + b) / 2;
}

/**
 * Âme d'une console : chaque sommet de son appui sur la poutre (sous le dessus de l'âme, entre
 * les rives de la poutre dans sa direction) est sur le dessus de la poutre (écart < `tol` mm),
 * et les rives `beamLo` / `beamHi` sont à b/2 de la trace.
 */
function expectConsoleOnBeam(
  s: SteelCentralResult["supports"][number],
  trace: CentralTrace,
  beam: CentralBeamResult,
  halfWidth: number,
  tol = 0.5,
): number {
  const web = s.parts[0]!;
  if (web.solid.kind !== "extrusion") throw new Error("âme non extrudée");
  const top = Math.max(...web.solid.profile.outer.map((q) => q.y));
  let checked = 0;
  for (const q of web.solid.profile.outer) {
    if (q.y > top - 1e-6 || q.x < s.beamLo - 1e-6 || q.x > s.beamHi + 1e-6) continue;
    const P = V.addScaled(s.center, s.across, q.x);
    const sigma = nearestSigma(trace, P, s.sigma);
    expect(Math.abs(q.y - beam.topAt(sigma)), `${web.id} s=${q.x.toFixed(1)}`).toBeLessThan(tol);
    checked++;
  }
  for (const edge of [s.beamLo, s.beamHi]) {
    const P = V.addScaled(s.center, s.across, edge);
    const lateral = V.distance(P, trace.point(nearestSigma(trace, P, s.sigma)));
    expect(Math.abs(lateral - halfWidth), `${web.id} rive`).toBeLessThan(tol);
  }
  return checked;
}

/** Distance d'un point hors du polygone (0 dedans). */
function outsideBy(p: Vec2, poly: Polygon2): number {
  if (pointInPolygon(p, poly, 1e-6) !== "outside") return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ab = V.sub(b, a);
    const t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / V.dot(ab, ab)));
    d = Math.min(d, V.distance(p, V.addScaled(a, ab, t)));
  }
  return d;
}

const violations = (m: Model, id: string) =>
  m.compliance.results.filter((r) => r.ruleId === id && r.status === "violation");

// ------------------------------------------------------------------ exemples

describe("limon central : escalier droit, tube, marches bois", () => {
  const { m, r } = run(preset("straight"));

  it("modèle complet, une console soudée sous chaque marche, tube unique, EXC1", () => {
    expect(frList(m.errors)).toEqual([]);
    expect(r.trace?.kind).toBe("straight");
    expect(m.parts.some((p) => p.id.startsWith("central-tube-"))).toBe(true);
    const treads = m.stepping.treads.map((t) => t.number);
    expect([...new Set(r.supports.map((s) => s.tread))].sort((a, b) => a - b)).toEqual(treads);
    for (const s of r.supports) {
      expect(s.parts.map((p) => p.id)).toEqual([
        `support-${s.tread}-central`,
        `support-${s.tread}-central-bearing`,
      ]);
      expect(s.parts.every((p) => p.category === "support")).toBe(true);
    }
    expect(m.executionClass).toBe("EXC1");
    expect(violations(m, "FAB_MARCHE_PORTEE")).toEqual([]);
    expect(violations(m, CENTRAL_RULES.supportHeight.id)).toEqual([]);
  });

  it("dessus de poutre auto : multiple de 5 mm, exposé, au moins `minHeight` sous chaque marche", () => {
    expect(r.topOffset % 5).toBe(0);
    expect(m.autoValues?.["stair.structure.params.beam.topOffset"]).toBe(r.topOffset);
    for (const s of r.supports) expect(s.zTop - s.zBeam).toBeGreaterThanOrEqual(40 - 1e-6);
  });

  it("console : dessus du plat d'appui = dessous de la marche, âme posée sur la poutre", () => {
    for (const s of r.supports) {
      const [web, bearing] = s.parts as [Part, Part];
      expect(zRange(bearing.solid).hi).toBeCloseTo(s.zTop, 6);
      expect(zRange(web.solid).hi).toBeCloseTo(s.zTop - 8, 6);
      expect(zRange(web.solid).lo).toBeCloseTo(s.zBeam, 6);
      expect(web.flat?.thickness).toBe(8);
      // Cordons : âme sur la poutre (2 × largeur), plat d'appui sur l'âme (2 × longueur).
      expect(web.quantities[QUANTITY_WELD_MM]).toBeCloseTo(2 * 100, 6);
      expect(bearing.quantities[QUANTITY_WELD_MM]).toBeGreaterThanOrEqual(2 * (s.s1 - s.s0) - 1e-6);
      expect(s.s0).toBeLessThan(-50);
      expect(s.s1).toBeGreaterThan(50);
    }
  });

  it("assemblages : plat d'appui ↔ marche, âme ↔ plat d'appui, âme ↔ poutre", () => {
    const s = r.supports[3]!;
    const web = m.parts.find((p) => p.id === s.parts[0]!.id)!;
    const bearing = m.parts.find((p) => p.id === s.parts[1]!.id)!;
    expect(bearing.assembledWith).toContain(`tread-${s.tread}`);
    expect(web.assembledWith).toContain(bearing.id);
    expect(s.beamPart).toBeDefined();
    expect(web.assembledWith).toContain(s.beamPart);
  });

  it("prédimensionnement en flexion de la poutre (largeur reprise = E), torsion non vérifiée", () => {
    expect(m.precheck?.beams).toHaveLength(1);
    expect(r.precheck?.length).toBeGreaterThan(0);
    expect(m.compliance.results.some((x) => x.ruleId === "PRECHECK_FLECHE")).toBe(true);
    expect(frList(m.precheck?.notes).join(" ")).toMatch(/torsion sous charge excentrée/);
  });

  it("porte-à-faux et torsion : avertissement « justification requise » sans justification", () => {
    const c = m.compliance.results.filter((x) => x.ruleId === CANTILEVER);
    expect(c).toHaveLength(1);
    expect(c[0]!.status).toBe("violation");
    expect(c[0]!.severity).toBe("avertissement");
    expect(c[0]!.justification).toBeUndefined();
    expect(fr(c[0]!.message)).toMatch(/^Justification requise/);
  });

  it("justification saisie : l'avertissement reste, justification jointe au résultat", () => {
    const j = run(preset("straight", { cantileverJustification: "  Note BET n° 12  " })).m;
    const c = j.compliance.results.find((x) => x.ruleId === CANTILEVER)!;
    expect(c.status).toBe("violation");
    expect(c.severity).toBe("avertissement");
    expect(c.justification).toBe("Note BET n° 12");
    expect(fr(c.message)).toMatch(/justification jointe .*Note BET n° 12/);
  });

  it("marches bois vissées par-dessous : perçages comptés, non dessinés (vis à bois)", () => {
    const s = r.supports[0]!;
    const bearing = s.parts[1]!;
    const joint = treadSupportJoint(
      { fixing: "screwed", screws: 4, holeDiameter: 9 },
      "wood",
      s.s1 - s.s0,
    );
    expect(bearing.quantities["holes"]).toBe(joint.holes);
    expect(bearing.flat?.outline.holes).toHaveLength(0);
    expect(bearing.fixings ?? []).toEqual(joint.fixings);
  });
});

describe("limon central : tournants (caisson débillardé)", () => {
  it("quart tournant balancé : caisson par défaut, trace débillardée, supports sous chaque marche", () => {
    const { m, r } = run(preset("quarter-left"));
    expect(frList(m.errors)).toEqual([]);
    expect(r.trace?.kind).toBe("turning");
    expect(m.parts.some((p) => p.id.startsWith("central-web-left-"))).toBe(true);
    expect(m.parts.some((p) => p.id.startsWith("central-tube-"))).toBe(false);
    expect(violations(m, "FAB_MARCHE_PORTEE")).toEqual([]);
    // Classe d'exécution : EXC2 ⇔ soudure bout à bout ou S355 soudé.
    const butt = m.parts.reduce((s, p) => s + (p.quantities[QUANTITY_BUTT_WELD_MM] ?? 0), 0);
    expect(m.executionClass).toBe(butt > 0 ? "EXC2" : "EXC1");
  });

  it("palier : supports répartis à entraxe ≤ `landingSpacing`", () => {
    const { m, r } = run(preset("quarter-landing", { supports: { landingSpacing: 300 } }));
    expect(frList(m.errors)).toEqual([]);
    const landing = m.stepping.treads.find((t) => t.kind === "landing")!;
    const under = r.supports.filter((s) => s.tread === landing.number);
    expect(under.length).toBeGreaterThanOrEqual(2);
    expect(under.map((s) => s.parts[0]!.id)).toEqual(
      under.map((_, k) => `support-${landing.number}-central-${k + 1}`),
    );
    const sig = under.map((s) => s.sigma).sort((a, b) => a - b);
    for (let i = 1; i < sig.length; i++) expect(sig[i]! - sig[i - 1]!).toBeLessThanOrEqual(300 + 1);
  });

  it.each(["two-quarters-u", "half-turn", "two-quarters-s"] as const)(
    "%s : modèle complet, toutes les marches portées",
    (id) => {
      const { m } = run(preset(id));
      expect(frList(m.errors)).toEqual([]);
      expect(violations(m, "FAB_MARCHE_PORTEE")).toEqual([]);
    },
  );

  it("tube imposé sur un tournant : option non prise en charge, erreur explicite, aucune exception", () => {
    const m = buildModel(preset("quarter-left", { section: { kind: "tube" } }), { memo: false });
    expect(m.errors.length).toBeGreaterThan(0);
  });
});

describe("limon central : hélicoïdal", () => {
  it("hélicoïdal à fût : trace hélicoïdale, fût non porteur signalé, marches portées", () => {
    const { m, r } = run(preset("helical"));
    expect(frList(m.errors)).toEqual([]);
    expect(r.trace?.kind).toBe("helical");
    expect(violations(m, "FAB_MARCHE_PORTEE")).toEqual([]);
    expect(frList(m.notes).join(" ")).toMatch(/fût/);
  });
});

describe("limon central : marches en tôle pliée (A31)", () => {
  it.each(["screwed", "welded"] as const)(
    "fixation %s : plat d'appui conforme à `treadSupportJoint`, perçages dessinés si vissée",
    (treadFixing) => {
      const { m, r } = run(
        preset("straight", { treadKind: "folded-steel", supports: { treadFixing } }),
      );
      expect(frList(m.errors)).toEqual([]);
      for (const s of r.supports) {
        const bearing = s.parts[1]!;
        const joint = treadSupportJoint(
          { fixing: treadFixing, screws: 4, holeDiameter: 9 },
          "steel",
          s.s1 - s.s0,
        );
        expect(bearing.quantities["holes"]).toBe(joint.holes);
        expect(bearing.flat?.outline.holes).toHaveLength(joint.holes);
        expect(s.treadPoints).toHaveLength(joint.holes);
      }
      // Contremarches bois retirées (profil Z : sauf l'arrivée remplacée par le plat plié).
      expect(m.parts.filter((p) => p.category === "tread")[0]!.material).toMatch(/^steel/);
    },
  );
});

describe("limon central : points de fixation non percés (A31, chiffrage aligné)", () => {
  it("perçage trop gros pour l'appui : support, visserie et marche concordent, remarque", () => {
    const { m, r } = run(
      preset("straight", {
        treadKind: "folded-steel",
        supports: { treadScrews: 6, treadHoleDiameter: 40 },
      }),
    );
    expect(frList(m.errors)).toEqual([]);
    const treadHoles = m.parts
      .filter((p) => p.category === "tread")
      .reduce((a, p) => a + (p.flat?.outline.holes.length ?? 0), 0);
    const supportHoles = r.supports.reduce(
      (a, s) => a + (s.parts[1]!.quantities[QUANTITY_HOLES] ?? 0),
      0,
    );
    const declared = r.supports
      .flatMap((s) => s.parts.flatMap((p) => p.fixings ?? []))
      .filter((f) => f.joint === "treadBolted")
      .reduce((a, f) => a + f.points, 0);
    const screws = (m.fasteners ?? [])
      .filter((f) => f.joint === "treadBolted")
      .reduce((a, f) => a + f.quantity, 0);
    expect(treadHoles).toBeGreaterThan(0);
    expect(treadHoles).toBeLessThan(6 * r.supports.length);
    expect(supportHoles).toBe(treadHoles);
    expect(declared).toBe(treadHoles);
    expect(screws).toBe(treadHoles);
    for (const s of r.supports) {
      expect(s.parts[1]!.flat?.outline.holes).toHaveLength(s.treadPoints.length);
    }
    const keys = (m.notes ?? []).map((n) => n.key);
    expect(keys).toContain("structure.steel.note.treadFixing.screwed");
    expect(keys).toContain("structure.steel.note.treadHolesSkipped");
  });

  it("valeurs par défaut : tous les points percés, remarque de fixation (vissée | soudée)", () => {
    for (const treadFixing of ["screwed", "welded"] as const) {
      const { m } = run(
        preset("quarter-left", { treadKind: "folded-steel", supports: { treadFixing } }),
      );
      const keys = (m.notes ?? []).map((n) => n.key);
      expect(keys).toContain(`structure.steel.note.treadFixing.${treadFixing}`);
      expect(keys).not.toContain("structure.steel.note.treadHolesSkipped");
    }
  });
});

describe("limon central : appui des supports sur la poutre", () => {
  it.each(["quarter-left", "two-quarters-u", "half-turn"] as const)(
    "%s : consoles en biais posées sur le dessus réel de la poutre (largeur b / cos β)",
    (id) => {
      const { m, r } = run(preset(id));
      expect(frList(m.errors)).toEqual([]);
      let biased = 0;
      for (const s of r.supports) {
        expect(expectConsoleOnBeam(s, r.trace!, r.beam!, 50)).toBeGreaterThan(0);
        if (s.beamHi - s.beamLo > 100 + 1) biased++;
      }
      // Marches balancées : des consoles croisent la poutre en biais.
      expect(biased).toBeGreaterThan(0);
    },
  );

  it("support plié : posé d'équerre sur la trace (section prismatique), même sur un balancement", () => {
    const { r } = run(preset("two-quarters-u", { supports: { kind: "folded-z" } }));
    for (const s of r.supports) {
      expect(Math.abs(V.dot(s.across, r.trace!.left(s.sigma)))).toBeCloseTo(1, 9);
      expect(s.beamHi - s.beamLo).toBeCloseTo(100, 9);
    }
  });

  it("caisson : support assemblé à la semelle haute du tronçon (dessus de la poutre)", () => {
    const { m, r } = run(
      preset("quarter-left", { supports: { kind: "folded-z", fixing: "bolted" } }),
    );
    for (const s of r.supports) {
      expect(s.beamPart).toMatch(/^central-flange-top-\d+$/);
      const f = s.parts[0]!.fixings?.find((x) => x.joint === "supportBolted");
      expect(f?.with).toEqual([s.beamPart]);
      expect(m.parts.find((p) => p.id === s.parts[0]!.id)?.assembledWith).toContain(s.beamPart);
    }
    // Tube : la barre elle-même.
    const tube = run(preset("straight"));
    for (const s of tube.r.supports) expect(s.beamPart).toMatch(/^central-tube-\d+$/);
  });

  it("entraxe des supports de palier inférieur à la largeur d'appui : erreur, supports jointifs", () => {
    const { m, r } = run(preset("quarter-landing", { supports: { landingSpacing: 10 } }));
    expect(m.errors.map((e) => e.key)).toContain("structure.steelCentral.error.landingSpacing");
    const landing = m.stepping.treads.find((t) => t.kind === "landing")!;
    const under = r.supports.filter((s) => s.tread === landing.number);
    expect(under.length).toBeGreaterThan(1);
    // Supports jointifs au plus : aucune superposition le long de la trace.
    const sorted = [...under].sort((a, b) => a.sigma - b.sigma);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.sigma - sorted[i - 1]!.sigma).toBeGreaterThanOrEqual(60 - 1e-6);
    }
  });
});

describe("limon central : supports pliés (C §2.6 [43], [42])", () => {
  it.each([
    ["folded-u", 2],
    ["folded-z", 2],
    ["folded-triangle", 2],
  ] as const)(
    "%s : développé à %i plis, tôle de 4 mm, dessus = dessous de la marche",
    (kind, bends) => {
      const { m, r } = run(preset("quarter-left", { supports: { kind } }));
      expect(frList(m.errors)).toEqual([]);
      expect(violations(m, "FAB_MARCHE_PORTEE")).toEqual([]);
      for (const s of r.supports) {
        expect(s.parts).toHaveLength(1);
        const p = s.parts[0]!;
        expect(p.id).toBe(`support-${s.tread}-central`);
        expect(p.flat?.thickness).toBe(4);
        expect(p.flat?.lines.filter((l) => l.kind === "bend")).toHaveLength(bends);
        expect(p.quantities["bends"]).toBe(bends);
        expect(zRange(p.solid).hi).toBeCloseTo(s.zTop, 6);
        // Ailes posées sur la poutre, qui descend vers l'avant à la pente (retour du Z compris).
        expect(zRange(p.solid).lo).toBeGreaterThan(s.zBeam - 2 * s.bearingWidth);
        expect(zRange(p.solid).lo).toBeLessThan(s.zBeam + 1);
      }
      // Contrôles de pliage des supports (loi de pli de la tôle de 4 mm).
      expect(m.compliance.results.some((x) => x.ruleId === "FAB_PLI_BORD_MIN")).toBe(true);
    },
  );

  it("Z vissé : boulons dans le retour posé, assemblés à la pièce de poutre", () => {
    const { r } = run(preset("straight", { supports: { kind: "folded-z", fixing: "bolted" } }));
    for (const s of r.supports) {
      const f = s.parts[0]!.fixings?.find((x) => x.joint === "supportBolted");
      expect(f?.points).toBe(2);
      expect(f?.with).toEqual([s.beamPart]);
      expect(s.parts[0]!.quantities[QUANTITY_WELD_MM]).toBe(0);
    }
  });

  it("U vissé : aucune aile posée, fixation soudée retenue et signalée", () => {
    const { m, r } = run(preset("straight", { supports: { kind: "folded-u", fixing: "bolted" } }));
    expect(frList(m.notes).join(" ")).toMatch(/fixation soudée retenue/);
    for (const s of r.supports) {
      expect(s.parts[0]!.fixings?.some((x) => x.joint === "supportBolted") ?? false).toBe(false);
    }
  });
});

describe("limon central : finition, nuance, paramètres", () => {
  it("galvanisé S355 : matière galvanisée, EXC2 (S355 soudé)", () => {
    const { m, r } = run(preset("straight", { grade: "S355", finish: "galvanized" }));
    expect(m.executionClass).toBe("EXC2");
    for (const s of r.supports) {
      expect(s.parts.every((p) => p.material === "steel-galvanized")).toBe(true);
    }
  });

  it("longueur de support imposée : centrée sur la poutre, dans la zone d'appui", () => {
    const { r } = run(preset("straight", { supports: { length: 400 } }));
    for (const s of r.supports) {
      expect(s.s1 - s.s0).toBeCloseTo(400, 6);
      expect(s.s0).toBeCloseTo(-200, 6);
    }
  });

  it("dessus de poutre imposé trop haut : contrôle de hauteur des supports en violation", () => {
    const { m } = run(preset("straight", { beam: { topOffset: 80 } }));
    expect(m.parts.length).toBeGreaterThan(0);
    const bad = violations(m, CENTRAL_RULES.supportHeight.id).length;
    const errs = m.errors.length;
    expect(bad + errs).toBeGreaterThan(0);
  });

  it("décalage latéral : supports dissymétriques autour de la poutre", () => {
    const { m, r } = run(preset("straight", { trace: { lateralOffset: 100 } }));
    expect(frList(m.errors)).toEqual([]);
    const s = r.supports[2]!;
    expect(Math.abs(s.s1 + s.s0 + 200)).toBeLessThan(1);
  });
});

describe("capacités", () => {
  it("tube non pris en charge sur un tracé tournant ou hélicoïdal (raison traduite)", () => {
    expect(structureUnsupportedOptions("steel-central", { kind: "flights", turns: 0 })).toEqual([]);
    for (const traits of [
      { kind: "flights", turns: 1 },
      { kind: "flights", turns: 2 },
      { kind: "helical", turns: 0 },
    ] as const) {
      const opts = structureUnsupportedOptions("steel-central", traits);
      expect(opts.map((o) => [o.path, o.value])).toEqual([[["section", "kind"], "tube"]]);
      expect(fr(opts[0]!.reason)).toMatch(/C §2\.3/);
      expect(EN.t(opts[0]!.reason)).toMatch(/^Tube for straight stairs only/);
    }
  });

  it("défauts : tube sur un escalier droit, caisson sur un tracé courbe ; pas de poteau exigé", () => {
    const sec = (id: PresetId): string => {
      const m = buildModel(preset(id), { memo: false });
      const ctx = { project: preset(id), layout: m.layout, stepping: m.stepping };
      return (STEEL_CENTRAL.defaults(ctx) as { section: { kind: string } }).section.kind;
    };
    expect(sec("straight")).toBe("tube");
    expect(sec("quarter-left")).toBe("box");
    expect(sec("helical")).toBe("box");
    expect(STEEL_CENTRAL.capabilities?.requiresNewel).toBe(false);
    expect(STEEL_CENTRAL.capabilities?.layouts).toEqual(["flights", "helical"]);
    expect(
      STEEL_CENTRAL.capabilities?.lateralThickness?.(SteelCentralParamsSchema.parse({})),
    ).toEqual({ inner: 0, outer: 0 });
  });
});

describe("robustesse (ne lève jamais)", () => {
  it("trace non construite : erreurs, aucune pièce, contrôle de porte-à-faux présent", () => {
    const p = preset("straight");
    const m = buildModel(p, { memo: false });
    const ctx = { project: p, layout: m.layout, stepping: m.stepping };
    const errors = [textMessage("trace impossible")];
    const r = buildSteelCentral(ctx, SteelCentralParamsSchema.parse({}), {
      buildTrace: () => ({ ok: false, errors }),
      buildBeam: () => {
        throw new Error("non appelé");
      },
    });
    expect(r.output.parts).toEqual([]);
    expect(r.output.errors).toEqual(errors);
    expect(r.output.checks.map((c) => c.ruleId)).toEqual([CANTILEVER]);
  });

  it("exception de la poutre : erreur explicite « non générée », aucune exception", () => {
    const p = preset("straight");
    const m = buildModel(p, { memo: false });
    const ctx = { project: p, layout: m.layout, stepping: m.stepping };
    const r = buildSteelCentral(ctx, SteelCentralParamsSchema.parse({}), {
      // Trace réelle, poutre défaillante.
      buildTrace: buildCentralTrace,
      buildBeam: (): CentralBeamResult => {
        throw new Error("poutre");
      },
    });
    expect(frList(r.output.errors)).toEqual([expect.stringMatching(/non générée : poutre/)]);
    expect(r.output.checks.some((c) => c.ruleId === CANTILEVER)).toBe(true);
  });

  it("intervalle d'une droite dans un polygone (contient le point, sinon null)", () => {
    const sq = [V.vec(0, 0), V.vec(10, 0), V.vec(10, 10), V.vec(0, 10)];
    expect(lineInterval(sq, V.vec(5, 5), V.vec(1, 0))).toEqual({ t0: -5, t1: 5 });
    expect(lineInterval(sq, V.vec(15, 5), V.vec(1, 0))).toBeNull();
  });
});

describe("textes anglais", () => {
  const FRENCH =
    /[àâçéèêëîïôûùœ«»]|\b(limons?|marches?|tôle|poteau|soudure|aucune?|sans|avec|platine|console|appui|pliée?)\b/i;
  it.each([
    ["droit", preset("straight")],
    [
      "quart, tôle pliée, supports en Z",
      preset("quarter-left", { treadKind: "folded-steel", supports: { kind: "folded-z" } }),
    ],
    ["hélicoïdal, triangle", preset("helical", { supports: { kind: "folded-triangle" } })],
  ])("%s : messages du plugin traduits, sans reste de français", (_, project) => {
    const { r } = run(project);
    const list: Message[] = [...r.output.notes, ...(r.output.errors ?? [])];
    for (const c of r.output.checks) list.push(c.message);
    for (const s of r.supports) {
      for (const p of s.parts) {
        list.push(p.name);
        if (p.section) list.push(p.section);
        if (p.flat?.reference) list.push(p.flat.reference.description);
        for (const l of p.flat?.lines ?? []) if (l.label) list.push(l.label);
      }
    }
    expect(list.length).toBeGreaterThan(10);
    for (const msg of list) {
      const t = EN.t(msg);
      expect(t, t).not.toMatch(/structure\.steelCentral\./);
      expect(t, t).not.toMatch(FRENCH);
    }
  });
});

// ------------------------------------------------------------------ propriétés

/** Paramètres du plugin tirés au hasard (valeurs plausibles). */
const paramsArb = fc.record({
  treadKind: fc.constantFrom("wood", "folded-steel"),
  supports: fc.record({
    kind: fc.constantFrom("console", "folded-u", "folded-z", "folded-triangle"),
    fixing: fc.constantFrom("welded", "bolted"),
    treadFixing: fc.constantFrom("screwed", "welded"),
    // Perçage trop gros pour l'appui (30 mm) : points non reportés dans la marche (A31).
    treadHoleDiameter: fc.constantFrom(9, 9, 30),
  }),
  // Sections plausibles (constructibles) ; type laissé au défaut du plugin (tube sur un droit,
  // caisson sur une trace courbe) ou caisson imposé.
  section: fc.record(
    {
      kind: fc.constantFrom(undefined, "box"),
      height: fc.integer({ min: 150, max: 300 }),
      width: fc.integer({ min: 80, max: 160 }),
      wallThickness: fc.integer({ min: 3, max: 12 }),
      webThickness: fc.integer({ min: 4, max: 12 }),
      flangeThickness: fc.integer({ min: 4, max: 12 }),
    },
    { requiredKeys: ["height", "width", "wallThickness", "webThickness", "flangeThickness"] },
  ),
  grade: fc.constantFrom("S235", "S355"),
  trace: fc.record({
    lateralOffset: fc.oneof(fc.constant(0), fc.integer({ min: -60, max: 60 })),
  }),
});

const straightArb = fc
  .record({
    H: fc.integer({ min: 2200, max: 3300 }),
    E: fc.integer({ min: 700, max: 1200 }),
    nosing: fc.integer({ min: 0, max: 40 }),
  })
  .map(({ H, E, nosing }) => {
    const n = Math.round(H / 175);
    const g = 630 - (2 * H) / n;
    return makeSteppingProject({
      width: E,
      legs: [Math.round((n - 1) * g)],
      floorToFloor: H,
      treads: { nosing },
    });
  });

const projectArb = fc.oneof(
  straightArb,
  stairArb().map((s) => s.project),
  fc
    .constantFrom<PresetId>("helical", "quarter-landing", "two-quarters-s")
    .map((id) => createProject(id)),
);

describe("propriétés (générateurs contraints)", () => {
  it("buildModel ne lève jamais (steel-central, paramètres et tracés tirés)", () => {
    fc.assert(
      fc.property(projectArb, paramsArb, (p, params) => {
        expect(() => buildModel(withCentral(p, params), { memo: false })).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it("section incohérente (parois trop épaisses) : erreur explicite, aucune pièce de poutre, quantités finies", () => {
    const badSection = fc.oneof(
      fc.record({
        kind: fc.constant("tube"),
        width: fc.integer({ min: 40, max: 160 }),
        height: fc.integer({ min: 40, max: 300 }),
        wallThickness: fc.integer({ min: 20, max: 200 }),
      }),
      fc.record({
        kind: fc.constant("box"),
        width: fc.integer({ min: 20, max: 160 }),
        height: fc.integer({ min: 10, max: 300 }),
        webThickness: fc.integer({ min: 4, max: 100 }),
        flangeThickness: fc.integer({ min: 4, max: 160 }),
      }),
    );
    let invalid = 0;
    fc.assert(
      fc.property(projectArb, badSection, (base, section) => {
        const m = buildModel(withCentral(base, { section }), { memo: false });
        for (const p of m.parts) {
          for (const [k, v] of Object.entries(p.quantities)) {
            expect(Number.isFinite(v) && v >= 0, `${p.id}.${k} = ${v}`).toBe(true);
          }
        }
        const tooThick =
          section.kind === "tube"
            ? 2 * section.wallThickness >= Math.min(section.width, section.height)
            : 2 * section.webThickness >= section.width ||
              2 * section.flangeThickness >= section.height;
        if (!tooThick || m.stepping.treads.length === 0) return;
        invalid++;
        expect(m.parts.some((p) => p.id.startsWith("central-"))).toBe(false);
        expect(
          m.errors.some((e) =>
            [
              "structure.steelCentral.error.tubeWallTooThick",
              "structure.steelCentral.error.websTooThick",
              "structure.steelCentral.error.flangesTooThick",
              "structure.steelCentral.error.tubeOnCurve",
              "structure.steelCentral.error.traceNotBuilt",
            ].includes(e.key),
          ),
          frList(m.errors).join(" | "),
        ).toBe(true);
      }),
      { numRuns: 25 },
    );
    expect(invalid).toBeGreaterThanOrEqual(5);
  });

  it("modèle sans erreur : un support sous chaque marche, dans la zone, sous la marche, au-dessus de la poutre", () => {
    let complete = 0;
    fc.assert(
      fc.property(projectArb, paramsArb, (base, params) => {
        const project = withCentral(base, params);
        const { m, r } = run(project);
        // Porte-à-faux et torsion : toujours présent, quel que soit l'état du modèle.
        if (m.stepping.treads.length > 0 && m.layout.walkline.segments.length > 0) {
          expect(r.output.checks.filter((c) => c.ruleId === CANTILEVER)).toHaveLength(1);
        }
        if (m.errors.length > 0 || !r.trace) return;
        complete++;
        // Trace à l'axe de l'emmarchement : chaque marche a son support. Trace décalée : une
        // marche étroite au droit du jour peut ne plus avoir de zone d'appui au droit de la
        // poutre, signalée (FAB_MARCHE_PORTEE) et jamais silencieuse.
        const numbers = new Set(r.supports.map((s) => s.tread));
        const notCarried = new Set(
          violations(m, "FAB_MARCHE_PORTEE").map((v) =>
            v.location.kind === "tread" ? v.location.number : -1,
          ),
        );
        for (const t of m.stepping.treads) {
          expect(numbers.has(t.number) || notCarried.has(t.number), `M${t.number}`).toBe(true);
          if (params.trace.lateralOffset === 0) {
            expect(numbers.has(t.number), `M${t.number}`).toBe(true);
          }
        }
        const footprint = m.layout.footprint;
        const holes = m.layout.footprintHoles ?? [];
        for (const s of r.supports) {
          // Dessus du support = dessous de la marche ; au-dessus de la poutre (topOffset auto).
          const top = Math.max(...s.parts.map((p) => zRange(p.solid).hi));
          expect(top).toBeCloseTo(s.zTop, 6);
          expect(s.zTop - s.zBeam).toBeGreaterThanOrEqual(40 - 1e-6);
          // Le support enjambe la poutre (rives dans sa direction, au moins ∓ b/2) ; sinon (support
          // plié posé d'équerre sur une marche balancée étroite) la marche est signalée non
          // portée, jamais en silence.
          const half = params.section.width / 2;
          expect(s.beamLo).toBeLessThanOrEqual(-half + 1e-6);
          expect(s.beamHi).toBeGreaterThanOrEqual(half - 1e-6);
          // Console : âme posée sur le dessus réel de la poutre (biais des marches balancées).
          if (params.supports.kind === "console" && r.beam) {
            expectConsoleOnBeam(s, r.trace, r.beam, half);
          }
          const spans = s.s0 <= s.beamLo + 1e-6 && s.s1 >= s.beamHi - 1e-6;
          const carriedByOther = r.supports.some(
            (o) => o.tread === s.tread && o.s0 <= o.beamLo + 1e-6 && o.s1 >= o.beamHi - 1e-6,
          );
          if (!spans && !carriedByOther) {
            expect(notCarried.has(s.tread), `M${s.tread} non portée signalée`).toBe(true);
          }
          // Aucune pièce de support hors emprise (tolérance 1 mm : bruit des repères).
          for (const p of s.parts) {
            for (const q of planPoints(p.solid)) {
              expect(outsideBy(q, footprint), p.id).toBeLessThan(1);
              for (const h of holes) expect(pointInPolygon(q, h, 1e-6), p.id).not.toBe("inside");
            }
          }
        }
        // Poutre et platines : dans l'emprise, au prolongement de départ près (`startExtension`,
        // 50 mm devant le nez de départ) et à l'épaisseur de la platine de tête près.
        const tol = 50 + 10 + 1;
        for (const p of r.beam?.parts ?? []) {
          for (const q of planPoints(p.solid)) {
            expect(outsideBy(q, footprint), p.id).toBeLessThan(tol);
          }
        }
        // A31 : trous des marches en tôle = points `treadBolted` des supports = vis à métaux.
        const treadHoles = m.parts
          .filter(
            (p) =>
              (p.category === "tread" || p.category === "landing") &&
              p.material.startsWith("steel"),
          )
          .reduce((a, p) => a + (p.flat?.outline.holes.length ?? 0), 0);
        const declared = m.parts
          .flatMap((p) => p.fixings ?? [])
          .filter((f) => f.joint === "treadBolted")
          .reduce((a, f) => a + f.points, 0);
        const screws = (m.fasteners ?? [])
          .filter((f) => f.joint === "treadBolted")
          .reduce((a, f) => a + f.quantity, 0);
        expect(declared).toBe(treadHoles);
        expect(screws).toBe(treadHoles);
        // Quantités finies et positives.
        for (const p of m.parts) {
          for (const [k, v] of Object.entries(p.quantities)) {
            expect(Number.isFinite(v) && v >= 0, `${p.id}.${k} = ${v}`).toBe(true);
          }
        }
        // Classe d'exécution : EXC2 ⇔ soudure bout à bout, ou S355 soudé.
        const weld = m.parts.reduce((a, p) => a + (p.quantities[QUANTITY_WELD_MM] ?? 0), 0);
        const butt = m.parts.reduce((a, p) => a + (p.quantities[QUANTITY_BUTT_WELD_MM] ?? 0), 0);
        const expected = butt > 1e-9 || (params.grade === "S355" && weld > 1e-9) ? "EXC2" : "EXC1";
        expect(m.executionClass).toBe(expected);
      }),
      { numRuns: 30 },
    );
    // Propriété non vide : la plupart des escaliers tirés sont construits sans erreur.
    expect(complete).toBeGreaterThanOrEqual(10);
  });
});

describe("caisson : entraxe des entretoises sous la borne basse (QUESTIONS A32 (a))", () => {
  it("modèle : erreur lisible, entretoises d'extrémité et de joint seules, modèle construit", () => {
    const over = { section: { kind: "box", height: 200, diaphragmSpacing: 120 } };
    const { m } = run(preset("straight", over));
    const err = m.errors.find((e) => e.key === "structure.steelCentral.error.diaphragmMinSpacing");
    expect(err).toBeDefined();
    expect(fr(err!)).toContain("200");
    const count = m.parts.filter((p) => p.id.startsWith("central-diaphragm-")).length;
    const { m: ref } = run(preset("straight", { section: { kind: "box" } }));
    const refCount = ref.parts.filter((p) => p.id.startsWith("central-diaphragm-")).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(refCount);
    expect(m.parts.some((p) => p.id.startsWith("central-web-"))).toBe(true);
  });

  it("borne `auto` exposée (hauteur de la section) sur un caisson, absente sur un tube", () => {
    const key = "stair.structure.params.section.diaphragmMinSpacing";
    const { m } = run(preset("straight", { section: { kind: "box", height: 240 } }));
    expect(m.autoValues?.[key]).toBe(240);
    const { m: tube } = run(preset("straight"));
    expect(tube.autoValues?.[key]).toBeUndefined();
    const { m: entered } = run(
      preset("straight", { section: { kind: "box", diaphragmMinSpacing: 150 } }),
    );
    expect(entered.autoValues?.[key]).toBeUndefined();
  });
});
