/**
 * Assemblage du pipeline (ADR-0002) : `buildModel(project) → Model`.
 *
 *   computeLayout → computeStepping → pièces de base → échappée → contrôle de conception
 *
 * - **Aucune exception** pour des paramètres impossibles : l'erreur de l'étape (message
 *   français de `LayoutError` / `SteppingError`, ou erreur interne) est ajoutée à
 *   `Model.errors` et les étapes suivantes reçoivent un résultat vide. Le modèle rendu est
 *   partiel mais cohérent : tracé vide si le tracé échoue, découpage vide (hauteurs seules si
 *   elles sont calculables) si le découpage échoue, et un contrôle de conception toujours
 *   présent (règles non calculables `non-evaluee`).
 * - **Mémoïsation** par identité : le modèle d'un même projet (objet immuable) est rendu tel
 *   quel ; sinon chaque étape réutilise son dernier résultat si ses dépendances (sous-objets du
 *   projet et étapes amont) sont les mêmes objets.
 */
import { computeHeadroom, type HeadroomAnalysis } from "../headroom/headroom.js";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import type { ComplianceReport, Layout, Model, Part, Stepping } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildBasicParts } from "../parts/basic.js";
import { fmt } from "../rules/check.js";
import { evaluateComplianceDetailed } from "../rules/engine.js";
import { SteppingError } from "../stepping/errors.js";
import { computeRises } from "../stepping/rises.js";
import { computeStepping } from "../stepping/stepping.js";
import { LastValueCache } from "./memo.js";

/** Résultat d'une étape : valeur ou message d'erreur. */
type Stage<T> =
  | { readonly value: T; readonly error?: undefined }
  | { readonly value?: undefined; readonly error: string };

const STAGE_LABELS = {
  layout: "Tracé",
  stepping: "Découpage",
  parts: "Pièces",
  headroom: "Échappée",
  compliance: "Contrôle de conception",
} as const;

function attempt<T>(label: string, fn: () => T): Stage<T> {
  try {
    return { value: fn() };
  } catch (e) {
    if (e instanceof LayoutError || e instanceof SteppingError) return { error: e.message };
    const detail = e instanceof Error ? e.message : String(e);
    return { error: `${label} : erreur interne (${detail}).` };
  }
}

const EMPTY_CURVE = { segments: [] } as const;

/** Tracé vide (étape « Tracé » en échec). */
export const EMPTY_LAYOUT: Layout = {
  inner: EMPTY_CURVE,
  outer: EMPTY_CURVE,
  walkline: EMPTY_CURVE,
  walklineOffset: Number.NaN,
  footprint: [],
  turns: [],
  innerSide: "left",
};

/** Découpage vide ; les hauteurs sont reprises si elles sont calculables. */
function emptyStepping(project: Project): Stepping {
  let rises: readonly number[] = [];
  let rise = Number.NaN;
  try {
    const r = computeRises(project);
    rises = r.rises;
    rise = r.rise;
  } catch {
    // Hauteurs impossibles : l'erreur est déjà rapportée par l'étape en échec.
  }
  return {
    riserCount: rises.length,
    rises,
    rise,
    going: Number.NaN,
    blondel: Number.NaN,
    run: Number.NaN,
    nosings: [],
    treads: [],
    balancedZones: [],
    notes: [],
  };
}

interface PartsStage {
  readonly parts: readonly Part[];
  readonly notes: readonly string[];
}

interface ComplianceStage {
  readonly report: ComplianceReport;
}

/** Caches par étape (dernier résultat). */
const caches = {
  layout: new LastValueCache<Stage<Layout>>(),
  stepping: new LastValueCache<Stage<Stepping>>(),
  parts: new LastValueCache<Stage<PartsStage>>(),
  headroom: new LastValueCache<Stage<HeadroomAnalysis | null>>(),
  compliance: new LastValueCache<Stage<ComplianceStage>>(),
};
let models = new WeakMap<Project, Model>();

/** Vide les caches (tests, mesures de performance). */
export function clearModelCache(): void {
  for (const c of Object.values(caches)) c.clear();
  models = new WeakMap();
}

/** Compteurs de réutilisation des étapes (diagnostic, tests de mémoïsation). */
export function modelCacheStats(): Readonly<
  Record<keyof typeof caches, { hits: number; misses: number }>
> {
  const out = {} as Record<keyof typeof caches, { hits: number; misses: number }>;
  for (const [k, c] of Object.entries(caches) as [keyof typeof caches, LastValueCache<unknown>][]) {
    out[k] = { hits: c.hits, misses: c.misses };
  }
  return out;
}

export interface BuildModelOptions {
  /** `false` : recalcul complet sans lire ni remplir les caches (mesures). Défaut : `true`. */
  readonly memo?: boolean;
}

/** Plus grande échappée minimale bloquante des règles d'échappée du rapport (mm). */
function headroomThreshold(report: ComplianceReport): number | null {
  let best: number | null = null;
  for (const r of report.results) {
    if (!r.ruleId.startsWith("ECHAPPEE_") || r.severity !== "bloquant") continue;
    if (typeof r.min === "number" && (best === null || r.min > best)) best = r.min;
  }
  return best;
}

