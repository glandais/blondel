/**
 * Limon débillardé acier (`steel-curved`) sur une cage saisie (ADR-0010, sous-lot 6d) :
 * capacités (`STEEL_CURVED_CAGE` : axe en arc, palier droit), parité stricte d'une cage sans
 * fonction avec la volée équivalente, palier droit traversé par le limon de jour débillardé,
 * cage à axe en arc (limons cintrés des deux côtés, développés en fibre neutre, rouleuse,
 * supports, platines, quantités), refus explicites (jonction tournante, rayon de roulage), puis
 * une propriété fast-check sur des cages tirées parmi les seules fonctions déclarées.
 *
 * Conventions vérifiées (à valider, QUESTIONS F19) : sur une cage à axe en arc, chaque limon est
 * une tôle continue du départ à l'arrivée le long de C_i (jour) ou de C_e (mur), face côté
 * marches sur le bord, épaisseur hors emprise ; raccords tangents aux naissances (droite / arc),
 * coupes décalées de δ dans la partie droite (mêmes règles que le débillardé des volées) ; une
 * jonction tournante n'est pas suivie (erreur).
 */
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import type { Model } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { toCageLayout } from "../project/layoutConversion.js";
import { createDemoProject, DEMO_PRESET_IDS } from "../project/presetDemo.js";
import { ALL_PRESET_IDS, createProject } from "../project/presets.js";
import { area } from "./geom.js";
import { structureCageFeatures } from "./registry.js";
import {
  QUANTITY_ROLLED_LENGTH_MM,
  STEEL_CURVED_CAGE,
  SteelCurvedParamsSchema,
  buildSteelCurved,
  type CurvedStringerResult,
  type SteelCurvedResult,
} from "./steelCurved.js";
import "./index.js";

const FR = translatorFor("fr");
const E = SteelCurvedParamsSchema.parse({}).thickness;
/** Décalage δ des coupes de naissance (paramètre du plugin, à valider). */
const DELTA = SteelCurvedParamsSchema.parse({}).curved.jointOffset;

const straight = (length: number, width = 900) => ({
  axis: { kind: "straight" as const, length },
  width,
});
const arc = (radius: number, sweep: number, width = 900) => ({
  axis: { kind: "arc" as const, radius, sweep },
  width,
});
const landing = (depth?: number) => ({
  angle: 0,
  mode: "landing" as const,
  ...(depth !== undefined ? { depth } : {}),
});

function cageProject(
  layout: CageLayoutSpecInput,
  params: Record<string, unknown> = {},
  structure = "steel-curved",
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      structure: { kind: structure, params },
    },
  });
}

function withCurved(p: Project, params: Record<string, unknown> = {}): Project {
  return ProjectSchema.parse({
    ...p,
    stair: { ...p.stair, structure: { kind: "steel-curved", params } },
  });
}

function run(project: Project): { m: Model; r: SteelCurvedResult } {
  const m = buildModel(project, { memo: false });
  const params = SteelCurvedParamsSchema.parse(project.stair.structure.params ?? {});
  const r = buildSteelCurved({ project, layout: m.layout, stepping: m.stepping }, params);
  return { m, r };
}

const keys = (m: Model): string[] => m.errors.map((e) => e.key);
const marks = (m: Model): string[] =>
  m.parts.filter((p) => p.category === "stringer").map((p) => p.mark);

/** Toutes les marches (palier compris) portées des deux côtés (`FAB_MARCHE_PORTEE`). */
function expectAllCarried(m: Model): void {
  const carried = m.compliance.results.filter((r) => r.ruleId === "FAB_MARCHE_PORTEE");
  expect(carried.length).toBe(m.stepping.treads.length);
  for (const r of carried) expect(r.status, FR.t(r.message)).toBe("ok");
}

/** Longueurs positives : débits, développés, longueurs roulées. */
function expectPositiveLengths(m: Model): void {
  const stringers = m.parts.filter((x) => x.category === "stringer");
  expect(stringers.length).toBeGreaterThan(0);
  for (const p of stringers) {
    expect(p.stock!.length, p.mark).toBeGreaterThan(0);
    expect(p.stock!.width, p.mark).toBeGreaterThan(0);
    expect(area(p.flat!.outline.outer), p.mark).toBeGreaterThan(0);
    expect(p.quantities[QUANTITY_ROLLED_LENGTH_MM] ?? 0, p.mark).toBeGreaterThanOrEqual(0);
  }
}

