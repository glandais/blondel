/**
 * Bande de chiffres clés d'une section du panneau libre (maquette 1b, spécification de contenu
 * § 2 « Chiffres affichés »). Aucun calcul métier : lectures du projet et du dernier modèle
 * calculé (il reste affiché pendant un calcul, chiffres du cœur dans `Model.figures`), comptes,
 * et fonctions de présentation existantes (`bomSummary`, `executionClassInfo`,
 * `precheckSummary`, `flightsTypologyLabel`). Un chiffre indisponible (modèle absent,
 * structure sans acier…) s'affiche « – ».
 *
 * L'unité est toujours à droite du chiffre, jamais dans la légende (spécification de contenu,
 * § 1). La grille n'a jamais de case vide : la dernière cellule d'une ligne incomplète s'étend
 * jusqu'au bord (`figureSpans`).
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
import "./sectionFigures.css";

/**
 * Un chiffre de la bande : valeur, légende, unité (rendue à droite de la valeur) ; `text` :
 * valeur en mots (corps réduit).
 */
export interface SectionFigure {
  readonly id: string;
  readonly value: string;
  readonly caption: string;
  /** Unité affichée à droite de la valeur (« mm », « cm », « kg »), absente sans unité. */
  readonly unit?: string;
  readonly text?: boolean;
  /** Occupe toute la ligne (typologie). */
  readonly wide?: boolean;
  /**
   * Valeur composée « L × l » (trémie, emprise) : dans le cadre de l'étape guidée, aux cellules
   * plus étroites, elle prend toute la ligne pour ne pas se couper (`stepFigures`).
   */
  readonly composite?: boolean;
}

const DASH = "–";

/** Unité de la masse (« kg »), texte affiché donc passé par le dictionnaire. */
export function massUnit(t: Translator): string {
  return t.t("ui.unit.kg");
}

/**
 * Longueur affichée sans unité (l'unité est rendue à part, à droite) : même arrondi que les
 * chiffres clés de l'inspecteur (mm entiers, `formatFigureLength`).
 */
function len(mm: number | undefined | null, unit: DisplayUnit, t: Translator): string {
  return formatFigureLength(mm, unit, t.locale);
}

/** Masse (kg) arrondie au kilogramme, tiret si inconnue. */
function kg(mass: number | undefined, t: Translator): string {
  return mass === undefined || !Number.isFinite(mass)
    ? DASH
    : formatNumber(t.locale, mass, { maximumFractionDigits: 0 });
}

/** Chiffre de longueur : valeur, légende et unité d'affichage (sans unité si la valeur manque). */
function lengthFigure(
  id: string,
  mm: number | undefined | null,
  caption: string,
  unit: DisplayUnit,
  t: Translator,
): SectionFigure {
  const value = len(mm, unit, t);
  return value === DASH ? { id, value, caption } : { id, value, caption, unit };
}

/** Chiffre de masse (kg). */
function massFigure(id: string, mass: number | undefined, caption: string, t: Translator) {
  const value = kg(mass, t);
  return value === DASH ? { id, value, caption } : { id, value, caption, unit: massUnit(t) };
}

export interface FigureSources {
  readonly project: Project;
  readonly model: Model | null;
  readonly unit: DisplayUnit;
  /** Masse de la structure (kg), si connue (nomenclature des pièces de la famille structure). */
  readonly structureMass: number | undefined;
  /** Masse des marches (kg), si connue (nomenclature des pièces de la famille marches). */
  readonly treadMass?: number | undefined;
}

/** Échappée : « non limitée » (trémie couvrante) ou minimum mesuré sur la ligne de foulée. */
function headroomFigure(model: Model | null, unit: DisplayUnit, t: Translator): SectionFigure {
  const caption = t.t("ui.figures.caption.headroom");
  return model?.headroomUnlimited?.walkline === true
    ? {
        id: "headroom",
        value: t.t("ui.figures.section.headroomUnlimited"),
        caption,
        text: true,
      }
    : lengthFigure("headroom", model?.headroom?.min, caption, unit, t);
}

