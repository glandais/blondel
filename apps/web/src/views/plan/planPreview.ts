/**
 * Retour en direct de l'éditeur de plan et calque des conflits interactif (ADR-0010, plan F,
 * sous-lot 4c). Fonctions pures d'affichage, testées sous Node, **sans calcul métier** : elles
 * choisissent ce qui est dessiné (dernier modèle complet ou dernier aperçu du worker), reportent
 * un dessin à un autre placement (déplacement rigide, comme `placedFootprint`) et relient un
 * conflit de `Model.siteFit` à l'élément du plan qu'il vise.
 *
 * Retour en direct, trois niveaux :
 *
 * 1. Déplacement ou rotation de l'escalier : le dernier dessin (modèle ou aperçu) est transformé
 *    à l'affichage (`placementTransform`, attribut `transform` SVG), aucun calcul ; les conflits
 *    liés au site sont masqués pendant le report (seul `selfOverlap` le suit).
 * 2. Autres glissers : le dernier aperçu reçu du worker (`PreviewView` : tracé, découpage léger,
 *    conflits géométriques) remplace le tracé, les nez et les conflits du modèle (`planDisplay`).
 * 3. Relâchement : le modèle complet remplace l'aperçu dès sa publication.
 */
import {
  pointInPolygon,
  type Model,
  type Project,
  type SiteConflict,
  type Site,
  type Vec2,
} from "@blondel/core";
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import type { PreviewView } from "../../store/modelStore.js";
import type { PlanSelection } from "../../store/planEditor.js";

/** Placement de l'escalier (`project.stair.placement`). */
type Placement = Project["stair"]["placement"];