/** Cage de référence : volée droite, palier droit, volée courbe à 60° (exemple du sous-lot). */
const ARC_CAGE: CageLayoutSpecInput = {
  kind: "cage",
  sections: [straight(1620), arc(1800, 60)],
  junctions: [landing(900)],
};

describe("capacités (sous-lot 6d)", () => {
  it("axe en arc et palier droit déclarés, les autres fonctions refusées", () => {
    expect(STEEL_CURVED_CAGE).toEqual(["arcAxis", "straightLanding"]);
    expect(structureCageFeatures("steel-curved")).toEqual(STEEL_CURVED_CAGE);
    const cases: [CageLayoutSpecInput, string][] = [
      [
        {
          kind: "cage",
          sections: [straight(1650), straight(1650)],
          junctions: [{ angle: 60, mode: "winders", well: { kind: "arc", radius: 250 } }],
        },
        "angle quelconque",
      ],
      [
        {
          kind: "cage",
          sections: [{ ...straight(1500), widthEnd: 1100 }, straight(1500, 1100)],
          junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 250 } }],
        },
        "largeur variable",
      ],
    ];
    for (const [layout, missing] of cases) {
      const m = buildModel(cageProject(layout), { memo: false });
      expect(keys(m)).toEqual(["structure.cageUnsupported"]);
      const text = FR.t(m.errors[0]!);
      expect(text).toContain(missing);
      expect(text).not.toContain("axe en arc");
      expect(text).not.toContain("palier droit");
    }
  });
});

describe("parité : une cage sans fonction donne les pièces de la volée équivalente", () => {
  /** Pièces sans le nom des limons (nommés par tronçon sur une cage, par volée sinon). */
  const partsOf = (m: Model) =>
    m.parts.map((p) => {
      if (p.category !== "stringer") return p;
      const { name: _name, ...rest } = p;
      return rest;
    });
  /** Erreurs de volées, clés de cage équivalentes (jour vif d'une jonction de cage). */
  const cageKey = (k: string): string =>
    k === "structure.steel.error.sharpWell" ? "structure.steel.error.sharpWellCage" : k;

  const flightsProjects = (): [string, Project][] => {
    const out: [string, Project][] = [];
    for (const id of ALL_PRESET_IDS) out.push([id, createProject(id)]);
    for (const id of DEMO_PRESET_IDS) out.push([id, createDemoProject(id)]);
    return out.filter(([, p]) => p.stair.layout.kind !== "helical");
  };

  /** Jours en arc de rayon 250 mm à chaque tournant (débillardé constructible). */
  const withArcWells = (p: Project): Project => {
    const layout = p.stair.layout;
    if (layout.kind === "helical" || layout.kind === "cage") return p;
    return ProjectSchema.parse({
      ...p,
      stair: {
        ...p.stair,
        layout: {
          ...layout,
          turns: layout.turns.map((t) => ({ ...t, inner: { kind: "arc", radius: 250 } })),
        },
      },
    });
  };

  it.each([
    ["défaut", {}],
    ["marches en tôle pliée Z", { treadKind: "folded-steel", folded: { profile: "Z" } }],
  ] as const)(
    "préréglages et démos (%s), jours tels quels et en arc : mêmes pièces",
    (_n, params) => {
      let compared = 0;
      for (const [id, base] of flightsProjects()) {
        for (const p of [base, withArcWells(base)]) {
          const flights = withCurved(p, params);
          const cage = toCageLayout(flights);
          if (!cage) continue;
          const a = buildModel(flights, { memo: false });
          const b = buildModel(cage, { memo: false });
          // Tracé impossible (jour en arc trop grand pour une volée courte) : même refus du tracé.
          if (keys(a).some((k) => k.startsWith("layout."))) {
            expect(
              keys(b).some((k) => k.startsWith("layout.")),
              id,
            ).toBe(true);
            continue;
          }
          if (keys(a).includes("structure.common.legs.oppositeTurns")) {
            // S / Z : refusé par le garde-fou sur la cage (tournants opposés non déclarés).
            expect(keys(b), id).toEqual(["structure.cageUnsupported"]);
            continue;
          }
          compared++;
          expect(keys(b), id).toEqual(keys(a).map(cageKey));
          expect(partsOf(b), id).toStrictEqual(partsOf(a));
          expect(b.executionClass, id).toBe(a.executionClass);
        }
      }
      expect(compared).toBeGreaterThan(15);
    },
  );
});

