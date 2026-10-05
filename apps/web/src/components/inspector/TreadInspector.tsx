/**
 * Inspecteur « Marche » (maquette 2a, ADR-0009) : la marche sélectionnée sur le plan,
 * l'élévation ou la 3D (ou le nez qui la porte : nez k ↔ marche k + 1).
 *
 * - en-tête : surtitre (« Marche », « · tournant i » dans une zone balancée), pastille de
 *   sélection, « Marche n », étiquette « balancée » / « palier », ‹ › vers la marche voisine
 *   (la sélection partagée suit : toutes les vues surlignent la nouvelle marche) ;
 * - valeurs lues dans le modèle : giron sur la ligne de foulée, collet (corde, comme le
 *   contrôle), hauteur, altitude du nez, échappée au nez (`Model.headroomAtNosings`) ;
 * - bloc « Ligne de nez » (`NosingLineBlock`), qui remplace le mode expert du plan ;
 * - règles de cette marche, pièces de cette marche, mention indicative en pied.
 *
 * Aucune grandeur n'est calculée ici : un champ que le modèle n'expose pas s'affiche « — ».
 */
import type { Model } from "@blondel/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "../../i18n/useT.js";
import { zoneOfTread } from "../../lib/nosingOverrides.js";
import { treadLinkedParts } from "../../lib/partLinks.js";
import { formatFigureLength, type DisplayUnit } from "../../lib/units.js";
import type { Locale } from "@blondel/i18n";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import { Icon } from "../ui/Icon.js";
import { ElementRules } from "./ElementRules.js";
import { NosingLineBlock } from "./NosingLineBlock.js";
import { PartLinkList } from "./PartLinkList.js";
import "./tread.css";

/** Valeur absente du modèle (champ du cœur non exposé). */
export const MISSING = "—";

export interface TreadInspectorProps {
  /** Numéro de la marche (1 … n − 1), présente dans `stepping.treads`. */
  readonly number: number;
}

/** Ligne du tableau des valeurs. */
export interface TreadValue {
  readonly id: "going" | "collet" | "rise" | "altitude" | "headroom";
  readonly value: string;
}

/**
 * Valeurs de la marche n, mises en forme (mm entiers ou cm, unité d'affichage suivie) : lectures
 * du modèle seulement. Échappée : `null` → `unlimited` (aucun plafond au-dessus du nez), champ
 * absent → « — ».
 */
export function treadValues(
  model: Pick<Model, "stepping" | "headroomAtNosings">,
  n: number,
  unit: DisplayUnit,
  locale: Locale,
  unlimited: string,
): readonly TreadValue[] {
  const tread = model.stepping.treads.find((t) => t.number === n);
  const len = (mm: number | undefined | null): string =>
    mm === undefined || mm === null || !Number.isFinite(mm)
      ? MISSING
      : `${formatFigureLength(mm, unit, locale)} ${unit}`;
  const headroom = model.headroomAtNosings?.[n - 1];
  return [
    { id: "going", value: len(tread?.going) },
    { id: "collet", value: len(tread?.colletChord) },
    { id: "rise", value: len(model.stepping.rises[n - 1]) },
    { id: "altitude", value: len(tread?.z) },
    {
      id: "headroom",
      value:
        model.headroomAtNosings === undefined || headroom === undefined
          ? MISSING
          : headroom === null
            ? unlimited
            : len(headroom),
    },
  ];
}

const VALUE_LABELS = {
  going: "ui.inspector.tread.going",
  collet: "ui.inspector.tread.collet",
  rise: "ui.inspector.tread.rise",
  altitude: "ui.inspector.tread.altitude",
  headroom: "ui.inspector.tread.headroom",
} as const;

/** Marches voisines présentes dans le découpage (`null` aux bouts). */
export function neighbourTreads(
  stepping: Pick<Model["stepping"], "treads">,
  n: number,
): { readonly prev: number | null; readonly next: number | null } {
  const has = (m: number) => stepping.treads.some((t) => t.number === m);
  return { prev: has(n - 1) ? n - 1 : null, next: has(n + 1) ? n + 1 : null };
}

const selectTread = (number: number): void =>
  appStore.getState().select({ location: { kind: "tread", number } });

export function TreadInspector({ number: n }: TreadInspectorProps) {
  const t = useT();
  const unit = useApp((s) => s.displayUnit);
  const { model } = useModel();
  const tread = model?.stepping.treads.find((x) => x.number === n);
  if (!model || !tread) return null;
  const zone = zoneOfTread(model.stepping, n);
  const { prev, next } = neighbourTreads(model.stepping, n);
  const values = treadValues(model, n, unit, t.locale, t.t("ui.inspector.figure.unlimited"));
  const kindTag =
    tread.kind === "winder"
      ? t.t("ui.inspector.tread.kind.winder")
      : tread.kind === "landing"
        ? t.t("ui.inspector.tread.kind.landing")
        : null;
  const prevLabel = t.t("ui.inspector.tread.prev");
  const nextLabel = t.t("ui.inspector.tread.next");

  return (
    <div className="insp-template tread-inspector" data-tread-number={n}>
      <div className="insp-head">
        <span className="insp-eyebrow">
          {zone
            ? t.t("ui.inspector.tread.eyebrow.turn", { turn: String(zone.turn + 1) })
            : t.t("ui.inspector.tread.eyebrow")}
        </span>
        <div className="insp-title-row">
          <span className="insp-swatch" aria-hidden="true" />
          <h3 className="insp-title">{t.t("ui.lib.location.tread", { number: String(n) })}</h3>
          {kindTag ? <span className="tag tag-neutral">{kindTag}</span> : null}
          <span className="insp-spacer" />
          <span className="tread-inspector__nav">
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={prevLabel}
              title={prevLabel}
              disabled={prev === null}
              onClick={() => prev !== null && selectTread(prev)}
            >
              <Icon icon={ChevronLeft} size={16} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={nextLabel}
              title={nextLabel}
              disabled={next === null}
              onClick={() => next !== null && selectTread(next)}
            >
              <Icon icon={ChevronRight} size={16} />
            </button>
          </span>
        </div>
      </div>
      <table className="table insp-values" aria-label={t.t("ui.inspector.tread.values")}>
        <tbody>
          {values.map((v) => (
            <tr key={v.id} data-value={v.id}>
              <td>{t.t(VALUE_LABELS[v.id])}</td>
              <td>{v.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <NosingLineBlock model={model} index={n - 1} />
      <ElementRules target={{ kind: "tread", number: n }} />
      <PartLinkList title={t.t("ui.inspector.tread.parts")} parts={treadLinkedParts(model, n)} />
      <span className="insp-spacer" />
      <p className="inspector-disclaimer">{t.t("ui.compliance.disclaimer")}</p>
    </div>
  );
}
