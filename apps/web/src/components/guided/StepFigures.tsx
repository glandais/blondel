/**
 * Cadre de chiffres clés d'une étape du parcours guidé (maquette 1a, spécification de contenu § 2
 * « Chiffres affichés ») : cadre blueprint, trois colonnes, chiffres en Barlow Condensed 32 px,
 * unité accolée à droite du chiffre (plus petite, sur la ligne de base).
 *
 * Aucun calcul métier : les chiffres des étapes 1 à 6 sont ceux de la bande du panneau libre
 * (`sectionFigures`, chiffres du cœur dans `Model.figures`), choisis par identifiant ; ceux de
 * l'étape 7 reprennent la lecture de la bande du mode Fabrication (`FabricationFigures` :
 * nombre de pièces, masse de la nomenclature, classe d'exécution). Pendant un calcul, le
 * dernier modèle reste affiché. À l'étape 3, la jauge du module 2h + g suit les chiffres. La
 * grille n'a jamais de case vide (`figureSpans`).
 */
import { massNoteFor } from "@blondel/exports";
import type { Model, PartFamilyId, Project } from "@blondel/core";
import type { Translator } from "@blondel/i18n";
import { useMemo } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { bomSummary } from "../../lib/parts.js";
import { executionClassInfo } from "../../lib/precheck.js";
import type { GuidedStep, SectionId } from "../../lib/sectionIds.js";
import type { DisplayUnit } from "../../lib/units.js";
import { useApp, useModel } from "../../store/appStore.js";
import {
  FigureValue,
  massUnit,
  figureSpans,
  sectionFigures,
  spanStyle,
  type SectionFigure,
} from "../free/SectionFigures.js";
import { Corners } from "../ui/Blueprint.js";
import { BlondelGauge } from "./BlondelGauge.js";
import "./stepFigures.css";

const DASH = "–";

/** Colonnes du cadre de chiffres (maquette 1a). */
const STEP_FIGURE_COLUMNS = 3;

/**
 * Chiffres retenus pour chaque étape de conception : section et identifiants, dans l'ordre.
 * Un identifiant absent de la bande (collet mini sans marche balancée, chiffres de garde-corps
 * sans garde-corps) est simplement omis.
 */
export const STEP_FIGURE_IDS: Readonly<
  Record<Exclude<GuidedStep, 7>, { readonly section: SectionId; readonly ids: readonly string[] }>
> = {
  1: { section: "site", ids: ["opening", "slab", "headroom"] },
  2: { section: "layout", ids: ["typology", "run", "minCollet", "footprint"] },
  3: { section: "stepping", ids: ["riserCount", "rise", "going", "blondel", "headroom"] },
  4: { section: "treads", ids: ["treadCount", "treadMass", "nosingOverlap"] },
  5: { section: "structure", ids: ["mass", "executionClass", "precheck"] },
  6: { section: "guards", ids: ["guards", "guardLength", "guardPosts", "guardRequiredHeight"] },
};

/** Sources des chiffres d'une étape. */
export interface StepFigureSources {
  readonly project: Project;
  readonly model: Model | null;
  readonly unit: DisplayUnit;
  /**
   * Masse affichée par l'étape (kg) : marches à l'étape 4, structure à l'étape 5, toutes les
   * pièces à l'étape 7 ; ignorée ailleurs.
   */
  readonly mass: number | undefined;
}

/** Chiffres de l'étape 7 : pièces, masse, classe d'exécution (lecture de `FabricationFigures`). */
export function fabricationStepFigures(
  model: Model | null,
  mass: number | undefined,
  t: Translator,
): readonly SectionFigure[] {
  const known = mass !== undefined && Number.isFinite(mass);
  return [
    {
      id: "parts",
      value: model ? String(model.parts.length) : DASH,
      caption: t.t("ui.guided.figures.parts"),
    },
    {
      id: "mass",
      value: known ? formatNumber(t.locale, mass, { maximumFractionDigits: 0 }) : DASH,
      caption: t.t("ui.figures.caption.mass"),
      ...(known ? { unit: massUnit(t) } : {}),
    },
    {
      id: "executionClass",
      value: executionClassInfo(model)?.value ?? DASH,
      caption: t.t("ui.figures.section.executionClass"),
    },
  ];
}

/** Chiffres d'une étape, dans l'ordre d'affichage. */
export function stepFigures(
  step: GuidedStep,
  { project, model, unit, mass }: StepFigureSources,
  t: Translator,
): readonly SectionFigure[] {
  if (step === 7) return fabricationStepFigures(model, mass, t);
  const { section, ids } = STEP_FIGURE_IDS[step];
  const all = sectionFigures(
    section,
    {
      project,
      model,
      unit,
      structureMass: step === 5 ? mass : undefined,
      treadMass: step === 4 ? mass : undefined,
    },
    t,
  );
  // Valeur composée « L × l » : toute la ligne du cadre (sinon coupée en deux lignes).
  return ids.flatMap((id) =>
    all.filter((f) => f.id === id).map((f) => (f.composite === true ? { ...f, wide: true } : f)),
  );
}

/** Famille des pièces dont la masse est affichée : marches (4), structure (5), toutes (7). */
const MASS_FAMILY: Partial<Record<GuidedStep, PartFamilyId | "all">> = {
  4: "treads",
  5: "structure",
  7: "all",
};

/** Pièces dont la masse est affichée à une étape, `null` si l'étape n'en affiche pas. */
function massParts(step: GuidedStep, model: Model | null): Model["parts"] | null {
  const family = MASS_FAMILY[step];
  if (!model || family === undefined) return null;
  return family === "all" ? model.parts : model.parts.filter((p) => p.family === family);
}

export function StepFigures({ step }: { step: GuidedStep }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const unit = useApp((s) => s.displayUnit);
  // Dernier modèle calculé (il reste affiché pendant un calcul) et profil d'atelier de son projet.
  const { model, project: modelProject } = useModel();
  const workshop = modelProject?.workshop;
  const mass = useMemo(() => {
    const parts = massParts(step, model);
    if (parts === null || parts.length === 0) return undefined;
    return step === 7
      ? bomSummary(parts, t.locale, massNoteFor(workshop)).mass
      : bomSummary(parts, t.locale).mass;
  }, [step, model, t.locale, workshop]);
  const figures = stepFigures(step, { project, model, unit, mass }, t);
  const spans = figureSpans(figures, STEP_FIGURE_COLUMNS);
  return (
    <div
      className="blueprint step-figures"
      role="group"
      aria-label={t.t("ui.guided.figures.label")}
      data-step={step}
    >
      <Corners />
      <dl className="step-figures__grid">
        {figures.map((f, i) => (
          <div
            key={f.id}
            className={`step-figures__cell${f.wide === true ? " step-figures__cell--wide" : ""}`}
            data-figure={f.id}
            style={spanStyle(spans[i]!, STEP_FIGURE_COLUMNS)}
          >
            <dt className="step-figures__caption">{f.caption}</dt>
            <dd
              className={`step-figures__value${f.text === true ? " step-figures__value--text" : ""}`}
            >
              <FigureValue figure={f} unitClass="step-figures__unit" />
            </dd>
          </div>
        ))}
      </dl>
      {step === 3 ? <BlondelGauge model={model} /> : null}
    </div>
  );
}