describe("palier droit sans axe en arc : le limon de jour débillardé le traverse", () => {
  it("quart tournant à jour en arc puis palier droit : un seul limon de jour, limons muraux aboutés", () => {
    const p = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(800), straight(1100)],
      junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 250 } }, landing(900)],
    });
    const { m, r } = run(p);
    expect(keys(m)).toEqual([]);
    // Jour : tronçons LD seulement (aucun limon de jour en plat LI*), du départ à l'arrivée.
    const ms = marks(m);
    expect(ms.filter((x) => x.startsWith("LI"))).toEqual([]);
    expect(ms.some((x) => /^LD\d+$/.test(x))).toBe(true);
    expect(ms.filter((x) => x.startsWith("LE")).length).toBeGreaterThan(1);
    expect(r.wall).toBeNull();
    const c = r.curved!;
    const nosings = m.stepping.nosings;
    expect(c.development.uLo).toBeLessThanOrEqual(nosings[0]!.sigmaInner);
    // Arrivée : au dernier nez, moins l'épaisseur de la platine de tête.
    const head = SteelCurvedParamsSchema.parse({}).plates.thickness;
    expect(c.development.uHi).toBeGreaterThanOrEqual(
      nosings[nosings.length - 1]!.sigmaInner - head - 1e-9,
    );
    expectAllCarried(m);
    expectPositiveLengths(m);
    expect(m.executionClass).toBe("EXC2");
  });

  it("escalier sans tournant (paliers droits seuls) : pas de jour courbe, comme en volées", () => {
    const { m } = run(
      cageProject({
        kind: "cage",
        sections: [straight(1890), straight(1620)],
        junctions: [landing(1000)],
      }),
    );
    expect(keys(m)).toEqual(["structure.steelCurved.error.noTurn"]);
    // Limons en plat de `steel-flat` (jour et mur), aboutés au milieu du palier.
    expect(marks(m).some((x) => x.startsWith("LI"))).toBe(true);
    expect(marks(m).some((x) => x.startsWith("LE"))).toBe(true);
  });

  it("jour vif sur une cage : erreur du débillardé, comme en volées", () => {
    const { m } = run(
      cageProject({
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 90, mode: "winders" }],
      }),
    );
    expect(keys(m)).toContain("structure.steelCurved.error.wellNotArc");
    expect(keys(m)).not.toContain("structure.cageUnsupported");
    const err = m.errors.find((e) => e.key === "structure.steelCurved.error.wellNotArc")!;
    expect(err.params?.["turn"]).toBe(1);
  });
});

