/**
 * Noyau du limon coudé sur des escaliers réels (sous-lot K2a, non branché) : faces, fenêtres et
 * supports candidats de `steel-profile` (`profileSupportSetup`), ligne des nez
 * (`nosingPitchLine`). I1 / CK7 (droit = corde actuelle, à 1e-9), I2, I6, I7 sur escaliers
 * générés, I8 (miroir), I9 (ordre des faces), exemples tournants et cages, chiffres épinglés
 * (section et besoin d'âme des mesures K2a) et constats du jour en pan coupé (K-Q12).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findSection, sectionsOf, type SteelSection } from "../catalog/sections.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { applyStructureChoice } from "../project/structureChoice.js";
import { ALL_TYPOLOGIES, makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { adaptJour } from "./compare.js";
import { nosingPitchLine } from "./development.js";
import { stairGeometry } from "./legs.js";
import {
  PROVISIONAL_KNEE_SETTINGS,
  bearingSectionOf,
  cornerOf,
  faceHeightNeed,
  fitInWebPolyline,
  lightestBearingSection,
  miterFlangeGap,
  polylineAt,
  profileBearings,
  riveFns,
  type BearingFace,
  type BearingInput,
  type BearingIssue,
  type BearingResult,
  type KneeSettings,
  type WebFitParams,
  type WebSupport,
} from "./profileBearing.js";
import {
  SteelProfileParamsSchema,
  buildSteelProfile,
  profileSupportSetup,
  type SteelProfileResult,
} from "./steelProfile.js";
import { StructureError } from "./registry.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
const RUNS = Math.min(Number(process.env["STEPPING_RUNS"] ?? 30), 200);
const ZERO: KneeSettings = { minSegmentLength: 0, minKneeAngle: 0 };

interface Setup {
  readonly project: Project;
  readonly faces: readonly BearingFace[];
  readonly pitch: BearingInput["pitch"];
  readonly upperOffset: number;
  readonly supports: ReadonlyMap<string, readonly (WebSupport & { tread: number })[]>;
  readonly fitOf: (s: SteelSection) => WebFitParams;
  readonly r: SteelProfileResult;
}

/** Faces, ligne des nez et supports candidats du greffon `steel-profile` pour un projet. */
function setupOf(project: Project): Setup {
  const m = buildModel(project, { memo: false });
  const params = SteelProfileParamsSchema.parse(project.stair.structure.params);
  const ctx = { project, layout: m.layout, stepping: m.stepping };
  const st = profileSupportSetup(ctx, params, stairGeometry(project, m.layout));
  const faces: BearingFace[] = st.faces.map((f) => ({
    id: f.id,
    side: f.side,
    sigmaA: f.sigmaA,
    faceLength: f.faceLength,
    uLo: st.windows.get(f.id)!.uLo,
    uHi: st.windows.get(f.id)!.uHi,
    start: f.start,
    end: f.end,
    ...(f.startCorner ? { startCorner: f.startCorner } : {}),
    ...(f.endCorner ? { endCorner: f.endCorner } : {}),
  }));
  const supports = new Map<string, (WebSupport & { tread: number })[]>();
  for (const c of st.candidates) {
    if (c.face.kind !== "stringer") continue;
    const list = supports.get(c.face.owner) ?? [];
    list.push({ u0: c.u0, u1: c.u1, zTop: c.zTop, tread: c.tread });
    supports.set(c.face.owner, list);
  }
  return {
    project,
    faces,
    pitch: {
      inner: nosingPitchLine(m.stepping.nosings, m.stepping.treads, "inner"),
      outer: nosingPitchLine(m.stepping.nosings, m.stepping.treads, "outer"),
    },
    upperOffset: params.upperOffset,
    supports,
    fitOf: (s) => ({
      depth: st.depthSup,
      edge: params.supports.edgeMargin,
      tf: s.shape === "I" ? s.tf : 0,
      minLength: params.supports.minLength,
    }),
    r: buildSteelProfile(ctx, params),
  };
}

function bearings(st: Setup, s: SteelSection, settings: KneeSettings): BearingResult {
  return profileBearings({
    faces: st.faces,
    pitch: st.pitch,
    upperOffset: st.upperOffset,
    section: bearingSectionOf(s),
    settings,
  });
}

