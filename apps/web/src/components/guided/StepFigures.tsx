/**
 * Cadre de chiffres clés d'une étape du parcours guidé (maquette 1a, spécification de contenu § 2
 * « Chiffres affichés ») : cadre blueprint, trois colonnes, chiffres en Barlow Condensed 32 px.
 *
 * Aucun calcul métier : les chiffres des étapes 1 à 6 sont ceux de la bande du panneau libre
 * (`sectionFigures`), choisis par identifiant ; ceux de l'étape 7 reprennent la lecture de la
 * bande du mode Fabrication (`FabricationFigures` : nombre de pièces, masse de la nomenclature,
 * classe d'exécution). Pendant un calcul, le dernier modèle reste affiché. À l'étape 3, la jauge
 * du module 2h + g suit les chiffres.
 */
import { massNoteFor } from "@blondel/exports";
import type { Model, Project } from "@blondel/core";
import type { Translator } from "@blondel/i18n";
import { useMemo } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { bomSummary } from "../../lib/parts.js";
import { executionClassInfo } from "../../lib/precheck.js";
import type { GuidedStep, SectionId } from "../../lib/sectionIds.js";
import type { DisplayUnit } from "../../lib/units.js";
import { useApp, useModel } from "../../store/appStore.js";
import { sectionFigures, type SectionFigure } from "../free/SectionFigures.js";
import { Corners } from "../ui/Blueprint.js";
import { BlondelGauge } from "./BlondelGauge.js";

const DASH = "–";

/** Chiffres retenus pour chaque étape de conception : section et identifiants, dans l'ordre. */
export const STEP_FIGURE_IDS: Readonly<
  Record<Exclude<GuidedStep, 7>, { readonly section: SectionId; readonly ids: readonly string[] }>
> = {
  1: { section: "site", ids: ["opening", "slab", "headroom"] },
  2: { section: "layout", ids: ["typology", "run", "width"] },
  3: { section: "stepping", ids: ["riserCount", "rise", "blondel"] },
  4: { section: "treads", ids: ["treadCount", "thickness", "nosing"] },
  5: { section: "structure", ids: ["mass", "executionClass", "precheck"] },
  6: { section: "guards", ids: ["guards"] },
};

/** Sources des chiffres d'une étape. */
export interface StepFigureSources {
  readonly project: Project;
  readonly model: Model | null;
  readonly unit: DisplayUnit;
  /** Masse de toutes les pièces (kg), étape 7 ; masse de la structure, étape 5. */
  readonly mass: number | undefined;
}

/** Chiffres de l'étape 7 : pièces, masse, classe d'exécution (lecture de `FabricationFigures`). */
export function fabricationStepFigures(
  model: Model | null,
  mass: number | undefined,
  t: Translator,
): readonly SectionFigure[] {
  return [
    {
      id: "parts",
      value: model ? String(model.parts.length) : DASH,
      caption: t.t("ui.guided.figures.parts"),
    },
    {
      id: "mass",
      value:
        mass === undefined || !Number.isFinite(mass)
          ? DASH
          : formatNumber(t.locale, mass, { maximumFractionDigits: 0 }),
      caption: t.t("ui.guided.figures.mass"),
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
  const all = sectionFigures(section, { project, model, unit, structureMass: mass }, t);
  return ids.flatMap((id) => all.filter((f) => f.id === id));
}

/** Pièces dont la masse est affichée : structure à l'étape 5, toutes à l'étape 7. */
function massParts(step: GuidedStep, model: Model | null): Model["parts"] | null {
  if (!model) return null;
  if (step === 7) return model.parts;
  if (step === 5) return model.parts.filter((p) => p.family === "structure");
  return null;
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
  return (
    <div
      className="blueprint step-figures"
      role="group"
      aria-label={t.t("ui.guided.figures.label")}
      data-step={step}
    >
      <Corners />
      <dl className="step-figures__grid">
        {figures.map((f) => (
          <div
            key={f.id}
            className={`step-figures__cell${f.wide === true ? " step-figures__cell--wide" : ""}`}
            data-figure={f.id}
          >
            <dt className="step-figures__caption">{f.caption}</dt>
            <dd
              className={`step-figures__value${f.text === true ? " step-figures__value--text" : ""}`}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      {step === 3 ? <BlondelGauge model={model} /> : null}
    </div>
  );
}
