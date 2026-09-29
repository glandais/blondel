import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { computeLayout } from "../layout/layout.js";
import type { Part } from "../model/derived.js";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { createProject, PRESET_IDS } from "../project/presets.js";
import { computeStepping } from "../stepping/stepping.js";
import { makeHelicalProject } from "../layout/helical-test-helpers.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { computeGuards } from "./compute.js";
import { GuardError } from "./errors.js";
import { jourWidth } from "./jour.js";
import { sectionHeight } from "./parts.js";
import type { GuardsAnalysis } from "./types.js";

beforeEach(() => clearModelCache());

function withGuards(
  p: Project,
  guards: ProjectInput["guards"],
  extra: Partial<ProjectInput> = {},
): Project {
  return ProjectSchema.parse({ ...p, ...extra, guards });
}

function analyze(p: Project): GuardsAnalysis {
  const layout = computeLayout(p);
  const stepping = computeStepping(p, layout);
  return computeGuards(p, layout, stepping);
}

/** Toutes les grandeurs numériques d'un solide sont finies. */
function finiteSolid(part: Part): boolean {
  const walk = (v: unknown): boolean => {
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.every(walk);
    if (v && typeof v === "object") return Object.values(v).every(walk);
    return true;
  };
  return walk(part.solid) && walk(part.stock) && walk(part.quantities);
}

/** Chemin en plan sans rebroussement : aucun virage de plus de 90° entre segments. */
function expectNoBacktrack(path: readonly { x: number; y: number }[]): void {
  for (let i = 1; i + 1 < path.length; i++) {
    const a = { x: path[i]!.x - path[i - 1]!.x, y: path[i]!.y - path[i - 1]!.y };
    const b = { x: path[i + 1]!.x - path[i]!.x, y: path[i + 1]!.y - path[i]!.y };
    const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
    expect(cos, `sommet ${i}`).toBeGreaterThan(-1e-6);
  }
}

const straight = (): Project => makeSteppingProject({ width: 900, legs: ["auto"] });