/** Besoin de hauteur (max des faces) avec la ligne d'appui construite pour la section s. */
function needOf(st: Setup, s: SteelSection, settings: KneeSettings): number {
  const res = bearings(st, s, settings);
  return Math.max(
    0,
    ...res.faces.map(
      (fb) => faceHeightNeed(fb, st.supports.get(fb.faceId) ?? [], st.fitOf(s)).need,
    ),
  );
}

const profiled = (p: Project, params: Record<string, unknown> = {}): Project => ({
  ...p,
  stair: { ...p.stair, structure: { kind: "steel-profile", params } },
});
/** Poteau posé comme en barre droite (`chord`), celui des mesures K2a (avant la bascule K2d). */
const choose = (p: Project): Project =>
  applyStructureChoice(p, "steel-profile", { family: "UPN", stringerLine: "chord" }).project;
/**
 * j3c au poteau 125 / 43 de l'exemple d'avant la bascule du défaut (sous-lot K2d ; l'exemple
 * régénéré pose le poteau du limon coudé, 110 / 35) : mesures K2a.
 */
const j3cAt125 = (): Project => {
  const p = loadExample("j3c-acceptance-01-upn.blondel.json");
  return {
    ...p,
    stair: {
      ...p.stair,
      layout: {
        ...p.stair.layout,
        turns: p.stair.layout.turns.map((t) => ({
          ...t,
          inner: { kind: "newel" as const, size: 125, offset: 43 },
        })),
      },
    },
  };
};
/**
 * j5b de référence pour les mesures K2a et le critère de K2b : chemin du comparateur
 * (`adaptJour`, critère d'acceptation n° 2), puis UPN. Le chemin de l'interface
 * (`applyStructureChoice`) donne un autre jour, donc d'autres chiffres (corde UPN 260 à 286,2 mm,
 * limon coudé UPN 180 à 178,3 mm).
 */
const j5bReference = (): Project => {
  const a = adaptJour(loadExample("j5b-debillarde-soude.blondel.json"), {
    kind: "steel-profile",
    params: { family: "UPN", stringerLine: "chord" },
  }).project;
  return {
    ...a,
    stair: { ...a.stair, structure: { kind: "steel-profile", params: { family: "UPN" } } },
  };
};
const isShort = (i: BearingIssue): boolean => i.kind === "shortSegment" || i.kind === "cutsCross";

/**
 * I2 aux onglets : écart nul (rive haute et rive basse, d = 0, shift, b) à chaque coin ; rend le
 * nombre de coins vérifiés et de coins sautés (tronçon trop court déclaré).
 */
function expectMitersClosed(
  st: Setup,
  res: BearingResult,
  s: SteelSection,
): { checked: number; skipped: number } {
  let checked = 0;
  let skipped = 0;
  const sec = bearingSectionOf(s);
  for (const a of st.faces) {
    if (a.end !== "corner") continue;
    const b = st.faces.find(
      (x) =>
        x.side === a.side &&
        x.start === "corner" &&
        Math.abs(x.sigmaA - a.sigmaA - a.faceLength) < 1e-6,
    );
    const fa = res.faces.find((f) => f.faceId === a.id);
    const fb = b && res.faces.find((f) => f.faceId === b.id);
    if (!b || !fa || !fb) continue;
    if (res.issues.some((i) => isShort(i) && "faceId" in i && [a.id, b.id].includes(i.faceId))) {
      skipped++;
      continue;
    }
    const gap = miterFlangeGap(riveFns(fa), riveFns(fb), a.faceLength, cornerOf(a, "end")!, sec);
    expect(gap.max, `${a.id}/${b.id}`).toBeLessThan(1e-6);
    checked++;
  }
  return { checked, skipped };
}

/** Constats propres au jour en pan coupé (K-Q12), absents des volées. */
const cageOnly = (res: BearingResult): BearingIssue[] =>
  res.issues.filter((i) => i.kind === "noseAboveRive" || i.kind === "steepSegment");

