/**
 * Insertion d'un SVG produit par `@blondel/exports` (fonction pure de notre code, jamais du
 * contenu saisi par l'utilisateur). Les éléments de marche portent `data-tread` : la marche
 * sélectionnée est surlignée par CSS et un clic sur une marche la sélectionne ; un clic
 * ailleurs dans le dessin (« dans le vide ») appelle `onClickEmpty`.
 *
 * Clavier (sélectionnable seulement) : la première forme de chaque marche reçoit le focus
 * (Tab), un rôle de bouton et le nom « Marche n » ; Entrée ou Espace la sélectionne (inspecteur
 * Marche, bloc « Ligne de nez »). Le dessin devient alors un groupe (`role="group"`) pour que ses
 * marches restent atteignables par les technologies d'assistance.
 */
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useT } from "../i18n/useT.js";
import { treadNumberFromAttribute } from "../lib/compliance.js";

export interface ExportedSvgProps {
  readonly svg: string;
  readonly label: string;
  readonly selectedTread?: number | undefined;
  readonly onSelectTread?: (n: number) => void;
  /** Clic hors de tout élément de marche (`[data-tread]`). */
  readonly onClickEmpty?: () => void;
}

/** Formes de marche rendues focalisables (pas les textes de numéro). */
const TREAD_SHAPES = "polygon[data-tread], path[data-tread]";

/** Numéro de marche de la cible d'un événement, `undefined` hors marche. */
function treadOf(target: EventTarget): number | undefined {
  if (!(target instanceof Element)) return undefined;
  return treadNumberFromAttribute(target.closest("[data-tread]")?.getAttribute("data-tread"));
}

export function ExportedSvg({
  svg,
  label,
  selectedTread,
  onSelectTread,
  onClickEmpty,
}: ExportedSvgProps) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const selectable = onSelectTread !== undefined;

  // Une forme focalisable par marche, nommée « Marche n » (après chaque nouveau rendu du SVG).
  useEffect(() => {
    const root = box.current;
    if (!root || !selectable) return;
    const seen = new Set<number>();
    for (const el of root.querySelectorAll(TREAD_SHAPES)) {
      const n = treadNumberFromAttribute(el.getAttribute("data-tread"));
      if (n === undefined || seen.has(n)) continue;
      seen.add(n);
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", t.t("ui.lib.location.tread", { number: String(n) }));
    }
  }, [svg, selectable, t]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const n = treadOf(e.target);
    if (n !== undefined) onSelectTread?.(n);
    else onClickEmpty?.();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const n = treadOf(e.target);
    if (n === undefined || !onSelectTread) return;
    e.preventDefault();
    onSelectTread(n);
  };
  const highlight =
    selectedTread === undefined
      ? ""
      : `.svg-export polygon[data-tread="${selectedTread}"], .svg-export path[data-tread="${selectedTread}"] { fill: var(--selected-fill); stroke: var(--selected); stroke-width: 2px; }`;
  return (
    <>
      {highlight ? <style>{highlight}</style> : null}
      <div
        ref={box}
        className="svg-export"
        role={selectable ? "group" : "img"}
        aria-label={label}
        onClick={onClick}
        onKeyDown={selectable ? onKeyDown : undefined}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </>
  );
}
