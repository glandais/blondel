/**
 * Plugin `wood-central` (limon central bois, QUESTIONS A29, vague 2) : capacités, contrôles
 * selon le tracé (règles de moyens, entaille arrière, k_r, plis minces, porte-à-faux),
 * justifications jointes, refus à petit rayon, valeurs `auto`, prédimensionnement, visserie ;
 * propriétés sur générateurs contraints.
 */
import fc from "fast-check";
import { translatorFor, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Model, RuleResult, SolidDesc } from "../model/derived.js";
import type { StructureOutput } from "../model/plugins.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { buildModel, deepMerge } from "../pipeline/build.js";
import { createProject, type PresetId } from "../project/presets.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { getRule } from "../rules/table.js";
import { grainAngle, hankinsonFactor } from "../precheck/grain.js";
import { structureUnsupportedOptions } from "./registry.js";
import { CENTRAL_RULES } from "./steelCentral.js";
import { deduceExecutionClass } from "./steelCommon.js";
import {
  WOOD_CENTRAL,
  WOOD_CENTRAL_RULES,
  WoodCentralParamsSchema,
  buildWoodCentral,
} from "./woodCentral.js";
import { woodBeamOf, woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";
import type { WoodCentralBeamResult } from "./woodCentralBeam.js";
import "./index.js";

const EN = translatorFor("en");
const CANTILEVER = CENTRAL_RULES.cantilever.id;
const THIN = WOOD_CENTRAL_RULES.thinPlies.id;
const KR = "LAMELLE_CINTRE_KR";
const KR_MIN = getRule(KR).min!;

/** Marches sans contremarche (entaille arrière dans la dent suivante). */
const OPEN = { risers: "none", thickness: 80 } as const;

/** Cintrage sur moule choisi (le défaut sur trace courbe est la filière des couches empilées). */
const MOULD = { section: { curvedMethod: "mould" } } as const;

function withWoodCentral(
  p: Project,
  params: Record<string, unknown> = {},
  treads: Record<string, unknown> = OPEN,
): Project {
  return deepMerge(p, {
    stair: { treads, structure: { kind: "wood-central", params } },
  }) as Project;
}

function preset(
  id: PresetId,
  params: Record<string, unknown> = {},
  treads: Record<string, unknown> = OPEN,
): Project {
  return withWoodCentral(createProject(id), params, treads);
}

/**
 * Escalier droit dans le domaine de l'exemple FCBA (H = 2 600, volée de 3 400 mm) : le tableau
 * est exploitable (le droit du préréglage, 3 780 mm de projection, en sort).
 */
function fcbaStraight(params: Record<string, unknown> = {}): Project {
  return withWoodCentral(
    createProject("straight", {
      floorToFloor: 2600,
      patch: { stair: { layout: { legs: [{ length: 3400 }] } } },
    }),
    params,
  );
}

/** Sortie du plugin et poutre détaillée (mêmes paramètres résolus que le pipeline). */
function run(project: Project): {
  m: Model;
  out: StructureOutput;
  beam: WoodCentralBeamResult | null;
} {
  const m = buildModel(project, { memo: false });
  const ctx = woodCentralContext(project);
  const params = woodCentralParams(project.stair.structure.params as Record<string, unknown>);
  const out = buildWoodCentral(ctx, params);
  let beam: WoodCentralBeamResult | null = null;
  try {
    beam = woodBeamOf(ctx, params).beam;
  } catch {
    beam = null;
  }
  return { m, out, beam };
}

const byRule = (checks: readonly RuleResult[], id: string) => checks.filter((c) => c.ruleId === id);
const violations = (m: Model, id: string) =>
  m.compliance.results.filter((r) => r.ruleId === id && r.status === "violation");

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

// ------------------------------------------------------------------ capacités

describe("capacités", () => {
  it("bois massif grisé sur un tournant et un hélicoïdal (raison traduite), rien sur un droit", () => {
    expect(structureUnsupportedOptions("wood-central", { kind: "flights", turns: 0 })).toEqual([]);
    for (const traits of [
      { kind: "flights", turns: 1 },
      { kind: "helical", turns: 0 },
    ] as const) {
      const opts = structureUnsupportedOptions("wood-central", traits);
      expect(opts.map((o) => [o.path, o.value])).toEqual([[["section", "kind"], "solid"]]);
      expect(fr(opts[0]!.reason)).toMatch(/C §1\.6/);
      expect(EN.t(opts[0]!.reason)).not.toBe("structure.woodCentral.unsupported.solidCurved");
    }
  });

  it("défauts : lamellé-collé de 88 mm sur tous les tracés, `auto` partout, pas de poteau", () => {
    for (const id of ["straight", "quarter-left", "helical"] as const) {
      const p = preset(id);
      const ctx = woodCentralContext(p);
      const d = WOOD_CENTRAL.defaults(ctx) as ReturnType<typeof WoodCentralParamsSchema.parse>;
      expect(d.section.kind).toBe("glulam");
      expect(d.section.width).toBe(88);
      expect(d.section.residual).toBe("auto");
      expect(d.section.lamellaThickness).toBe("auto");
      expect(d.notch.rearDepth).toBe("auto");
      expect(d.cantileverJustification).toBe("");
      expect(d.laminationJustification).toBe("");
    }
    expect(WOOD_CENTRAL.family).toBe("bois");
    expect(WOOD_CENTRAL.capabilities?.requiresNewel).toBe(false);
    expect(WOOD_CENTRAL.capabilities?.layouts).toEqual(["flights", "helical"]);
    expect(
      WOOD_CENTRAL.capabilities?.lateralThickness?.(WoodCentralParamsSchema.parse({})),
    ).toEqual({ inner: 0, outer: 0 });
  });
});

// ------------------------------------------------------------------ contrôles

describe("contrôles selon le tracé", () => {
  it("droit : règles de moyens, entaille arrière, k_r = 1 sans cintrage, pas de plis minces", () => {
    const { m, out } = run(fcbaStraight());
    expect(frList(m.errors)).toEqual([]);
    const cr = byRule(out.checks, "CREMAILLERE_REGLE_MOYENS");
    expect(cr.length).toBeGreaterThan(0);
    expect(cr.every((c) => c.status === "ok")).toBe(true);
    expect(fr(cr[0]!.message)).toContain("crémaillère centrale (D40, largeur 88 mm");
    expect(byRule(out.checks, "LIMON_ENTAILLE_MIN").length).toBeGreaterThan(0);
    const kr = byRule(out.checks, KR);
    expect(kr.map((c) => c.status)).toEqual(["ok"]);
    expect(fr(kr[0]!.message)).toMatch(/sans cintrage : k_r = 1/);
    expect(byRule(out.checks, THIN)).toEqual([]);
    expect(byRule(out.checks, CANTILEVER)).toHaveLength(1);
    // Contrôles rendus par le plugin dans le rapport (pas le résultat d'attente du moteur).
    for (const id of ["CREMAILLERE_REGLE_MOYENS", "LIMON_ENTAILLE_MIN", KR]) {
      const rs = m.compliance.results.filter((r) => r.ruleId === id);
      expect(rs.length, id).toBeGreaterThan(0);
      expect(
        rs.some((r) => /portée? par la structure/.test(fr(r.message))),
        id,
      ).toBe(false);
    }
  });

  it("quart tournant, cintrage sur moule choisi : lamelles cintrées, k_r contrôlé, FCBA hors domaine, plis minces signalés", () => {
    const { m, out, beam } = run(preset("quarter-left", MOULD));
    expect(frList(m.errors)).toEqual([]);
    expect(beam?.lamination.curved).toBe(true);
    const kr = byRule(out.checks, KR);
    expect(kr).toHaveLength(1);
    expect(kr[0]!.status).toBe("ok");
    expect(kr[0]!.measured).toBeCloseTo(beam!.lamination.ratio, 9);
    expect(fr(kr[0]!.message)).toMatch(/k_r = 1/);
    const cr = byRule(out.checks, "CREMAILLERE_REGLE_MOYENS");
    expect(cr.map((c) => c.status)).toEqual(["non-evaluee"]);
    // Épaisseur `auto` : r_in / t ≥ 240, lamelles minces ⇒ avertissement (SPEC Q10).
    const thin = byRule(out.checks, THIN);
    expect(thin).toHaveLength(1);
    expect(beam!.lamination.lamellaThickness).toBeLessThanOrEqual(7);
    expect(thin[0]!.status).toBe("violation");
    expect(fr(thin[0]!.message)).toMatch(/justification requise/);
  });

  it("lamelles épaisses (au-delà du seuil) : plis minces conformes", () => {
    const { out, beam } = run(
      preset("quarter-left", {
        section: { thinPlyMax: 1, lamellaThickness: 2, curvedMethod: "mould" },
      }),
    );
    expect(beam!.lamination.lamellaThickness).toBeGreaterThan(1);
    expect(byRule(out.checks, THIN).map((c) => c.status)).toEqual(["ok"]);
  });

  it("quart tournant et hélicoïdal par défaut : couches empilées, k_r = 1 sans cintrage, pas de plis minces", () => {
    for (const id of ["quarter-left", "helical"] as const) {
      const { m, out, beam } = run(preset(id));
      expect(frList(m.errors)).toEqual([]);
      expect(beam!.lamination.method, id).toBe("stacked");
      const kr = byRule(out.checks, KR);
      expect(kr.map((c) => [c.status, c.message.key])).toEqual([
        ["ok", "structure.woodCentral.check.krStacked"],
      ]);
      expect(fr(kr[0]!.message)).toMatch(/sans cintrage : k_r = 1/);
      expect(byRule(out.checks, THIN)).toEqual([]);
      expect(byRule(out.checks, "CREMAILLERE_REGLE_MOYENS").map((c) => c.status)).toEqual([
        "non-evaluee",
      ]);
    }
    // Refus de cintrage toujours actif sur le moule, sans objet en couches empilées.
    const stacked = run(preset("quarter-left", { section: { lamellaThickness: 10 } }));
    expect(stacked.out.errors ?? []).toEqual([]);
    expect(byRule(stacked.out.checks, KR).map((c) => c.status)).toEqual(["ok"]);
  });

  it("contremarches pleines (A33 (i)) : entaille arrière derrière la contremarche, conforme", () => {
    const { out } = run(preset("straight", {}, { risers: "full" }));
    const housing = byRule(out.checks, "LIMON_ENTAILLE_MIN");
    expect(housing.length).toBeGreaterThan(0);
    expect(housing.every((c) => c.status === "ok")).toBe(true);
    expect(
      housing.some((c) => c.message.key === "structure.woodCentral.check.rearHousingNone"),
    ).toBe(false);
    expect(out.notes.map((n) => n.key)).toContain("structure.woodCentral.note.riserHousing");
    // Entaille nulle saisie : marches posées, constat explicite (chemin conservé).
    const laid = byRule(
      run(preset("straight", { notch: { rearDepth: 0 } }, { risers: "full" })).out.checks,
      "LIMON_ENTAILLE_MIN",
    );
    expect(laid.every((c) => c.status === "violation")).toBe(true);
    expect(fr(laid[0]!.message)).toMatch(/marche posée, sans entaille arrière/);
  });
});

describe("justifications jointes (A12)", () => {
  it("porte-à-faux : sans justification « requise », avec : l'avertissement reste, jointe", () => {
    const none = byRule(run(preset("straight")).out.checks, CANTILEVER);
    expect(none.map((c) => c.status)).toEqual(["violation"]);
    expect(fr(none[0]!.message)).toMatch(/^Justification requise/);
    const just = byRule(
      run(preset("straight", { cantileverJustification: " Note de calcul n° 12 " })).out.checks,
      CANTILEVER,
    );
    expect(just.map((c) => c.status)).toEqual(["violation"]);
    expect(just[0]!.justification).toBe("Note de calcul n° 12");
    expect(fr(just[0]!.message)).toMatch(/justification jointe/);
  });

  it("plis minces : justification jointe, l'avertissement reste", () => {
    const { out } = run(
      preset("quarter-left", { ...MOULD, laminationJustification: "Avis technique 7" }),
    );
    const thin = byRule(out.checks, THIN);
    expect(thin.map((c) => c.status)).toEqual(["violation"]);
    expect(thin[0]!.justification).toBe("Avis technique 7");
    expect(fr(thin[0]!.message)).toMatch(/justification jointe \(non vérifiée par Blondel\)/);
  });
});

describe("refus et configurations non prises en charge (aucune exception)", () => {
  it("rayon trop petit (lamelles de 10 mm sur quart tournant) : refus lisible, bloquant, aucune pièce", () => {
    const { m, out, beam } = run(
      preset("quarter-left", { section: { lamellaThickness: 10, curvedMethod: "mould" } }),
    );
    expect(beam!.lamination.ratio).toBeLessThan(KR_MIN);
    expect((out.errors ?? []).map((e) => e.key)).toContain(
      "structure.woodCentral.error.bendRadius",
    );
    expect(
      frList(m.errors).some((e) =>
        e.startsWith("Limon central bois : rayon de cintrage trop petit"),
      ),
    ).toBe(true);
    const kr = byRule(out.checks, KR);
    expect(kr).toHaveLength(1);
    expect(kr[0]!.status).toBe("violation");
    expect(kr[0]!.severity).toBe("bloquant");
    expect(fr(kr[0]!.message)).toMatch(/cintrage refusé/);
    expect(m.parts.some((p) => p.id.startsWith("wood-central-"))).toBe(false);
    expect(byRule(out.checks, CANTILEVER)).toHaveLength(1);
    expect(out.precheck).toBeUndefined();
  });

  it("bois massif sur un tournant : erreur explicite, aucune poutre", () => {
    const { m, out } = run(preset("quarter-left", { section: { kind: "solid" } }));
    expect((out.errors ?? []).map((e) => e.key)).toContain(
      "structure.woodCentral.unsupported.solidCurved",
    );
    expect(m.parts.some((p) => p.id === "wood-central-beam")).toBe(false);
  });

  it("trace impossible (poutre hors de l'emmarchement) : erreurs, aucune pièce, porte-à-faux présent", () => {
    const p = preset("straight", { trace: { lateralOffset: 2000 } });
    const out = buildWoodCentral(
      woodCentralContext(p),
      woodCentralParams({ trace: { lateralOffset: 2000 } }),
    );
    expect(out.parts).toEqual([]);
    expect((out.errors ?? []).length).toBeGreaterThan(0);
    expect(out.checks.map((c) => c.ruleId)).toEqual([CANTILEVER]);
  });
});

describe("valeurs auto, prédimensionnement, visserie", () => {
  it("valeurs `auto` retenues : reste sous entaille, épaisseur de lamelle, entaille arrière", () => {
    const { out, beam } = run(preset("straight"));
    expect(out.autoValues).toEqual({
      "section.residual": beam!.residual,
      "section.lamellaThickness": beam!.lamination.lamellaThickness,
      "notch.rearDepth": beam!.rearDepth,
      // EC5 « tous angles » pour M10 (perçage de 11) : a1 = 5·d, a3,c = 4·d (C §1.11 [71]).
      "bolts.minSpacing": 50,
      "bolts.edgeDistance": 40,
      // Tire-fonds Ø10 au plus sévère des règles latérales et axiales (A35 (l), C §1.11 [71]
      // tableau 10.6) : entraxe max(5·d ; 7·d), pince avant max(a3,c ; a1,CG = 10·d).
      "lagScrews.minSpacing": 70,
      "lagScrews.endDistance": 100,
    });
    // Perçage de 13 (M12) : 60 et 48.
    const m12 = run(preset("straight", { bolts: { holeDiameter: 13 } })).out.autoValues!;
    expect(m12["bolts.minSpacing"]).toBe(60);
    expect(m12["bolts.edgeDistance"]).toBe(48);
    expect(m12["lagScrews.minSpacing"]).toBe(84);
    expect(m12["lagScrews.endDistance"]).toBe(120);
    // Valeurs imposées : non exposées.
    const fixed = run(
      preset("straight", {
        section: { residual: 200, lamellaThickness: 44 },
        notch: { rearDepth: 20 },
        bolts: { minSpacing: 40, edgeDistance: 30 },
        lagScrews: { minSpacing: 80, endDistance: 90 },
      }),
    ).out;
    expect(fixed.autoValues).toBeUndefined();
    // Bois massif : pas d'épaisseur de lamelle.
    const solid = run(preset("straight", { section: { kind: "solid" } })).out;
    expect(Object.keys(solid.autoValues ?? {})).not.toContain("section.lamellaThickness");
  });

  it("valeurs `auto` des couches empilées et de la platine (trace courbe par défaut)", () => {
    const { out, beam } = run(preset("quarter-left"));
    expect(beam!.stacked).not.toBeNull();
    const auto = out.autoValues!;
    expect(auto["section.layerThickness"]).toBe(beam!.stacked!.layerThickness);
    expect(auto["section.dressingAllowance"]).toBe(beam!.stacked!.dressingAllowance);
    expect(auto["section.lamellaThickness"]).toBeUndefined();
    // Platine : b + 4 × pince = 88 + 100.
    expect(auto["anchors.plate.width"]).toBe(188);
    // Âme de pied prolongée (A35 (a)) : longueur retenue par la poutre, exposée si `auto`.
    expect(auto["anchors.plate.footWebLength"]).toBe(beam!.footWebLength);
    const fixedWeb = run(preset("quarter-left", { anchors: { plate: { footWebLength: 200 } } }));
    expect(fixedWeb.out.autoValues?.["anchors.plate.footWebLength"]).toBeUndefined();
    // Cintrage sur moule : épaisseur de lamelle, pas de couche.
    const mould = run(preset("quarter-left", MOULD)).out.autoValues!;
    expect(mould["section.lamellaThickness"]).toBeGreaterThan(0);
    expect(mould["section.layerThickness"]).toBeUndefined();
  });

  it("prédimensionnement : poutre LC1, largeur reprise = emmarchement, k_r appliqué", () => {
    const straight = run(preset("straight")).out;
    expect(straight.precheck?.beams).toHaveLength(1);
    expect(straight.precheck?.beams[0]!.partId).toBe("wood-central-beam");
    expect(frList(straight.notes).some((n) => /torsion sous charge excentrée/.test(n))).toBe(true);
    // Classe `auto` (A35 (k)) : chêne lamellé-collé → classe massive de l'essence, D40 (à
    // valider) ; essence lamellé-collé → GL24h ; pin lamellé-collé → C24.
    expect(fr(straight.precheck!.beams[0]!.label)).toMatch(/D40/);
    expect(
      frList(straight.notes).some((n) => /classe D40 : classe massive de l'essence/.test(n)),
    ).toBe(true);
    // D40 : γ_M du bois massif (1,3), f_m,k = 40 ⇒ f_d = 0,8 × 40 / 1,3.
    expect(straight.precheck!.beams[0]!.result.design).toBeCloseTo((0.8 * 40) / 1.3, 9);
    const gl = run(preset("straight", { material: "wood-glulam" })).out;
    expect(fr(gl.precheck!.beams[0]!.label)).toMatch(/GL24h/);
    expect(frList(gl.notes).some((n) => /classe GL24h \(réglage/.test(n))).toBe(true);
    const pine = run(preset("straight", { material: "wood-pine" })).out;
    expect(fr(pine.precheck!.beams[0]!.label)).toMatch(/C24/);
    expect(frList(pine.notes).some((n) => /classe C24 \(réglage/.test(n))).toBe(true);
    // Chêne massif : pas de lamellé-collé, classe `auto` historique C24.
    const solid = run(preset("straight", { section: { kind: "solid" } })).out;
    expect(fr(solid.precheck!.beams[0]!.label)).toMatch(/C24/);
    // Classe FCBA saisie sur une poutre de chêne (relecture A35 (k)) : même classe pour le
    // prédimensionnement que pour la lecture du tableau FCBA.
    const fcbaC30 = run(preset("straight", { strengthClass: "C30" }));
    expect(fcbaC30.beam!.fcba.cls).toBe("C30");
    expect(fr(fcbaC30.out.precheck!.beams[0]!.label)).toMatch(/C30/);
    expect(
      frList(fcbaC30.out.notes).some((n) => /classe C30 : classe massive de l'essence/.test(n)),
    ).toBe(true);
    // Classe saisie : prime sur l'essence.
    const c30 = run(preset("straight", { precheck: { woodClass: "C30" } })).out;
    expect(fr(c30.precheck!.beams[0]!.label)).toMatch(/C30/);
    expect(frList(c30.notes).some((n) => /classe C30 \(réglage/.test(n))).toBe(true);
    // GL24h : γ_M = 1,25, f_m,k = 24 ⇒ f_d = 0,8 × 24 / 1,25.
    expect(gl.precheck!.beams[0]!.result.design).toBeCloseTo((0.8 * 24) / 1.25, 9);
    const gl32 = run(
      preset("straight", { material: "wood-glulam", precheck: { woodClass: "GL32h" } }),
    ).out;
    expect(gl32.precheck!.beams[0]!.result.design).toBeCloseTo((0.8 * 32) / 1.25, 9);
    // k_r < 1 (r_in / t entre 170 et 240) : résistance de calcul réduite.
    const q = run(
      preset("quarter-left", { section: { lamellaThickness: 2, curvedMethod: "mould" } }),
    );
    const kr = q.beam!.lamination.kr;
    if (kr < 1) {
      const ref = run(
        preset("quarter-left", { section: { lamellaThickness: 1, curvedMethod: "mould" } }),
      ).out;
      const d = q.out.precheck!.beams[0]!.result.design;
      const d0 = ref.precheck!.beams[0]!.result.design;
      expect(d).toBeCloseTo(d0 * kr, 9);
      expect(frList(q.out.notes).some((n) => /multipliée par k_r/.test(n))).toBe(true);
    }
  });

  it("prédimensionnement des couches empilées : réduction de Hankinson (A35 (j), C §1.11 [81])", () => {
    for (const id of ["quarter-left", "helical"] as const) {
      const { out, beam } = run(preset(id));
      expect(beam!.lamination.method, id).toBe("stacked");
      expect(out.precheck?.beams, id).toHaveLength(1);
      const statuses = byRule(out.checks, "PRECHECK_CONTRAINTE").map((c) => c.status);
      expect(statuses.length, id).toBeGreaterThan(0);
      expect(statuses, id).not.toContain("non-evaluee");
      // θ = acos(cos α · cos β), facteurs des défauts (flexion Q/P 0,10, n 1,5, ajustement des
      // essais de [81] ; module Q/P 0,04, n 2).
      const theta = grainAngle(Math.max(0, beam!.slope), beam!.stacked!.maxGrainDeviation ?? 0);
      expect(theta).toBeGreaterThan(0);
      const kf = hankinsonFactor(0.1, 1.5, theta);
      const kE = hankinsonFactor(0.04, 2, theta);
      // Sans réduction (Q/P = 1 ⇒ facteur 1) : même poutre, résistance et module entiers.
      const ref = run(preset(id, { grainAngle: { strengthRatio: 1, modulusRatio: 1 } })).out
        .precheck!.beams[0]!.result;
      const r = out.precheck!.beams[0]!.result;
      expect(r.design).toBeCloseTo(ref.design * kf, 9);
      expect(r.design).toBeCloseTo(((0.8 * 40) / 1.3) * kf, 9);
      // Flèche inversement proportionnelle au module.
      expect(r.deflection * kE).toBeCloseTo(ref.deflection, 6);
      const note = frList(out.notes).find((n) => /^Couches empilées : fil horizontal/.test(n));
      expect(note, id).toBeDefined();
      expect(note).toMatch(/Hankinson/);
      expect(note).toMatch(/\[81\]/);
      expect(note).toMatch(/à valider/);
      expect(frList(out.notes).some((n) => /non évalué/.test(n))).toBe(false);
    }
  });

  it("prédimensionnement des couches empilées : paramètres dégénérés → non évalué, sans exception", () => {
    // Exposant nul refusé par le schéma ; un paramètre non fini ne peut être saisi : la branche
    // « non évalué » est protégée par `Number.isFinite`, vérifiée ici sur la fonction pure.
    expect(hankinsonFactor(0.04, Number.NaN, 0.5)).toBeNaN();
    expect(() => woodCentralParams({ grainAngle: { strengthExponent: 0 } })).toThrow();
  });

  it("visserie : boulons traversants M10 de longueur déduite, sabots, aucune vis de marche", () => {
    const { m } = run(preset("straight"));
    const fasteners = m.fasteners ?? [];
    const tread = fasteners.filter((f) => f.joint === "treadBeamBolted");
    expect(tread.length).toBeGreaterThan(0);
    for (const f of tread) {
      expect(f.diameter).toBe(10);
      expect(f.deduced).toContain("length");
      expect(f.deduced).toContain("diameter");
    }
    for (const j of ["shoeBolted", "plateFloor", "plateTrimmer"] as const) {
      expect(
        fasteners.some((f) => f.joint === j),
        j,
      ).toBe(true);
    }
    expect(fasteners.some((f) => f.joint === "treadScrewed")).toBe(false);
    const declared = m.parts
      .flatMap((p) => p.fixings ?? [])
      .filter((f) => f.joint === "treadBeamBolted")
      .reduce((a, f) => a + f.points, 0);
    expect(tread.reduce((a, f) => a + f.quantity, 0)).toBe(declared);
    // Marches basses : tire-fonds Ø10 (diamètre lu sur le perçage de la marche), longueur
    // déduite, origine traduite (QUESTIONS A34 (a)).
    const lags = fasteners.filter((f) => f.joint === "treadBeamLagScrewed");
    expect(lags.length).toBeGreaterThan(0);
    for (const f of lags) {
      expect(f.kind).toBe("lag-screw");
      expect(f.diameter).toBe(10);
      expect(f.deduced).toContain("length");
    }
    const declaredLags = m.parts
      .flatMap((p) => p.fixings ?? [])
      .filter((f) => f.joint === "treadBeamLagScrewed")
      .reduce((a, f) => a + f.points, 0);
    expect(lags.reduce((a, f) => a + f.quantity, 0)).toBe(declaredLags);
    // Toutes les marches fixées : autour du perçage d'un boulon de sabot, un tire-fond ne garde
    // que le jeu géométrique (relecture A35, QUESTIONS A36 (10)).
    expect(violations(m, "FAB_LIMON_CENTRAL_BOIS_BOULONS")).toEqual([]);
  });

  it("classe d'exécution des ancrages : sabots sans soudure EXC1, platines selon leur soudure", () => {
    const shoe = run(preset("straight")).out;
    expect(shoe.executionClass).toBe("EXC1");
    for (const p of [
      preset("helical"),
      preset("straight", { anchors: { kind: "embeddedPlate" } }),
    ]) {
      const { out, beam } = run(p);
      expect(beam!.anchorKind).toBe("embeddedPlate");
      const steel = out.parts.some((q) => q.material.startsWith("steel"));
      if (!steel) {
        expect(out.executionClass).toBeUndefined();
        continue;
      }
      const grade = woodCentralParams({}).anchors.grade;
      expect(out.executionClass).toBe(
        deduceExecutionClass({ grade, buttWeld: 0, welded: beam!.anchorsWelded }).executionClass,
      );
    }
  });

  it("textes anglais : messages du plugin traduits", () => {
    const FRENCH = /[àâçéèêëîïôûùœ«»]|\b(limon|marches?|entaille|lamelles?|sabot|poutre)\b/i;
    for (const p of [preset("straight"), preset("quarter-left"), preset("helical")]) {
      const { out } = run(p);
      const list: Message[] = [...out.notes, ...(out.errors ?? [])];
      for (const c of out.checks) list.push(c.message);
      for (const msg of list) {
        const t = EN.t(msg);
        expect(t, t).not.toMatch(/structure\.woodCentral\./);
        expect(t, t).not.toMatch(FRENCH);
      }
    }
  });
});

// ------------------------------------------------------------------ propriétés

const paramsArb = fc.record({
  material: fc.constantFrom("wood-oak", "wood-pine", "wood-glulam"),
  section: fc.record({
    width: fc.integer({ min: 60, max: 140 }),
    lamellaThickness: fc.oneof(fc.constant("auto"), fc.integer({ min: 1, max: 20 })),
    curvedMethod: fc.constantFrom("auto", "mould", "stacked"),
  }),
  notch: fc.record({ rearDepth: fc.oneof(fc.constant("auto"), fc.integer({ min: 0, max: 25 })) }),
  bolts: fc.record({ perTread: fc.integer({ min: 0, max: 3 }) }),
  anchors: fc.record({
    foot: fc.boolean(),
    head: fc.boolean(),
    kind: fc.constantFrom("auto", "shoe", "embeddedPlate"),
  }),
  trace: fc.record({
    lateralOffset: fc.oneof(fc.constant(0), fc.integer({ min: -60, max: 60 })),
  }),
});

const treadsArb = fc.record({
  risers: fc.constantFrom("none", "full", "open"),
  thickness: fc.integer({ min: 30, max: 80 }),
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
    .constantFrom<PresetId>("helical", "quarter-landing", "two-quarters-s", "quarter-left")
    .map((id) => createProject(id)),
);

describe("propriétés (générateurs contraints)", () => {
  it("buildModel ne lève jamais (wood-central, paramètres et tracés tirés)", () => {
    fc.assert(
      fc.property(projectArb, paramsArb, treadsArb, (p, params, treads) => {
        expect(() => buildModel(withWoodCentral(p, params, treads), { memo: false })).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it("modèle sans erreur : une assise sous chaque marche, boulons, aucune pièce hors emprise", () => {
    let complete = 0;
    fc.assert(
      fc.property(projectArb, paramsArb, treadsArb, (base, params, treads) => {
        const project = withWoodCentral(base, params, treads);
        const { m, out, beam } = run(project);
        if (m.stepping.treads.length > 0 && m.layout.walkline.segments.length > 0) {
          expect(byRule(out.checks, CANTILEVER)).toHaveLength(1);
        }
        for (const p of m.parts) {
          for (const [k, v] of Object.entries(p.quantities)) {
            expect(Number.isFinite(v) && v >= 0, `${p.id}.${k} = ${v}`).toBe(true);
          }
        }
        if (m.errors.length > 0 || !beam || beam.beamPartId === undefined) return;
        complete++;
        const seated = new Set(beam.seats.map((s) => s.tread));
        // Assises signalées sans boulon (FAB_LIMON_CENTRAL_BOIS_BOULONS) ; -1 : toute la poutre.
        const unbolted = new Set(
          violations(m, "FAB_LIMON_CENTRAL_BOIS_BOULONS").map((v) =>
            v.location.kind === "tread"
              ? v.location.number
              : v.location.kind === "part"
                ? (v.location.treadNumber ?? -1)
                : -1,
          ),
        );
        for (const t of m.stepping.treads) {
          expect(seated.has(t.number), `M${t.number}`).toBe(true);
        }
        if (params.bolts.perTread > 0) {
          for (const s of beam.seats) {
            if (unbolted.has(s.tread) || unbolted.has(-1)) continue;
            expect(s.bolts.length, `M${s.tread}`).toBeGreaterThan(0);
          }
        }
        // Aucune pièce hors emprise : poutre à 1 mm près, sabots à quelques mm près, au débord
        // du nez d'arrivée près (l'emprise s'arrête au nez d'arrivée, le chevêtre contre lequel
        // la tête est coupée d'aplomb est en retrait du débord et, avec des contremarches
        // pleines, de l'épaisseur de la contremarche d'arrivée).
        const footprint = m.layout.footprint;
        const spec = project.stair.treads;
        const overhang = spec.nosing + (spec.risers === "full" ? spec.riserThickness : 0);
        // Platines : emprise contrôlée par leurs propres tests ; couches : part de la poutre.
        for (const p of m.parts.filter(
          (q) => q.id.startsWith("wood-central-") && !q.id.startsWith("wood-central-plate"),
        )) {
          const tol =
            (p.id === "wood-central-beam" || p.componentOf !== undefined ? 1 : 10) + overhang;
          for (const q of planPoints(p.solid)) {
            expect(outsideBy(q, footprint), p.id).toBeLessThan(tol);
          }
        }
        // Visserie : boulons traversants et tire-fonds = points déclarés.
        for (const joint of ["treadBeamBolted", "treadBeamLagScrewed"] as const) {
          const declared = m.parts
            .flatMap((p) => p.fixings ?? [])
            .filter((f) => f.joint === joint)
            .reduce((a, f) => a + f.points, 0);
          const counted = (m.fasteners ?? [])
            .filter((f) => f.joint === joint)
            .reduce((a, f) => a + f.quantity, 0);
          expect(counted, joint).toBe(declared);
        }
        // Sabot en U seulement s'il est choisi ou sur une poutre droite (A34 (c)).
        const shoes = m.parts.filter((q) => q.id.startsWith("wood-central-shoe"));
        if (beam.anchorKind === "embeddedPlate") {
          expect(shoes).toEqual([]);
          expect(m.compliance.results.some((r) => r.ruleId === "FAB_SABOT_EMPRISE")).toBe(false);
        }
      }),
      { numRuns: 30 },
    );
    expect(complete).toBeGreaterThanOrEqual(10);
  });

  it("refus ⇔ r_in / t < min de LAMELLE_CINTRE_KR (lamelles cintrées)", () => {
    const curvedArb = fc.oneof(
      stairArb().map((s) => s.project),
      fc
        .constantFrom<PresetId>("helical", "quarter-left", "two-quarters-s")
        .map((id) => createProject(id)),
    );
    let refusedCount = 0;
    let acceptedCount = 0;
    fc.assert(
      fc.property(curvedArb, fc.integer({ min: 1, max: 12 }), (base, t) => {
        const project = withWoodCentral(base, {
          section: { lamellaThickness: t, curvedMethod: "mould" },
        });
        const { out, beam } = run(project);
        if (!beam || !beam.lamination.curved || !Number.isFinite(beam.lamination.ratio)) return;
        const refused = (out.errors ?? []).some(
          (e) =>
            String(e.key) === "structure.woodCentral.error.bendRadius" ||
            String(e.key) === "structure.woodCentral.error.bendRadiusMinPly",
        );
        expect(refused).toBe(beam.lamination.ratio < KR_MIN);
        const kr = byRule(out.checks, KR);
        expect(kr).toHaveLength(1);
        expect(kr[0]!.status).toBe(refused ? "violation" : "ok");
        if (refused) {
          refusedCount++;
          expect(out.parts.some((p) => p.id.startsWith("wood-central-"))).toBe(false);
        } else acceptedCount++;
      }),
      { numRuns: 30 },
    );
    expect(refusedCount).toBeGreaterThan(0);
    expect(acceptedCount).toBeGreaterThan(0);
  });
});