describe("computeGuards — escalier droit", () => {
  it("sans mur : garde-corps des deux côtés, hauteur à la verticale des nez", () => {
    const a = analyze(withGuards(straight(), {}));
    expect(a.sides.map((s) => s.intervals.map((i) => i.kind))).toEqual([["void"], ["void"]]);
    const rakes = a.runs.filter((r) => r.kind === "rake");
    expect(rakes.map((r) => r.side)).toEqual(["inner", "outer"]);
    for (const r of rakes) {
      expect(r.nosingHeights.length).toBeGreaterThan(0);
      for (const n of r.nosingHeights) expect(n.height).toBeCloseTo(900, 6);
      expect(r.postPartIds.length).toBeGreaterThanOrEqual(2);
    }
    // Sans trémie : aucun garde-corps de trémie.
    expect(a.runs.some((r) => r.kind === "opening")).toBe(false);
    // Mains courantes sur les garde-corps, prolongées d'un giron aux deux extrémités.
    const st = computeStepping(straight(), computeLayout(straight()));
    for (const h of a.handrails) {
      expect(h.onGuard).toBe(true);
      expect(h.extensionBottom).toBeCloseTo(st.going, 6);
      expect(h.extensionTop).toBeCloseTo(st.going, 6);
    }
  });

  it("mur le long du bord droit : côté mur, main courante murale à la demande", () => {
    const base = straight();
    const layout = computeLayout(base);
    const outerX = Math.max(...layout.footprint.map((p) => p.x));
    const maxY = Math.max(...layout.footprint.map((p) => p.y));
    const walls = [
      {
        id: "m",
        a: { x: outerX + 120, y: -100 },
        b: { x: outerX + 120, y: maxY + 100 },
        thickness: 200,
        loadBearing: true,
      },
    ];
    const p = withGuards(
      base,
      { handrail: { wallSides: "both" } },
      {
        site: { ...base.site, walls },
      },
    );
    const a = analyze(p);
    expect(a.sides[1]!.intervals).toEqual([
      expect.objectContaining({ kind: "wall", wallId: "m", wallFaceDistance: 20 }),
    ]);
    expect(a.runs.filter((r) => r.kind === "rake").map((r) => r.side)).toEqual(["inner"]);
    const wall = a.handrails.find((h) => !h.onGuard)!;
    expect(wall.side).toBe("outer");
    expect(wall.wallClearance).toBe(50);
    // Ø 42 + 50 mm de dégagement, nu du mur à 20 mm du bord : empiètement 72 mm.
    expect(wall.intrusion).toBeCloseTo(72, 6);
    for (const n of wall.nosingHeights) expect(n.height).toBeCloseTo(900, 6);
  });

  it("mur partiel : portions vide / mur / vide contiguës", () => {
    const base = straight();
    const walls = [
      {
        id: "m",
        a: { x: 1000, y: 500 },
        b: { x: 1000, y: 1500 },
        thickness: 200,
        loadBearing: false,
      },
    ];
    const a = analyze(withGuards(base, {}, { site: { ...base.site, walls } }));
    const outer = a.sides[1]!;
    expect(outer.intervals.map((i) => i.kind)).toEqual(["void", "wall", "void"]);
    expect(outer.intervals[0]!.from).toBe(0);
    for (let i = 1; i < outer.intervals.length; i++)
      expect(outer.intervals[i]!.from).toBeCloseTo(outer.intervals[i - 1]!.to, 6);
    expect(outer.intervals[outer.intervals.length - 1]!.to).toBeCloseTo(outer.length, 6);
    // Deux garde-corps côté extérieur, numérotés.
    const labels = a.runs.filter((r) => r.side === "outer").map((r) => r.label);
    expect(labels).toEqual([
      "garde-corps de volée côté extérieur n° 1",
      "garde-corps de volée côté extérieur n° 2",
    ]);
    // `auto` : la main courante du garde-corps se poursuit le long du mur (continuité).
    const outerRails = a.handrails
      .filter((h) => h.side === "outer")
      .sort((x, y) => x.from - y.from)
      .map((h) => [h.onGuard, h.from, h.to]);
    expect(outerRails.map((h) => h[0])).toEqual([true, false, true]);
    for (let i = 1; i < outerRails.length; i++)
      expect(outerRails[i]![1]).toBeCloseTo(outerRails[i - 1]![2] as number, 6);
  });

  it("mur partiel sans main courante murale : discontinuité signalée (MC_DISCONTINUITE)", () => {
    const base = straight();
    const walls = [
      {
        id: "m",
        a: { x: 1000, y: 500 },
        b: { x: 1000, y: 1500 },
        thickness: 200,
        loadBearing: false,
      },
    ];
    const p = withGuards(
      base,
      { handrail: { wallSides: "none" } },
      { site: { ...base.site, walls } },
    );
    const mc = buildModel(p).compliance.results.filter((r) => r.ruleId === "MC_DISCONTINUITE");
    expect(mc).toEqual([
      expect.objectContaining({
        status: "violation",
        location: { kind: "part", partId: "guard-outer-2-handrail" },
      }),
    ]);
    expect(mc[0]!.measured).toBeCloseTo(1000, 0);
    // Défaut `auto` : main courante murale ajoutée, plus de discontinuité.
    const ok = buildModel(withGuards(base, {}, { site: { ...base.site, walls } }));
    expect(
      ok.compliance.results.filter((r) => r.ruleId === "MC_DISCONTINUITE").map((r) => r.status),
    ).toEqual(["ok"]);
  });

  it("côté imposé : `wall` sans mur du site → main courante murale supposée au bord", () => {
    const a = analyze(withGuards(straight(), { flight: { inner: "wall", outer: "wall" } }));
    expect(a.runs).toEqual([]);
    // Aucun garde-corps : main courante murale automatique d'un côté.
    expect(a.handrails.map((h) => [h.side, h.onGuard])).toEqual([["outer", false]]);
    expect(a.notes.some((n) => /mur imposé/.test(n))).toBe(true);
  });
});

