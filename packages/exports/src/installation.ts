/**
 * Données de la fiche de pose (CHALLENGE P7) : traçage au sol du départ et de l'arrivée, cotes
 * d'implantation par rapport aux nus des murs et à la trémie, diagonales de contrôle, hauteurs
 * et épure des lignes de nez au sol.
 *
 * Toutes les coordonnées sont dans le repère du site (celui du relevé : murs et trémie saisis
 * dans `project.site`, tracé déjà placé par `stair.placement`). Les murs sont décrits par leur
 * axe et leur épaisseur (`WallSchema`) : leurs nus sont à ± épaisseur / 2 de l'axe. Aucune
 * tolérance n'est écrite ici : la tolérance de la première marche est lue dans le contrôle de
 * conception (règle `H_PREMIERE_MARCHE_TOL` quand elle s'applique).
 */
import {
  curvePointAt,
  curveLength,
  vec2,
  type Model,
  type Project,
  type Vec2,
  type Wall,
} from "@blondel/core";
import { msg } from "@blondel/i18n";
import { modelOpening } from "./annotations.js";
import { translatorOf, type LocaleOption } from "./i18n.js";

export interface InstallationPoint {
  readonly id: "start-inner" | "start-outer" | "start-walkline" | "end-inner" | "end-outer";
  readonly label: string;
  readonly at: Vec2;
}

export interface WallOffset {
  readonly pointId: InstallationPoint["id"];
  readonly wallId: string;
  /** Distance au nu du mur situé du côté du point (négative : point dans l'épaisseur du mur). */
  readonly distance: number;
  /** Pied de la perpendiculaire sur le nu. */
  readonly foot: Vec2;
  /** Le pied tombe entre les extrémités du mur (sinon : sur son prolongement). */
  readonly onWall: boolean;
}

export interface OpeningOffset {
  readonly pointId: InstallationPoint["id"];
  /** Distance au bord de trémie le plus proche. */
  readonly distance: number;
  /** Indice du bord (côté i du contour, du sommet i au sommet i + 1). */
  readonly edge: number;
  readonly foot: Vec2;
  /** Point à l'aplomb de la trémie (vide du plancher haut). */
  readonly inside: boolean;
}

export interface InstallationSheet {
  /** Côté du jour par rapport au sens de la montée. */
  readonly innerSide: "left" | "right";
  readonly points: readonly InstallationPoint[];
  /** Largeur de la ligne de départ (bord intérieur → bord extérieur). */
  readonly startWidth?: number;
  /** Diagonales de contrôle entre les extrémités du départ et de l'arrivée. */
  readonly diagonals: readonly {
    readonly from: string;
    readonly to: string;
    readonly length: number;
  }[];
  readonly walls: readonly WallOffset[];
  readonly wallIds: readonly string[];
  readonly opening?: {
    readonly outline: readonly Vec2[];
    readonly offsets: readonly OpeningOffset[];
  };
  readonly heights: {
    readonly total: number;
    readonly count: number;
    readonly first?: number;
    readonly nominal: number;
    /** Tolérance de la 1re marche après pose, lue dans le contrôle de conception. */
    readonly firstTolerance?: {
      readonly min: number;
      readonly max: number;
      readonly source: string;
    };
  };
  /** Épure au sol : lignes de nez (Q côté jour, R côté extérieur) et altitude du nez. */
  readonly nosings: readonly {
    readonly index: number;
    readonly q: Vec2;
    readonly r: Vec2;
    readonly z: number;
  }[];
  /** Le projet (murs, trémie) a été fourni. */
  readonly hasSite: boolean;
}

/** Nus d'un mur : axe décalé de ± épaisseur / 2. Renvoie le nu côté `p`. */
export function wallOffset(
  wall: Wall,
  p: Vec2,
): Omit<WallOffset, "pointId" | "wallId"> | undefined {
  const a = { x: wall.a.x, y: wall.a.y };
  const b = { x: wall.b.x, y: wall.b.y };
  const ab = vec2.sub(b, a);
  const len = vec2.norm(ab);
  if (!(len > 0)) return undefined;
  const u = vec2.scale(ab, 1 / len);
  const n = vec2.perpLeft(u);
  const ap = vec2.sub(p, a);
  const along = vec2.dot(ap, u);
  const signed = vec2.dot(ap, n);
  const side = signed >= 0 ? 1 : -1;
  const half = wall.thickness / 2;
  const foot = vec2.add(vec2.add(a, vec2.scale(u, along)), vec2.scale(n, side * half));
  return {
    distance: Math.abs(signed) - half,
    foot,
    onWall: along >= -1e-9 && along <= len + 1e-9,
  };
}