/** Chiffres d'une section, dans l'ordre d'affichage. */
export function sectionFigures(
  section: SectionId,
  { project, model, unit, structureMass, treadMass }: FigureSources,
  t: Translator,
): readonly SectionFigure[] {
  const st = model?.stepping;
  const figures = model?.figures;
  switch (section) {
    case "site": {
      const site = project.site;
      const o = site.opening;
      const caption = t.t("ui.figures.caption.opening");
      const opening: SectionFigure =
        o === undefined
          ? {
              id: "opening",
              value: t.t("ui.figures.section.opening.none"),
              caption,
              text: true,
            }
          : o.kind === "rect"
            ? {
                id: "opening",
                value: `${len(o.sizeX, unit, t)} × ${len(o.sizeY, unit, t)}`,
                caption,
                unit,
                composite: true,
              }
            : {
                id: "opening",
                value: t.t("ui.figures.section.opening.polygon", { count: o.points.length }),
                caption,
                text: true,
              };
      return [
        lengthFigure(
          "floorToFloor",
          site.floorToFloor,
          t.t("ui.figures.caption.floorToFloor"),
          unit,
          t,
        ),
        lengthFigure("slab", site.upperSlabThickness, t.t("ui.figures.caption.slab"), unit, t),
        opening,
        headroomFigure(model, unit, t),
      ];
    }
    case "layout": {
      const layout = project.stair.layout;
      const typology =
        layout.kind === "helical"
          ? t.t(LAYOUT_KIND_LABELS.helical)
          : t.t(flightsTypologyLabel(layout.turns));
      const fp = figures?.footprint;
      const footprintCaption = t.t("ui.figures.caption.footprint");
      return [
        {
          id: "typology",
          value: typology,
          caption: t.t("ui.figures.section.typology"),
          text: true,
          wide: true,
        },
        lengthFigure("run", st?.run, t.t("ui.figures.caption.run"), unit, t),
        lengthFigure("width", layout.width, t.t("ui.figures.caption.width"), unit, t),
        // Collet mini : seulement avec des marches balancées.
        ...(figures?.minCollet !== undefined
          ? [
              lengthFigure(
                "minCollet",
                figures.minCollet,
                t.t("ui.figures.caption.minCollet"),
                unit,
                t,
              ),
            ]
          : []),
        fp === undefined
          ? { id: "footprint", value: DASH, caption: footprintCaption }
          : {
              id: "footprint",
              value: `${len(fp.x, unit, t)} × ${len(fp.y, unit, t)}`,
              caption: footprintCaption,
              unit,
              composite: true,
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
        lengthFigure("rise", st?.rise, t.t("ui.figures.caption.rise"), unit, t),
        lengthFigure("going", st?.going, t.t("ui.figures.caption.going"), unit, t),
        lengthFigure("blondel", st?.blondel, t.t("ui.figures.caption.blondel"), unit, t),
        headroomFigure(model, unit, t),
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
        lengthFigure(
          "targetCollet",
          b.targetCollet,
          t.t("ui.figures.caption.targetCollet"),
          unit,
          t,
        ),
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
        lengthFigure("thickness", tr.thickness, t.t("ui.figures.caption.thickness"), unit, t),
        lengthFigure("nosing", tr.nosing, t.t("ui.figures.caption.nosing"), unit, t),
        massFigure("treadMass", treadMass, t.t("ui.figures.caption.treadMass"), t),
        lengthFigure(
          "nosingOverlap",
          figures?.nosingOverlap,
          t.t("ui.figures.caption.nosingOverlap"),
          unit,
          t,
        ),
      ];
    }
    case "structure": {
      const exc = executionClassInfo(model);
      const pc = precheckSummary(model);
      const ok = pc?.rows.filter((r) => r.ok.deflection && r.ok.stress && r.ok.frequency).length;
      return [
        massFigure("mass", structureMass, t.t("ui.figures.caption.structureMass"), t),
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
      const g = figures?.guards;
      // Garde-corps configurés sans aucune ligne générée (bords tous contre des murs) : « 0 »
      // ligne, pas « aucun garde-corps », que la configuration du projet contredirait.
      if (project.guards !== undefined && g?.lines === 0)
        return [{ id: "guards", value: "0", caption: t.t("ui.figures.caption.guardLines") }];
      if (g === undefined || g.lines === 0)
        return [{ id: "guards", value: DASH, caption: t.t("ui.figures.section.noGuards") }];
      return [
        {
          id: "guardLines",
          value: String(g.lines),
          caption: t.t("ui.figures.caption.guardLines"),
        },
        lengthFigure("guardLength", g.length, t.t("ui.figures.caption.guardLength"), unit, t),
        {
          id: "guardPosts",
          value: String(g.posts),
          caption: t.t("ui.figures.caption.guardPosts"),
        },
        lengthFigure(
          "guardRequiredHeight",
          g.requiredHeight,
          t.t("ui.figures.caption.guardRequiredHeight"),
          unit,
          t,
        ),
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
export function columnsOf(figures: readonly SectionFigure[]): number {
  const n = figures.filter((f) => f.wide !== true).length;
  if (n === 4) return 2;
  return Math.max(1, Math.min(3, n));
}

/**
 * Nombre de colonnes occupées par chaque chiffre dans une grille de `cols` colonnes, sans case
 * vide : un chiffre `wide` occupe toute la ligne, et la dernière cellule d'une ligne incomplète
 * (avant un chiffre `wide` ou en fin de grille) s'étend jusqu'au bord.
 */
export function figureSpans(figures: readonly SectionFigure[], cols: number): number[] {
  const spans = figures.map((f) => (f.wide === true ? cols : 1));
  let pos = 0;
  let last = -1;
  const close = (): void => {
    if (pos > 0 && last >= 0) spans[last] = cols - pos + 1;
    pos = 0;
  };
  figures.forEach((f, i) => {
    if (f.wide === true) {
      close();
      return;
    }
    last = i;
    pos++;
    if (pos === cols) pos = 0;
  });
  close();
  return spans;
}

/** Style de grille d'une cellule : toute la ligne, ou `span n`. */
export function spanStyle(span: number, cols: number): CSSProperties {
  return { gridColumn: span >= cols ? "1 / -1" : `span ${span} / span ${span}` };
}

/** Valeur suivie de son unité, à droite (plus petite, sur la ligne de base). */
export function FigureValue({ figure, unitClass }: { figure: SectionFigure; unitClass: string }) {
  return (
    <>
      {figure.value}
      {figure.unit !== undefined ? <span className={unitClass}>{figure.unit}</span> : null}
    </>
  );
}

export function SectionFigures({ section }: { section: SectionId }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const unit = useApp((s) => s.displayUnit);
  const { model } = useModel();
  // Nomenclature seulement pour les sections Structure et Marches (masses des pièces).
  const family = section === "structure" ? "structure" : section === "treads" ? "treads" : null;
  const mass = useMemo(() => {
    if (family === null || !model) return undefined;
    const parts = model.parts.filter((p) => p.family === family);
    return parts.length === 0 ? undefined : bomSummary(parts, t.locale).mass;
  }, [family, model, t.locale]);
  const figures = sectionFigures(
    section,
    {
      project,
      model,
      unit,
      structureMass: family === "structure" ? mass : undefined,
      treadMass: family === "treads" ? mass : undefined,
    },
    t,
  );
  const cols = columnsOf(figures);
  const spans = figureSpans(figures, cols);
  const style = { "--figure-cols": cols } as CSSProperties;
  return (
    <div role="group" aria-label={t.t("ui.figures.section.label")} data-section={section}>
      <dl className="section-figures" style={style}>
        {figures.map((f, i) => (
          <div
            key={f.id}
            className={`section-figures__cell${f.wide === true ? " section-figures__cell--wide" : ""}`}
            data-figure={f.id}
            style={spanStyle(spans[i]!, cols)}
          >
            <dt>{f.caption}</dt>
            <dd className={f.text === true ? "section-figures__text" : undefined}>
              <FigureValue figure={f} unitClass="section-figures__unit" />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