describe("computeGuards — angles concaves du jour", () => {
  it("demi-tournant : pas de rebroussement du garde-corps de jour près des angles", () => {
    // Jour de 240 mm à angles vifs : des nez tombent à moins de 30 mm (décalage) des angles ;
    // le décalage naïf station par station faisait revenir la main courante en arrière.
    const a = analyze(withGuards(createProject("half-turn"), {}));
    const inner = a.runs.find((r) => r.side === "inner")!;
    expectNoBacktrack(inner.path);
    // Pas de poteau d'angle parasite sur les rebroussements : 2 angles de 90° seulement.
    const turns = inner.path.slice(1, -1).filter((_, i) => {
      const p0 = inner.path[i]!;
      const p1 = inner.path[i + 1]!;
      const p2 = inner.path[i + 2]!;
      const c = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
      return Math.abs(c) > 1e-6;
    });
    expect(turns.length).toBe(2);
    for (const n of inner.nosingHeights) expect(n.height).toBeGreaterThanOrEqual(900 - 1e-6);
  });

  it("jour plus étroit que deux décalages : erreur explicite dans Model.errors", () => {
    const base = createProject("half-turn");
    // Décalage de 130 mm de part et d'autre d'un jour de 240 mm : les deux rampants se croisent.
    const m = buildModel(withGuards(base, { flight: { edgeOffset: 130 } }));
    expect(m.errors).toEqual([expect.stringMatching(/jour trop étroit/)]);
  });
});

describe("computeGuards — paramètres impossibles", () => {
  it("entraxe inférieur à la section : erreur dans Model.errors, règles non évaluées", () => {
    const p = withGuards(straight(), {
      infill: { kind: "balusters", spacing: 30, section: { kind: "rect", width: 40, height: 40 } },
    });
    const m = buildModel(p);
    expect(m.errors).toEqual([expect.stringMatching(/entraxe 30 mm/)]);
    expect(m.parts.some((x) => x.id.startsWith("guard-"))).toBe(false);
    const gc = m.compliance.results.find((r) => r.ruleId === "GC_OBLIGATOIRE");
    expect(gc?.status).toBe("non-evaluee");
  });

  it("lisses trop nombreuses : erreur explicite", () => {
    const p = withGuards(straight(), { infill: { kind: "rails", count: 30 } });
    expect(buildModel(p).errors).toEqual([expect.stringMatching(/Lisses : 30 éléments/)]);
  });
});

describe("computeGuards — remplissages", () => {
  it("tôle perforée : maille contrôlée au gabarit T3 sur le panneau", () => {
    const p = withGuards(straight(), { infill: { kind: "perforated", holeDiameter: 60 } });
    const m = buildModel(p);
    const t3 = m.compliance.results.filter((r) => r.ruleId === "GC_GABARIT_T3_2024");
    expect(t3.length).toBeGreaterThan(0);
    expect(t3.every((r) => r.status === "violation")).toBe(true);
    const id = t3[0]!.location.kind === "part" ? t3[0]!.location.partId : "";
    expect(m.parts.find((x) => x.id === id)?.name).toBe("Tôle perforée");
  });

  it("verre : panneaux en surface réglée, remarque sur le produit non vérifié", () => {
    const m = buildModel(withGuards(straight(), { infill: { kind: "glass" } }));
    const panels = m.parts.filter((x) => x.material === "glass");
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((x) => x.solid.kind === "ruled")).toBe(true);
    expect(m.notes?.some((n) => /Verre \(V1\)/.test(n))).toBe(true);
  });

  it("palier d'angle : partie horizontale du rampant contrôlée comme un palier", () => {
    const p = withGuards(
      createProject("quarter-landing"),
      {},
      {
        compliance: { contexts: ["bois_dtu", "logement_interieur"], referenceDate: "2020-01-01" },
      },
    );
    const a = analyze(p);
    expect(a.runs.some((r) => r.kind === "rake" && r.horizontalLength > 1)).toBe(true);
    const m = buildModel(p);
    const palier = m.compliance.results.filter((r) => r.ruleId === "GC_HAUTEUR_PALIER_1988");
    // Rampant de 900 mm sur un palier : 1 000 mm exigés (NF P01-012:1988).
    expect(palier.some((r) => r.status === "violation" && r.measured === 900)).toBe(true);
  });
});

