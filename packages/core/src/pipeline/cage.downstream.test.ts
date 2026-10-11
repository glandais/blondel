/**
 * Aval complet d'une cage saisie (ADR-0010, sous-lot 2d) : le garde-fou temporaire de l'aval
 * est levé ; échappée, garde-corps et contrôle de conception sont calculés sur toute cage
 * (angles quelconques, palier droit, trapèze, axe en arc, marches rayonnantes), avec les
 * largeurs propres aux tronçons et aux jonctions.
 */
import { createTranslator } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { distanceToCurve } from "../geom2d/intersect.js";
import { computeGuards } from "../guards/compute.js";
import type { Model, RuleResult } from "../model/derived.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "./build.js";

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

function cageProject(
  layout: CageLayoutSpecInput,
  opts: { opening?: Record<string, unknown>; floorToFloor?: number } = {},
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: {
      floorToFloor: opts.floorToFloor ?? 2700,
      upperSlabThickness: 200,
      ...(opts.opening ? { opening: opts.opening } : {}),
    },
    stair: { placement: { origin: { x: 0, y: 0 }, rotation: 0 }, layout },
    guards: {},
  });
}

/** Trémie couvrant toute l'emprise sauf une bande de `band` mm au départ (dalle au-dessus). */
function openingOver(project: Project, band: number): Record<string, unknown> {
  const m = buildModel(project, { memo: false });
  const xs = m.layout.footprint.map((p) => p.x);
  const ys = m.layout.footprint.map((p) => p.y);
  const x = Math.round(Math.min(...xs)) - 300;
  const y = Math.round(Math.min(...ys)) + band;
  return {
    kind: "rect",
    x,
    y,
    sizeX: Math.round(Math.max(...xs)) + 300 - x,
    sizeY: Math.round(Math.max(...ys)) + 300 - y,
  };
}

const SHAPES: Record<string, CageLayoutSpecInput> = {
  "60° balancé": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: 60, mode: "winders" }],
  },
  "120° balancé, congé côté mur": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: -120, mode: "winders", wall: { kind: "arc", radius: 300 } }],
  },
  "palier droit": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: 0, mode: "landing", depth: 900 }],
  },
  "trapèze et quart tournant": {
    kind: "cage",
    sections: [straight(1500, 900, 1300), straight(1500, 1300)],
    junctions: [{ angle: 90, mode: "winders" }],
  },
  "arc de 90°": {
    kind: "cage",
    sections: [{ axis: { kind: "arc", radius: 1500, sweep: 90 }, width: 900 }],
    junctions: [],
  },
  "marches rayonnantes à 75°": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: 75, mode: "radiating", well: { kind: "arc", radius: 150 } }],
  },
};

const fr = createTranslator("fr");

const result = (m: Model, id: string): RuleResult[] =>
  m.compliance.results.filter((r) => r.ruleId === id);

