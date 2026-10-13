/**
 * Parité **hélicoïdal / cage** (F10, sous-lot P1, ADR-0010) : pour un projet hélicoïdal P, le
 * moteur hélicoïdal actuel (référence : `computeHelicalLayout`, `computeHelicalStepping`,
 * `computeHeadroom` sur `Stepping.soffits`) et le moteur de cage appliqué à `helicalToCage(P)`
 * (`computeCageLayout` origine `helical`, `computeStepping`, étape d'échappée de cage
 * `cageHeadroomCeilings`) rendent-ils les mêmes tracés, découpages, sous-faces, échappées et
 * cotes ? Le pipeline n'est pas basculé : `computeLayout` garde le moteur hélicoïdal.
 *
 * Niveaux (comparateur et tolérances justifiées : `helical-parity-helpers.ts`) :
 * - N0 : conversion (erreurs de spécification identiques : nom, clé, paramètres) ;
 * - N1 : `Layout` champ à champ, ajouts de cage vérifiés (`sections`, `walklineSide`,
 *   `helicalOrigin`), `Layout.helical` reconstruit depuis la cage et comparé ;
 * - N2 : `Stepping` champ à champ (nez, marches sommet par sommet, remarques, erreurs), angle des
 *   nez de la cage (ajout) nul ;
 * - N3 : sous-faces (`Stepping.soffits` de l'hélicoïdal contre sous-faces de l'étape d'échappée
 *   de cage, palier d'arrivée compris) ;
 * - N4 : `HeadroomAnalysis` complet ;
 * - N5 : cotes de `mainDimensions` (`pipeline/build.test.ts`) restreintes au tracé, au
 *   découpage et à l'échappée, égalité stricte après arrondis.
 *
 * Écarts attendus **explicites** : chaque cas porte sa table `EXPECTED_GAPS` (chemins en écart,
 * lacune) ; le test exige l'égalité exacte de l'ensemble des chemins en écart avec la table : un
 * écart nouveau échoue, un écart qui disparaît aussi. Lacunes (constat consigné dans
 * `docs/QUESTIONS.md`, F10) :
 * - `CUT` (coupure par la ligne du nez k + 2, irréductible en P1) : quand d / sin Δθ > r_i, le
 *   contour de pièce de l'hélicoïdal (`helicalTreadOutline`) déborde au-delà du nez k + 2 sur le
 *   bord intérieur ; la cage le coupe sur cette ligne (`outlineBetween`, paramètre `c`), comme
 *   les contremarches. Corriger demanderait de modifier le moteur hélicoïdal (référence) ; la
 *   cage est la plus juste. Contours et sous-faces en écart ; l'échappée (valeurs, N4 et N5)
 *   reste comparée strictement (aucun écart d'échappée mesuré sur les tirages CUT : un écart
 *   de valeur y serait un écart nouveau, à documenter).
 * - `TIE` (égalité de minima, bruit) : l'échappée minimale est atteinte avec la même valeur (à
 *   1e-6 près) en plusieurs points, images l'un de l'autre par le vissage de Δθ, h (le plus
 *   souvent à 1 à 3 nez d'écart, parfois un tour) ; `selfcover.ts` retient le premier minimum
 *   strict, et le bruit d'arrondi des deux chemins de calcul départage différemment : point et
 *   abscisse (ou nez) du minimum en écart, **valeur** identique. Admis seulement si le point de
 *   la cage est vérifié comme minimum ex æquo de la référence (`tieOnReference` : même valeur,
 *   abscisse décalée d'un nombre entier de girons, point sur Γ et altitude sur la ligne de pente
 *   de référence ; sur la largeur, point sur le nez de référence de même indice, à son
 *   altitude). Corriger demanderait un départage avec tolérance dans `selfcover.ts`, partagé
 *   avec l'hélicoïdal (référence) : hors P1.
 * - `HALF` (arrondi d'une valeur au demi-pas, bruit) : une grandeur exactement à mi-chemin de
 *   deux arrondis (0,05 pour `dec` des remarques et r1, 0,005 pour r2) bascule d'un côté ou de
 *   l'autre selon le bruit (valeur brute égale à 1e-6 près, vérifiée).
 *
 * Erreurs (N0) : la parité des erreurs de spécification est une propriété de la **conversion**,
 * pas du moteur de cage : `helicalToCage` rejoue les contrôles de `computeHelicalLayout` (n, R_e >
 * r_i, d_f, Δθ) avant d'appeler la cage, et le contrôle de débord (`nosingReaches*`) est une copie
 * dans `stepping.ts` sous `helicalOrigin`. Le moteur de cage seul accepte un Δθ ≥ 180° (lacune
 * « contrôles », assertée par un test dédié) : à reporter dans le moteur avant la bascule (P2).
 *
 * Les champs `Stepping.soffits` (hélicoïdal) et `HeadroomAnalysis.selfCover` (cage) portent les
 * mêmes sous-faces à des emplacements différents (lacune « emplacement des sous-faces ») : leur
 * contenu est comparé en N3, l'emplacement est asserté à part.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { circularOpening, helicalHeadroomBound } from "../../headroom/helical.js";
import type { HelicalLayout } from "../../model/derived.js";
import { ProjectSchema, type HelicalLayoutSpec, type Project } from "../../model/project.js";
import { parseProjectText } from "../../project/parse.js";
import { createDemoProject } from "../../project/presetDemo.js";
import { createProject } from "../../project/presets.js";
import { computeStepping } from "../../stepping/stepping.js";
import { buildModel } from "../../pipeline/build.js";
import { computeLayout } from "../layout.js";
import { makeHelicalProject, type HelicalShape } from "../helical-test-helpers.js";
import {
  compareValues,
  gapPaths,
  gapSummary,
  helicalParity,
  helicalParityProjectArb,
  n5Projection,
  runHelical,
  tieOnReference,
  type Gaps,
  type ParityReport,
} from "./helical-parity-helpers.js";
import { computeCageLayout } from "./cage.js";
import { helicalToCage } from "./fromHelical.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../examples");
const loadExample = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

const HELICAL_EXAMPLES = [
  "j5a-helicoidal",
  "j5c-limon-central-helicoidal",
  "j5c-limon-central-bois-helicoidal",
  "demo-helical-glass",
  "demo-helical-well",
  "demo-central-glulam",
] as const;

/** Projet dont le tracé hélicoïdal est modifié (re-validé par le schéma). */
function withHelical(project: Project, patch: Partial<HelicalLayoutSpec>): Project {
  const layout = { ...(project.stair.layout as HelicalLayoutSpec), ...patch };
  const { width: _w, legs: _l, turns: _t, ...input } = layout;
  return ProjectSchema.parse({ ...project, stair: { ...project.stair, layout: input } });
}