describe("computeGuards — propriétés (escaliers tournants générés)", () => {
  const spec = fc.record({
    spacing: fc.integer({ min: 90, max: 260 }),
    width: fc.integer({ min: 20, max: 60 }),
    maxSpacing: fc.integer({ min: 600, max: 2000 }),
    edgeOffset: fc.integer({ min: 0, max: 60 }),
    height: fc.integer({ min: 900, max: 1100 }),
  });

  it("balustres : vides ≤ max(entraxe − section, section), hauteurs aux nez exactes, solides finis", () => {
    fc.assert(
      fc.property(stairArb(), spec, ({ project }, s) => {
        const p = withGuards(project, {
          flight: { height: s.height, edgeOffset: s.edgeOffset },
          posts: { maxSpacing: s.maxSpacing },
          infill: {
            kind: "balusters",
            spacing: Math.max(s.spacing, s.width + 1),
            section: { kind: "rect", width: s.width, height: 40 },
          },
        });
        let a: GuardsAnalysis;
        try {
          a = analyze(p);
        } catch (e) {
          // Paramètres impossibles (hauteur, entraxe) : erreur explicite.
          expect(e).toBeInstanceOf(GuardError);
          return;
        }
        // Jour plus étroit que la sphère T1 ou que deux décalages : plus d'exception, la ligne
        // concernée n'est pas produite et l'erreur est lisible (reprise dans Model.errors).
        for (const err of a.errors ?? []) expect(err).toMatch(/jour/);
        const st = computeStepping(p, computeLayout(p));
        const maxRise = Math.max(
          ...st.nosings.map((n, k) => n.z - (k > 0 ? st.nosings[k - 1]!.z : 0)),
        );
        const target = Math.max(s.spacing, s.width + 1) - s.width;
        for (const side of a.sides) {
          expect(side.intervals[0]?.from ?? 0).toBe(0);
          for (let i = 1; i < side.intervals.length; i++)
            expect(side.intervals[i]!.from).toBeCloseTo(side.intervals[i - 1]!.to, 6);
        }
        for (const r of a.runs) {
          for (const g of r.gaps.filter((x) => x.kind === "vertical")) {
            expect(g.value).toBeGreaterThanOrEqual(-1e-9);
            // Entraxe respecté, sauf travée trop courte pour un balustre de plus.
            expect(g.value).toBeLessThanOrEqual(Math.max(target, s.width) + 1e-6);
          }
          // Hauteur mesurée sur le chemin construit : jamais sous H ; au plus une hauteur de
          // marche de plus près d'un angle concave (stations fusionnées sur l'onglet), ou le
          // dénivelé jusqu'au plus haut des nez qui aboutissent dans le retrait de l'onglet (jour
          // vif balancé : plusieurs nez convergent à quelques millimètres du coin).
          const end = (k: number) => (r.side === "outer" ? st.nosings[k]!.r : st.nosings[k]!.q);
          const reach = 3 * s.edgeOffset + 1;
          for (const n of r.nosingHeights) {
            const zk = st.nosings[n.index]!.z;
            const converging = Math.max(
              0,
              ...st.nosings
                .filter((x) => V.distance(end(x.index), end(n.index)) <= reach)
                .map((x) => x.z - zk),
            );
            expect(n.height).toBeGreaterThanOrEqual(s.height - 1e-6);
            expect(n.height).toBeLessThanOrEqual(s.height + converging + maxRise + 1e-6);
          }
          if (r.kind === "rake") expectNoBacktrack(r.path);
        }
        expect(a.parts.every(finiteSolid)).toBe(true);
        expect(new Set(a.parts.map((x) => x.id)).size).toBe(a.parts.length);
      }),
      { numRuns: 60 },
    );
  });

  it("lisses : vides égaux, empilement = hauteur sous main courante", () => {
    fc.assert(
      fc.property(
        stairArb(),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 80 }),
        ({ project }, count, bottomGap) => {
          const p = withGuards(project, { infill: { kind: "rails", count, bottomGap } });
          let a: GuardsAnalysis;
          try {
            a = analyze(p);
          } catch (e) {
            // Jour de demi-tournant plus étroit que deux décalages (générateur : dès 50 mm).
            expect(String(e)).toMatch(/jour trop étroit/);
            return;
          }
          const H = p.guards!.flight.height;
          const hh = sectionHeight(p.guards!.handrail.section);
          const rh = 30;
          for (const r of a.runs) {
            const between = r.gaps.filter((g) => g.kind === "horizontal");
            // Travée plus courte que les poteaux (entre deux poteaux d'angle proches) : vide.
            if (between.length === 0) continue;
            const bay = between.slice(0, count);
            const vertical = bay.map((g) => g.zTop - g.zBottom);
            for (const v of vertical) expect(v).toBeCloseTo(vertical[0]!, 6);
            expect(bottomGap + count * rh + count * vertical[0]!).toBeCloseTo(H - hh, 6);
            // Vide perpendiculaire ≤ vide vertical (pente).
            for (const g of between) expect(g.value).toBeLessThanOrEqual(g.zTop - g.zBottom + 1e-9);
            expect(r.footholds.length % count).toBe(0);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("computeGuards — conflit avec le plancher haut", () => {
  it("bords d'escalier au nu de la trémie : rampants décalés sous la dalle signalés", () => {
    // Préréglage droit sans jeu latéral : trémie de la largeur de l'escalier (x ∈ [0 ; 900]) ;
    // garde-corps à 30 mm vers le vide, donc sous la dalle ; la main courante traverse la dalle.
    const flush = createProject("straight", { openingClearance: 0 });
    const m = buildModel(withGuards(flush, {}));
    const clashes = m.compliance.results.filter((r) => r.ruleId === "GC_CONFLIT_DALLE");
    expect(clashes.map((r) => r.location)).toEqual([
      { kind: "part", partId: "guard-inner-1-handrail" },
      { kind: "part", partId: "guard-outer-1-handrail" },
    ]);
    for (const c of clashes) {
      expect(c.status).toBe("violation");
      expect(c.severity).toBe("avertissement");
      expect(c.measured).toBeGreaterThan(500);
    }
  });

  it("décalage nul (garde-corps au nu de la trémie) : aucun conflit", () => {
    const m = buildModel(
      withGuards(createProject("straight", { openingClearance: 0 }), {
        flight: { edgeOffset: 0 },
        handrail: { section: { kind: "round", diameter: 42 } },
      }),
    );
    // Axe au nu : la demi-section déborde encore sous la dalle.
    expect(m.compliance.results.some((r) => r.ruleId === "GC_CONFLIT_DALLE")).toBe(true);
    const wide = createProject("straight", { openingClearance: 0 });
    const opening = wide.site.opening!;
    if (opening.kind !== "rect") throw new Error("trémie rectangulaire attendue");
    const m2 = buildModel(
      withGuards(
        wide,
        {},
        {
          site: {
            ...wide.site,
            opening: { ...opening, x: opening.x - 100, sizeX: opening.sizeX + 200 },
          },
        },
      ),
    );
    expect(m2.compliance.results.some((r) => r.ruleId === "GC_CONFLIT_DALLE")).toBe(false);
  });

  it.each(PRESET_IDS)(
    "préréglage « %s » (jeu latéral par défaut) avec garde-corps : aucun conflit",
    (preset) => {
      for (const floorToFloor of [2500, 2700, 2900]) {
        const m = buildModel(withGuards(createProject(preset, { floorToFloor }), {}));
        expect(m.errors).toEqual([]);
        const clash = m.compliance.results.filter((r) => r.ruleId === "GC_CONFLIT_DALLE");
        expect(clash, `${preset} H=${floorToFloor}`).toEqual([]);
      }
    },
  );
});

describe("computeGuards — jour plus étroit que la sphère T1", () => {
  /** Demi-tournant dont la volée centrale mesure 2E + `well` (jour de `well` mm). */
  function halfTurn(well: number) {
    const p = createProject("half-turn");
    const legs = p.stair.layout.legs.map((l, i) =>
      i === 1 ? { length: 2 * p.stair.layout.width + well } : l,
    );
    return withGuards(p, {}, { stair: { ...p.stair, layout: { ...p.stair.layout, legs } } });
  }

  it("jour de 20 à 109 mm : erreur de modèle lisible, pas d'exception, autres lignes produites", () => {
    for (const well of [20, 60, 109]) {
      const project = halfTurn(well);
      const layout = computeLayout(project);
      expect(jourWidth(layout, project.stair.layout.turns)).toBeCloseTo(well, 6);
      const g = computeGuards(project, layout, computeStepping(project, layout));
      expect(g.errors).toHaveLength(1);
      expect(g.errors![0]).toContain(`jour de ${well} mm`);
      expect(g.runs.some((r) => r.side === "inner")).toBe(false);
      expect(g.runs.some((r) => r.side === "outer")).toBe(true);
      const m = buildModel(project);
      expect(m.errors).toEqual(g.errors);
      expect(m.parts.some((p) => p.id.startsWith("guard-outer"))).toBe(true);
    }
  });

  it("jour de 110 mm et plus : garde-corps de jour produit", () => {
    const project = halfTurn(150);
    const layout = computeLayout(project);
    const g = computeGuards(project, layout, computeStepping(project, layout));
    expect(g.errors ?? []).toEqual([]);
    expect(g.runs.some((r) => r.side === "inner")).toBe(true);
  });

  it("largeur du jour : poteaux d'angle déduits, quart tournant sans jour", () => {
    const q = createProject("quarter-left");
    expect(jourWidth(computeLayout(q), q.stair.layout.turns)).toBe(Infinity);
    const h = createProject("half-turn");
    const turns = h.stair.layout.turns.map((t) => ({
      ...t,
      inner: { kind: "newel" as const, size: 100 },
    }));
    const hn = { ...h, stair: { ...h.stair, layout: { ...h.stair.layout, turns } } };
    expect(jourWidth(computeLayout(hn), turns)).toBeCloseTo(240 - 100, 6);
  });
});

describe("hélicoïdal : côté intérieur", () => {
  const helicalWith = (core: "column" | "well", radius: number): Project =>
    withGuards(
      makeHelicalProject({
        outerRadius: 1000,
        coreRadius: radius,
        core,
        direction: "left",
        floorToFloor: 2700,
      }),
      {},
    );

  it("fût central : aucun garde-corps ni main courante le long du fût (pas de vide)", () => {
    const a = analyze(helicalWith("column", 70));
    const inner = a.sides.find((s) => s.side === "inner")!;
    expect(inner.intervals).toEqual([]);
    expect(inner.maxFall).toBe(0);
    expect(a.parts.some((p) => p.id.startsWith("guard-inner"))).toBe(false);
    expect(a.parts.some((p) => p.id.startsWith("handrail-wall-inner"))).toBe(false);
    expect(a.parts.some((p) => p.id.startsWith("guard-outer"))).toBe(true);
    expect(a.notes.some((n) => /fût central/.test(n))).toBe(true);
  });

  it("jour central : le côté intérieur est un vide, garde-corps de jour généré", () => {
    const a = analyze(helicalWith("well", 400));
    const inner = a.sides.find((s) => s.side === "inner")!;
    expect(inner.intervals.some((iv) => iv.kind === "void")).toBe(true);
    expect(inner.maxFall).toBeGreaterThan(0);
    expect(a.parts.some((p) => p.id.startsWith("guard-inner"))).toBe(true);
  });
});
