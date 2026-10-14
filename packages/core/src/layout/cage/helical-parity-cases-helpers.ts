/**
 * Catalogue des cas de parité hélicoïdal / cage (F10, sous-lots P1 et P2), partagé par
 * `helicalParity.test.ts` (tracé, découpage, échappée) et `pipeline/helicalSwitch.parity.test.ts`
 * (`Model` entier) : exemples du dépôt (avec et sans palier), préréglage, démos, formes
 * synthétiques, cas d'erreur. Assistant de test, non exporté par le paquet (garde-fou de
 * `layout/legacyHelical.test.ts`). Les écarts attendus (`gaps`) sont ceux du niveau tracé /
 * découpage (chemins `N2:` / `N3:`, voir `helical-parity-helpers.ts`).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { circularOpening } from "../../headroom/helical.js";
import { ProjectSchema, type HelicalLayoutSpec, type Project } from "../../model/project.js";
import { parseProjectText } from "../../project/parse.js";
import { createDemoProject } from "../../project/presetDemo.js";
import { createProject } from "../../project/presets.js";
import { makeHelicalProject, type HelicalShape } from "../helical-test-helpers.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../examples");
export const loadExample = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

export const HELICAL_EXAMPLES = [
  "j5a-helicoidal",
  "j5c-limon-central-helicoidal",
  "j5c-limon-central-bois-helicoidal",
  "demo-helical-glass",
  "demo-helical-well",
  "demo-central-glulam",
] as const;

/** Projet dont le tracé hélicoïdal est modifié (re-validé par le schéma). */
export function withHelical(project: Project, patch: Partial<HelicalLayoutSpec>): Project {
  const layout = { ...(project.stair.layout as HelicalLayoutSpec), ...patch };
  const { width: _w, legs: _l, turns: _t, ...input } = layout;
  return ProjectSchema.parse({ ...project, stair: { ...project.stair, layout: input } });
}

/** Projet modifié au niveau de l'escalier (re-validé par le schéma). */
export function withStair(project: Project, patch: Partial<Project["stair"]>): Project {
  const { width: _w, legs: _l, turns: _t, ...layout } = project.stair.layout as HelicalLayoutSpec;
  return ProjectSchema.parse({ ...project, stair: { ...project.stair, layout, ...patch } });
}

export const j5a = (): Project => loadExample("j5a-helicoidal");
export const shape = (s: Partial<HelicalShape>): Project =>
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
export interface ParityCase {
  readonly name: string;
  readonly project: () => Project;
  /** Écarts attendus, par lacune ; vide : parité tenue. */
  readonly gaps?: Readonly<Partial<Record<"CUT" | "HALF", readonly string[]>>>;
}

/** CUT : nombre de sommets des contours (et des sous-faces) en écart. */
export const CUT_COUNT = ["N2:treads[*].outline.length", "N3:soffits[*].outline.length"];
/** CUT : même nombre de sommets, sommets déplacés. */
export const CUT_VERTICES = [
  "N2:treads[*].outline[*].x",
  "N2:treads[*].outline[*].y",
  "N3:soffits[*].outline[*].x",
  "N3:soffits[*].outline[*].y",
];
/**
 * Anciens cas TIE (P1) : minimum d'échappée atteint, à 1e-6 près, en plusieurs points ; la cage
 * et l'hélicoïdal départageaient différemment selon le bruit. Depuis la décision F10 (3)
 * (`selfcover.ts`, premier minimum en montant à `HEADROOM_TIE_TOL` près), plus aucun écart :
 * la table de ces cas est vide, et le test « ex æquo » vérifie le départage.
 */
export const FORMER_TIE = new Set<string>();
const formerTie = (name: string): string => {
  FORMER_TIE.add(name);
  return name;
};

export const HELICAL_PARITY_CASES: readonly ParityCase[] = [
  // Exemples du dépôt (tous à palier d'arrivée, `treadsPerTurn`, sens `left`).
  ...HELICAL_EXAMPLES.map((name): ParityCase => ({
    name: `exemple ${name}`,
    project: () => loadExample(name),
  })),
  // Les mêmes, privés de leur palier (isole la lacune du palier d'arrivée).
  ...HELICAL_EXAMPLES.map((name): ParityCase => ({
    name:
      name === "j5a-helicoidal"
        ? formerTie(`exemple ${name} sans palier`)
        : `exemple ${name} sans palier`,
    project: () => withHelical(loadExample(name), { landing: undefined }),
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
    name: formerTie(`angle ${deg}°`),
    project: () => shape({ totalAngle: deg, nosing: 20, landingAngle: 30 }),
  })),
  {
    name: formerTie("angle 2 160° (n = 60)"),
    project: () =>
      shape({
        totalAngle: 2160,
        riserCount: 60,
        floorToFloor: 10500,
        nosing: 20,
        landingAngle: 30,
      }),
  },
  {
    name: "angle 359°, débord au-dessus du départ, sens droite",
    project: () => shape({ totalAngle: 359, nosing: 30, direction: "right" }),
  },
  // Mode `treadsPerTurn`.
  {
    name: formerTie("N = 3 (Δθ = 120°)"),
    project: () => shape({ treadsPerTurn: 3, riserCount: 7, nosing: 10 }),
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
    name: formerTie("ligne de foulée fromInner 300"),
    project: () => shape({ walklineFromInner: 300 }),
  },
  {
    name: formerTie("DTU, E ≤ seuil (E = 1 200)"),
    project: () => shape({ outerRadius: 1300, coreRadius: 100 }),
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
    name: formerTie("deux tours sans trémie"),
    project: () => shape({ totalAngle: 720, riserCount: 25, floorToFloor: 4400 }),
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
export const HELICAL_PARITY_ERROR_CASES: readonly {
  name: string;
  project: () => Project;
  key: string;
}[] = [
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