/** Projet modifié au niveau de l'escalier (re-validé par le schéma). */
function withStair(project: Project, patch: Partial<Project["stair"]>): Project {
  const { width: _w, legs: _l, turns: _t, ...layout } = project.stair.layout as HelicalLayoutSpec;
  return ProjectSchema.parse({ ...project, stair: { ...project.stair, layout, ...patch } });
}

const j5a = (): Project => loadExample("j5a-helicoidal");
const shape = (s: Partial<HelicalShape>): Project =>
  makeHelicalProject({
    outerRadius: 1000,
    coreRadius: 100,
    direction: "left",
    floorToFloor: 2800,
    riserCount: 16,
    ...s,
  });

// ------------------------------------------------------------------ catalogue des cas

/** Cas : projet hélicoïdal et écarts attendus (chemins normalisés, voir l'en-tête). */
interface ParityCase {
  readonly name: string;
  readonly project: () => Project;
  /** Écarts attendus, par lacune ; vide : parité tenue. */
  readonly gaps?: Readonly<Partial<Record<"CUT" | "TIE" | "HALF", readonly string[]>>>;
}

/** CUT : nombre de sommets des contours (et des sous-faces) en écart. */
const CUT_COUNT = ["N2:treads[*].outline.length", "N3:soffits[*].outline.length"];
/** CUT : même nombre de sommets, sommets déplacés. */
const CUT_VERTICES = [
  "N2:treads[*].outline[*].x",
  "N2:treads[*].outline[*].y",
  "N3:soffits[*].outline[*].x",
  "N3:soffits[*].outline[*].y",
];
/** TIE : minimum sur Γ atteint (même valeur) en un autre point. */
const TIE_WALK = [
  "N4:headroom.walkline.at.x",
  "N4:headroom.walkline.at.y",
  "N4:headroom.walkline.at.z",
  "N4:headroom.walkline.s",
];
/** TIE : minimum sur Γ atteint (même valeur) au même point en plan, un tour plus haut ou plus bas. */
const TIE_WALK_TURN = ["N4:headroom.walkline.at.z", "N4:headroom.walkline.s"];

