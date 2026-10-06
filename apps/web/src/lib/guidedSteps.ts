/**
 * Parcours guidé (ADR-0009, écran 1a, spécification de contenu § 2) : présentation des sept
 * étapes en fonctions pures, sans DOM ni store.
 *
 * - titres des étapes, étape précédente / suivante ;
 * - onglets de vue du guidé (Élévation | Plan | 3D ; à l'étape 7 : Pièces | Nomenclature |
 *   Comparer | 3D), vue montrée et vue conseillée (`recommendedView` de `lib/journey.ts`) ;
 * - étape guidée d'un paramètre (liens « Ouvrir » de la liste des valeurs ◆) ;
 * - résumé d'une ligne de chaque étape pour la barre d'étapes (« H 2 700 · trémie 2 930 ×
 *   1 330 », « 15 hauteurs · 180 mm »…), suivi des ◆ restantes de l'étape.
 *
 * Aucun calcul métier : lectures du projet et du dernier modèle calculé, libellés existants
 * (typologie, structure, remplissage, matériau), longueurs arrondies à l'affichage
 * (`formatFigureLength`, mm entiers ou cm selon l'unité affichée).
 */
import { DEFAULT_WOOD_MATERIAL, type Model, type Project } from "@blondel/core";
import { materialLabel } from "@blondel/exports";
import { msg, type MessageKey, type Translator } from "@blondel/i18n";
import type { PlanMode, ViewTab } from "../store/projectStore.js";
import { INFILL_LABELS } from "./guardsForm.js";
import { recommendedView } from "./journey.js";
import { LAYOUT_KIND_LABELS, flightsTypologyLabel } from "./layoutKind.js";
import { availableStructures } from "./optionalApi.js";
import {
  STRUCTURE_PARAMS_PREFIX,
  structureParamEntry,
  tierEntry,
  treadsMaterialApplies,
  type ParamTierEntry,
} from "./paramTiers.js";
import { GUIDED_STEPS, type GuidedStep } from "./sectionIds.js";
import { safeDefaults, structureContext, withDefaults } from "./structureForm.js";
import type { ToValidateRow } from "./toValidate.js";
import { formatFigureLength, type DisplayUnit } from "./units.js";

/** Titre de chaque étape (barre d'étapes, titre du formulaire). */
export const STEP_TITLE_KEYS: Readonly<Record<GuidedStep, MessageKey>> = {
  1: "ui.guided.step.title.1",
  2: "ui.guided.step.title.2",
  3: "ui.guided.step.title.3",
  4: "ui.guided.step.title.4",
  5: "ui.guided.step.title.5",
  6: "ui.guided.step.title.6",
  7: "ui.guided.step.title.7",
};

/** Nombre d'étapes du parcours guidé (7). */
export const GUIDED_STEP_COUNT: number = GUIDED_STEPS.length;

/** Étape précédente, `null` à la première. */
export function previousStep(step: GuidedStep): GuidedStep | null {
  const i = GUIDED_STEPS.indexOf(step);
  return i > 0 ? GUIDED_STEPS[i - 1]! : null;
}

/** Étape suivante, `null` à la dernière. */
export function nextStep(step: GuidedStep): GuidedStep | null {
  const i = GUIDED_STEPS.indexOf(step);
  return i >= 0 && i < GUIDED_STEPS.length - 1 ? GUIDED_STEPS[i + 1]! : null;
}

/** Onglets de vue des étapes de conception, dans l'ordre de la maquette 1a. */
export const GUIDED_DESIGN_TABS: readonly ViewTab[] = ["elevation", "plan", "3d"];

/** Onglets de vue de l'étape 7 (Fabrication). */
export const GUIDED_FABRICATION_TABS: readonly ViewTab[] = ["flat", "bom", "compare", "3d"];

/** Onglets de vue d'une étape. */
export function guidedViewTabs(step: GuidedStep): readonly ViewTab[] {
  return step === 7 ? GUIDED_FABRICATION_TABS : GUIDED_DESIGN_TABS;
}

/**
 * Vue montrée à une étape : la vue active si elle fait partie des onglets de l'étape, sinon la
 * vue conseillée de l'étape (exemple : « À valider » n'est pas un onglet du guidé).
 */
