/**
 * Cartes de choix du parcours guidé (maquette 1a : forme, structure, remplissage) : grille de
 * boutons bascule (`aria-pressed`) dans un groupe nommé (`role="group"`). Une carte indisponible
 * reste atteignable au clavier (`aria-disabled`, pas `disabled`) et sa raison, écrite sous le
 * libellé, lui est liée par `aria-describedby` ; un clic dessus est sans effet. Les textes
 * viennent de l'appelant (dictionnaire), jamais d'ici.
 */
import { useId, type CSSProperties, type JSX, type ReactNode } from "react";
import "./choiceCards.css";

export interface ChoiceCard<V> {
  readonly value: V;
  /** Libellé court (nom accessible de la carte). */
  readonly label: string;
  /** Nom complet en infobulle. */
  readonly title?: string;
  /** Légende sous le libellé. */
  readonly caption?: string;
  /** Pictogramme décoratif (masqué aux lecteurs d'écran). */
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  /** Raison de l'indisponibilité, écrite sur la carte. */
  readonly reason?: string;
}

export interface ChoiceCardsProps<V extends string> {
  /** Nom du groupe. */
  readonly label: string;
  readonly cards: readonly ChoiceCard<V>[];
  isPressed(v: V): boolean;
  onChoose(v: V): void;
  /** Nombre de colonnes (défaut : 3). */
  readonly columns?: number;
}

export function ChoiceCards<V extends string>({
  label,
  cards,
  isPressed,
  onChoose,
  columns = 3,
}: ChoiceCardsProps<V>): JSX.Element {
  const id = useId();
  const style = { "--choice-columns": columns } as CSSProperties;
  return (
    <div className="choice-cards" role="group" aria-label={label} style={style}>
      {cards.map((c, i) => {
        const pressed = isPressed(c.value);
        const disabled = c.disabled === true;
        const captionId = c.caption !== undefined ? `${id}-caption-${i}` : undefined;
        const reasonId = disabled && c.reason !== undefined ? `${id}-reason-${i}` : undefined;
        const described = [captionId, reasonId].filter((x) => x !== undefined).join(" ");
        return (
          <button
            key={c.value}
            type="button"
            className="choice-card"
            data-value={c.value}
            // Nom accessible : le libellé court ; légende et raison en description.
            aria-label={c.label}
            aria-pressed={pressed}
            {...(disabled ? { "aria-disabled": true } : {})}
            {...(described === "" ? {} : { "aria-describedby": described })}
            {...(c.title === undefined ? {} : { title: c.title })}
            onClick={() => {
              if (!disabled) onChoose(c.value);
            }}
          >
            {c.icon !== undefined ? (
              <span className="choice-card__icon" aria-hidden="true">
                {c.icon}
              </span>
            ) : null}
            <span className="choice-card__label">{c.label}</span>
            {c.caption !== undefined ? (
              <span className="choice-card__caption" id={captionId}>
                {c.caption}
              </span>
            ) : null}
            {reasonId !== undefined ? (
              <span className="choice-card__caption choice-card__reason" id={reasonId}>
                {c.reason}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