const CASES: readonly ParityCase[] = [
  // Exemples du dépôt (tous à palier d'arrivée, `treadsPerTurn`, sens `left`).
  ...HELICAL_EXAMPLES.map((name): ParityCase => ({
    name: `exemple ${name}`,
    project: () => loadExample(name),
  })),
  // Les mêmes, privés de leur palier (isole la lacune du palier d'arrivée).
  ...HELICAL_EXAMPLES.map((name): ParityCase => ({
    name: `exemple ${name} sans palier`,
    project: () => withHelical(loadExample(name), { landing: undefined }),
    ...(name === "j5a-helicoidal" ? { gaps: { TIE: TIE_WALK } } : {}),
  })),
  { name: "préréglage helical", project: () => createProject("helical") },
  { name: "démo demo-helical-glass", project: () => createDemoProject("demo-helical-glass") },
  { name: "démo demo-helical-well", project: () => createDemoProject("demo-helical-well") },
  { name: "démo demo-central-glulam", project: () => createDemoProject("demo-central-glulam") },
  // Sens, angle de départ, placement quelconque.
  {
    name: "sens droite, départ 37°, placement (1 234 ; −567) −110°",
    project: () =>
      withStair(withHelical(j5a(), { direction: "right", startAngle: 37 }), {
        placement: { origin: { x: 1234, y: -567 }, rotation: -110 },
      }),
  },
  {
    name: "sens gauche, départ 37°, placement (1 234 ; −567) −110°",
    project: () =>
      withStair(withHelical(j5a(), { startAngle: 37 }), {
        placement: { origin: { x: 1234, y: -567 }, rotation: -110 },
      }),
  },
  // Mode `angle`.
  // 90° : Δθ = 6°, d / sin Δθ = 191 mm > r_i = 100 mm (CUT).
  {
    name: "angle 90°",
    project: () => shape({ totalAngle: 90, nosing: 20, landingAngle: 30 }),
    gaps: { CUT: CUT_VERTICES },
  },
  ...[270, 359, 360].map((deg): ParityCase => ({
    name: `angle ${deg}°`,
    project: () => shape({ totalAngle: deg, nosing: 20, landingAngle: 30 }),
  })),
  ...[450, 720].map((deg): ParityCase => ({
    name: `angle ${deg}°`,
    project: () => shape({ totalAngle: deg, nosing: 20, landingAngle: 30 }),
    gaps: { TIE: TIE_WALK },
  })),
  {
    name: "angle 2 160° (n = 60)",
    project: () =>
      shape({
        totalAngle: 2160,
        riserCount: 60,
        floorToFloor: 10500,
        nosing: 20,
        landingAngle: 30,
      }),
    gaps: { TIE: TIE_WALK },
  },
  {
    name: "angle 359°, débord au-dessus du départ, sens droite",
    project: () => shape({ totalAngle: 359, nosing: 30, direction: "right" }),
  },
  // Mode `treadsPerTurn`.
  {
    name: "N = 3 (Δθ = 120°)",
    project: () => shape({ treadsPerTurn: 3, riserCount: 7, nosing: 10 }),
    gaps: { TIE: TIE_WALK_TURN },
  },
  {
    name: "N = 12, n = 13 (Θ = 360° exact)",
    project: () => shape({ treadsPerTurn: 12, riserCount: 13, nosing: 0 }),
  },
  { name: "N = 60", project: () => shape({ treadsPerTurn: 60, riserCount: 24, coreRadius: 300 }) },
  // Fût contre jour central, même géométrie.
  { name: "fût central", project: () => shape({ core: "column", treadsPerTurn: 14 }) },
  { name: "jour central", project: () => shape({ core: "well", treadsPerTurn: 14 }) },
  // Ligne de foulée.
  {
    name: "ligne de foulée fromInner 300",
    project: () => shape({ walklineFromInner: 300 }),
    gaps: { TIE: TIE_WALK },
  },
  {
    name: "DTU, E ≤ seuil (E = 1 200)",
    project: () => shape({ outerRadius: 1300, coreRadius: 100 }),
    gaps: { TIE: TIE_WALK },
  },
  {
    name: "DTU, E > seuil (E = 1 400)",
    project: () => shape({ outerRadius: 1500, coreRadius: 100 }),
  },
  {
    name: "côté de Γ choisi à l'extérieur dans le projet source",
    project: () =>
      withStair(shape({ treadsPerTurn: 13 }), { walkline: { mode: "dtu", side: "right" } }),
  },
  // Débord de nez.
  { name: "débord 0", project: () => shape({ nosing: 0, landingAngle: 60 }) },
  { name: "débord 30", project: () => shape({ nosing: 30, landingAngle: 60 }) },
  {
    name: "débord proche de r_i (r_i = 50, d = 40, Δθ = 30°)",
    project: () => shape({ coreRadius: 50, outerRadius: 950, nosing: 40, treadsPerTurn: 12 }),
    gaps: { CUT: CUT_COUNT },
  },
  // Palier d'arrivée.
  {
    name: "palier qui recouvre la montée (Θ = 300°, Λ = 90°)",
    project: () => shape({ totalAngle: 300, landingAngle: 90 }),
  },
  {
    name: "palier sans recouvrement (Θ = 180°, Λ = 45°)",
    project: () => shape({ totalAngle: 180, landingAngle: 45 }),
  },
  // Trémies.
  { name: "sans trémie", project: () => shape({ treadsPerTurn: 13, landingAngle: 45 }) },
  {
    name: "trémie rectangulaire",
    project: () =>
      shape({
        treadsPerTurn: 13,
        landingAngle: 45,
        opening: { kind: "rect", x: -1100, y: -1100, sizeX: 2200, sizeY: 1100 },
      }),
  },
  {
    name: "trémie circulaire",
    project: () =>
      shape({
        treadsPerTurn: 13,
        landingAngle: 45,
        opening: circularOpening({ x: 0, y: 0 }, 1050),
      }),
  },
  {
    name: "deux tours sans trémie",
    project: () => shape({ totalAngle: 720, riserCount: 25, floorToFloor: 4400 }),
    gaps: { TIE: TIE_WALK },
  },
  // Hauteurs non régulières, réglages des escaliers à volées.
  { name: "firstRiseOffset 12", project: () => shape({ firstRiseOffset: 12 }) },
  {
    name: "giron cible saisi",
    project: () =>
      withStair(shape({}), {
        stepping: { ...shape({}).stair.stepping, targetGoing: 250 },
      }),
  },
  {
    name: "surcharges de nez fixe et angle",
    project: () =>
      withStair(shape({}), {
        nosingOverrides: [
          { kind: "fixed", index: 3 },
          { kind: "angle", index: 5, angle: 7 },
        ],
      }),
  },
];