export function guidedShownView(step: GuidedStep, view: ViewTab): ViewTab {
  return guidedViewTabs(step).includes(view) ? view : recommendedView(step).view;
}

/**
 * La vue active est-elle la vue conseillée de l'étape (mention « Vue conseillée pour cette
 * étape ») ? Pour une vue conseillée en plan, le mode du plan compte aussi.
 */
export function isRecommendedView(step: GuidedStep, view: ViewTab, planMode: PlanMode): boolean {
  const rec = recommendedView(step);
  return view === rec.view && (rec.planMode === undefined || rec.planMode === planMode);
}

/**
 * Étape guidée où un paramètre s'édite : sa première place dans le guidé ; à défaut, l'étape 7
 * pour un réglage d'atelier (repris sous « Plus de réglages » de l'étape Fabrication) ; sinon
 * `null` (paramètre de Conception absent du guidé : il s'édite dans le panneau libre).
 */
export function guidedStepOfParam(entry: ParamTierEntry): GuidedStep | null {
  const first = entry.guided[0];
  if (first !== undefined) return first.step;
  return entry.tier === "workshop" ? 7 : null;
}

/**
 * Étape guidée d'une ligne de la liste des valeurs ◆ : entrée du plugin de structure pour un
 * paramètre de plugin (`structureParamEntry`), sinon entrée du dictionnaire (`tierEntry`) ;
 * sans entrée, première étape de la ligne.
 */
export function guidedStepOfRow(
  row: Pick<ToValidateRow, "key" | "steps" | "structureKind">,
): GuidedStep | null {
  const entry =
    row.structureKind !== undefined && row.key.startsWith(STRUCTURE_PARAMS_PREFIX)
      ? structureParamEntry(
          row.structureKind,
          row.key.slice(STRUCTURE_PARAMS_PREFIX.length).split("."),
        )
      : tierEntry(row.key);
  if (entry === undefined) return row.steps[0] ?? null;
  return guidedStepOfParam(entry);
}

// ------------------------------------------------------------------ Résumés de la barre d'étapes

export interface StepSummarySources {
  readonly project: Project;
  readonly model: Model | null;
  readonly unit: DisplayUnit;
  readonly toValidateByStep: Readonly<Record<GuidedStep, number>>;
}

export interface StepSummary {
  /** Résumé sans les ◆ (tronqué à l'affichage s'il est trop long). */
  readonly base: string;
  /** Partie « · ◆ n » (« · ◆ n à valider » à l'étape 7), `null` s'il n'en reste pas. */
  readonly toValidateText: string | null;
  /** Résumé complet : `base`, suivi de `toValidateText` s'il y en a. */
  readonly text: string;
  /** ◆ restantes de l'étape (> 0 → résumé ocre). */
  readonly toValidate: number;
}

const DASH = "–";

/**
 * Libellé court de chaque structure livrée (résumé de l'étape 5, spécification de contenu § 2 :
 * « Débillardé soudé · S235 ») ; une structure tierce garde son libellé complet.
 */
const STRUCTURE_SHORT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  "wood-cut": "ui.guided.summary.structure.woodCut",
  "wood-housed": "ui.guided.summary.structure.woodHoused",
  "steel-flat": "ui.guided.summary.structure.steelFlat",
  "steel-profile": "ui.guided.summary.structure.steelProfile",
  "steel-curved": "ui.guided.summary.structure.steelCurved",
  "helical-core": "ui.guided.summary.structure.helicalCore",
};

/** Paramètres du plugin de structure du projet complétés par ses défauts, `null` sans plugin. */
function structureValues(project: Project, model: Model | null): Record<string, unknown> | null {
  const structure = project.stair.structure;
  const plugin = availableStructures().find((k) => k.kind === structure.kind);
  if (plugin === undefined) return null;
  return withDefaults(safeDefaults(plugin, structureContext(project, model)), structure.params);
}

/**
 * Résumé de l'étape 5 : libellé court de la structure, puis nuance d'acier (paramètre `grade`)
 * ou essence (paramètre `material`) du plugin, quand il en a une.
 */