describe("aval complet d'une cage (garde-fou levé au 2d)", () => {
  it.each(Object.entries(SHAPES))(
    "%s : échappée, garde-corps continus, règles évaluées, aucune erreur",
    (_name, spec) => {
      const base = cageProject(spec);
      const project = cageProject(spec, { opening: openingOver(base, 600) });
      const model = buildModel(project, { memo: false });
      expect(model.errors).toEqual([]);
      // Échappée calculée (dalle au-dessus du départ).
      expect(model.headroom).toBeDefined();
      expect(model.headroomAtNosings).toHaveLength(model.stepping.nosings.length);
      expect(result(model, "ECHAPPEE_MIN_DTU")[0]!.status).not.toBe("non-evaluee");
      // Plus de modèle partiel : le découpage existe et les règles le lisent.
      expect(
        model.compliance.notes?.some((n) => n.key === "compliance.engine.partialModel"),
      ).not.toBe(true);
      for (const id of ["G_MIN_DTU", "BLONDEL_DTU", "VOLEE_MAX_DTU", "LF_POSITION_DTU_ETROIT"]) {
        expect(result(model, id).every((r) => r.status !== "non-evaluee")).toBe(true);
      }
      // Garde-corps : une ligne de volée par côté (aucun mur), main courante sur toute la
      // longueur du bord, axe à `edgeOffset` du bord (onglets bornés à 4 × edgeOffset).
      const guards = computeGuards(project, model.layout, model.stepping);
      expect(guards.errors ?? []).toEqual([]);
      const offset = guards.spec.flight.edgeOffset;
      for (const side of guards.sides) {
        expect(side.intervals).toEqual([{ from: 0, to: side.length, kind: "void" }]);
        const runs = guards.runs.filter((r) => r.kind === "rake" && r.side === side.side);
        expect(runs).toHaveLength(1);
        const curve = side.side === "inner" ? model.layout.inner : model.layout.outer;
        for (const p of runs[0]!.path) {
          const d = distanceToCurve(p, curve);
          expect(d).toBeGreaterThan(offset - 1);
          expect(d).toBeLessThan(4 * offset + 1e-6);
        }
        const hr = guards.handrails.filter((h) => h.side === side.side && h.onGuard);
        expect(hr).toHaveLength(1);
        expect(hr[0]!.from).toBeCloseTo(0, 6);
        expect(hr[0]!.to).toBeCloseTo(side.length, 6);
      }
      expect(model.parts.filter((p) => p.family === "guards").length).toBeGreaterThan(0);
    },
  );
});