describe("cage à axe en arc : limons cintrés des deux côtés", () => {
  const { m, r } = run(cageProject(ARC_CAGE));
  const inner = r.curved!;
  const wall = r.wall!;

  it("modèle sans erreur, repères LD (jour) et LDM (mur), aucun limon en plat", () => {
    expect(keys(m)).toEqual([]);
    const ms = marks(m);
    expect(ms.every((x) => /^LDM?\d+$/.test(x))).toBe(true);
    expect(ms.filter((x) => /^LD\d/.test(x)).length).toBe(inner.segments.length);
    expect(ms.filter((x) => /^LDM\d/.test(x)).length).toBe(wall.segments.length);
    expect(r.flat.stringers).toEqual([]);
    expect(inner.jour).toBe(m.layout.innerSide);
    expect(wall.jour).not.toBe(m.layout.innerSide);
    expect(m.parts.find((p) => p.mark === "LDM1")!.id).toBe("stringer-outer-curved-1");
    expect(FR.t(m.parts.find((p) => p.mark === "LDM1")!.name)).toMatch(/^Limon mural cintré/);
  });

  it("rayons : face, fibre neutre et rayon roulé de chaque arc (concave au jour, convexe au mur)", () => {
    const sec = m.layout.sections!.find((s) => s.kind === "arc")!;
    const ri = sec.arc!.radius - 450;
    const re = sec.arc!.radius + 450;
    const arcsOf = (c: CurvedStringerResult) => c.segments.flatMap((s) => s.arcs);
    expect(arcsOf(inner).length).toBeGreaterThan(0);
    for (const a of arcsOf(inner)) {
      expect(a.faceRadius).toBeCloseTo(ri, 9);
      expect(a.neutralRadius).toBeCloseTo(ri - E / 2, 9);
      expect(a.innerRadius).toBeCloseTo(ri - E, 9);
    }
    expect(arcsOf(wall).length).toBeGreaterThan(0);
    for (const a of arcsOf(wall)) {
      expect(a.faceRadius).toBeCloseTo(re, 9);
      expect(a.neutralRadius).toBeCloseTo(re + E / 2, 9);
      expect(a.innerRadius).toBeCloseTo(re, 9);
    }
    // Contrôle de la rouleuse : un élément par arc et par limon (un arc, deux limons), rayon
    // intérieur roulé ; valeur la plus défavorable : celle du jour (r_i − e < r_e).
    const rolling = m.compliance.results.filter((x) => x.ruleId === "FAB_ROULAGE_RAYON_MIN");
    expect(rolling).toHaveLength(1);
    expect(rolling[0]!.status).toBe("ok");
    expect(rolling[0]!.measured).toBeCloseTo(ri - E, 9);
    expect(rolling[0]!.message.params?.["count"]).toMatchObject({ num: 2 });
  });

  it("développés : tronçons jointifs en fibre neutre, longueurs roulées = arcs de la fibre neutre", () => {
    // Coupes de naissance plus près que δ (repli, hors arc) : autant que de remarques
    // `springingCutClose` (limon de jour nu, limon mural préfixé).
    let closeJoints = 0;
    for (const c of [inner, wall]) {
      const segs = c.segments;
      expect(segs.length).toBeGreaterThan(1);
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i]!.sigma0).toBeCloseTo(segs[i - 1]!.sigma1, 9);
        expect(segs[i]!.neutral0).toBeCloseTo(segs[i - 1]!.neutral1, 9);
      }
      const total = segs[segs.length - 1]!.neutral1 - segs[0]!.neutral0;
      expect(total).toBeCloseTo(
        c.neutral.toFiber(c.development.uHi) - c.neutral.toFiber(c.development.uLo),
        6,
      );
      // Longueur roulée (nomenclature) = somme des portions d'arc de la fibre neutre.
      const rolled = segs.reduce(
        (s, x) => s + (x.part.quantities[QUANTITY_ROLLED_LENGTH_MM] ?? 0),
        0,
      );
      const arcLen = c.neutral.pieces
        .filter((p) => p.kind === "arc")
        .reduce(
          (s, p) =>
            s +
            Math.max(
              0,
              Math.min(p.fiber1, c.neutral.toFiber(c.development.uHi)) -
                Math.max(p.fiber0, c.neutral.toFiber(c.development.uLo)),
            ),
          0,
        );
      expect(rolled).toBeCloseTo(arcLen, 6);
      // Joints soudés bout à bout : un de moins que de tronçons, décalés de δ des naissances.
      expect(c.joints).toHaveLength(segs.length - 1);
      for (const j of c.joints) {
        expect(j.weld).toBeGreaterThan(0);
        if (j.naissanceOffset !== undefined && !j.onArc && j.naissanceOffset < DELTA - 1e-6) {
          closeJoints++;
        }
      }
    }
    const closeNotes = (m.notes ?? []).filter((n) => {
      const inner = n.params?.["detail"] as { key?: string } | undefined;
      return [n.key, inner?.key].includes("structure.steelCurved.note.springingCutClose");
    }).length;
    expect(closeJoints).toBe(closeNotes);
    // Sur cette cage, la partie droite n'est pas encombrée : δ tenu partout.
    expect(closeNotes).toBe(0);
    expect(m.executionClass).toBe("EXC2");
  });

  it("solides : la face côté marches suit C_i et C_e (rayon des bords sur l'arc)", () => {
    const sec = m.layout.sections!.find((s) => s.kind === "arc")!;
    const center = sec.arc!.center;
    const ri = sec.arc!.radius - 450;
    const re = sec.arc!.radius + 450;
    const onArc = (pts: readonly { x: number; y: number }[], radius: number): number =>
      pts.filter((p) => Math.abs(V.distance(V.vec(p.x, p.y), center) - radius) < 1e-6).length;
    let innerHits = 0;
    let wallHits = 0;
    for (const s of inner.segments) {
      if (s.part.solid.kind !== "ruled") throw new Error("solide réglé attendu");
      innerHits += onArc(s.part.solid.a, ri);
    }
    for (const s of wall.segments) {
      if (s.part.solid.kind !== "ruled") throw new Error("solide réglé attendu");
      wallHits += onArc(s.part.solid.a, re);
      // Épaisseur vers le mur : normales sortantes (loin du centre) sur l'arc.
      const solid = s.part.solid;
      solid.a.forEach((p, i) => {
        const pt: Vec2 = V.vec(p.x, p.y);
        if (Math.abs(V.distance(pt, center) - re) > 1e-6) return;
        expect(V.dot(solid.normals![i]!, V.normalize(V.sub(pt, center)))).toBeCloseTo(1, 9);
      });
    }
    expect(innerHits).toBeGreaterThan(5);
    expect(wallHits).toBeGreaterThan(5);
  });

  it("supports des deux côtés, faces tangentes, marches portées ; platines de pied et de tête", () => {
    expect(inner.supports.length).toBe(m.stepping.treads.length);
    expect(wall.supports.length).toBe(m.stepping.treads.length);
    for (const s of inner.supports) expect(s.placement.face.side).toBe("inner");
    for (const s of wall.supports) {
      expect(s.placement.face.side).toBe("outer");
      expect(s.placement.face.owner).toMatch(/^stringer-outer-curved-\d+$/);
      expect(s.gap).toBeGreaterThanOrEqual(0);
    }
    expectAllCarried(m);
    expectPositiveLengths(m);
    const plates = m.parts.filter((p) => p.id.startsWith("plate-")).map((p) => p.id);
    expect(plates).toEqual(
      expect.arrayContaining([
        `plate-foot-stringer-inner-curved-1`,
        `plate-foot-stringer-outer-curved-1`,
        `plate-head-stringer-inner-curved-${inner.segments.length}`,
        `plate-head-stringer-outer-curved-${wall.segments.length}`,
      ]),
    );
    // Assemblages : tronçons consécutifs de chaque limon.
    const with2 = (id: string) => m.parts.find((p) => p.id === id)!.assembledWith ?? [];
    expect(with2("stringer-outer-curved-1")).toContain("stringer-outer-curved-2");
    expect(with2("stringer-inner-curved-1")).toContain("stringer-inner-curved-2");
  });

  it("libellés : lignes de roulage nommant la face roulée, contrôles du mur préfixés", () => {
    const rollLabel = (mark: string): string[] =>
      m.parts
        .find((p) => p.mark === mark)!
        .flat!.lines.filter((l) => l.kind === "roll" && l.label)
        .map((l) => FR.t(l.label!));
    const innerArcMark = inner.segments.find((s) => s.arcs.length > 0)!.part.mark;
    const wallArcMark = wall.segments.find((s) => s.arcs.length > 0)!.part.mark;
    expect(rollLabel(innerArcMark).join()).toContain("face côté jour à l'intérieur");
    expect(rollLabel(wallArcMark).join()).toContain("face côté marches à l'intérieur");
    const wallChecks = m.compliance.results.filter((x) =>
      FR.t(x.message).startsWith("Limon mural cintré — "),
    );
    expect(wallChecks.length).toBeGreaterThan(5);
    const notes = (m.notes ?? []).map((n) => FR.t(n));
    expect(notes.some((n) => n.startsWith("Limon mural cintré : tôle"))).toBe(true);
    for (const n of notes) expect(n).not.toMatch(/Limon mural cintré — Limon mural cintré/);
  });

  it("marches en tôle pliée : développées et vissées sur les supports des deux limons", () => {
    const { m: mf, r: rf } = run(
      cageProject(ARC_CAGE, { treadKind: "folded-steel", folded: { profile: "Z" } }),
    );
    expect(keys(mf)).toEqual([]);
    expect(rf.flat.treads.length).toBeGreaterThan(0);
    expectAllCarried(mf);
    expectPositiveLengths(mf);
  });

  it("arcs de sens opposés (palier droit entre deux arcs) : face roulée selon le sens", () => {
    const { m: ms, r: rs } = run(
      cageProject({
        kind: "cage",
        sections: [arc(2400, 45), arc(2400, -45)],
        junctions: [landing(900)],
      }),
    );
    expect(keys(ms)).toEqual([]);
    expectAllCarried(ms);
    const concave = (c: CurvedStringerResult) =>
      new Set(c.neutral.pieces.filter((p) => p.kind === "arc").map((p) => p.concave));
    expect([...concave(rs.curved!)].sort()).toEqual([false, true]);
    expect([...concave(rs.wall!)].sort()).toEqual([false, true]);
  });
});

