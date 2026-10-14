/**
 * Formes d'affichage de l'éditeur de plan (ADR-0010, sous-lot 4a) : chemins SVG des tronçons,
 * contour d'une jonction, obstacles, attributs de sélection. Fonctions pures, testées sous
 * Node ; elles **assemblent** des points lus dans le `Model` (`layout.sections`, `layout.turns`)
 * ou le site, sans aucun calcul métier (le tracé est celui du cœur, calculé dans le worker).
 *
 * Convention : coordonnées du site (mm, y vers le haut), dessinées dans le groupe `scale(1, -1)`
 * de l'éditeur (voir `planSiteGeometry.ts`).
 */
import {
  doorSwingSector,
  postPolygon,
  type SiteFitProfileInput,
  type Layout,
  type LayoutSection,
  type Obstacle,
  type Vec2,
} from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import type { PlanSelection } from "../../store/planEditor.js";

const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();
const pt = (p: Vec2): string => `${n2(p.x)} ${n2(p.y)}`;

/**
 * Arc SVG de `from` à `to` autour de `center`, de balayage signé `sweep` (rad, positif =
 * trigonométrique) : dans le groupe `scale(1, -1)`, le sens trigonométrique du site est le
 * drapeau de balayage 1 (même convention que `segmentPath`).
 */
function arcTo(center: Vec2, from: Vec2, to: Vec2, sweep: number): string {
  const r = Math.hypot(from.x - center.x, from.y - center.y);
  const large = Math.abs(sweep) > Math.PI ? 1 : 0;
  const flag = sweep > 0 ? 1 : 0;
  return `A${n2(r)} ${n2(r)} 0 ${large} ${flag} ${pt(to)}`;
}

/**
 * Contour d'un tronçon (`d`) : départ gauche → arrivée gauche (droite ou arc concentrique) →
 * arrivée droite → départ droit (retour en sens inverse) → fermeture.
 */
export function sectionPathData(s: LayoutSection): string {
  const { start, end, arc } = s;
  if (s.kind === "arc" && arc !== undefined) {
    return (
      `M${pt(start.left)}${arcTo(arc.center, start.left, end.left, arc.sweep)}` +
      `L${pt(end.right)}${arcTo(arc.center, end.right, start.right, -arc.sweep)}Z`
    );
  }
  return `M${pt(start.left)}L${pt(end.left)}L${pt(end.right)}L${pt(start.right)}Z`;
}

const close = (a: Vec2, b: Vec2): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-6;

/**
 * Tronçons éditables du tracé dans l'éditeur de plan : ceux de `layout.sections`, sauf pour un
 * hélicoïdal (`layout.helical`, F10 sous-lot P2). Calculé par le moteur de cage, l'hélicoïdal
 * porte un tronçon à axe en arc qui peut dépasser un tour ; il se règle dans son propre
 * formulaire (`HelicalEditor`) et reste non sélectionnable en plan, comme avant la bascule.
 */
export function editableSections(layout: Layout): readonly LayoutSection[] {
  return layout.helical ? [] : (layout.sections ?? []);
}

/**
 * Contour de la jonction `j` (zone tournante ou palier entre les tronçons `j` et `j + 1`) pour
 * la sélection : arrivée du tronçon entrant, coin extérieur, départ du tronçon sortant, coin
 * intérieur (sommet du jour), dans l'ordre du pourtour ; sommets confondus retirés. Le coin du
 * côté du jour (`collarSide`, à défaut `direction`) s'insère entre les bords de ce côté. Un
 * raccord de jour en arc est ramené à son coin K : zone de clic approchée, non une cote.
 * `null` si le tracé ne porte pas ces tronçons ou ce tournant.
 */
export function junctionPolygon(layout: Layout, j: number): Vec2[] | null {
  const a = layout.sections?.[j];
  const b = layout.sections?.[j + 1];
  const zone = layout.turns.find((t) => t.index === j) ?? layout.turns[j];
  if (!a || !b || !zone) return null;
  const jourLeft = (zone.collarSide ?? zone.direction) === "left";
  const ring = jourLeft
    ? [a.end.left, a.end.right, zone.outerCorner, b.start.right, b.start.left, zone.innerCorner]
    : [a.end.left, a.end.right, zone.innerCorner, b.start.right, b.start.left, zone.outerCorner];
  const out: Vec2[] = [];
  for (const p of ring) {
    if (out.length === 0 || !close(out[out.length - 1]!, p)) out.push(p);
  }
  while (out.length > 1 && close(out[0]!, out[out.length - 1]!)) out.pop();
  return out.length >= 3 ? out : null;
}