/**
 * Calcule le modèle dérivé d'un projet. Ne lève pas d'exception pour des paramètres
 * impossibles : voir `Model.errors`.
 */
export function buildModel(project: Project, options: BuildModelOptions = {}): Model {
  const memo = options.memo !== false;
  if (memo) {
    const hit = models.get(project);
    if (hit) return hit;
  }
  const run = <R>(cache: LastValueCache<R>, keys: readonly unknown[], fn: () => R): R =>
    memo ? cache.get(keys, fn) : fn();

  const { site, stair } = project;
  const errors: string[] = [];
  const notes: string[] = [];

  // 1. Tracé.
  const layoutStage = run(
    caches.layout,
    [stair.layout, stair.placement, stair.walkline, stair.stepping, site.floorToFloor],
    () => attempt(STAGE_LABELS.layout, () => computeLayout(project)),
  );
  if (layoutStage.error !== undefined) errors.push(layoutStage.error);
  const layout = layoutStage.value;

  // 2. Découpage.
  const steppingStage: Stage<Stepping> | undefined = layout
    ? run(caches.stepping, [layout, stair, site.floorToFloor], () =>
        attempt(STAGE_LABELS.stepping, () => computeStepping(project, layout)),
      )
    : undefined;
  if (steppingStage?.error !== undefined) errors.push(steppingStage.error);
  const stepping = steppingStage?.value;
  const complete = layout !== undefined && stepping !== undefined;

  // 3. Pièces de base (structure `none` ; plugins de structure au jalon 3).
  let parts: readonly Part[] = [];
  if (complete) {
    const partsStage = run(caches.parts, [layout, stepping, stair.treads], () =>
      attempt(STAGE_LABELS.parts, () => buildBasicParts(project, layout, stepping)),
    );
    if (partsStage.error !== undefined) errors.push(partsStage.error);
    else {
      parts = partsStage.value.parts;
      notes.push(...partsStage.value.notes);
    }
  }
  if (stair.structure.kind !== "none") {
    notes.push(
      `Structure « ${stair.structure.kind} » : aucun plugin de structure disponible, seules les marches, contremarches et paliers sont générés.`,
    );
  }

  // 4. Échappée.
  let headroom: HeadroomAnalysis | null = null;
  if (complete) {
    const headroomStage = run(caches.headroom, [layout, stepping, site], () =>
      attempt(STAGE_LABELS.headroom, () => computeHeadroom(site, layout, stepping)),
    );
    if (headroomStage.error !== undefined) errors.push(headroomStage.error);
    else headroom = headroomStage.value;
  }
  const headroomMin = headroom?.walkline
    ? { min: headroom.walkline.min, at: headroom.walkline.at }
    : undefined;
  const headroomClear = headroom !== null && headroom.walkline === undefined;
  const incomplete = layout === undefined ? "layout" : stepping === undefined ? "stepping" : null;

  // 5. Contrôle de conception (toujours produit, éventuellement sur un modèle partiel).
  const layoutOut = layout ?? EMPTY_LAYOUT;
  const steppingOut = stepping ?? emptyStepping(project);
  const complianceStage = run(
    caches.compliance,
    [project.compliance, site, stair, project.rulesVersion, layoutOut, steppingOut, headroom],
    () =>
      attempt(STAGE_LABELS.compliance, () => ({
        report: evaluateComplianceDetailed({
          project,
          layout: layoutOut,
          stepping: steppingOut,
          ...(headroomMin ? { headroom: headroomMin } : {}),
          ...(headroomClear ? { headroomClear } : {}),
          ...(incomplete ? { incomplete } : {}),
        }).report,
      })),
  );
  let compliance: ComplianceReport;
  if (complianceStage.error !== undefined) {
    errors.push(complianceStage.error);
    compliance = {
      rulesVersion: project.rulesVersion,
      contexts: [],
      profile: project.compliance.profile,
      results: [],
      summary: { bloquant: 0, avertissement: 0, conseil: 0 },
    };
  } else compliance = complianceStage.value.report;

  // Échappée sur la largeur des marches : avertissement (CHALLENGE G4), hors rules.yaml.
  const width = headroom?.width;
  if (width) {
    const threshold = headroomThreshold(compliance);
    if (threshold !== null && width.min < threshold) {
      // Le nez k porte le dessus de la marche k + 1 (M<k+1>) ; le dernier est le nez d'arrivée.
      const where =
        width.nosing === steppingOut.nosings.length - 1
          ? "au nez d'arrivée"
          : `au nez de la marche ${width.nosing + 1}`;
      notes.push(
        `Avertissement : échappée sur la largeur des marches de ${fmt(width.min)} mm ${where} (< ${fmt(threshold, 0)} mm exigés sur la ligne de foulée) ; grandeur non réglementaire (CHALLENGE G4).`,
      );
    }
  }

  const model: Model = {
    layout: layoutOut,
    stepping: steppingOut,
    parts,
    compliance,
    ...(headroomMin ? { headroom: headroomMin } : {}),
    ...(width ? { headroomWidth: width } : {}),
    errors,
    ...(notes.length > 0 ? { notes } : {}),
  };
  if (memo) models.set(project, model);
  return model;
}