describe("cage à axe en arc : refus explicites, sans exception", () => {
  it("jonction tournante : erreur nommant la jonction, limons débillardés non générés", () => {
    const { m } = run(
      cageProject({
        kind: "cage",
        sections: [straight(1500), arc(1800, 60)],
        junctions: [{ angle: 90, mode: "winders" }],
      }),
    );
    expect(keys(m)).toEqual(["structure.steelCurved.error.cageArcTurn"]);
    expect(m.errors[0]!.params?.["junction"]).toBe(1);
    expect(marks(m)).toEqual([]);
    const jour = m.compliance.results.filter((x) => x.ruleId === "FAB_DEBILLARDE_JOUR");
    expect(jour.map((x) => x.status)).toContain("violation");
  });

  it("rayon de roulage trop petit côté jour : limon de jour non généré, limon mural cintré généré", () => {
    // Bord intérieur de 600 − 450 = 150 mm : r − e = 142 mm < 150 mm (rouleuse par défaut).
    const { m, r } = run(
      cageProject({
        kind: "cage",
        sections: [straight(1500), arc(600, 90)],
        junctions: [landing()],
      }),
    );
    expect(keys(m)).toContain("structure.steelCurved.error.rollingRadiusArc");
    expect(r.curved).toBeNull();
    expect(r.wall).not.toBeNull();
    const rolling = m.compliance.results.find((x) => x.ruleId === "FAB_ROULAGE_RAYON_MIN")!;
    expect(rolling.status).toBe("violation");
  });

  it("rayon de roulage trop petit côté mur : limon mural cintré non généré, limon de jour généré", () => {
    // Arcs de sens opposés : sur le second, le mur est du côté du centre ; bord côté mur de
    // 600 − 450 = 150 mm, concave vers l'épaisseur : r − e = 142 mm < 150 mm.
    const { m, r } = run(
      cageProject({
        kind: "cage",
        sections: [arc(2400, 45), arc(600, -90)],
        junctions: [landing(900)],
      }),
    );
    expect(r.wall).toBeNull();
    expect(r.curved).not.toBeNull();
    expect(keys(m)).toContain("structure.steelCurved.error.rollingRadiusArc");
    const err = m.errors.find((x) => x.key === "structure.steelCurved.error.rollingRadiusArc")!;
    expect(FR.t(err)).toMatch(/^Limon mural cintré : arc de rayon 150 mm, .* 142 mm < /);
    expect(marks(m).some((x) => x.startsWith("LD"))).toBe(true);
    expect(marks(m).some((x) => x.startsWith("LDM"))).toBe(false);
    const rolling = m.compliance.results.find((x) => x.ruleId === "FAB_ROULAGE_RAYON_MIN")!;
    expect(rolling.status).toBe("violation");
    expect(FR.t(rolling.message)).toContain(
      "Limon mural cintré, arc de rayon 150 mm (face côté mur à l'intérieur)",
    );
  });
});