/** Cas d'erreur : même niveau, même nom, même clé et mêmes paramètres. */
const ERROR_CASES: readonly { name: string; project: () => Project; key: string }[] = [
  {
    name: "Δθ ≥ 180° (angle 400°, n = 3)",
    project: () => shape({ totalAngle: 400, riserCount: 3 }),
    key: "layout.helical.invalidStepAngle",
  },
  {
    name: "R_e ≤ r_i (projet construit hors schéma)",
    project: () => {
      const p = j5a();
      const l = p.stair.layout as HelicalLayoutSpec;
      return { ...p, stair: { ...p.stair, layout: { ...l, outerRadius: 70, width: 0 } } };
    },
    key: "layout.helical.outerRadiusBelowColumn",
  },
  {
    name: "R_e ≤ r_i, jour central (hors schéma)",
    project: () => {
      const p = shape({ core: "well" });
      const l = p.stair.layout as HelicalLayoutSpec;
      return { ...p, stair: { ...p.stair, layout: { ...l, outerRadius: 90, width: -10 } } };
    },
    key: "layout.helical.outerRadiusBelowWell",
  },
  {
    name: "d_f hors emmarchement (fromInner ≥ E)",
    project: () => shape({ walklineFromInner: 900 }),
    key: "layout.walklineOutsideWidth",
  },
  {
    name: "débord ≥ r_i (fût)",
    project: () => shape({ coreRadius: 50, outerRadius: 950, nosing: 50 }),
    key: "stepping.helical.nosingReachesColumn",
  },
  {
    name: "débord ≥ r_i (jour)",
    project: () => shape({ core: "well", coreRadius: 50, outerRadius: 950, nosing: 60 }),
    key: "stepping.helical.nosingReachesWell",
  },
  {
    name: "n hors domaine",
    project: () =>
      withStair(shape({}), {
        stepping: { ...shape({}).stair.stepping, riserCount: "auto", targetRise: 10 },
      }),
    key: "layout.riserCountOutOfRange",
  },
];

