/**
 * Marque ◆ d'une valeur par défaut non sourcée, « à valider » (ADR-0009 point 9).
 *
 * Le glyphe ◆ n'entre jamais dans un nom accessible (un lecteur d'écran lirait « losange noir ») :
 * il est rendu `aria-hidden`, suivi d'un texte masqué qui dit la même chose en mots, « 3 valeurs
 * à valider » avec un compte, « à valider » sans. `silent` ne rend que le glyphe, quand le texte
 * voisin dit déjà « à valider » (« ◆ valeur par défaut à valider », « ◆ 3 restantes » sous un
 * titre « Valeurs à valider »).
 */
import type { Translator } from "@blondel/i18n";
import { useT } from "../../i18n/useT.js";
import "./tvMark.css";

export interface TvMarkProps {
  /** Nombre de valeurs restantes : glyphe suivi du nombre (« ◆3 »). */
  readonly count?: number;
  /** Glyphe seul, sans texte masqué : le texte voisin dit déjà « à valider ». */
  readonly silent?: boolean;
  /**
   * `warn` (défaut) : couleur d'avertissement et petite taille de la marque des champs ;
   * `inherit` : couleur et taille du texte voisin (compteurs, bandes de chiffres).
   */
  readonly tone?: "warn" | "inherit";
  /** Classes ajoutées à la marque visible (`tiered__mark`…). */
  readonly className?: string;
}

/** Texte lu à la place du glyphe : « n valeurs à valider », ou « à valider » sans compte. */
export function tvMarkText(t: Translator, count?: number): string {
  return count === undefined
    ? t.t("ui.tvMark.toValidate")
    : t.t("ui.sections.toValidateCount", { count });
}

export function TvMark({ count, silent = false, tone = "warn", className }: TvMarkProps) {
  const t = useT();
  const classes = ["tv-mark", tone === "inherit" ? "tv-mark--inherit" : null, className ?? null]
    .filter((c) => c !== null)
    .join(" ");
  return (
    <>
      <span className={classes} aria-hidden="true">
        ◆{count === undefined ? null : count}
      </span>
      {silent ? null : <span className="visually-hidden"> {tvMarkText(t, count)}</span>}
    </>
  );
}