describe("propriété : cages tirées parmi les fonctions déclarées", () => {
  /** Cage à axe en arc : tronçons droits ou en arc de même largeur, paliers droits. */
  const arcCage = fc
    .record({
      width: fc.integer({ min: 800, max: 1100 }),
      sections: fc.array(
        fc.oneof(
          fc.record({
            kind: fc.constant("straight" as const),
            length: fc.integer({ min: 600, max: 2200 }),
          }),
          fc.record({
            kind: fc.constant("arc" as const),
            radius: fc.integer({ min: 1300, max: 3000 }),
            sweep: fc.integer({ min: 25, max: 80 }).chain((a) => fc.constantFrom(a, -a)),
          }),
        ),
        { minLength: 1, maxLength: 3 },
      ),
      depth: fc.integer({ min: 800, max: 1200 }),
    })
    .filter((r) => r.sections.some((s) => s.kind === "arc"))
    .map((r): CageLayoutSpecInput => ({
      kind: "cage",
      sections: r.sections.map((s) =>
        s.kind === "straight" ? straight(s.length, r.width) : arc(s.radius, s.sweep, r.width),
      ),
      junctions: r.sections.slice(1).map(() => landing(r.depth)),
    }));
  /** Cage sans axe en arc : quarts tournants de même sens à jour en arc, paliers droits. */
  const turnCage = fc
    .record({
      lengths: fc.array(fc.integer({ min: 1200, max: 2000 }), { minLength: 2, maxLength: 3 }),
      kinds: fc.array(fc.constantFrom("turn" as const, "landing" as const), {
        minLength: 2,
        maxLength: 2,
      }),
      sign: fc.constantFrom(1, -1),
      radius: fc.integer({ min: 300, max: 400 }),
    })
    .filter((r) => r.kinds.slice(0, r.lengths.length - 1).includes("turn"))
    .map((r): CageLayoutSpecInput => ({
      kind: "cage",
      sections: r.lengths.map((l) => straight(l)),
      junctions: r.lengths.slice(1).map((_, i) =>
        r.kinds[i] === "turn"
          ? {
              angle: 90 * r.sign,
              mode: "winders" as const,
              well: { kind: "arc" as const, radius: r.radius },
            }
          : landing(),
      ),
    }));

  it.each([
    ["axe en arc", "défaut", arcCage, {}],
    ["axe en arc", "tôle pliée", arcCage, { treadKind: "folded-steel" }],
    ["sans axe en arc", "défaut", turnCage, {}],
  ] as const)(
    "%s (%s) : ne lève jamais, aucun refus, pièces, marches portées, longueurs > 0",
    (_n, _v, arb, params) => {
      let built = 0;
      let runs = 0;
      fc.assert(
        fc.property(arb, (layout) => {
          runs++;
          const p = cageProject(layout, params);
          let m!: Model;
          expect(() => (m = buildModel(p, { memo: false }))).not.toThrow();
          const k = keys(m);
          expect(k).not.toContain("structure.cageUnsupported");
          expect(k).not.toContain("pipeline.internalError");
          // Tracé ou découpage impossible (tronçons qui se recouvrent, etc.) : hors domaine.
          if (m.stepping.treads.length === 0 || k.some((x) => x.startsWith("layout."))) return;
          built++;
          expect(k.filter((x) => x.startsWith("structure."))).toEqual([]);
          expectPositiveLengths(m);
          // Marches portées : seulement à giron réaliste. En deçà, le bord du jour d'un arc serré
          // laisse une marche trop courte pour son support (signalé par `FAB_MARCHE_PORTEE`, pas
          // une erreur) : sonde de 1 500 tirages, échecs jusqu'à 161 mm (bois) et 213 mm (tôle
          // pliée) ; sans axe en arc, marches dansantes autour d'un jour en arc de 300 mm
          // (giron ≈ 213 mm), à l'identique en volées, antérieur au sous-lot 6d.
          if (m.stepping.going >= 220) expectAllCarried(m);
        }),
        { numRuns: 100, seed: 67 },
      );
      expect(built / runs).toBeGreaterThan(0.5);
    },
  );
});
