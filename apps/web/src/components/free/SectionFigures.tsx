/**
 * Bande de chiffres clés d'une section du panneau libre (maquette 1b, spécification de contenu
 * § 2 « Chiffres affichés »). Aucun calcul métier : lectures du projet et du dernier modèle
 * calculé (il reste affiché pendant un calcul), comptes, et fonctions de présentation
 * existantes (`bomSummary`, `executionClassInfo`, `precheckSummary`, `flightsTypologyLabel`).
 * Un chiffre indisponible (modèle absent, structure sans acier…) s'affiche « – ».
 */
import type { Model, Project } from "@blondel/core";
import type { Translator } from "@blondel/i18n";
import { useMemo, type CSSProperties } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { BALANCING_METHOD_LABELS } from "../../lib/balancingForm.js";
import { LAYOUT_KIND_LABELS, flightsTypologyLabel } from "../../lib/layoutKind.js";
import { bomSummary } from "../../lib/parts.js";
import { executionClassInfo, precheckSummary } from "../../lib/precheck.js";
import type { SectionId } from "../../lib/sectionIds.js";
import { formatFigureLength, type DisplayUnit } from "../../lib/units.js";
import { useApp, useModel } from "../../store/appStore.js";
import "./free.css";

/** Un chiffre de la bande : valeur, légende ; `text` : valeur en mots (corps réduit). */
export interface SectionFigure {
  readonly id: string;
  readonly value: string;
  readonly caption: string;
  readonly text?: boolean;
  /** Occupe toute la ligne (typologie). */
  readonly wide?: boolean;
}

const DASH = "–";

/**
 * Longueur affichée sans unité (l'unité est dans la légende) : même arrondi que les chiffres
 * clés de l'inspecteur (mm entiers, `formatFigureLength`).
 */
function len(mm: number | undefined | null, unit: DisplayUnit, t: Translator): string {
  return formatFigureLength(mm, unit, t.locale);
}

interface FigureSources {
  readonly project: Project;
  readonly model: Model | null;
  readonly unit: DisplayUnit;
  /** Masse de la structure (kg), si connue (nomenclature des pièces de la famille structure). */
  readonly structureMass: number | undefined;
}