const n6 = (v: number): string => {
  const r = Math.round(v * 1e6) / 1e6;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/**
 * Transformation SVG (`matrix(a b c d e f)`, repère du site) qui reporte un dessin fait au
 * placement `from` au placement `to` : p ↦ R(Δ)·(p − o_from) + o_to, Δ = rotation_to −
 * rotation_from (degrés, sens trigonométrique). `null` si les placements sont égaux (aucun
 * attribut à poser).
 */
export function placementTransform(from: Placement, to: Placement): string | null {
  const dr = to.rotation - from.rotation;
  if (dr === 0 && from.origin.x === to.origin.x && from.origin.y === to.origin.y) return null;
  const a = (dr * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = to.origin.x - (c * from.origin.x - s * from.origin.y);
  const f = to.origin.y - (s * from.origin.x + c * from.origin.y);
  return `matrix(${[c, s, -s, c, e, f].map(n6).join(" ")})`;
}

/** Ce que dessinent les calques escalier, conflits et poignées. */
export interface PlanDisplay {
  /** Modèle dessiné : le modèle complet, ou son tracé, ses nez et ses conflits remplacés par l'aperçu. */
  readonly model: Model;
  /** Projet dont le dessin est issu (positions des poignées), `null` sans modèle. */
  readonly source: Project | null;
  /** Report du dessin au placement courant (niveau 1), ou `null`. */
  readonly transform: string | null;
  /** Le dessin vient de l'aperçu du worker (niveau 2). */
  readonly previewing: boolean;
}

/**
 * Dessin de l'éditeur : l'aperçu s'il porte un tracé (sinon le modèle complet, dernier état
 * valide), reporté au placement du projet courant si celui-ci a changé depuis (déplacement ou
 * rotation en cours, ou modèle pas encore recalculé).
 */
export function planDisplay(
  model: Model,
  modelProject: Project | null,
  preview: PreviewView | null,
  project: Project,
): PlanDisplay {
  const layout = preview?.result.layout;
  const shown: Model =
    preview && layout
      ? {
          ...model,
          layout,
          stepping: preview.result.stepping ?? { ...model.stepping, nosings: [], treads: [] },
          siteFit: preview.result.siteFit,
        }
      : model;
  const source = preview && layout ? preview.project : modelProject;
  const transform = source
    ? placementTransform(source.stair.placement, project.stair.placement)
    : null;
  // Report d'un dessin : les conflits liés au site (mur, dalle, baie, débattement, obstacle,
  // pièce, dégagement, échappée) ne suivent pas l'escalier ; reportés, ils seraient faux. Seuls
  // restent ceux propres à l'escalier (recouvrement de ses tronçons), qu'un déplacement rigide
  // conserve ; les autres reviennent avec le modèle complet.
  const drawn: Model =
    transform && shown.siteFit?.some((c) => !STAIR_ONLY_CONFLICTS.has(c.kind))
      ? { ...shown, siteFit: shown.siteFit.filter((c) => STAIR_ONLY_CONFLICTS.has(c.kind)) }
      : shown;
  return {
    model: drawn,
    source,
    transform,
    previewing: shown !== model,
  };
}

/** Conflits propres à l'escalier, invariants par déplacement ou rotation (report d'affichage). */
const STAIR_ONLY_CONFLICTS: ReadonlySet<SiteConflict["kind"]> = new Set(["selfOverlap"]);

/** Paramètre entier d'un message (numéro de tronçon d'un recouvrement). */
function intParam(m: Message, name: string): number | undefined {
  const v = m.params?.[name];
  return typeof v === "number" && Number.isInteger(v) ? v : undefined;
}

/**
 * Élément du plan visé par un conflit (clic sur sa zone) : le mur ou l'obstacle de `targetId`,
 * le premier tronçon d'un recouvrement de l'escalier sur lui-même, sinon l'escalier (dalle,
 * échappée, hors pièce : c'est l'escalier qui est en cause).
 */
export function conflictSelection(c: SiteConflict, site: Site): PlanSelection {
  if (c.targetId !== undefined) {
    if (site.walls.some((w) => w.id === c.targetId)) return { kind: "wall", id: c.targetId };
    if ((site.obstacles ?? []).some((o) => o.id === c.targetId))
      return { kind: "obstacle", id: c.targetId };
  }
  if (c.kind === "selfOverlap") {
    const a = intParam(c.message, "sectionA");
    if (a !== undefined && a >= 1) return { kind: "section", index: a - 1 };
  }
  return { kind: "stair" };
}

/** Conflits dessinés (zone d'au moins trois sommets), avec leur rang dans la liste. */
export function drawnConflicts(
  conflicts: readonly SiteConflict[] | undefined,
): { readonly index: number; readonly conflict: SiteConflict }[] {
  return (conflicts ?? []).flatMap((conflict, index) =>
    conflict.zone.length >= 3 ? [{ index, conflict }] : [],
  );
}

/**
 * Conflit sous un point du site (bulle au survol) : le premier dont la zone contient le point
 * (liste triée par sévérité : le plus grave d'abord), ou `-1`. Le report d'affichage
 * (`transform`) est défait en ramenant le point au placement du dessin.
 */
export function conflictAt(
  conflicts: readonly SiteConflict[] | undefined,
  p: Vec2,
  shown?: { readonly from: Placement; readonly to: Placement } | null,
): number {
  const q = shown ? movePoint(p, shown.to, shown.from) : p;
  for (const { index, conflict } of drawnConflicts(conflicts)) {
    if (pointInPolygon(q, conflict.zone) !== "outside") return index;
  }
  return -1;
}

/** Point reporté du placement `from` au placement `to` (même transformation que ci-dessus). */
export function movePoint(p: Vec2, from: Placement, to: Placement): Vec2 {
  const a = ((to.rotation - from.rotation) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p.x - from.origin.x;
  const dy = p.y - from.origin.y;
  return { x: c * dx - s * dy + to.origin.x, y: s * dx + c * dy + to.origin.y };
}

export const SEVERITY_LABELS: Readonly<Record<SiteConflict["severity"], MessageKey>> = {
  erreur: "site.fit.severity.erreur",
  avertissement: "site.fit.severity.avertissement",
  conseil: "site.fit.severity.conseil",
};

/** Texte d'un conflit : sévérité et message (bulle, libellé accessible). */
export function conflictText(c: SiteConflict): Message {
  return msg("ui.plan.editor.conflict.label", {
    severity: msg(SEVERITY_LABELS[c.severity]),
    text: c.message,
  });
}

/**
 * Annonce de la liste des conflits (zone `aria-live` de l'éditeur) : nombre et textes, ou
 * « aucun conflit ».
 */
export function conflictsAnnouncement(conflicts: readonly SiteConflict[] | undefined): Message {
  const list = conflicts ?? [];
  if (list.length === 0) return msg("ui.plan.editor.conflicts.none");
  const texts = list
    .map(conflictText)
    .reduceRight<Message | null>(
      (rest, first) => (rest === null ? first : msg("common.list", { first, rest })),
      null,
    );
  return msg("ui.plan.editor.conflicts.status", { count: list.length, list: texts! });
}
