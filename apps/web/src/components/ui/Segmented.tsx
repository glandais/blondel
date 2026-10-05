/**
 * Contrôle segmenté du système Industry (`.seg` + `.seg-opt`, ADR-0009) : un choix parmi
 * quelques options, sur des `<button>`.
 *
 * - `semantics="radio"` (défaut) : groupe de boutons radio (`radiogroup` / `radio`, `aria-checked`) ;
 *   `semantics="tabs"` : liste d'onglets (`tablist` / `tab`, `aria-selected`).
 * - Focus itinérant : seule l'option choisie est dans l'ordre de tabulation. Les flèches
 *   (gauche / droite, haut / bas) déplacent le focus et choisissent ; Début / Fin vont aux
 *   extrémités ; les options désactivées sont sautées.
 *
 * Aucun texte n'est écrit ici : nom du groupe et libellés viennent des props (dictionnaire).
 */
import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "./Icon.js";

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly disabled?: boolean;
  readonly title?: string;
}

export interface SegmentedProps<V extends string> {
  /** Nom accessible du groupe. */
  readonly label: string;
  readonly value: V;
  readonly options: readonly SegmentedOption<V>[];
  readonly onChange: (value: V) => void;
  readonly semantics?: "radio" | "tabs";
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
  /** Préfixe des `id` des options (`<prefix>-<value>`), par exemple pour `aria-labelledby`. */
  readonly idPrefix?: string;
}

/**
 * Option atteinte depuis `current` par la touche `key`, en sautant les options désactivées
 * (`disabled[i]`). Les flèches bouclent d'une extrémité à l'autre. `null` : touche sans effet
 * (non gérée, ou aucune option disponible).
 */
export function nextIndex(
  current: number,
  key: string,
  disabled: readonly boolean[],
): number | null {
  const n = disabled.length;
  const enabled = (i: number) => disabled[i] !== true;
  const scan = (start: number, step: 1 | -1): number | null => {
    for (let k = 0; k < n; k++) {
      const i = (((start + step * k) % n) + n) % n;
      if (enabled(i)) return i;
    }
    return null;
  };
  if (n === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return scan(current + 1, 1);
    case "ArrowLeft":
    case "ArrowUp":
      return scan(current - 1, -1);
    case "Home":
      return scan(0, 1);
    case "End":
      return scan(n - 1, -1);
    default:
      return null;
  }
}

/** Option qui porte le focus itinérant : la choisie si elle est active, sinon la première active. */
export function rovingIndex<V extends string>(
  options: readonly SegmentedOption<V>[],
  value: V,
): number {
  const i = options.findIndex((o) => o.value === value && o.disabled !== true);
  return i >= 0 ? i : options.findIndex((o) => o.disabled !== true);
}

export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
  semantics = "radio",
  size = "md",
  className,
  idPrefix,
}: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = semantics === "tabs";
  const focusable = rovingIndex(options, value);
  const classes = ["seg", size === "md" ? null : `seg--${size}`, className]
    .filter(Boolean)
    .join(" ");

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextIndex(
      index,
      e.key,
      options.map((o) => o.disabled === true),
    );
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    const option = options[next];
    if (option && option.value !== value) onChange(option.value);
  };

  return (
    <div role={tabs ? "tablist" : "radiogroup"} aria-label={label} className={classes}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            id={idPrefix === undefined ? undefined : `${idPrefix}-${o.value}`}
            className="seg-opt"
            role={tabs ? "tab" : "radio"}
            aria-checked={tabs ? undefined : selected}
            aria-selected={tabs ? selected : undefined}
            tabIndex={i === focusable ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            onClick={() => {
              if (!selected) onChange(o.value);
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon ? <Icon icon={o.icon} size={size === "sm" ? 14 : 16} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
