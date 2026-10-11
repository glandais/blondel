/**
 * Recalage d'une cage saisie (tracé libre, ADR-0010, sous-lot 2e) : seule la partie droite du
 * dernier tronçon change, jonctions, largeurs et placement conservés ; même résultat que le
 * recalage du tracé à volées équivalent ; refus explicites (arc final, palier, H trop faible).
 */
import { describe, expect, it } from "vitest";
import { frList } from "../i18n.test-helpers.js";
import { curveLength } from "../geom2d/curve.js";
import { computeLayout } from "../layout/layout.js";
import { resolveRiserCount, resolveTargetGoing } from "../layout/resolve.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { toCageLayout, toFlightsLayout } from "./layoutConversion.js";
import { createProject, OPPOSITE_TURNS_PRESET_IDS, PRESET_IDS } from "./presets.js";
import { realignBlocker, realignFlightsAndOpening } from "./realign.js";

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

function cageProject(layout: CageLayoutSpecInput, floorToFloor = 2700): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor, upperSlabThickness: 200 },
    stair: { placement: { origin: { x: 250, y: -80 }, rotation: 30 }, layout },
  });
}

const withHeight = (p: Project, floorToFloor: number): Project => ({
  ...p,
  site: { ...p.site, floorToFloor },
});

/** Γ hors paliers moins (n − 1 − paliers)·g. */
function gap(p: Project): number {
  const layout = computeLayout(p);
  const landings = layout.turns.filter((t) => t.mode === "landing");
  const on = landings.reduce((a, t) => a + (t.sEnd - t.sStart), 0);
  const n = resolveRiserCount(p);
  const g = resolveTargetGoing(p, n);
  return curveLength(layout.walkline) - on - (n - 1 - landings.length) * g;
}

const cageOf = (p: Project): CageLayoutSpec => p.stair.layout as CageLayoutSpec;

