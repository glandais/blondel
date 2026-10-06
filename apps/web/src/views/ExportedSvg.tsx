/**
 * Insertion d'un SVG produit par `@blondel/exports` (fonction pure de notre code, jamais du
 * contenu saisi par l'utilisateur). Les éléments de marche portent `data-tread` : la marche
 * sélectionnée est surlignée par CSS et un clic sur une marche la sélectionne ; un clic
 * ailleurs dans le dessin (« dans le vide ») appelle `onClickEmpty`.
 *
 * Nez d'arrivée (QUESTIONS A28) : la cible posée par `withNosingTarget` (`data-nosing-target`)
 * sélectionne ce nez (`onSelectNosing`) ; le nez sélectionné (`selectedNosing`, ligne du plan
 * ou point de l'élévation `data-nosing`) est surligné comme une marche.
 *
 * Clavier (sélectionnable seulement) : la première forme de chaque marche reçoit le focus
 * (Tab), un rôle de bouton et le nom « Marche n » ; Entrée ou Espace la sélectionne (inspecteur
 * Marche, bloc « Ligne de nez ») ; la cible du nez d'arrivée est focalisable de la même façon.
 * Le dessin devient alors un groupe (`role="group"`) pour que ses marches restent atteignables
 * par les technologies d'assistance.
 */
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useT } from "../i18n/useT.js";
import { nosingIndexFromAttribute, treadNumberFromAttribute } from "../lib/compliance.js";

export interface ExportedSvgProps {
  readonly svg: string;
  readonly label: string;
  readonly selectedTread?: number | undefined;
  readonly onSelectTread?: (n: number) => void;
  /** Nez sélectionné (surligné : ligne du plan, point de l'élévation). */
  readonly selectedNosing?: number | undefined;
  /** Clic ou Entrée sur la cible d'un nez (`[data-nosing-target]`, nez d'arrivée). */
  readonly onSelectNosing?: (index: number) => void;
  /** Clic hors de tout élément de marche (`[data-tread]`) ou de nez sélectionnable. */
  readonly onClickEmpty?: () => void;
}

/** Formes de marche rendues focalisables (pas les textes de numéro). */
const TREAD_SHAPES = "polygon[data-tread], path[data-tread]";

/** Cible d'un événement : nez sélectionnable, marche, ou rien. */
export type SvgHit =
  | { readonly kind: "nosing"; readonly index: number }
  | { readonly kind: "tread"; readonly number: number }
  | null;

/** Élément réduit à ce que la recherche de cible consulte (testable sans DOM). */
export interface HitElement {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** Cible d'un clic : la cible du nez d'arrivée l'emporte sur la marche qu'elle recouvre. */
export function svgHit(target: HitElement | null): SvgHit {
  if (target === null) return null;
  const k = nosingIndexFromAttribute(
    target.closest("[data-nosing-target]")?.getAttribute("data-nosing-target"),
  );
  if (k !== undefined) return { kind: "nosing", index: k };
  const n = treadNumberFromAttribute(target.closest("[data-tread]")?.getAttribute("data-tread"));
  return n === undefined ? null : { kind: "tread", number: n };
}

const asHitElement = (target: EventTarget): HitElement | null =>
  typeof Element !== "undefined" && target instanceof Element ? target : null;

/** Règles CSS de surlignage de la sélection (marche, nez), vides sans sélection. */
export function highlightCss(selectedTread?: number, selectedNosing?: number): string {
  const rules: string[] = [];
  if (selectedTread !== undefined) {
    rules.push(
      `.svg-export polygon[data-tread="${selectedTread}"], .svg-export path[data-tread="${selectedTread}"] { fill: var(--selected-fill); stroke: var(--selected); stroke-width: 2px; }`,
    );
  }
  if (selectedNosing !== undefined) {
    rules.push(
      `.svg-export line[data-nosing="${selectedNosing}"] { stroke: var(--selected); stroke-width: 3px; }`,
      `.svg-export circle[data-nosing="${selectedNosing}"] { fill: var(--selected); r: 4px; }`,
    );
  }
  return rules.join(" ");
}

export function ExportedSvg({
  svg,
  label,
  selectedTread,
  onSelectTread,
  selectedNosing,
  onSelectNosing,
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

  const select = (hit: SvgHit): boolean => {
    if (hit?.kind === "nosing" && onSelectNosing) {
      onSelectNosing(hit.index);
      return true;
    }
    if (hit?.kind === "tread" && onSelectTread) {
      onSelectTread(hit.number);
      return true;
    }
    return false;
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!select(svgHit(asHitElement(e.target)))) onClickEmpty?.();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (select(svgHit(asHitElement(e.target)))) e.preventDefault();
  };
  const highlight = highlightCss(selectedTread, selectedNosing);
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