describe("profileBearing — escaliers droits (I1 / CK7)", () => {
  const cases: [string, () => Project][] = [
    ["demo-erp-grand", () => loadExample("demo-erp-grand.blondel.json")],
    ["demo-straight-loft", () => loadExample("demo-straight-loft.blondel.json")],
    ...[8, 15, 19].map((n): [string, () => Project] => [
      `droit ${n}`,
      () =>
        profiled(
          makeSteppingProject({
            width: 900,
            legs: ["auto"],
            floorToFloor: 175 * n,
            stepping: { riserCount: n, targetRise: 175, targetGoing: 280 },
          }),
        ),
    ]),
  ];
  for (const [name, make] of cases) {
    it(`${name} : un tronçon par face, égal à la corde ; besoin = requiredHeight`, () => {
      const st = setupOf(make());
      const s = st.r.section!;
      expect(s).not.toBeNull();
      const res = bearings(st, s, ZERO);
      expect(res.issues).toEqual([]);
      for (const x of st.r.stringers) {
        const fb = res.faces.find((f) => f.faceId === x.face.id)!;
        expect(fb.segments).toHaveLength(1);
        const seg = fb.segments[0]!;
        expect(Math.abs(Math.tan(seg.alpha) - x.line.slope)).toBeLessThan(1e-9);
        expect(Math.abs(polylineAt(fb.line, x.line.u0) - x.line.z0)).toBeLessThan(1e-9);
      }
      expect(Math.abs(needOf(st, s, ZERO) - st.r.requiredHeight)).toBeLessThan(1e-6);
    });
  }
});

describe("profileBearing — escaliers tournants générés (I2, I6, I7)", () => {
  it("poteaux imposés, UPN / IPE / HEA : onglets fermés, tronçons réalisables, logement exact", () => {
    let evaluated = 0;
    let miters = 0;
    const sectionArb = fc.constantFrom("UPN 160", "UPN 220", "IPE 300", "HEA 200");
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), sectionArb, ({ project }, name) => {
        const withNewels: Project = {
          ...project,
          stair: {
            ...project.stair,
            layout: {
              ...project.stair.layout,
              turns: project.stair.layout.turns.map((t) => ({
                ...t,
                inner: { kind: "newel" as const, size: 120 },
              })),
            },
          },
        };
        const p = choose(withNewels);
        let st: Setup;
        try {
          st = setupOf(p);
        } catch (e) {
          // Découpage en faces impossible pour ce tirage (tournants opposés S / Z, tracé
          // inattendu) : hors du noyau. Toute autre exception est une régression.
          if (e instanceof StructureError) return;
          throw e;
        }
        evaluated++;
        const s = findSection(name)!;
        const settings = PROVISIONAL_KNEE_SETTINGS;
        const res = bearings(st, s, settings);
        miters += expectMitersClosed(st, res, s).checked;
        // Nez au-dessus de la rive haute : seulement là où la ligne d'appui quitte les nez (sommet
        // retiré pour coupes croisées ou trop court, partie de niveau d'un coin). Ce cas existe en
        // volées : côté jour près du poteau, girons courts et raides (sonde de correction K2a,
        // 9 faces sur 267 escaliers, jusqu'à 170 mm). Raccord raide : toujours au bord d'un niveau.
        for (const i of cageOnly(res)) {
          const fb = res.faces.find((f) => "faceId" in i && f.faceId === i.faceId)!;
          const left =
            fb.removed.some((r) => r.reason === "segment") ||
            fb.start === "corner" ||
            fb.end === "corner";
          expect(left, JSON.stringify(i)).toBe(true);
        }
        const m = settings.minSegmentLength;
        const fit = st.fitOf(s);
        for (const fb of res.faces) {
          for (const seg of fb.segments) {
            if (seg.fibres.shortest < m - 1e-9) {
              expect(
                res.issues.some((i) => isShort(i) && "faceId" in i && i.faceId === fb.faceId),
              ).toBe(true);
            }
          }
          for (let i = 0; i + 1 < fb.line.length; i++) {
            expect(fb.line[i + 1]!.y).toBeGreaterThanOrEqual(fb.line[i]!.y - 1e-9);
          }
          for (const c of st.supports.get(fb.faceId) ?? []) {
            const r = fitInWebPolyline(fb.upperRive, fb.lowerRive, c, fit);
            if (r.u1 - r.u0 <= 0) continue;
            const g = (u: number): number =>
              Math.min(
                polylineAt(fb.upperRive, u) - fit.tf - c.zTop,
                c.zTop - fit.depth - fit.edge - polylineAt(fb.lowerRive, u) - fit.tf,
              );
            expect(g(r.u0)).toBeGreaterThanOrEqual(-1e-6);
            expect(g(r.u1)).toBeGreaterThanOrEqual(-1e-6);
          }
        }
      }),
      { numRuns: RUNS },
    );
    // Les tirages dont le découpage échoue ne prouvent rien : il en faut une part suffisante
    // d'évalués. Environ la moitié échouent (tournants opposés S / Z) : une borne à la moitié
    // échouait au hasard (13 évalués sur 30) ; au cinquième, l'échec fortuit devient négligeable.
    expect(evaluated).toBeGreaterThan(RUNS / 5);
    expect(miters).toBeGreaterThan(0);
  });
});

