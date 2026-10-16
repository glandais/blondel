/**
 * Maillages d'affichage du site dans la vue 3D (repère du cœur, mm, z vers le haut) : murs
 * (percés de leurs baies), poteaux droits et ronds, vantaux de portes, vitrages des fenêtres,
 * zones interdites (plaque mince au sol) et contour de la pièce (ligne au sol). Présentation
 * seulement : le rattachement d'une baie à son mur est celui de l'adéquation au site
 * (`bayWall` du cœur), les murs et poteaux montent du sol fini bas à la sous-face du plancher
 * haut (H − épaisseur du plancher), comme le suppose le cœur (« éléments qui montent sur toute
 * la hauteur »).
 */
import {
  bayWall,
  ensureCCW,
  postPolygon,
  type Obstacle,
  type Polygon2,
  type Site,
  type Vec2,
  type Wall,
} from "@blondel/core";
import { mergeMeshes, meshExtrusion, type Mesh } from "@blondel/geometry";

/** Hauteur d'affichage d'une porte (mm) : le site n'en décrit pas (présentation, à valider). */
export const DOOR_DISPLAY_HEIGHT_MM = 2040;
/** Épaisseur d'affichage d'un vantail de porte (mm, présentation). */
export const DOOR_LEAF_MM = 40;
/** Épaisseur d'affichage d'un vitrage de fenêtre (mm, présentation). */
export const WINDOW_PANE_MM = 24;
/** Épaisseur d'affichage d'une zone interdite au sol (mm, présentation). */
export const ZONE_DISPLAY_MM = 4;
/** Facettes d'un poteau rond (présentation). */
export const CIRCULAR_POST_SEGMENTS = 32;

export interface SiteSceneMeshes {
  /** Murs et poteaux (volumes opaques à la lumière). */
  readonly solids: Mesh | undefined;
  /** Vantaux des portes. */
  readonly doors: Mesh | undefined;
  /** Vitrages des fenêtres. */
  readonly panes: Mesh | undefined;
  /** Zones interdites (plaques minces au sol). */
  readonly zones: Mesh | undefined;
  /** Contour de la pièce au sol (boucle fermée), vide sans contour. */
  readonly room: readonly Vec2[];
}

type Bay = Extract<Obstacle, { kind: "door" | "window" }>;

/** Prisme vertical de base `outline` entre `z0` et `z1` ; `undefined` s'il est dégénéré. */
function prism(outline: Polygon2, z0: number, z1: number): Mesh | undefined {
  if (!(z1 - z0 > 1e-6) || outline.length < 3) return undefined;
  try {
    return meshExtrusion(
      {
        origin: { x: 0, y: 0, z: z0 },
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        zAxis: { x: 0, y: 0, z: 1 },
      },
      { outer: ensureCCW(outline), holes: [] },
      z1 - z0,
    );
  } catch {
    return undefined; // contour dégénéré : élément non affiché.
  }
}

/** Rectangle en plan d'axe `a`–`b`, d'épaisseur `thickness` centrée sur l'axe. */
function band(a: Vec2, b: Vec2, thickness: number): Polygon2 {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(L > 0)) return [];
  const nx = (-(b.y - a.y) / L) * (thickness / 2);
  const ny = ((b.x - a.x) / L) * (thickness / 2);
  return [
    { x: a.x - nx, y: a.y - ny },
    { x: b.x - nx, y: b.y - ny },
    { x: b.x + nx, y: b.y + ny },
    { x: a.x + nx, y: a.y + ny },
  ];
}

/** Intervalles [z0, z1] de [0, top] privés des intervalles `holes` (réunis). */
export function subtractIntervals(
  top: number,
  holes: readonly (readonly [number, number])[],
): [number, number][] {
  const sorted = holes
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(top, Math.max(a, b))] as const)
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let z = 0;
  for (const [a, b] of sorted) {
    if (a > z) out.push([z, a]);
    z = Math.max(z, b);
  }
  if (top > z) out.push([z, top]);
  return out;
}

/** Ouverture verticale d'une baie dans son mur (mm depuis le sol fini bas). */
function bayHole(o: Bay): [number, number] {
  return o.kind === "door" ? [0, DOOR_DISPLAY_HEIGHT_MM] : [o.sill, o.head];
}

