/**
 * Liste de liens vers des pièces (« Pièces de cette marche », « Assemblée avec ») des
 * inspecteurs Marche (2a) et Pièce (2b), ADR-0009, vague 3. Chaque ligne (repère, désignation,
 * section) sélectionne la pièce : la sélection est partagée par toutes les vues et
 * l'inspecteur passe à la 2b de cette pièce. Les petites pièces répétées (supports, barreaux)
 * sont regroupées en une ligne (« CR1–CR9 … ×10 », `groupPartLinks`) qui sélectionne la
 * première.
 *
 * Visserie (QUESTIONS A27, `fasteners`, facultatif) : sous les pièces, liste « Visserie » des
 * éléments de visserie des assemblages de la pièce (`partFastenerLines`) : repère, désignation,
 * quantité ; lignes non cliquables (la visserie n'est pas une pièce sélectionnable). Liste de
 * pièces et visserie vides : rien n'est rendu.
 */
import type { FastenerLine, Part } from "@blondel/core";
import { useT } from "../../i18n/useT.js";
import { groupPartLinks } from "../../lib/partLinks.js";
import { appStore } from "../../store/appStore.js";
import "../fasteners.css";
import "./part.css";

export interface PartLinkListProps {
  /** Titre (surtitre) du bloc, déjà traduit. */
  readonly title: string;
  /** Pièces liées, dans l'ordre d'affichage ; liste vide : bloc masqué (sans visserie). */
  readonly parts: readonly Part[];
  /** Visserie des assemblages de la pièce (`partFastenerLines`) ; absente ou vide : rien. */
  readonly fasteners?: readonly FastenerLine[];
}

export function PartLinkList({ title, parts, fasteners = [] }: PartLinkListProps) {
  const t = useT();
  if (parts.length === 0 && fasteners.length === 0) return null;
  const fastenersTitle = t.t("ui.partLinks.fasteners");
  return (
    <div className="part-links">
      <span className="insp-section-title">{title}</span>
      {parts.length > 0 ? (
        <ul className="insp-links" aria-label={title}>
          {groupPartLinks(parts).map((g) => {
            const p = g.parts[0]!;
            const marks =
              g.marks.length <= 2
                ? g.marks.join(", ")
                : t.t("ui.partLinks.markRange", {
                    first: g.marks[0]!,
                    last: g.marks[g.marks.length - 1]!,
                  });
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="insp-link"
                  data-part={p.id}
                  title={g.parts.length > 1 ? g.marks.join(", ") : undefined}
                  onClick={() =>
                    appStore.getState().select({ location: { kind: "part", partId: p.id } })
                  }
                >
                  <b>{marks}</b>
                  <span className="insp-link__name">
                    {g.parts.length > 1
                      ? t.t("ui.partLinks.group", { name: g.name, count: g.parts.length })
                      : t.t(g.name)}
                  </span>
                  {p.section !== undefined ? (
                    <span className="insp-link__detail">{t.t(p.section)}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {fasteners.length > 0 ? (
        <ul className="insp-links part-links__fasteners" aria-label={fastenersTitle}>
          {fasteners.map((f) => (
            <li key={f.mark} className="insp-fastener" data-fastener={f.mark}>
              <b>{f.mark}</b>
              <span className="insp-fastener__name">{t.t(f.name)}</span>
              <span className="insp-link__detail num">
                {t.t("ui.fab.list.quantity", { count: f.quantity })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
