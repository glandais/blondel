/**
 * Assemblage du pipeline (ADR-0002) : `buildModel(project) → Model`.
 *
 *   computeLayout → computeStepping → pièces de base → structure (plugin) → garde-corps
 *   → échappée → contrôle de conception (+ contrôles du plugin de structure et des garde-corps)
 *
 * - **Aucune exception** pour des paramètres impossibles : l'erreur de l'étape (message
 *   français de `LayoutError` / `SteppingError`, ou erreur interne) est ajoutée à
 *   `Model.errors` et les étapes suivantes reçoivent un résultat vide. Le modèle rendu est
 *   partiel mais cohérent : tracé vide si le tracé échoue, découpage vide (hauteurs seules si
 *   elles sont calculables) si le découpage échoue, et un contrôle de conception toujours
 *   présent (règles non calculables `non-evaluee`).
 * - **Structure** (`stair.structure.kind`) : `none` = pièces de base seules ; sinon le plugin
 *   enregistré (`structures/registry.ts`) est appelé avec ses paramètres par défaut
 *   (`defaults(ctx)`) surchargés par `structure.params` puis validés par son `paramsSchema`.
 *   Ses pièces remplacent les pièces de base de même `id` et s'ajoutent aux autres ; ses
 *   contrôles remplacent le résultat « sans évaluateur » du moteur pour une règle de
 *   rules.yaml et s'ajoutent sinon ; ses erreurs vont dans `Model.errors`, ses remarques dans
 *   `Model.notes`. Plugin inconnu : remarque, pièces de base seules. Les pièces bois reçoivent
 *   les grandeurs de nomenclature normalisées (`structures/quantities.ts`, profil d'atelier).
 * - **Garde-corps** (`project.guards`, jalon 4, `guards/compute.ts`) : absent = aucune pièce
 *   ni analyse (règles GC_* / MC_* « non évaluées ») ; présent, lignes de garde-corps de volée
 *   (côtés vides) et de trémie, mains courantes, pièces ajoutées au modèle ; l'analyse est
 *   transmise au contrôle de conception (`ComplianceInput.guards`) et ses contrôles hors table
 *   (câbles) s'ajoutent au rapport. Paramètres impossibles : `GuardError` dans `Model.errors` ;
 *   ligne isolée impossible (jour plus étroit que la sphère T1) : `GuardsAnalysis.errors` repris
 *   dans `Model.errors`, les autres lignes sont produites.
 * - **Mémoïsation** par identité : le modèle d'un même projet (objet immuable) est rendu tel
 *   quel ; sinon chaque étape réutilise son dernier résultat si ses dépendances (sous-objets du
 *   projet et étapes amont) sont les mêmes objets.
 */
import { computeHeadroom, type HeadroomAnalysis } from "../headroom/headroom.js";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import type {
  ComplianceReport,
  Layout,
  Model,
  ModelPrecheck,
  Part,
  RuleResult,
  Severity,
  Stepping,
} from "../model/derived.js";
import type { StructureContext, StructureKind } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { buildBasicParts } from "../parts/basic.js";
import { precheckStringers, structurePrecheckSettings } from "../precheck/stringers.js";
import { fmt } from "../rules/check.js";
import { evaluateComplianceDetailed, unknownOverrideNote } from "../rules/engine.js";
import { findRule } from "../rules/table.js";
import { guardChecks } from "../guards/checks.js";
import { computeGuards } from "../guards/compute.js";
import { GuardError } from "../guards/errors.js";
import type { GuardsAnalysis } from "../guards/types.js";
import { getStructure, StructureError } from "../structures/index.js";
import { normalizeWoodQuantities } from "../structures/quantities.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
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
  structure: "Structure",
  guards: "Garde-corps",
  headroom: "Échappée",
  compliance: "Contrôle de conception",
} as const;