describe("profileBearing — symétrie et déterminisme (I8, I9)", () => {
  const left = (): Project => choose(loadExample("quarter-left.blondel.json"));
  const mirror = (p: Project): Project => ({
    ...p,
    stair: {
      ...p.stair,
      layout: {
        ...p.stair.layout,
        turns: p.stair.layout.turns.map((t) => ({
          ...t,
          direction: t.direction === "left" ? ("right" as const) : ("left" as const),
        })),
      },
    },
  });

  it("I8 : tournant à gauche et son miroir, mêmes lignes d'appui, λ, besoins et section", () => {
    const a = setupOf(left());
    const b = setupOf(mirror(left()));
    const ups = sectionsOf("UPN");
    const sa = lightestBearingSection(ups, (s) => needOf(a, s, PROVISIONAL_KNEE_SETTINGS));
    const sb = lightestBearingSection(ups, (s) => needOf(b, s, PROVISIONAL_KNEE_SETTINGS));
    expect(sa?.name).toBe(sb?.name);
    const s = sa ?? findSection("UPN 200")!;
    const ra = bearings(a, s, PROVISIONAL_KNEE_SETTINGS);
    const rb = bearings(b, s, PROVISIONAL_KNEE_SETTINGS);
    expect(rb.faces.map((f) => f.faceId)).toEqual(ra.faces.map((f) => f.faceId));
    ra.faces.forEach((fa, i) => {
      const fb = rb.faces[i]!;
      expect(fb.line).toHaveLength(fa.line.length);
      fa.line.forEach((q, k) => {
        expect(Math.abs(fb.line[k]!.x - q.x)).toBeLessThan(1e-6);
        expect(Math.abs(fb.line[k]!.y - q.y)).toBeLessThan(1e-6);
      });
      const na = faceHeightNeed(fa, a.supports.get(fa.faceId) ?? [], a.fitOf(s)).need;
      const nb = faceHeightNeed(fb, b.supports.get(fb.faceId) ?? [], b.fitOf(s)).need;
      expect(Math.abs(na - nb)).toBeLessThan(1e-6);
    });
    expect(rb.corners).toHaveLength(ra.corners.length);
    ra.corners.forEach((c, i) => {
      expect(Math.abs(rb.corners[i]!.lengthBefore - c.lengthBefore)).toBeLessThan(1e-6);
      expect(Math.abs(rb.corners[i]!.lengthAfter - c.lengthAfter)).toBeLessThan(1e-6);
    });
  });

  it("I9 : faces mélangées et appel répété, résultat identique", () => {
    const st = setupOf(choose(loadExample("j3c-acceptance-01-upn.blondel.json")));
    const s = findSection("UPN 180")!;
    const input: BearingInput = {
      faces: st.faces,
      pitch: st.pitch,
      upperOffset: st.upperOffset,
      section: bearingSectionOf(s),
      settings: PROVISIONAL_KNEE_SETTINGS,
    };
    const res = profileBearings(input);
    expect(profileBearings({ ...input, faces: [...st.faces].reverse() })).toEqual(res);
    expect(profileBearings(input)).toEqual(res);
  });
});

describe("profileBearing — exemples tournants et cages", () => {
  const cases: [string, () => Project][] = [
    ["j3c", () => j3cAt125()],
    ["cage-60", () => choose(loadExample("cage-60.blondel.json"))],
    ["cage-trapeze", () => choose(loadExample("cage-trapeze.blondel.json"))],
    ["demo-cage-flared-steel", () => choose(loadExample("demo-cage-flared-steel.blondel.json"))],
    ["half-turn", () => choose(loadExample("half-turn.blondel.json"))],
    ["two-quarters-u", () => choose(loadExample("two-quarters-u.blondel.json"))],
  ];
  for (const [name, make] of cases) {
    it(`${name} : sans exception, onglets fermés au bout d'aile, parties de niveau aux coins`, () => {
      const st = setupOf(make());
      for (const s of [findSection("UPN 180")!, findSection("IPE 200")!]) {
        for (const settings of [ZERO, PROVISIONAL_KNEE_SETTINGS]) {
          const res = bearings(st, s, settings);
          expect(expectMitersClosed(st, res, s).skipped).toBe(0);
          const cornerFaces = st.faces.filter((f) => f.end === "corner").length;
          expect(res.corners.length).toBeGreaterThan(0);
          expect(res.corners.length).toBeLessThanOrEqual(cornerFaces + 1);
          for (const c of res.corners) {
            const f = st.faces.find((x) => x.id === (c.faceBefore ?? c.faceAfter))!;
            const P = st.pitch[f.side];
            expect(Number.isFinite(c.z)).toBe(true);
            expect(c.z).toBeGreaterThanOrEqual(Math.min(...P.ys) - 1e-9);
            expect(c.z).toBeLessThanOrEqual(Math.max(...P.ys) + 1e-9);
          }
        }
      }
    });
  }
});