/** Forme d'affichage d'un obstacle du site. */
export type ObstacleShape =
  | { readonly kind: "polygon"; readonly points: readonly Vec2[] }
  | { readonly kind: "circle"; readonly center: Vec2; readonly radius: number }
  | { readonly kind: "bay"; readonly a: Vec2; readonly b: Vec2; readonly swing?: readonly Vec2[] };

/**
 * Forme d'un obstacle : poteau (contour du cœur), poteau rond, baie de porte (avec son secteur
 * de débattement, `doorSwingSector` du cœur : rayon du réglage d'atelier `siteFit` du projet,
 * sinon largeur de la baie, décision F7) ou de fenêtre (segment de la baie), zone interdite.
 */
export function obstacleShape(o: Obstacle, siteFit?: SiteFitProfileInput): ObstacleShape {
  switch (o.kind) {
    case "post":
      return { kind: "polygon", points: postPolygon(o) };
    case "circularPost":
      return { kind: "circle", center: o.center, radius: o.radius };
    case "door": {
      const swing = doorSwingSector(o, siteFit);
      return swing.length > 0
        ? { kind: "bay", a: o.a, b: o.b, swing }
        : { kind: "bay", a: o.a, b: o.b };
    }
    case "window":
      return { kind: "bay", a: o.a, b: o.b };
    case "zone":
      return { kind: "polygon", points: o.points };
  }
}

/** Clé du libellé accessible d'un élément sélectionnable. */
export const SELECTION_LABELS: Readonly<Record<PlanSelection["kind"], MessageKey>> = {
  stair: "ui.plan.editor.select.stair",
  section: "ui.plan.editor.select.section",
  junction: "ui.plan.editor.select.junction",
  wall: "ui.plan.editor.select.wall",
  wallEnd: "ui.plan.editor.select.wallEnd",
  opening: "ui.plan.editor.select.opening",
  openingVertex: "ui.plan.editor.select.openingVertex",
  room: "ui.plan.editor.select.room",
  roomVertex: "ui.plan.editor.select.roomVertex",
  obstacle: "ui.plan.editor.select.obstacle",
};

/** Paramètres du libellé d'un élément (numéros à partir de 1). */
export function selectionLabelParams(sel: PlanSelection): Record<string, string | number> {
  switch (sel.kind) {
    case "stair":
    case "opening":
    case "room":
      return {};
    case "section":
    case "junction":
    case "openingVertex":
    case "roomVertex":
      return { index: sel.index + 1 };
    case "wall":
    case "obstacle":
      return { id: sel.id };
    case "wallEnd":
      return { id: sel.id, end: sel.end.toUpperCase() };
  }
}

/**
 * Attribut `data-plan-select` d'un élément sélectionnable (lu au clic par délégation) :
 * `stair`, `section:1`, `wallEnd:m1:a`… ; `parsePlanSelection` le relit.
 */
export function planSelectionKey(sel: PlanSelection): string {
  switch (sel.kind) {
    case "stair":
    case "opening":
    case "room":
      return sel.kind;
    case "section":
    case "junction":
    case "openingVertex":
    case "roomVertex":
      return `${sel.kind}:${sel.index}`;
    case "wall":
    case "obstacle":
      return `${sel.kind}:${sel.id}`;
    case "wallEnd":
      return `wallEnd:${sel.end}:${sel.id}`;
  }
}

/** Relit un attribut `data-plan-select` ; `null` si invalide. */
export function parsePlanSelection(key: string | null | undefined): PlanSelection | null {
  if (!key) return null;
  const i = key.indexOf(":");
  const kind = i < 0 ? key : key.slice(0, i);
  const rest = i < 0 ? "" : key.slice(i + 1);
  const index = (): number | null => (/^\d+$/.test(rest) ? Number(rest) : null);
  switch (kind) {
    case "stair":
    case "opening":
    case "room":
      return i < 0 ? { kind } : null;
    case "section":
    case "junction":
    case "openingVertex":
    case "roomVertex": {
      const n = index();
      return n === null ? null : { kind, index: n };
    }
    case "wall":
    case "obstacle":
      return rest.length > 0 ? { kind, id: rest } : null;
    case "wallEnd": {
      const end = rest.slice(0, 1);
      const id = rest.slice(2);
      return (end === "a" || end === "b") && rest[1] === ":" && id.length > 0
        ? { kind, id, end }
        : null;
    }
    default:
      return null;
  }
}