function attempt<T>(label: string, fn: () => T): Stage<T> {
  try {
    return { value: fn() };
  } catch (e) {
    if (
      e instanceof LayoutError ||
      e instanceof SteppingError ||
      e instanceof StructureError ||
      e instanceof GuardError
    )
      return { error: e.message };
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

interface StructureStage {
  readonly parts: readonly Part[];
  readonly checks: readonly RuleResult[];
  readonly notes: readonly string[];
  readonly errors: readonly string[];
  /** Classe d'exécution EN 1090-2 déduite par le plugin (métal), reportée dans `Model`. */
  readonly executionClass?: "EXC1" | "EXC2";
  /** Prédimensionnement indicatif des limons, reporté dans `Model.precheck`. */
  readonly precheck?: ModelPrecheck;
}

interface ComplianceStage {
  readonly report: ComplianceReport;
}

/**
 * Prédimensionnement des limons d'une structure dont le plugin n'en rend pas
 * (`StructureOutput.precheck` absent) : `precheckStringers` sur les pièces fusionnées, réglages
 * de `structure.params.precheck`. Indicatif : un échec n'invalide pas le modèle (absent).
 */
function fallbackPrecheck(
  project: Project,
  stepping: Stepping,
  parts: readonly Part[],
): ModelPrecheck | undefined {
  try {
    const settings = structurePrecheckSettings(project.stair.structure.params);
    const { beams, loads, permanentArea, notes } = precheckStringers(
      project,
      stepping,
      parts,
      settings,
    );
    return { beams, loads, permanentArea, notes };
  } catch {
    return undefined;
  }
}

/** Caches par étape (dernier résultat). */
const caches = {
  layout: new LastValueCache<Stage<Layout>>(),
  stepping: new LastValueCache<Stage<Stepping>>(),
  parts: new LastValueCache<Stage<PartsStage>>(),
  structure: new LastValueCache<Stage<StructureStage>>(),
  guards: new LastValueCache<Stage<GuardsAnalysis>>(),
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Fusion profonde des objets simples : un sous-objet partiel du projet (ex. `newel: { joint }`)
 * complète le sous-objet par défaut au lieu de le remplacer ; tableaux et valeurs remplacés.
 */
export function deepMerge(
  base: Readonly<Record<string, unknown>>,
  over: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = isRecord(b) && isRecord(v) ? deepMerge(b, v) : v;
  }
  return out;
}

/** Paramètres du plugin : défauts `defaults(ctx)` surchargés par le projet, validés par zod. */
function resolveStructureParams(
  plugin: StructureKind<unknown>,
  ctx: StructureContext,
  params: Readonly<Record<string, unknown>>,
): unknown {
  const defaults = plugin.defaults(ctx);
  const merged = isRecord(defaults) ? deepMerge(defaults, params) : params;
  const parsed = plugin.paramsSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")} : ${i.message}` : i.message))
      .join(" ; ");
    throw new StructureError(`Structure « ${plugin.kind} » : paramètres invalides (${issues}).`);
  }
  return parsed.data;
}

/** Pièces de base remplacées (même `id`) ou complétées par celles du plugin. */
function mergeParts(
  base: readonly Part[],
  extra: readonly Part[],
  removed: readonly string[] = [],
): Part[] {
  const byId = new Map(extra.map((p) => [p.id, p]));
  // Pièces de base supprimées par la structure (`StructureOutput.removedBaseParts`), sauf si
  // elle fournit elle-même une pièce de même identifiant (remplacement).
  const drop = new Set(removed.filter((id) => !byId.has(id)));
  const out = base.filter((p) => !drop.has(p.id)).map((p) => byId.get(p.id) ?? p);
  const baseIds = new Set(base.map((p) => p.id));
  for (const p of extra) if (!baseIds.has(p.id)) out.push(p);
  return out;
}

/**
 * Intègre les contrôles du plugin au rapport : pour une règle de rules.yaml, ils remplacent
 * (à sa place) le résultat du moteur ; les contrôles propres au plugin sont ajoutés à la fin.
 */
export function mergeStructureChecks(
  report: ComplianceReport,
  checks: readonly RuleResult[],
): ComplianceReport {
  if (checks.length === 0) return report;
  const byRule = new Map<string, RuleResult[]>();
  for (const c of checks) {
    const list = byRule.get(c.ruleId) ?? [];
    list.push(c);
    byRule.set(c.ruleId, list);
  }
  const replaced = new Set(
    [...byRule.keys()].filter(
      (id) => findRule(id) !== undefined && report.results.some((r) => r.ruleId === id),
    ),
  );
  const results: RuleResult[] = [];
  const inserted = new Set<string>();
  for (const r of report.results) {
    if (!replaced.has(r.ruleId)) results.push(r);
    else if (!inserted.has(r.ruleId)) {
      results.push(...byRule.get(r.ruleId)!);
      inserted.add(r.ruleId);
    }
  }
  for (const [id, list] of byRule) if (!inserted.has(id)) results.push(...list);
  const summary: Record<Severity, number> = { bloquant: 0, avertissement: 0, conseil: 0 };
  for (const r of results) if (r.status === "violation") summary[r.severity]++;
  // Surcharge d'un contrôle de plugin : appliquée par le plugin (`effectiveSeverity`), elle n'est
  // pas « inconnue » ; seule reste la note des identifiants qu'aucun résultat ne porte.
  const applied = new Set([...byRule.keys()].map(unknownOverrideNote));
  const { notes: reportNotes, ...rest } = report;
  const notes = (reportNotes ?? []).filter((n) => !applied.has(n));
  return { ...rest, results, summary, ...(notes.length > 0 ? { notes } : {}) };
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
    ? run(
        caches.stepping,
        // Tout `stair` sauf `placement` (porté par `layout`) et les paramètres de structure :
        // le découpage ne lit que `structure.kind` (variante M3 des débillardés). Changer un
        // paramètre de structure ne recalcule ni le découpage ni les garde-corps.
        [
          layout,
          stair.layout,
          stair.walkline,
          stair.stepping,
          stair.balancing,
          stair.treads,
          stair.nosingOverrides,
          stair.structure.kind,
          site.floorToFloor,
        ],
        () => attempt(STAGE_LABELS.stepping, () => computeStepping(project, layout)),
      )
    : undefined;
  if (steppingStage?.error !== undefined) errors.push(steppingStage.error);
  const stepping = steppingStage?.value;
  const complete = layout !== undefined && stepping !== undefined;

  // 3. Pièces de base, puis structure (plugin) et grandeurs de nomenclature.
  let parts: readonly Part[] = [];
  let structureChecks: readonly RuleResult[] = [];
  let executionClass: "EXC1" | "EXC2" | undefined;
  let precheck: ModelPrecheck | undefined;
  const kind = stair.structure.kind;
  const plugin = kind !== "none" ? getStructure(kind) : undefined;
  if (kind !== "none" && !plugin) {
    notes.push(
      `Structure « ${kind} » : aucun plugin de structure disponible, seules les marches, contremarches et paliers sont générés.`,
    );
  }
  if (complete) {
    const partsStage = run(caches.parts, [layout, stepping, stair.treads], () =>
      attempt(STAGE_LABELS.parts, () => buildBasicParts(project, layout, stepping)),
    );
    if (partsStage.error !== undefined) errors.push(partsStage.error);
    else {
      notes.push(...partsStage.value.notes);
      const base = partsStage.value.parts;
      const structureStage = run(
        caches.structure,
        // Sans plugin, les pièces ne dépendent que des pièces de base et du profil d'atelier.
        plugin
          ? [base, layout, stepping, plugin, stair, site, project.compliance, project.workshop]
          : [base, project.workshop],
        () =>
          attempt(STAGE_LABELS.structure, (): StructureStage => {
            const profile = resolveWorkshopProfile(project.workshop);
            const normalize = (ps: readonly Part[]): Part[] =>
              ps.map((p) => normalizeWoodQuantities(p, profile));
            if (!plugin) return { parts: normalize(base), checks: [], notes: [], errors: [] };
            const ctx: StructureContext = { project, layout, stepping, baseParts: base };
            const params = resolveStructureParams(plugin, ctx, stair.structure.params);
            const out = plugin.build(ctx, params);
            const merged = normalize(mergeParts(base, out.parts, out.removedBaseParts));
            const precheck = out.precheck ?? fallbackPrecheck(project, stepping, merged);
            return {
              parts: merged,
              checks: out.checks,
              notes: out.notes,
              errors: out.errors ?? [],
              ...(out.executionClass ? { executionClass: out.executionClass } : {}),
              ...(precheck ? { precheck } : {}),
            };
          }),
      );
      if (structureStage.error !== undefined) {
        errors.push(structureStage.error);
        // Pièces de base seules, avec les grandeurs de nomenclature normalisées.
        const profile = resolveWorkshopProfile(project.workshop);
        parts = base.map((p) => normalizeWoodQuantities(p, profile));
      } else {
        parts = structureStage.value.parts;
        structureChecks = structureStage.value.checks;
        executionClass = structureStage.value.executionClass;
        precheck = structureStage.value.precheck;
        notes.push(...structureStage.value.notes);
        errors.push(...structureStage.value.errors);
      }
    }
  }

  // 3 bis. Garde-corps et mains courantes (après la structure).
  let guards: GuardsAnalysis | null | undefined;
  let guardResults: readonly RuleResult[] = [];
  if (complete && project.guards) {
    const guardsStage = run(
      caches.guards,
      [project.guards, layout, stepping, site, stair.layout, project.workshop],
      () => attempt(STAGE_LABELS.guards, () => computeGuards(project, layout, stepping)),
    );
    if (guardsStage.error !== undefined) {
      errors.push(guardsStage.error);
      guards = null;
    } else {
      guards = guardsStage.value;
      parts = [...parts, ...guards.parts];
      notes.push(...guards.notes);
      // Lignes impossibles (jour trop étroit…) : erreurs lisibles, les autres lignes restent.
      errors.push(...(guards.errors ?? []));
      guardResults = guardChecks(project, stepping, guards);
    }
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
    [
      project.compliance,
      site,
      stair,
      project.rulesVersion,
      layoutOut,
      steppingOut,
      headroom,
      project.guards,
      guards,
    ],
    () =>
      attempt(STAGE_LABELS.compliance, () => ({
        report: evaluateComplianceDetailed({
          project,
          layout: layoutOut,
          stepping: steppingOut,
          ...(headroomMin ? { headroom: headroomMin } : {}),
          ...(headroomClear ? { headroomClear } : {}),
          ...(incomplete ? { incomplete } : {}),
          ...(guards !== undefined ? { guards } : {}),
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
  } else
    compliance = mergeStructureChecks(complianceStage.value.report, [
      ...structureChecks,
      ...guardResults,
    ]);

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
    ...(executionClass ? { executionClass } : {}),
    ...(precheck ? { precheck } : {}),
    errors,
    ...(notes.length > 0 ? { notes } : {}),
  };
  if (memo) models.set(project, model);
  return model;
}