/** Chiffres d'une section, dans l'ordre d'affichage. */
export function sectionFigures(
  section: SectionId,
  { project, model, unit, structureMass }: FigureSources,
  t: Translator,
): readonly SectionFigure[] {
  const u = { unit };
  const st = model?.stepping;
  switch (section) {
    case "site": {
      const site = project.site;
      const o = site.opening;
      const opening: SectionFigure =
        o === undefined
          ? {
              id: "opening",
              value: t.t("ui.figures.section.opening.none"),
              caption: t.t("ui.figures.section.opening", u),
              text: true,
            }
          : o.kind === "rect"
            ? {
                id: "opening",
                value: `${len(o.sizeX, unit, t)} × ${len(o.sizeY, unit, t)}`,
                caption: t.t("ui.figures.section.opening", u),
              }
            : {
                id: "opening",
                value: t.t("ui.figures.section.opening.polygon", { count: o.points.length }),
                caption: t.t("ui.figures.section.opening", u),
                text: true,
              };
      const unlimited = model?.headroomUnlimited?.walkline === true;
      return [
        {
          id: "floorToFloor",
          value: len(site.floorToFloor, unit, t),
          caption: t.t("ui.figures.section.floorToFloor", u),
        },
        {
          id: "slab",
          value: len(site.upperSlabThickness, unit, t),
          caption: t.t("ui.figures.section.slab", u),
        },
        opening,
        unlimited
          ? {
              id: "headroom",
              value: t.t("ui.figures.section.headroomUnlimited"),
              caption: t.t("ui.figures.section.headroom", u),
              text: true,
            }
          : {
              id: "headroom",
              value: len(model?.headroom?.min, unit, t),
              caption: t.t("ui.figures.section.headroom", u),
            },
      ];
    }
    case "layout": {
      const layout = project.stair.layout;
      const typology =
        layout.kind === "helical"
          ? t.t(LAYOUT_KIND_LABELS.helical)
          : t.t(flightsTypologyLabel(layout.turns));
      return [
        {
          id: "typology",
          value: typology,
          caption: t.t("ui.figures.section.typology"),
          text: true,
          wide: true,
        },
        { id: "run", value: len(st?.run, unit, t), caption: t.t("ui.figures.section.run", u) },
        {
          id: "width",
          value: len(layout.width, unit, t),
          caption: t.t("ui.figures.section.width", u),
        },
      ];
    }
    case "stepping":
      return [
        {
          id: "riserCount",
          value: st ? String(st.riserCount) : DASH,
          caption: t.t("ui.figures.section.riserCount"),
        },
        { id: "rise", value: len(st?.rise, unit, t), caption: t.t("ui.figures.section.rise", u) },
        {
          id: "going",
          value: len(st?.going, unit, t),
          caption: t.t("ui.figures.section.going", u),
        },
        {
          id: "blondel",
          value: len(st?.blondel, unit, t),
          caption: t.t("ui.figures.section.blondel", u),
        },
        model?.headroomUnlimited?.walkline === true
          ? {
              id: "headroom",
              value: t.t("ui.figures.section.headroomUnlimited"),
              caption: t.t("ui.figures.section.headroom", u),
              text: true,
            }
          : {
              id: "headroom",
              value: len(model?.headroom?.min, unit, t),
              caption: t.t("ui.figures.section.headroom", u),
            },
      ];
    case "balancing": {
      const b = project.stair.balancing;
      return [
        {
          id: "method",
          value: t.t(BALANCING_METHOD_LABELS[b.method]),
          caption: t.t("ui.figures.section.method"),
          text: true,
          wide: true,
        },
        {
          id: "balancedZones",
          value: st ? String(st.balancedZones.length) : DASH,
          caption: t.t("ui.figures.section.balancedZones"),
        },
        {
          id: "targetCollet",
          value: len(b.targetCollet, unit, t),
          caption: t.t("ui.figures.section.targetCollet", u),
        },
      ];
    }
    case "treads": {
      const tr = project.stair.treads;
      return [
        {
          id: "treadCount",
          value: st ? String(st.treads.length) : DASH,
          caption: t.t("ui.figures.section.treadCount"),
        },
        {
          id: "thickness",
          value: len(tr.thickness, unit, t),
          caption: t.t("ui.figures.section.thickness", u),
        },
        {
          id: "nosing",
          value: len(tr.nosing, unit, t),
          caption: t.t("ui.figures.section.nosing", u),
        },
      ];
    }
    case "structure": {
      const exc = executionClassInfo(model);
      const pc = precheckSummary(model);
      const ok = pc?.rows.filter((r) => r.ok.deflection && r.ok.stress && r.ok.frequency).length;
      return [
        {
          id: "mass",
          value:
            structureMass === undefined
              ? DASH
              : formatNumber(t.locale, structureMass, { maximumFractionDigits: 0 }),
          caption: t.t("ui.figures.section.mass"),
        },
        {
          id: "executionClass",
          value: exc?.value ?? DASH,
          caption: t.t("ui.figures.section.executionClass"),
        },
        {
          id: "precheck",
          value: pc === null || pc.rows.length === 0 ? DASH : `${ok} / ${pc.rows.length}`,
          caption: t.t("ui.figures.section.precheck"),
        },
      ];
    }
    case "guards": {
      const count = model?.parts.filter((p) => p.family === "guards").length ?? 0;
      return [
        count > 0
          ? { id: "guards", value: String(count), caption: t.t("ui.figures.section.guardParts") }
          : { id: "guards", value: DASH, caption: t.t("ui.figures.section.noGuards") },
      ];
    }
    case "compliance": {
      const c = project.compliance;
      return [
        {
          id: "profile",
          value: t.t(
            c.profile === "strict"
              ? "ui.params.compliance.profile.strict"
              : "ui.params.compliance.profile.souple",
          ),
          caption: t.t("ui.figures.section.profile"),
          text: true,
        },
        {
          id: "contexts",
          value: String(c.contexts.length),
          caption: t.t("ui.figures.section.contexts"),
        },
        {
          id: "overrides",
          value: String(c.overrides.length),
          caption: t.t("ui.figures.section.overrides"),
        },
      ];
    }
  }
}

/** Colonnes de la bande : lignes pleines (quatre chiffres en deux lignes de deux). */
function columnsOf(figures: readonly SectionFigure[]): number {
  const n = figures.filter((f) => f.wide !== true).length;
  if (n === 4) return 2;
  return Math.max(1, Math.min(3, n));
}

export function SectionFigures({ section }: { section: SectionId }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const unit = useApp((s) => s.displayUnit);
  const { model } = useModel();
  // Nomenclature seulement pour la section Structure (lecture des masses des pièces).
  const structureMass = useMemo(() => {
    if (section !== "structure" || !model) return undefined;
    const parts = model.parts.filter((p) => p.family === "structure");
    return parts.length === 0 ? undefined : bomSummary(parts, t.locale).mass;
  }, [section, model, t.locale]);
  const figures = sectionFigures(section, { project, model, unit, structureMass }, t);
  const style = { "--figure-cols": columnsOf(figures) } as CSSProperties;
  return (
    <div role="group" aria-label={t.t("ui.figures.section.label")} data-section={section}>
      <dl className="section-figures" style={style}>
        {figures.map((f) => (
          <div
            key={f.id}
            className={`section-figures__cell${f.wide === true ? " section-figures__cell--wide" : ""}`}
            data-figure={f.id}
          >
            <dt>{f.caption}</dt>
            <dd className={f.text === true ? "section-figures__text" : undefined}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