/** Chemins en écart attendus d'un cas. */
const expectedOf = (c: ParityCase): string[] =>
  [...new Set(Object.values(c.gaps ?? {}).flat())].sort();

const reports = new Map<string, ParityReport>();
const reportOf = (c: ParityCase): ParityReport => {
  let r = reports.get(c.name);
  if (!r) {
    r = helicalParity(c.project());
    reports.set(c.name, r);
  }
  return r;
};

// ------------------------------------------------------------------ tests

describe("parité hélicoïdal / cage (F10, P1) — comparateur", () => {
  it("détecte un écart de sommet, de longueur, de clé et de champ manquant", () => {
    const out: Gaps = new Map();
    compareValues(
      { a: [{ x: 0, y: 0 }], k: "x", m: { key: "k", params: { v: 1 } }, startAngle: Math.PI },
      {
        a: [{ x: 2e-6, y: 0 }],
        k: "y",
        m: { key: "k", params: { v: 1 } },
        extra: 1,
        startAngle: -Math.PI,
      },
      "",
      out,
    );
    compareValues([1, 2], [1], "t", out);
    expect(gapPaths(out)).toEqual(["a[*].x", "extra:extra", "k", "t.length"]);
    // Tolérances : 1e-6 mm, 1e-9 rad ; angle de départ modulo 2π ; altitude d'un nez exacte.
    const ok: Gaps = new Map();
    compareValues(
      { x: 1, sweep: 1, nosings: [{ z: 1 }] },
      { x: 1 + 9e-7, sweep: 1 + 9e-10, nosings: [{ z: 1 }] },
      "",
      ok,
    );
    expect(gapPaths(ok)).toEqual([]);
    const z: Gaps = new Map();
    compareValues({ nosings: [{ z: 1 }] }, { nosings: [{ z: 1 + 1e-12 }] }, "", z);
    expect(gapPaths(z)).toEqual(["nosings[*].z"]);
  });
});

describe("parité hélicoïdal / cage (F10, P1) — cas", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = reportOf(c);
    if (process.env.PARITY_MEASURE) console.log(c.name, JSON.stringify(gapSummary(r.gaps)));
    expect(r.helical.error).toBeUndefined();
    expect(r.cage.error).toBeUndefined();
    expect(gapPaths(r.gaps)).toEqual(expectedOf(c));
  });

  it("emplacement des sous-faces : `Stepping.soffits` (hélicoïdal), étape d'échappée (cage)", () => {
    for (const c of CASES) {
      const r = reportOf(c);
      expect(r.helical.stepping?.soffits, c.name).toBeDefined();
      expect(r.cage.stepping?.soffits, c.name).toBeUndefined();
      expect(r.cage.headroom?.selfCover, c.name).toEqual(r.cage.soffits);
    }
  });

  it("écart TIE : la valeur du minimum est identique, seul son emplacement diffère", () => {
    for (const c of CASES) {
      const r = reportOf(c);
      const a = r.helical.headroom;
      const b = r.cage.headroom;
      if (!a || !b) continue;
      if (a.walkline && b.walkline) {
        expect(Math.abs(a.walkline.min - b.walkline.min), c.name).toBeLessThanOrEqual(1e-6);
      }
      // Emplacement en écart : vérifié comme minimum ex æquo de la référence.
      if (c.gaps?.TIE) expect(tieOnReference(r.helical, r.cage).walkline, c.name).toBe(true);
    }
  });
});