describe("profileBearing — chiffres épinglés (mesures K2a, réglages provisoires)", () => {
  const ups = sectionsOf("UPN");
  const cases: [string, () => Project, string, number][] = [
    // [cas, projet, section UPN la plus légère, besoin d'âme avec cette section (mm)]
    ["j3c", () => j3cAt125(), "UPN 180", 167.0],
    ["j5b (comparateur)", j5bReference, "UPN 200", 184.5],
    ["quart", () => choose(loadExample("quarter-left.blondel.json")), "UPN 220", 211.5],
    ["U", () => choose(loadExample("two-quarters-u.blondel.json")), "UPN 200", 197.3],
    [
      "j4-demi",
      () => choose(loadExample("j4-demi-tournant-acier-garde-corps.blondel.json")),
      "UPN 260",
      242.5,
    ],
  ];
  for (const [name, make, section, need] of cases) {
    it(`${name} : ${section}, besoin ${need} mm ; ni nez au-dessus de la rive, ni raccord raide`, () => {
      const st = setupOf(make());
      const s = lightestBearingSection(ups, (x) => needOf(st, x, PROVISIONAL_KNEE_SETTINGS));
      expect(s?.name).toBe(section);
      expect(Math.abs(needOf(st, s!, PROVISIONAL_KNEE_SETTINGS) - need)).toBeLessThan(0.5);
      for (const x of [s!, findSection("IPE 200")!]) {
        expect(cageOnly(bearings(st, x, PROVISIONAL_KNEE_SETTINGS))).toEqual([]);
      }
    });
  }

  it("j3c : 9 jarrets en UPN 180 (le nettoyage n'en retire pas davantage)", () => {
    const st = setupOf(j3cAt125());
    const s = findSection("UPN 180")!;
    const count = (k: KneeSettings): number =>
      bearings(st, s, k).faces.reduce((a, f) => a + f.knees.length, 0);
    expect(count(PROVISIONAL_KNEE_SETTINGS)).toBe(9);
    expect(count(ZERO)).toBe(10);
  });

  it("quart : extrémité de LI1 au poteau déplacée de −48,9 mm (prolongement, `endShift`)", () => {
    const st = setupOf(choose(loadExample("quarter-left.blondel.json")));
    const res = bearings(st, findSection("UPN 220")!, PROVISIONAL_KNEE_SETTINGS);
    const li1 = res.faces.find((f) => f.faceId === "stringer-inner-1")!;
    expect(li1.endShift.start).toBeCloseTo(0, 9);
    expect(li1.endShift.end).toBeCloseTo(-48.9, 1);
    expect(li1.nosingDeviation.max).toBeLessThan(1e-9);
  });
});

describe("profileBearing — jour en pan coupé de cage (K-Q12)", () => {
  it("cage-60-palier-limon : nez au-dessus de la rive haute, raccord raide, marche 7 perdue", () => {
    const st = setupOf(choose(loadExample("cage-60-palier-limon.blondel.json")));
    const ups = sectionsOf("UPN");
    expect(lightestBearingSection(ups, (x) => needOf(st, x, PROVISIONAL_KNEE_SETTINGS))).toBeNull();
    const s = findSection("UPN 260")!;
    const res = bearings(st, s, PROVISIONAL_KNEE_SETTINGS);
    const above = res.issues.filter((i) => i.kind === "noseAboveRive");
    expect(above).toHaveLength(1);
    expect(above[0]!.kind === "noseAboveRive" && above[0]!.excess).toBeCloseTo(62.0, 1);
    expect(res.issues.some((i) => i.kind === "steepSegment")).toBe(true);
    const lost = res.faces.flatMap(
      (fb) => faceHeightNeed(fb, st.supports.get(fb.faceId) ?? [], st.fitOf(s)).lost,
    );
    expect(lost).toEqual([7]);
  });
});