function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function nearestEdge(
  p: Vec2,
  poly: readonly Vec2[],
): { distance: number; edge: number; foot: Vec2 } {
  let best = { distance: Infinity, edge: 0, foot: p };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ab = vec2.sub(b, a);
    const l2 = vec2.dot(ab, ab);
    const t = l2 > 0 ? Math.min(1, Math.max(0, vec2.dot(vec2.sub(p, a), ab) / l2)) : 0;
    const foot = vec2.add(a, vec2.scale(ab, t));
    const d = vec2.distance(p, foot);
    if (d < best.distance) best = { distance: d, edge: i, foot };
  }
  return best;
}

/** Options de la fiche de pose. */
export type InstallationSheetOptions = LocaleOption;

/**
 * Données de la fiche de pose. `project` absent : ni murs ni trémie. `options.locale` : langue
 * des libellés des points (défaut « fr »).
 */
export function installationSheet(
  model: Model,
  project?: Project,
  options: InstallationSheetOptions = {},
): InstallationSheet {
  // Libellés des points et des diagonales dans la langue de l'option `locale`.
  const t = translatorOf(options);
  const { layout, stepping } = model;
  const side = msg(
    layout.innerSide === "left" ? "installation.side.left" : "installation.side.right",
  );
  const other = msg(
    layout.innerSide === "left" ? "installation.side.right" : "installation.side.left",
  );
  const points: InstallationPoint[] = [];
  const ends = (c: typeof layout.inner): [Vec2, Vec2] | undefined =>
    c.segments.length > 0 ? [curvePointAt(c, 0), curvePointAt(c, curveLength(c))] : undefined;
  const inner = ends(layout.inner);
  const outer = ends(layout.outer);
  const walk = ends(layout.walkline);
  if (inner)
    points.push({
      id: "start-inner",
      label: t.t("installation.point.startInner", { side }),
      at: inner[0],
    });
  if (outer)
    points.push({
      id: "start-outer",
      label: t.t("installation.point.startOuter", { side: other }),
      at: outer[0],
    });
  if (walk)
    points.push({
      id: "start-walkline",
      label: t.t("installation.point.startWalkline"),
      at: walk[0],
    });
  if (inner)
    points.push({
      id: "end-inner",
      label: t.t("installation.point.endInner", { side }),
      at: inner[1],
    });
  if (outer)
    points.push({
      id: "end-outer",
      label: t.t("installation.point.endOuter", { side: other }),
      at: outer[1],
    });
  const byId = new Map(points.map((p) => [p.id, p]));

  const diagonals: { from: string; to: string; length: number }[] = [];
  const diag = (
    a: InstallationPoint["id"],
    b: InstallationPoint["id"],
    from: string,
    to: string,
  ): void => {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (pa && pb) diagonals.push({ from, to, length: vec2.distance(pa.at, pb.at) });
  };
  diag(
    "start-inner",
    "end-outer",
    t.t("installation.diagonal.startInner"),
    t.t("installation.diagonal.endOuter"),
  );
  diag(
    "start-outer",
    "end-inner",
    t.t("installation.diagonal.startOuter"),
    t.t("installation.diagonal.endInner"),
  );

  const walls: WallOffset[] = [];
  const siteWalls = project?.site.walls ?? [];
  for (const p of points) {
    if (p.id === "start-walkline") continue;
    for (const w of siteWalls) {
      const o = wallOffset(w, p.at);
      if (o) walls.push({ pointId: p.id, wallId: w.id, ...o });
    }
  }

  const poly = modelOpening(model, project);
  const opening =
    poly !== undefined && poly.length >= 3
      ? {
          outline: poly,
          offsets: points
            .filter((p) => p.id !== "start-walkline")
            .map((p) => ({
              pointId: p.id,
              ...nearestEdge(p.at, poly),
              inside: pointInPolygon(p.at, poly),
            })),
        }
      : undefined;

  const firstRule = model.compliance.results.find((r) => r.ruleId === "H_PREMIERE_MARCHE_TOL");
  const first = stepping.rises[0];
  const total = stepping.rises.reduce((s, h) => s + h, 0);
  return {
    innerSide: layout.innerSide,
    points,
    ...(inner && outer ? { startWidth: vec2.distance(inner[0], outer[0]) } : {}),
    diagonals,
    walls,
    wallIds: siteWalls.map((w) => w.id),
    ...(opening ? { opening } : {}),
    heights: {
      total: project?.site.floorToFloor ?? total,
      count: stepping.riserCount,
      ...(first !== undefined ? { first } : {}),
      nominal: stepping.rise,
      ...(firstRule !== undefined &&
      typeof firstRule.min === "number" &&
      typeof firstRule.max === "number"
        ? { firstTolerance: { min: firstRule.min, max: firstRule.max, source: firstRule.source } }
        : {}),
    },
    nosings: stepping.nosings.map((n) => ({ index: n.index, q: n.q, r: n.r, z: n.z })),
    hasSite: project !== undefined,
  };
}