describe("parité hélicoïdal / cage (F10, P1) — erreurs", () => {
  it.each(ERROR_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = helicalParity(c.project());
    expect(r.helical.error).toBeDefined();
    const err = r.helical.error!.error.msg;
    expect(typeof err === "string" ? err : err.key).toBe(c.key);
    expect(gapPaths(r.gaps)).toEqual([]);
  });

  it("lacune « contrôles » : le moteur de cage seul accepte Δθ ≥ 180° (contrôle porté par la conversion)", () => {
    // Conversion d'un cas valide (400°, n = 16), puis n = 3 sur le projet converti : Δθ = 200°.
    // L'hélicoïdal lève `layout.helical.invalidStepAngle` (cas d'erreur ci-dessus) ; la cage,
    // appelée sans les contrôles de `helicalToCage`, calcule tracé et découpage sans erreur.
    // Écart attendu et documenté (QUESTIONS F10) : à reporter dans le moteur avant P2.
    const conv = helicalToCage(shape({ totalAngle: 400, riserCount: 16 }));
    const p = {
      ...conv.project,
      stair: { ...conv.project.stair, stepping: { ...conv.project.stair.stepping, riserCount: 3 } },
    };
    const layout = computeCageLayout(p, conv.spec, conv.options);
    const stepping = computeStepping(p, layout);
    expect(stepping.riserCount).toBe(3);
    expect(stepping.nosings).toHaveLength(3);
    const keys = stepping.notes.map((m) => (typeof m === "string" ? m : m.key));
    expect(keys).not.toContain("layout.helical.invalidStepAngle");
  });
});

describe("parité hélicoïdal / cage (F10, P1) — cotes des exemples (N5)", () => {
  // La projection N5 de l'hélicoïdal est celle de `buildModel` (donc des instantanés de
  // `pipeline/build.test.ts`, inchangés) ; la cage la retrouve à l'égalité stricte (cas ci-dessus).
  it.each(HELICAL_EXAMPLES.map((n) => [n] as const))("%s", (name) => {
    const project = loadExample(name);
    const m = buildModel(project, { memo: false });
    const fromModel = {
      ...n5Projection(m.stepping, null),
      headroom: m.headroom ? Math.round(m.headroom.min * 10) / 10 : null,
      headroomWidth: m.headroomWidth
        ? { min: Math.round(m.headroomWidth.min * 10) / 10, nosing: m.headroomWidth.nosing }
        : null,
    };
    const r = helicalParity(project);
    expect(n5Projection(r.helical.stepping!, r.helical.headroom)).toEqual(fromModel);
    expect(n5Projection(r.cage.stepping!, r.cage.headroom)).toEqual(fromModel);
  });
});