describe("règles : largeurs propres aux tronçons et aux jonctions", () => {
  it("trapèze : ligne de foulée contrôlée à la jonction avec E = 1 300 mm (largeur à la jonction, F1)", () => {
    const model = buildModel(cageProject(SHAPES["trapèze et quart tournant"]!), { memo: false });
    // E de l'escalier = 900 mm (plus petite largeur), mais E = 1 300 mm à la jonction.
    expect(model.layout.walklineOffset).toBe(600);
    const narrow = result(model, "LF_POSITION_DTU_ETROIT");
    expect(narrow).toHaveLength(1);
    expect(narrow[0]!.status).toBe("ok");
    expect(narrow[0]!.message.key).toBe("compliance.walkline.wideNotApplicable");
    const wide = result(model, "LF_POSITION_DTU_LARGE");
    expect(wide).toHaveLength(1);
    expect(wide[0]!.status).toBe("ok");
    expect(wide[0]!.message.key).toBe("compliance.walkline.atJunction");
    expect(wide[0]!.message.params).toMatchObject({ junction: 1 });
    expect(wide[0]!.measured).toBe(600);
  });

  it("deux jonctions de largeurs différentes : un constat par jonction, mesure sur la ligne de chacune", () => {
    const model = buildModel(
      cageProject({
        kind: "cage",
        sections: [straight(1500, 900), straight(600, 900, 1300), straight(1500, 1300)],
        junctions: [
          { angle: 90, mode: "winders" },
          { angle: 90, mode: "winders" },
        ],
      }),
      { memo: false },
    );
    expect(model.errors).toEqual([]);
    const d = model.layout.turns.map((t) => t.walklineOffset ?? model.layout.walklineOffset);
    expect(d).toEqual([450, 600]);
    const both = result(model, "LF_POSITION_ACCESSIBILITE");
    const junctions = both.map((r) => (r.message.params as { junction?: number }).junction);
    expect(junctions).toEqual([1, 2]);
    expect(both.every((r) => r.status !== "non-evaluee")).toBe(true);
    expect(both.map((r) => r.measured)).toEqual([450, 600]);
  });

  it("ERP tournant, deux jonctions (d_f 450 et 600 mm) : girons mesurés à 600 mm du jour de chacune (F2)", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [straight(1500, 900), straight(600, 900, 1300), straight(1500, 1300)],
      junctions: [
        { angle: 60, mode: "winders" },
        { angle: 120, mode: "winders" },
      ],
    };
    const project = ProjectSchema.parse({
      ...cageProject(spec),
      compliance: { contexts: ["erp_securite", "erp_neuf"] },
    });
    const model = buildModel(project, { memo: false });
    expect(model.errors).toEqual([]);
    const r = result(model, "LF_POSITION_ERP_TOURNANT");
    const byJunction = new Map<number, RuleResult[]>();
    for (const x of r) {
      const j = (x.message.params as { junction: number }).junction;
      byJunction.set(j, [...(byJunction.get(j) ?? []), x]);
    }
    expect([...byJunction.keys()].sort()).toEqual([1, 2]);
    // Jonction 2 : d_f = 600 = distance réglementaire, ligne confondue.
    expect(byJunction.get(2)!.map((x) => x.status)).toEqual(["ok"]);
    expect(byJunction.get(2)![0]!.measured).toBe(600);
    // Jonction 1 : d_f = 450, girons balancés mesurés sur la ligne à 600 mm (jamais « non
    // évalué ») ; le constat cite la ligne de mesure.
    const j1 = byJunction.get(1)!;
    expect(j1.every((x) => x.status !== "non-evaluee")).toBe(true);
    for (const x of j1) {
      expect(fr.t(x.message)).toMatch(
        /^Jonction 1 : Ligne de conception à 450 mm, ligne de mesure à 600 mm/,
      );
    }
  });

  it("paliers droits : profondeur comparée à l'emmarchement des tronçons voisins (F9)", () => {
    const model = buildModel(
      cageProject({
        kind: "cage",
        sections: [straight(1500, 900), straight(1500, 1200), straight(1500, 1200)],
        junctions: [
          { angle: 0, mode: "landing", depth: 1000 },
          { angle: 0, mode: "landing", depth: 1000 },
        ],
      }),
      { memo: false },
    );
    expect(model.errors).toEqual([]);
    const landings = model.stepping.treads.filter((t) => t.kind === "landing");
    expect(landings).toHaveLength(2);
    // Palier 1 entre 900 et 1 200 mm : E = 900, 1 000 ≥ 900 ; palier 2 entre 1 200 et 1 200 :
    // E = 1 200, 1 000 < 1 200. Avec l'emmarchement unique de la cage (900), les deux passaient.
    const r = result(model, "PALIER_LONGUEUR_METIER");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("violation");
    expect(r[0]!.min).toBe(1200);
    expect(r[0]!.measured).toBeCloseTo(1000, 6);
    expect(r[0]!.location).toEqual({ kind: "tread", number: landings[1]!.number });
  });

  it("palier droit assez profond : conforme, borne de l'emmarchement voisin", () => {
    const model = buildModel(cageProject(SHAPES["palier droit"]!), { memo: false });
    const r = result(model, "PALIER_LONGUEUR_METIER");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("ok");
    expect(r[0]!.min).toBe(900);
  });

  it("trapèze suivi d'un palier droit : E du palier = largeur qui le borde (1 300), pas l'extrémité éloignée du trapèze", () => {
    const model = buildModel(
      cageProject({
        kind: "cage",
        sections: [straight(1500, 900, 1300), straight(1500, 1300)],
        junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
      }),
      { memo: false },
    );
    expect(model.errors).toEqual([]);
    const landing = model.stepping.treads.find((t) => t.kind === "landing")!;
    const r = result(model, "PALIER_LONGUEUR_METIER");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("violation");
    expect(r[0]!.min).toBe(1300);
    expect(r[0]!.measured).toBeCloseTo(1000, 6);
    expect(r[0]!.location).toEqual({ kind: "tread", number: landing.number });
  });

  it("paliers de bornes différentes, tous conformes : un constat, palier de plus petite marge", () => {
    const model = buildModel(
      cageProject({
        kind: "cage",
        sections: [straight(1500, 900), straight(1500, 1200), straight(1500, 1200)],
        junctions: [
          { angle: 0, mode: "landing", depth: 1300 },
          { angle: 0, mode: "landing", depth: 1300 },
        ],
      }),
      { memo: false },
    );
    expect(model.errors).toEqual([]);
    const landings = model.stepping.treads.filter((t) => t.kind === "landing");
    expect(landings).toHaveLength(2);
    // Dimension = plus petite largeur de la surface (profondeur 1 300, largeur ≤ 1 200).
    // Palier 1 : borne 900, marge ≈ 290 ; palier 2 : borne 1 200, marge 0 (le plus défavorable).
    const r = result(model, "PALIER_LONGUEUR_METIER");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("ok");
    expect(r[0]!.min).toBe(1200);
    expect(r[0]!.measured).toBeCloseTo(1200, 6);
    expect(r[0]!.location).toEqual({ kind: "stair" });
    expect(r[0]!.message.params?.["item"]).toEqual({
      key: "compliance.item.landing",
      params: { n: landings[1]!.number },
    });
  });

  it("ERP, palier droit : PALIER_LONGUEUR_ERP_NON_CONTRARIE évaluée (profondeur > 1 000 mm)", () => {
    const erp = (depth: number) =>
      buildModel(
        ProjectSchema.parse({
          ...cageProject({
            kind: "cage",
            sections: [straight(1500, 1400), straight(1500, 1400)],
            junctions: [{ angle: 0, mode: "landing", depth }],
          }),
          compliance: { contexts: ["erp_securite", "erp_neuf"] },
        }),
        { memo: false },
      );
    const short = result(erp(600), "PALIER_LONGUEUR_ERP_NON_CONTRARIE");
    expect(short).toHaveLength(1);
    expect(short[0]!.status).toBe("violation");
    expect(short[0]!.measured).toBe(600);
    expect(short[0]!.min).toBe(1000);
    const long = result(erp(1400), "PALIER_LONGUEUR_ERP_NON_CONTRARIE");
    expect(long.map((x) => x.status)).toEqual(["ok"]);
    // Strictement plus de 1 000 mm (« L_palier > 1000 »).
    expect(result(erp(1000), "PALIER_LONGUEUR_ERP_NON_CONTRARIE")[0]!.status).toBe("violation");
  });

  it("ERP : MC_UP_ERP jugée sur le tronçon le plus large (2 UP dès qu'un tronçon atteint 1 400 mm)", () => {
    const erp = (w2: number) =>
      buildModel(
        ProjectSchema.parse({
          ...cageProject({
            kind: "cage",
            sections: [straight(1500, 1500), straight(1500, w2)],
            junctions: [{ angle: 0, mode: "landing" }],
          }),
          compliance: { contexts: ["erp_securite", "erp_neuf"] },
        }),
        { memo: false },
      );
    for (const w2 of [1000, 1500]) {
      const r = result(erp(w2), "MC_UP_ERP");
      expect(r.length).toBeGreaterThan(0);
      expect(r.every((x) => x.min === 2)).toBe(true);
    }
  });

  it("palier droit avant l'arrivée : TREMIE_LONGUEUR non évaluée, message du palier droit", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [straight(1800), straight(600)],
      junctions: [{ angle: 0, mode: "landing", depth: 900 }],
    };
    const project = cageProject(spec, { opening: openingOver(cageProject(spec), 600) });
    const model = buildModel(project, { memo: false });
    const r = result(model, "TREMIE_LONGUEUR");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("non-evaluee");
    expect(r[0]!.message.key).toBe("rules.TREMIE_LONGUEUR.landing");
  });

  it("arc avant l'arrivée : TREMIE_LONGUEUR non évaluée (dérivation pour une volée droite)", () => {
    const spec = SHAPES["arc de 90°"]!;
    const project = cageProject(spec, { opening: openingOver(cageProject(spec), 600) });
    const model = buildModel(project, { memo: false });
    const r = result(model, "TREMIE_LONGUEUR");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("non-evaluee");
    expect(r[0]!.message.key).toBe("rules.TREMIE_LONGUEUR.turn");
  });

  it("marches rayonnantes : l'angle du jour est repéré pour G_COLLET_MONOTONE", () => {
    const model = buildModel(cageProject(SHAPES["marches rayonnantes à 75°"]!), { memo: false });
    const r = result(model, "G_COLLET_MONOTONE");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("ok");
    expect(r[0]!.message.params?.["corners"]).toMatchObject({ params: { count: 1 } });
  });
});
