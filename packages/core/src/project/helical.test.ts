/**
 * Tracé hélicoïdal (jalon 5a) côté projet : union discriminée rétrocompatible, champs dérivés,
 * sérialisation, préréglage `helical`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { msg, translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { helicalHeadroomBound } from "../headroom/helical.js";
import { isSimplePolygon } from "../structures/geom.js";
import { computeLayout } from "../layout/layout.js";
import {
  HELICAL_TREADS_PER_TURN_MIN,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { getRule } from "../rules/table.js";
import { computeStepping } from "../stepping/stepping.js";
import { ProjectParseError } from "./errors.js";
import { parseProject, parseProjectText } from "./parse.js";
import {
  ALL_PRESET_IDS,
  createProject,
  PRESET_HEADROOM_MIN,
  PRESET_IDS,
  PRESET_LABELS,
  PRESET_OPENING_CLEARANCE,
} from "./presets.js";
import { serializeProject } from "./serialize.js";
import {
  HelicalSweepError,
  createHelicalProject,
  createHelicalProjectWithFallback,
} from "./presetHelical.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

function minimalHelical(): Record<string, unknown> {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 } },
      layout: {
        kind: "helical",
        direction: "left",
        outerRadius: 900,
        core: { kind: "column", radius: 70 },
        sweep: { mode: "treadsPerTurn", count: 12 },
      },
    },
  };
}

describe("LayoutSpec : union discriminée rétrocompatible", () => {
  it("les exemples existants (sans `kind`) restent des escaliers à volées, sérialisés à l'identique", () => {
    const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json"));
    for (const file of files) {
      const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
      const p = parseProjectText(text);
      expect(serializeProject(p)).toBe(text);
      if (p.stair.layout.kind === "helical") continue;
      expect(text).not.toContain('"kind": "flights"');
      expect(p.stair.layout.kind).toBeUndefined();
      expect(p.stair.layout.legs.length).toBeGreaterThan(0);
    }
  });

  it('`kind: "flights"` explicite est accepté', () => {
    const p = createProject("straight");
    const q = ProjectSchema.parse({
      ...p,
      stair: { ...p.stair, layout: { ...p.stair.layout, kind: "flights" } },
    });
    expect(computeLayout(q).walkline).toEqual(computeLayout(p).walkline);
  });

  it("hélicoïdal : champs dérivés (E, volées, tournants) recalculés, non sérialisés", () => {
    const p = parseProject(minimalHelical());
    const layout = p.stair.layout;
    if (layout.kind !== "helical") throw new Error("hélicoïdal attendu");
    expect(layout.width).toBe(830);
    expect(layout.legs).toEqual([]);
    expect(layout.turns).toEqual([]);
    expect(layout.startAngle).toBe(0);
    const text = serializeProject(p);
    const json = JSON.parse(text) as { stair: { layout: Record<string, unknown> } };
    expect(Object.keys(json.stair.layout).sort()).toEqual(
      ["core", "direction", "kind", "outerRadius", "startAngle", "sweep"].sort(),
    );
    expect(serializeProject(parseProjectText(text))).toBe(text);
    // Un projet lu peut être relu tel quel (champs dérivés ignorés).
    expect(ProjectSchema.parse(p)).toEqual(p);
    const edited = ProjectSchema.parse({
      ...p,
      stair: { ...p.stair, layout: { ...layout, width: 1 } },
    });
    expect(edited.stair.layout.width).toBe(830);
  });

  it("propriété : sérialisation stable pour tout hélicoïdal valide", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 40, max: 300 }),
        fc.integer({ min: 400, max: 1200 }),
        fc.constantFrom("left" as const, "right" as const),
        fc.integer({ min: 3, max: 60 }),
        fc.option(fc.integer({ min: 1, max: 359 }), { nil: undefined }),
        (r, w, direction, count, landing) => {
          const json = minimalHelical() as { stair: { layout: Record<string, unknown> } };
          json.stair.layout = {
            ...json.stair.layout,
            direction,
            outerRadius: r + w,
            core: { kind: "well", radius: r },
            sweep: { mode: "treadsPerTurn", count },
            ...(landing ? { landing: { angle: landing } } : {}),
          };
          const p = parseProject(json);
          expect(p.stair.layout.width).toBe(w);
          const text = serializeProject(p);
          expect(serializeProject(parseProjectText(text))).toBe(text);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("erreurs lisibles : rayon extérieur ≤ fût, discriminant inconnu", () => {
    const bad = minimalHelical() as { stair: { layout: Record<string, unknown> } };
    bad.stair.layout["outerRadius"] = 60;
    const err = (() => {
      try {
        parseProject(bad);
      } catch (e) {
        return e as ProjectParseError;
      }
      throw new Error("erreur attendue");
    })();
    expect(err.issues.some((i) => i.path.startsWith("stair.layout.outerRadius"))).toBe(true);
    const unknown = minimalHelical() as { stair: { layout: Record<string, unknown> } };
    unknown.stair.layout["kind"] = "spiral";
    expect(() => parseProject(unknown)).toThrow(/"flights", "helical"/);
  });
});

describe("préréglage `helical`", () => {
  it("n'est pas dans PRESET_IDS (volées) mais dans ALL_PRESET_IDS, avec un libellé", () => {
    expect(PRESET_IDS).not.toContain("helical");
    expect(ALL_PRESET_IDS).toContain("helical");
    expect(fr(msg(PRESET_LABELS.helical))).toMatch(/Hélicoïdal/);
  });

  it("défauts : échappée, Blondel, giron logement, palier, trémie qui dégage l'escalier", () => {
    const p = createProject("helical");
    const layout = computeLayout(p);
    const st = computeStepping(p, layout);
    const h = layout.helical!;
    expect(p.stair.layout.kind).toBe("helical");
    expect(p.compliance.contexts).toContain("helicoidal");
    const blondel = getRule("BLONDEL_DTU");
    expect(st.blondel).toBeGreaterThanOrEqual(blondel.min!);
    expect(st.blondel).toBeLessThanOrEqual(blondel.max!);
    expect(st.going).toBeGreaterThanOrEqual(getRule("G_MIN_LOGEMENT").min!);
    expect(h.landingAngle).toBeGreaterThan(0);
    const m = buildModel(p);
    expect(m.errors).toEqual([]);
    expect(m.headroom!.min).toBeGreaterThanOrEqual(PRESET_HEADROOM_MIN);
    const blocking = m.compliance.results.filter(
      (r) => r.status === "violation" && r.severity === "bloquant",
    );
    expect(blocking.map((r) => r.ruleId)).toEqual([]);
    // Sortie vers la dalle : corde de l'arc extérieur du palier au moins égale à l'emmarchement.
    const E = h.outerRadius - h.innerRadius;
    const chord = (angle: number): number => 2 * h.outerRadius * Math.sin(angle / 2);
    expect(chord(h.landingAngle)).toBeGreaterThanOrEqual(E);
    // N minimal : avec une marche de moins par tour, une règle échoue ou la sortie est trop
    // étroite (plus grand palier admissible pour l'échappée).
    const stepFewer = (2 * Math.PI) / (h.treadsPerTurn - 1);
    const boundFor = (landingAngle?: number) =>
      helicalHeadroomBound({
        riserCount: st.riserCount,
        rise: st.rise,
        stepAngle: stepFewer,
        walklineRadius: h.walklineRadius,
        treadThickness: p.stair.treads.thickness,
        nosing: p.stair.treads.nosing,
        ...(landingAngle !== undefined ? { landingAngle } : {}),
      });
    const fewer = boundFor();
    let landingFewer = 0;
    for (let a = 90; a >= 5; a -= 5) {
      const b = boundFor((a * Math.PI) / 180);
      if (b.landing === null || b.landing >= PRESET_HEADROOM_MIN) {
        landingFewer = (a * Math.PI) / 180;
        break;
      }
    }
    const going = h.walklineRadius * stepFewer;
    expect(
      (fewer.treads !== null && fewer.treads < PRESET_HEADROOM_MIN) ||
        2 * st.rise + going > blondel.max! ||
        going < getRule("G_MIN_LOGEMENT").min! ||
        chord(landingFewer) < E,
    ).toBe(true);
  });

  it.each(["left", "right"] as const)(
    "sortie vers la dalle (%s) : la trémie suit l'arc du palier, jeu autour des marches seulement",
    (direction) => {
      const p = createProject("helical", { direction });
      const layout = computeLayout(p);
      const h = layout.helical!;
      const opening = p.site.opening!;
      if (opening.kind !== "polygon") throw new Error("trémie polygonale attendue");
      const pts = opening.points;
      expect(signedArea(pts)).toBeGreaterThan(0);
      expect(isSimplePolygon(pts)).toBe(true);
      // L'arc extérieur du palier (sommets à R_e) appartient au bord de la trémie.
      const outerArc = h.landingOutline!.filter(
        (q) => Math.abs(V.distance(q, h.center) - h.outerRadius) < 1e-6,
      );
      expect(outerArc.length).toBeGreaterThan(2);
      for (const q of outerArc) {
        expect(pts.some((o) => V.distance(o, q) < 0.01)).toBe(true);
      }
      // Les autres sommets sont à R_e + jeu (inscrits : sur le cercle).
      const radii = pts.map((o) => V.distance(o, h.center));
      for (const r of radii) {
        const onLanding = Math.abs(r - h.outerRadius) < 0.01;
        const onClearance = Math.abs(r - (h.outerRadius + PRESET_OPENING_CLEARANCE)) < 0.01;
        expect(onLanding || onClearance).toBe(true);
      }
      // Le palier est dans la trémie (bord commun) ; le milieu de chaque marche aussi.
      for (const q of h.landingOutline!) {
        expect(pointInPolygon(q, pts, 0.01)).not.toBe("outside");
      }
      const m = buildModel(p);
      expect(m.errors).toEqual([]);
      expect(m.headroom!.min).toBeGreaterThanOrEqual(PRESET_HEADROOM_MIN);
      // Contremarches pleines : pas de conseil VIDE_ENTRE_MARCHES.
      expect(p.stair.treads.risers).toBe("full");
      expect(
        m.compliance.results.filter(
          (r) => r.ruleId === "VIDE_ENTRE_MARCHES" && r.status === "violation",
        ),
      ).toEqual([]);
    },
  );

  it("options : sens, trémie carrée, rayons ; erreurs explicites", () => {
    const r = createProject("helical", { direction: "right", openingShape: "square" });
    const layout = r.stair.layout;
    if (layout.kind !== "helical") throw new Error("hélicoïdal attendu");
    expect(layout.direction).toBe("right");
    expect(r.site.opening).toEqual({ kind: "rect", x: -1050, y: -1050, sizeX: 2100, sizeY: 2100 });
    expect(() => createProject("helical", { width: 800 })).toThrow(RangeError);
    expect(() => createProject("straight", { outerRadius: 900 })).toThrow(RangeError);
    expect(() => createProject("helical", { coreRadius: 900, outerRadius: 900 })).toThrow(
      RangeError,
    );
    const fixed = createProject("helical", {
      patch: { stair: { layout: { sweep: { mode: "treadsPerTurn", count: 16 } } } },
    });
    expect(fixed.stair.layout.kind === "helical" && fixed.stair.layout.sweep).toEqual({
      mode: "treadsPerTurn",
      count: 16,
    });
  });
});

describe("préréglage `helical` : structure et repli (dette D4)", () => {
  it("le cœur pose `helical-core` ; une structure imposée par `patch` est conservée", () => {
    const p = createProject("helical");
    expect(p.stair.structure.kind).toBe("helical-core");
    const ids = buildModel(p).parts.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["helical-column", "helical-handrail"]));
    const none = createProject("helical", {
      patch: { stair: { structure: { kind: "none", params: {} } } },
    });
    expect(none.stair.structure.kind).toBe("none");
  });

  it("aucun N ne passe : HelicalSweepError ; repli du cœur parmi les N essayés, annoncé", () => {
    const opts = {
      floorToFloor: 2750,
      patch: { stair: { stepping: { riserCount: 17 } } },
    } as const;
    expect(() => createHelicalProject(opts)).toThrow(HelicalSweepError);
    const r = createHelicalProjectWithFallback(opts);
    expect(fr(r.note)).toMatch(/Repli : \d+ marches par tour/);
    expect(translatorFor("en").t(r.note!)).toMatch(
      /^Spiral stair: no number of treads per turn .* Fallback: \d+ treads per turn /,
    );
    const sweep = r.project.stair.layout.kind === "helical" ? r.project.stair.layout.sweep : null;
    expect(sweep?.mode).toBe("treadsPerTurn");
    const count = sweep?.mode === "treadsPerTurn" ? sweep.count : 0;
    expect(count).toBeGreaterThanOrEqual(HELICAL_TREADS_PER_TURN_MIN);
    expect(r.project.stair.structure.kind).toBe("helical-core");
    // Modèle calculable (le contrôle de conception signale ce qui ne passe pas).
    expect(buildModel(r.project).errors).toEqual([]);
    // Sans difficulté : même projet que le préréglage, sans note.
    const ok = createHelicalProjectWithFallback({ floorToFloor: 2700 });
    expect(ok.note).toBeUndefined();
    expect(ok.project).toEqual(createProject("helical", { floorToFloor: 2700 }));
    // Autres incohérences : toujours RangeError, sans repli.
    expect(() => createHelicalProjectWithFallback({ width: 900 })).toThrow(RangeError);
  });
});
