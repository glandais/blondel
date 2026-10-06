/**
 * Inspecteur du nez d'arrivée (QUESTIONS A28, décision de l'utilisateur du 2026-10-06) : le
 * dernier nez du découpage, au palier haut, n'est porté par aucune marche. Sélectionné par un
 * clic sur sa ligne (plan coté) ou son point (élévation), il s'inspecte seul :
 *
 * - en-tête : surtitre « Nez k · palier d'arrivée », pastille de sélection, « Nez d'arrivée »,
 *   « ‹ » vers la dernière marche (la sélection partagée suit) ;
 * - bloc « Ligne de nez » (`NosingLineBlock`) SEUL : angle affiché non modifiable avec son motif
 *   (`angleLocked` : les bords de l'escalier s'arrêtent à ce nez, le découpage déclare
 *   inapplicable tout angle non nul ; question ouverte A30), valeur calculée en regard, Fixer le
 *   nez (F), Retirer la retouche (Suppr, y compris une retouche d'angle importée), liste des
 *   retouches ;
 * - aucune fiche de marche (ni giron, ni hauteur, ni contrôles de marche, ni pièces).
 *
 * Aucune grandeur n'est calculée ici : les angles sont ceux du cœur (`NosingLine.angle`,
 * `computedAngle`), lus par le bloc.
 */
import { msg } from "@blondel/i18n";
import { ChevronLeft } from "lucide-react";
import { useT } from "../../i18n/useT.js";
import { appStore, useModel } from "../../store/appStore.js";
import { Icon } from "../ui/Icon.js";
import { NosingLineBlock } from "./NosingLineBlock.js";
import "./tread.css";

export interface ArrivalNosingInspectorProps {
  /** Indice du nez d'arrivée (`arrivalNosingIndex`, nombre de nez − 1). */
  readonly index: number;
}

/** Dernière marche (celle que le nez d'arrivée borde à l'arrière), si elle existe. */
export function lastTreadBefore(
  stepping: { readonly treads: readonly { readonly number: number }[] },
  k: number,
): number | null {
  return stepping.treads.some((t) => t.number === k) ? k : null;
}

/** Motif de l'angle non modifiable du nez d'arrivée. */
const ANGLE_LOCKED = msg("ui.inspector.arrivalNosing.angleLocked");

export function ArrivalNosingInspector({ index: k }: ArrivalNosingInspectorProps) {
  const t = useT();
  const { model } = useModel();
  if (!model || model.stepping.nosings[k] === undefined) return null;
  const prev = lastTreadBefore(model.stepping, k);
  const prevLabel = t.t("ui.inspector.arrivalNosing.prev");
  return (
    <div className="insp-template arrival-nosing" data-nosing-index={k}>
      <div className="insp-head">
        <span className="insp-eyebrow">
          {t.t("ui.inspector.arrivalNosing.eyebrow", { index: String(k) })}
        </span>
        <div className="insp-title-row">
          <span className="insp-swatch" aria-hidden="true" />
          <h3 className="insp-title">{t.t("ui.lib.location.arrivalNosing")}</h3>
          <span className="insp-spacer" />
          <span className="tread-inspector__nav">
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={prevLabel}
              title={prevLabel}
              disabled={prev === null}
              onClick={() =>
                prev !== null &&
                appStore.getState().select({ location: { kind: "tread", number: prev } })
              }
            >
              <Icon icon={ChevronLeft} size={16} />
            </button>
          </span>
        </div>
      </div>
      <p className="arrival-nosing__hint">{t.t("ui.inspector.arrivalNosing.hint")}</p>
      <NosingLineBlock model={model} index={k} angleLocked={ANGLE_LOCKED} />
    </div>
  );
}