/**
 * Tronçons d'un mur de hauteur `top` percé des baies `bays` (abscisses `s0`–`s1` le long de son
 * axe) : entre deux abscisses de baies consécutives, la hauteur pleine privée des ouvertures
 * des baies qui couvrent le tronçon.
 */
function wallPieces(
  w: Wall,
  bays: readonly { readonly s0: number; readonly s1: number; readonly hole: [number, number] }[],
  top: number,
): Mesh[] {
  const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  if (!(L > 0)) return [];
  const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
  const at = (s: number): Vec2 => ({ x: w.a.x + u.x * s, y: w.a.y + u.y * s });
  const cuts = [
    ...new Set([0, L, ...bays.flatMap((b) => [b.s0, b.s1]).filter((s) => s > 0 && s < L)]),
  ].sort((p, q) => p - q);
  const out: Mesh[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const s0 = cuts[i]!;
    const s1 = cuts[i + 1]!;
    if (!(s1 - s0 > 1e-6)) continue;
    const mid = (s0 + s1) / 2;
    const holes = bays.filter((b) => b.s0 < mid && mid < b.s1).map((b) => b.hole);
    const outline = band(at(s0), at(s1), w.thickness);
    for (const [z0, z1] of subtractIntervals(top, holes)) {
      const m = prism(outline, z0, z1);
      if (m) out.push(m);
    }
  }
  return out;
}

function circle(center: Vec2, radius: number): Polygon2 {
  const out: Vec2[] = [];
  for (let k = 0; k < CIRCULAR_POST_SEGMENTS; k++) {
    const t = (2 * Math.PI * k) / CIRCULAR_POST_SEGMENTS;
    out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return out;
}

const merged = (meshes: readonly Mesh[]): Mesh | undefined =>
  meshes.length > 0 ? mergeMeshes(meshes) : undefined;

/** Maillages d'affichage du site (voir l'en-tête). */
export function siteSceneMeshes(site: Site): SiteSceneMeshes {
  const top = site.floorToFloor - site.upperSlabThickness;
  const obstacles = site.obstacles ?? [];
  const bays = obstacles.filter((o): o is Bay => o.kind === "door" || o.kind === "window");
  const placed = bays.map((o) => ({ o, on: bayWall(o, site.walls) }));

  const solids: Mesh[] = [];
  for (const w of site.walls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (!(L > 0)) continue;
    const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const s = (p: Vec2): number => (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y;
    const own = placed
      .filter((p) => p.on?.wall === w)
      .map(({ o, on }) => {
        const sa = s(on!.a);
        const sb = s(on!.b);
        return {
          s0: Math.max(0, Math.min(sa, sb)),
          s1: Math.min(L, Math.max(sa, sb)),
          hole: bayHole(o),
        };
      })
      .filter((b) => b.s1 > b.s0);
    solids.push(...wallPieces(w, own, top));
  }
  for (const o of obstacles) {
    const m =
      o.kind === "post"
        ? prism(postPolygon(o), 0, top)
        : o.kind === "circularPost"
          ? prism(circle(o.center, o.radius), 0, top)
          : undefined;
    if (m) solids.push(m);
  }

  const doors: Mesh[] = [];
  const panes: Mesh[] = [];
  for (const { o, on } of placed) {
    const a = on?.a ?? o.a;
    const b = on?.b ?? o.b;
    const m =
      o.kind === "door"
        ? prism(band(a, b, DOOR_LEAF_MM), 0, Math.min(DOOR_DISPLAY_HEIGHT_MM, top))
        : prism(band(a, b, WINDOW_PANE_MM), o.sill, Math.min(o.head, top));
    if (m) (o.kind === "door" ? doors : panes).push(m);
  }

  const zones: Mesh[] = [];
  for (const o of obstacles) {
    if (o.kind !== "zone") continue;
    const m = prism(o.points, 0, ZONE_DISPLAY_MM);
    if (m) zones.push(m);
  }

  return {
    solids: merged(solids),
    doors: merged(doors),
    panes: merged(panes),
    zones: merged(zones),
    room: site.room?.points ?? [],
  };
}