describe("recalage d'une cage saisie", () => {
  it.each([...PRESET_IDS, ...OPPOSITE_TURNS_PRESET_IDS])(
    "%s converti en cage : même recalage que le tracé à volées",
    (id) => {
      for (const h of [2550, 2900, 3100]) {
        const flights = withHeight(createProject(id), h);
        const cage = toCageLayout(flights);
        if (cage === null) throw new Error("préréglage convertible attendu");
        const blocker = realignBlocker(flights);
        if (blocker !== null) {
          // Palier hors d'un nombre entier de girons : refus aussi, en vocabulaire de cage.
          expect(blocker.key).toMatch(/^project\.realign\.landingNotWhole/);
          expect(realignBlocker(cage)?.key).toBe("project.realign.cageLandingNotWhole");
          continue;
        }
        const a = realignFlightsAndOpening(flights);
        const b = realignFlightsAndOpening(cage);
        // Même tracé recalé : la cage recalée se reconvertit exactement en volées recalées.
        expect(toFlightsLayout(b.project)?.stair.layout).toEqual(a.project.stair.layout);
        expect(b.project.site.opening).toEqual(a.project.site.opening);
        expect(b.project.stair.placement).toBe(cage.stair.placement);
        if (a.project !== flights) {
          expect(frList(b.notes).join(" ")).toMatch(
            /Dernier tronçon recalé.*position des jonctions conservée/,
          );
        }
      }
    },
  );

  it("angle quelconque (palier droit hors girons refusé) : seule la dernière partie droite change", () => {
    const base = cageProject({
      kind: "cage",
      sections: [straight(1200), straight(900), straight(1500)],
      junctions: [
        { angle: 60, mode: "winders" },
        { angle: 0, mode: "landing", depth: 900 },
      ],
    });
    // Palier droit : la partie droite qui le précède doit contenir un nombre entier de girons.
    expect(realignBlocker(base)?.key).toBe("project.realign.cageLandingNotWhole");
    const p = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: -120, mode: "winders", wall: { kind: "arc", radius: 300 } }],
    });
    for (const h of [2500, 2900, 3200]) {
      const before = withHeight(p, h);
      const r = realignFlightsAndOpening(before);
      const after = cageOf(r.project);
      expect(after.sections[0]).toBe(cageOf(before).sections[0]);
      expect(after.junctions).toBe(cageOf(before).junctions);
      expect(r.project.stair.placement).toBe(before.stair.placement);
      expect(Math.abs(gap(r.project))).toBeLessThanOrEqual(1);
      expect(buildModel(r.project, { memo: false }).errors).toEqual([]);
      // Déjà calé : rien ne change.
      const again = realignFlightsAndOpening(r.project);
      expect(again.project).toBe(r.project);
      expect(again.notes.map((n) => n.key)).toEqual([
        "project.realign.noOpening",
        "project.realign.cageAlreadyAligned",
      ]);
    }
  });

  it("palier droit : recalage réussi, profondeur du palier hors girons, Γ sur la cible", () => {
    const probe = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: 0, mode: "landing", depth: 900 }],
    });
    const n = resolveRiserCount(probe);
    const g = resolveTargetGoing(probe, n);
    expect([n, g]).toEqual([15, 270]);
    // Partie droite avant le palier : nombre entier de girons cibles (5 g = 1 350 mm).
    const p = cageProject({
      kind: "cage",
      sections: [straight(Math.round(5 * g)), straight(1500)],
      junctions: [{ angle: 0, mode: "landing", depth: 900 }],
    });
    expect(realignBlocker(p)).toBeNull();
    const r = realignFlightsAndOpening(p);
    const after = cageOf(r.project);
    expect(after.sections[0]).toBe(cageOf(p).sections[0]);
    expect(after.junctions).toBe(cageOf(p).junctions);
    expect(r.project.stair.placement).toBe(p.stair.placement);
    // Cible (n − 1 − 1)·g = 13 g : 5 g avant le palier, 8 g après (le palier n'est pas un giron).
    expect((after.sections[1]!.axis as { length: number }).length).toBe(Math.round(8 * g));
    expect(Math.abs(gap(r.project))).toBeLessThanOrEqual(1);
    expect(buildModel(r.project, { memo: false }).errors).toEqual([]);
    // Le palier droit compte pour sa profondeur, pas pour un giron.
    const landing = computeLayout(r.project).turns[0]!;
    expect(landing.mode).toBe("landing");
    expect(landing.sEnd - landing.sStart).toBeCloseTo(900, 6);
  });

  it("dernier tronçon en trapèze (Γ oblique) : longueur cherchée sur le tracé (sécante)", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(1400, 900, 1300)],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    for (const h of [2600, 2950, 3300]) {
      const r = realignFlightsAndOpening(withHeight(p, h));
      expect(Math.abs(gap(r.project))).toBeLessThanOrEqual(1);
      const last = cageOf(r.project).sections[1]!;
      expect(last.width).toBe(900);
      expect(last.widthEnd).toBe(1300);
      expect(Number.isInteger((last.axis as { length: number }).length)).toBe(true);
    }
  });

  it("refus explicites par une clé du dictionnaire : arc final, H trop faible", () => {
    const arc = cageProject({
      kind: "cage",
      sections: [straight(1500), { axis: { kind: "arc", radius: 1500, sweep: 90 }, width: 900 }],
      junctions: [{ angle: 90, mode: "winders" }],
    });
    expect(() => realignFlightsAndOpening(arc)).toThrow(RangeError);
    expect(realignBlocker(arc)?.key).toBe("project.realign.cageArcLast");
    const low = cageProject(
      {
        kind: "cage",
        sections: [straight(2400), straight(2400)],
        junctions: [{ angle: 90, mode: "winders" }],
      },
      1400,
    );
    expect(realignBlocker(low)?.key).toBe("project.realign.cageHeightTooLow");
  });

  it("tronçon unique de longueur automatique : conservé, aucun refus", () => {
    const p = cageProject({
      kind: "cage",
      sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }],
      junctions: [],
    });
    const r = realignFlightsAndOpening(withHeight(p, 3000));
    expect(r.project.stair.layout).toBe(p.stair.layout);
    expect(cageOf(r.project).sections[0]!.axis).toEqual({ kind: "straight", length: "auto" });
    expect(realignBlocker(p)).toBeNull();
  });
});
