/**
 * Liste de liens vers des pièces (« Pièces de cette marche », « Assemblée avec ») des
 * inspecteurs Marche (2a) et Pièce (2b), ADR-0009, vague 3. Chaque ligne (repère, désignation,
 * section) sélectionne la pièce : la sélection est partagée par toutes les vues et
 * l'inspecteur passe à la 2b de cette pièce. Les petites pièces répétées (supports, barreaux)
 * sont regroupées en une ligne (« CR1–CR9 … ×10 », `groupPartLinks`) qui sélectionne la
 * première. Liste vide : rien n'est rendu.
 */
import type { Part } from "@blondel/core";
import { useT } from "../../i18n/useT.js";
import { groupPartLinks } from "../../lib/partLinks.js";
import { appStore } from "../../store/appStore.js";
import "./part.css";

export interface PartLinkListProps {
  /** Titre (surtitre) du bloc, déjà traduit. */
  readonly title: string;
  /** Pièces liées, dans l'ordre d'affichage ; liste vide : bloc masqué. */
  readonly parts: readonly Part[];
}

export function PartLinkList({ title, parts }: PartLinkListProps) {
  const t = useT();
  if (parts.length === 0) return null;
  return (
    <div className="part-links">
      <span className="insp-section-title">{title}</span>
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
    </div>
  );
}