function structureSummary(project: Project, model: Model | null, t: Translator): string {
  const kind = project.stair.structure.kind;
  if (kind === "none") return t.t("ui.guided.cards.structure.none");
  const plugin = availableStructures().find((k) => k.kind === kind);
  if (plugin === undefined) return t.t("ui.structure.pluginMissing", { kind });
  const shortKey = STRUCTURE_SHORT_LABEL_KEYS[kind];
  const label = t.t(shortKey ?? plugin.labelKey);
  const values = structureValues(project, model) ?? {};
  const grade = values["grade"];
  const material = values["material"];
  const detail =
    typeof grade === "string"
      ? grade
      : typeof material === "string"
        ? materialLabel(t, material)
        : null;
  return detail === null ? label : t.t("ui.guided.summary.structure", { label, detail });
}

/** Matériau des marches affiché à l'étape 4 (identifiant), `null` s'il n'est pas défini ici. */
function treadMaterialOf(project: Project, model: Model | null): string | null {
  // Paramètres du plugin complétés par ses défauts (comme le formulaire de la section).
  const values = structureValues(project, model);
  if (values === null) return project.stair.treads.material ?? DEFAULT_WOOD_MATERIAL;
  const own = values["material"];
  if (typeof own === "string") return own;
  return treadsMaterialApplies(values)
    ? (project.stair.treads.material ?? DEFAULT_WOOD_MATERIAL)
    : null;
}

/** Résumé sans les ◆. */
function baseSummary(step: GuidedStep, s: StepSummarySources, t: Translator): string {
  const { project, model, unit } = s;
  const len = (mm: number | undefined | null): string => formatFigureLength(mm, unit, t.locale);
  switch (step) {
    case 1: {
      const site = project.site;
      const height = len(site.floorToFloor);
      const o = site.opening;
      if (o === undefined) return t.t("ui.guided.summary.site.none", { height });
      if (o.kind === "rect") {
        return t.t("ui.guided.summary.site.rect", {
          height,
          x: len(o.sizeX),
          y: len(o.sizeY),
        });
      }
      return t.t("ui.guided.summary.site.polygon", { height });
    }
    case 2: {
      const layout = project.stair.layout;
      const typology =
        layout.kind === "helical"
          ? t.t(LAYOUT_KIND_LABELS.helical)
          : t.t(flightsTypologyLabel(layout.turns));
      return t.t("ui.guided.summary.layout", { typology, width: len(layout.width) });
    }
    case 3: {
      const st = model?.stepping;
      if (st === undefined) return DASH;
      return t.t(
        msg("ui.guided.summary.stepping", {
          count: st.riserCount,
          rise: len(st.rise),
          unit,
        }),
      );
    }
    case 4: {
      const tr = project.stair.treads;
      const material = treadMaterialOf(project, model);
      const thickness = len(tr.thickness);
      const nosing = len(tr.nosing);
      return material === null
        ? t.t("ui.guided.summary.treads", { thickness, nosing })
        : t.t("ui.guided.summary.treads.material", {
            material: materialLabel(t, material),
            thickness,
            nosing,
          });
    }
    case 5:
      return structureSummary(project, model, t);
    case 6: {
      const guards = project.guards;
      return guards === undefined
        ? t.t("ui.guided.summary.guards.none")
        : t.t(INFILL_LABELS[guards.infill.kind]);
    }
    case 7:
      return model ? t.t(msg("ui.fab.figures.parts", { count: model.parts.length })) : DASH;
  }
}

/**
 * Résumé d'une ligne d'une étape (barre d'étapes, spécification de contenu § 2 « Résumé dans
 * la barre d'étapes »), suivi des ◆ restantes de l'étape : « · ◆ n », ou « · ◆ n à valider »
 * à l'étape 7.
 */
export function stepSummary(step: GuidedStep, s: StepSummarySources, t: Translator): StepSummary {
  const base = baseSummary(step, s, t);
  const toValidate = s.toValidateByStep[step];
  if (toValidate <= 0) return { base, toValidateText: null, text: base, toValidate: 0 };
  // Deux textes distincts : à l'affichage, seul `base` est tronqué, la partie ◆ reste visible.
  const toValidateText = t.t(
    step === 7 ? "ui.guided.summary.toValidate.fabrication" : "ui.guided.summary.toValidate",
    { count: toValidate },
  );
  return { base, toValidateText, text: `${base} ${toValidateText}`, toValidate };
}
