/**
 * Zoom des SVG exportés affichés (plan coté, élévation) par les commandes − / + / Recadrer de la
 * vue centrale (`uiStore.viewCommand`) : simple agrandissement d'affichage, sans calcul métier ni
 * nouveau rendu du SVG. L'échelle 1 ajuste le dessin au cadre ; au-delà, le cadre défile et le
 * centre de la partie visible reste en place. Clic de sélection et surlignage de marche
 * inchangés (`ExportedSvg`).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { useViewCommand, type ViewCommandKind } from "../../store/uiStore.js";
import { ExportedSvg, type ExportedSvgProps } from "../../views/ExportedSvg.js";

/** Facteur d'un pas de zoom. */
export const ZOOM_STEP = 1.25;
/** Bornes de l'échelle (1 = ajusté au cadre). */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;

/** Échelle après une commande : un pas, borné ; « Recadrer » revient à l'ajustement au cadre. */
export function nextZoom(scale: number, kind: ViewCommandKind): number {
  if (kind === "fit") return 1;
  const next = kind === "zoomIn" ? scale * ZOOM_STEP : scale / ZOOM_STEP;
  // Arrondi : un aller-retour retombe exactement sur l'échelle de départ.
  const rounded = Math.round(next * 1e6) / 1e6;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

export function ZoomableSvg(props: ExportedSvgProps) {
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  /** Centre visible (fractions de la zone défilante) à garder au prochain changement d'échelle. */
  const anchor = useRef<{ x: number; y: number } | null>(null);

  useViewCommand((kind) => {
    const el = box.current;
    if (el && el.scrollWidth > 0 && el.scrollHeight > 0) {
      anchor.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
        y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
      };
    }
    setScale((s) => nextZoom(s, kind));
  });

  useLayoutEffect(() => {
    const el = box.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2;
  }, [scale]);

  const size = `${scale * 100}%`;
  return (
    <div ref={box} className="zoomable" data-zoom={scale}>
      <div className="zoomable__content" style={{ width: size, height: size }}>
        <ExportedSvg {...props} />
      </div>
    </div>
  );
}
