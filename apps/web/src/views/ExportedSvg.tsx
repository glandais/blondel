/**
 * Insertion d'un SVG produit par `@blondel/exports` (fonction pure de notre code, jamais du
 * contenu saisi par l'utilisateur). Les éléments de marche portent `data-tread` : la marche
 * sélectionnée est surlignée par CSS et un clic sur une marche la sélectionne.
 */
import type { MouseEvent } from "react";
import { treadNumberFromAttribute } from "../lib/compliance.js";

export interface ExportedSvgProps {
  readonly svg: string;
  readonly label: string;
  readonly selectedTread?: number | undefined;
  readonly onSelectTread?: (n: number) => void;
}

export function ExportedSvg({ svg, label, selectedTread, onSelectTread }: ExportedSvgProps) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSelectTread || !(e.target instanceof Element)) return;
    const n = treadNumberFromAttribute(
      e.target.closest("[data-tread]")?.getAttribute("data-tread"),
    );
    if (n !== undefined) onSelectTread(n);
  };
  const highlight =
    selectedTread === undefined
      ? ""
      : `.svg-export polygon[data-tread="${selectedTread}"], .svg-export path[data-tread="${selectedTread}"] { fill: var(--selected-fill); stroke: var(--selected); stroke-width: 2px; }`;
  return (
    <>
      {highlight ? <style>{highlight}</style> : null}
      <div
        className="svg-export"
        role="img"
        aria-label={label}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </>
  );
}