describe("parité hélicoïdal / cage (F10, P1) — cas inverse `cage-arc`", () => {
  // L'exemple `cage-arc` (axe en arc de 100°, rayon d'axe 2 150 mm au milieu, E = 900, n = 15)
  // écrit à la main en hélicoïdal (r_i = 1 700, R_e = 2 600, angle 100°, axe au centre de
  // l'arc). Moteur hélicoïdal contre l'instantané existant de `cage-arc` (`buildModel`, cage
  // saisie, origine `cage`) : mêmes cotes, sauf la **nature des marches** (lacune consignée,
  // question F10) : une cage saisie classe les marches d'un axe en arc en `straight`
  // (« ssss… », sans collet listé), l'hélicoïdal en `winder` (« wwww… », collets listés).
  it("mêmes cotes sauf la nature des marches et les collets qui en dépendent", () => {
    const cageArc = loadExample("cage-arc");
    const helical = ProjectSchema.parse({
      ...cageArc,
      stair: {
        ...cageArc.stair,
        placement: { origin: { x: -1700, y: 0 }, rotation: 0 },
        layout: {
          kind: "helical",
          direction: "left",
          outerRadius: 2600,
          core: { kind: "well", radius: 1700 },
          sweep: { mode: "angle", degrees: 100 },
          startAngle: 0,
        },
      },
    });
    const ref = runHelical(helical);
    const m = buildModel(cageArc, { memo: false });
    const a = n5Projection(ref.stepping!, ref.headroom);
    const b = {
      ...n5Projection(m.stepping, null),
      headroom: m.headroom ? Math.round(m.headroom.min * 10) / 10 : null,
      headroomWidth: m.headroomWidth
        ? { min: Math.round(m.headroomWidth.min * 10) / 10, nosing: m.headroomWidth.nosing }
        : null,
    };
    const differing = (Object.keys(a) as (keyof typeof a)[]).filter(
      (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
    );
    expect(differing).toEqual(["treads", "colletsChord", "colletMin"]);
    expect(a.treads).toBe("w".repeat(14));
    expect(b.treads).toBe("s".repeat(14));
  });
});

describe("parité hélicoïdal / cage (F10, P1) — aiguillage inchangé", () => {
  it("computeLayout et computeStepping passent toujours par le moteur hélicoïdal", () => {
    const p = j5a();
    const layout = computeLayout(p);
    expect(layout.helical).toBeDefined();
    expect(layout.helicalOrigin).toBeUndefined();
    expect(layout.sections).toBeUndefined();
    expect(computeStepping(p, layout).helical).toBe(true);
    expect(buildModel(p, { memo: false }).layout.helical).toBeDefined();
  });
});

describe("parité hélicoïdal / cage (F10, P1) — échappée et règle dérivée", () => {
  // Sous les hypothèses de `helicalHeadroomBound` (hauteurs régulières, aucune trémie, N
  // entier), l'échappée de la cage retrouve la borne dérivée à 1e-6 près, comme l'hélicoïdal
  // (`headroom/helical.test.ts`).
  it("borne dérivée retrouvée par la cage", () => {
    fc.assert(
      fc.property(
        fc.record({
          treadsPerTurn: fc.integer({ min: 8, max: 16 }),
          riserCount: fc.integer({ min: 18, max: 24 }),
          nosing: fc.integer({ min: 0, max: 25 }),
          landing: fc.integer({ min: 0, max: 180 }),
          direction: fc.constantFrom("left" as const, "right" as const),
        }),
        (s) => {
          const project = shape({
            treadsPerTurn: s.treadsPerTurn,
            riserCount: s.riserCount,
            nosing: s.nosing,
            floorToFloor: 3600,
            direction: s.direction,
            ...(s.landing > 0 ? { landingAngle: s.landing } : {}),
          });
          const r = helicalParity(project);
          const h = r.helical.layout!.helical as HelicalLayout;
          const bound = helicalHeadroomBound({
            riserCount: s.riserCount,
            rise: r.helical.stepping!.rise,
            stepAngle: h.stepAngle,
            walklineRadius: h.walklineRadius,
            treadThickness: project.stair.treads.thickness,
            nosing: s.nosing,
            landingAngle: h.landingAngle,
          });
          const cageMin = r.cage.headroom?.walkline?.min ?? null;
          if (bound.min === null) expect(cageMin).toBeNull();
          else expect(Math.abs(cageMin! - bound.min)).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ------------------------------------------------------------------ propriété

/** Valeur à mi-chemin de deux arrondis au pas `step` (à 1e-6 près, relatif au pas). */
const atHalf = (x: number, step: number): boolean => {
  const f = x / step - Math.floor(x / step);
  return Math.abs(f - 0.5) < 1e-6;
};

/**
 * Écarts que prévoient les lacunes pour un tirage (voir l'en-tête) : `allowed` (chemins admis)
 * et `required` (au moins un chemin de chaque groupe doit apparaître).
 */
function predictedGaps(
  project: Project,
  r: ParityReport,
): { allowed: Set<string>; required: string[][] } {
  const allowed = new Set<string>();
  const required: string[][] = [];
  const h = r.helical.layout?.helical;
  const st = r.helical.stepping;
  if (!h || !st) return { allowed, required };
  const d = project.stair.treads.nosing;
  // CUT : la ligne d'appui du nez k + 1 (parallèle à son rayon, décalée de d) coupe le rayon du
  // nez k + 2 au rayon ρ = d / sin Δθ, à l'abscisse d·cot Δθ le long de la ligne : avant le
  // bord intérieur (donc coupure par la cage) si Δθ < 90° et r_i < ρ < R_e.
  const rho = d / Math.sin(h.stepAngle);
  const cut =
    d > 0 &&
    st.riserCount >= 3 &&
    h.stepAngle < Math.PI / 2 &&
    rho > h.innerRadius &&
    rho < h.outerRadius;
  if (cut) {
    const outline = [
      "N2:treads[*].outline.length",
      "N2:treads[*].outline[*].x",
      "N2:treads[*].outline[*].y",
      "N3:soffits[*].outline.length",
      "N3:soffits[*].outline[*].x",
      "N3:soffits[*].outline[*].y",
    ];
    // Contours et sous-faces seulement : l'échappée reste stricte (voir l'en-tête).
    outline.forEach((p) => allowed.add(p));
    required.push(outline);
  }
  // TIE : emplacement du minimum, admis seulement si la cage tombe sur un minimum ex æquo de
  // la référence (`tieOnReference` : même valeur, vissage d'un nombre entier de marches).
  const a = r.helical.headroom;
  const tie = tieOnReference(r.helical, r.cage);
  if (tie.walkline) {
    for (const k of ["at.x", "at.y", "at.z", "s"]) allowed.add(`N4:headroom.walkline.${k}`);
  }
  if (tie.width) {
    for (const k of ["at.x", "at.y", "at.z", "nosing"]) allowed.add(`N4:headroom.width.${k}`);
    // Cote N5 `headroomWidth` = { min, nosing } : seul l'indice du nez peut différer.
    allowed.add("N5:headroomWidth");
  }
  // HALF : arrondis à mi-pas (remarques au dixième, cotes r1 / r2).
  const deg = 180 / Math.PI;
  const summary: Record<string, number> = {
    stepAngle: h.stepAngle * deg,
    treadsPerTurn: h.treadsPerTurn,
    totalAngle: h.totalAngle * deg,
    going: st.going,
    walklineRadius: h.walklineRadius,
    collet: h.innerRadius * h.stepAngle,
  };
  for (const [k, v] of Object.entries(summary)) {
    if (atHalf(v, 0.1)) allowed.add(`N2:notes[*].params.${k}.num`);
  }
  if (atHalf(st.going, 0.1)) allowed.add("N2:notes[*].params.going.num");
  const r2Keys: Record<string, number> = {
    h: st.rise,
    firstRise: st.rises[0]!,
    g: st.going,
    blondel: st.blondel,
  };
  for (const [k, v] of Object.entries(r2Keys)) if (atHalf(v, 0.01)) allowed.add(`N5:${k}`);
  if (atHalf(st.run, 0.1)) allowed.add("N5:run");
  if (a?.walkline && atHalf(a.walkline.min, 0.1)) allowed.add("N5:headroom");
  if (a?.width && atHalf(a.width.min, 0.1)) allowed.add("N5:headroomWidth");
  if (st.treads.some((t) => atHalf(t.colletChord, 0.1))) {
    allowed.add("N5:colletsChord");
    allowed.add("N5:colletMin");
  }
  return { allowed, required };
}

describe("parité hélicoïdal / cage (F10, P1) — propriété", () => {
  it("chaque tirage tombe sur les écarts prévus par les lacunes, et seulement eux", () => {
    fc.assert(
      fc.property(helicalParityProjectArb, (project) => {
        const r = helicalParity(project);
        const { allowed, required } = predictedGaps(project, r);
        const paths = gapPaths(r.gaps);
        const unexpected = paths.filter((p) => !allowed.has(p));
        expect(unexpected, JSON.stringify(gapSummary(r.gaps))).toEqual([]);
        for (const group of required) {
          expect(
            paths.some((p) => group.includes(p)),
            group.join(", "),
          ).toBe(true);
        }
      }),
      { numRuns: Number(process.env.HELICAL_PARITY_RUNS ?? 250) },
    );
  }, 600_000);
});
