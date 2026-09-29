/**
 * Étape « garde-corps » du pipeline (jalon 4) : `computeGuards(project, layout, stepping)`.
 *
 * 1. **Côtés** (`sides.ts`) : bords simplifiés C_i / C_e, portions vides ou murs (murs du site,
 *    ou côté imposé), profil de la ligne des nez, hauteur de chute.
 * 2. **Garde-corps de volée** sur chaque portion vide : axe = bord décalé vers le vide de
 *    `flight.edgeOffset` ; dessus de main courante à `flight.height` au-dessus de la ligne des
 *    nez (mesure à la verticale du nez), horizontal sur les paliers.
 * 3. **Garde-corps de trémie** sur les côtés libres de la trémie (hors arrivée de l'escalier et
 *    murs), en recul `opening.setback` sur le plancher, à `opening.height` au-dessus du sol haut.
 * 4. **Poteaux** aux extrémités, aux angles (déviation > `posts.cornerAngle`) et en
 *    intermédiaire (entraxe ≤ `posts.maxSpacing`) ; un poteau d'angle du tracé (`newel`) en
 *    tient lieu côté jour (pas de pièce générée par les garde-corps).
 * 5. **Remplissage** par travée (entre poteaux) et **vides analytiques** (voir `types.ts`).
 * 6. **Mains courantes** : continues (balayage `sweep`) sur chaque garde-corps, prolongées
 *    horizontalement aux extrémités de l'escalier ; murales selon `handrail.wallSides`.
 *
 * Aucune valeur métier en dur : hauteurs, sections, entraxes et jeux viennent de la
 * spécification (`spec.ts`, défauts sourcés ou « à valider ») ; les seuils de contrôle sont lus
 * dans rules.yaml par les évaluateurs.
 */
import * as V from "../geom2d/vec.js";
import { openingPolygon } from "../headroom/headroom.js";
import type { Layout, Location, MaterialId, Part, Stepping } from "../model/derived.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import type { Project, Wall } from "../model/project.js";
import { fmt } from "../rules/check.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import { GuardError } from "./errors.js";
import { jourWidth, NARROW_JOUR_ERROR_PREFIX, narrowJourThreshold } from "./jour.js";
import {
  MarkRegistry,
  panelMember,
  sectionHeight,
  sectionWidth,
  sweptMember,
  verticalMember,
  type PartFactoryContext,
} from "./parts.js";
import {
  cumulative,
  interp,
  offset,
  offsetStations,
  pointAt,
  slice,
  tangentAt,
  turnAngleDeg,
} from "./polyline.js";
import { analyzeSide, refAt, wallCover, type SideEdge } from "./sides.js";
import { GuardsSpecSchema, type GuardInfill, type GuardsSpec } from "./spec.js";
import type {
  Foothold,
  GapMeasure,
  GuardRun,
  GuardsAnalysis,
  HandrailRun,
  SideAnalysis,
  SideInterval,
  StairSide,
} from "./types.js";

const SIDE_LABEL: Record<StairSide, string> = { inner: "côté jour", outer: "côté extérieur" };

const part = (partId: string): Location => ({ kind: "part", partId });

interface PostPos {
  w: Mm;
  size: Mm;
  /** Poteau d'angle du tracé : pas de pièce de garde-corps. */
  virtual: boolean;
}

interface LineArgs {
  readonly id: string;
  readonly kind: GuardRun["kind"];
  readonly side?: StairSide;
  readonly label: string;
  readonly path: readonly Vec2[];
  readonly ref: readonly Mm[];
  readonly height: Mm;
  /** Sommets imposés comme poteaux d'angle du tracé (indice de sommet → côté du poteau). */
  readonly newelVertices: ReadonlyMap<number, Mm>;
  readonly extensionBottom?: Mm;
  readonly extensionTop?: Mm;
  readonly nosingHeights: readonly { readonly index: number; readonly height: Mm }[];
  readonly fall: Mm;
}

interface LineOutput {
  readonly run: GuardRun;
  readonly parts: Part[];
}

/** Matériau du remplissage. */
function infillMaterial(infill: GuardInfill, spec: GuardsSpec): MaterialId {
  switch (infill.kind) {
    case "cables":
      return "stainless-brushed";
    case "glass":
      return "glass";
    case "perforated":
      return spec.material.startsWith("wood-") ? "steel-painted" : spec.material;
    default:
      return spec.material;
  }
}

/** Épaisseur du remplissage en travers de la ligne (h(E), GC_HAUTEUR_2024). */
function infillThickness(infill: GuardInfill): Mm {
  switch (infill.kind) {
    case "balusters":
      return sectionHeight(infill.section);
    case "rails":
      return sectionWidth(infill.section);
    case "cables":
      return infill.diameter;
    default:
      return infill.thickness;
  }
}

/** Positions des poteaux le long d'une ligne (abscisses du chemin). */
function postPositions(
  path: readonly Vec2[],
  w: readonly number[],
  spec: GuardsSpec,
  newels: ReadonlyMap<number, Mm>,
): PostPos[] {
  const W = w[w.length - 1]!;
  const mandatory: PostPos[] = [];
  const add = (p: PostPos): void => {
    const near = mandatory.find((m) => Math.abs(m.w - p.w) < 1);
    if (!near) mandatory.push(p);
    else if (p.virtual) Object.assign(near, p);
  };
  add({ w: 0, size: spec.posts.size, virtual: false });
  add({ w: W, size: spec.posts.size, virtual: false });
  for (let i = 1; i + 1 < path.length; i++) {
    const newel = newels.get(i);
    if (newel !== undefined) add({ w: w[i]!, size: newel, virtual: true });
    else if (turnAngleDeg(path, i) > spec.posts.cornerAngle)
      add({ w: w[i]!, size: spec.posts.size, virtual: false });
  }
  for (const [i, size] of newels)
    if (i === 0 || i === path.length - 1) add({ w: w[i]!, size, virtual: true });
  mandatory.sort((a, b) => a.w - b.w);
  const out: PostPos[] = [];
  for (let k = 0; k < mandatory.length; k++) {
    const a = mandatory[k]!;
    out.push(a);
    const b = mandatory[k + 1];
    if (!b) break;
    const n = Math.ceil((b.w - a.w) / spec.posts.maxSpacing - 1e-9);
    for (let j = 1; j < n; j++)
      out.push({ w: a.w + ((b.w - a.w) * j) / n, size: spec.posts.size, virtual: false });
  }
  return out;
}

/** Pentes (valeur absolue dz/dw) des tronçons qui recouvrent [c0 ; c1]. */
function slopesIn(w: readonly number[], ref: readonly number[], c0: Mm, c1: Mm): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < w.length; i++) {
    const a = w[i]!;
    const b = w[i + 1]!;
    if (b - a < 1e-9 || b <= c0 || a >= c1) continue;
    out.push(Math.abs(ref[i + 1]! - ref[i]!) / (b - a));
  }
  return out.length > 0 ? out : [0];
}

/** Points du chemin (3D, niveau de référence + dz) entre les abscisses c0 < c1. */
function subPath3(
  path: readonly Vec2[],
  w: readonly number[],
  ref: readonly number[],
  c0: Mm,
  c1: Mm,
  dz: Mm,
): { pts: Vec3[]; normals: Vec2[] } {
  const stations = [c0, ...w.filter((x) => x > c0 + 1e-6 && x < c1 - 1e-6), c1];
  const pts = stations.map((x) => {
    const p = pointAt(path, w, x);
    return { x: p.x, y: p.y, z: interp(w, ref, x) + dz };
  });
  const normals = stations.map((x) =>
    V.perpLeft(tangentAt(path, w, Math.min(Math.max(x, c0 + 1e-6), c1 - 1e-6))),
  );
  return { pts, normals };
}

/** Construit une ligne de garde-corps : poteaux, remplissage, main courante, vides. */
function buildLine(fctx: PartFactoryContext, spec: GuardsSpec, a: LineArgs): LineOutput {
  const { path, ref, height: H } = a;
  const w = cumulative(path);
  const zr = (x: Mm): Mm => interp(w, ref, x);
  const hr = spec.handrail;
  const hh = sectionHeight(hr.section);
  const infill = spec.infill;
  const bottomGap = infill.bottomGap;
  const infillTop = H - hh;
  if (infillTop <= bottomGap) {
    throw new GuardError(
      `Garde-corps ${a.label} : hauteur ${H} mm insuffisante pour la main courante (${hh} mm) et le vide bas (${bottomGap} mm).`,
    );
  }
  const parts: Part[] = [];
  const posts = postPositions(path, w, spec, a.newelVertices);
  const postSection = { kind: "rect" as const, width: spec.posts.size, height: spec.posts.size };
  const postPartIds: string[] = [];
  const postIdAt = new Map<number, string>();
  let postNo = 0;
  for (const p of posts) {
    if (p.virtual) continue;
    postNo++;
    const center = pointAt(path, w, p.w);
    const dir = tangentAt(path, w, p.w);
    const id = `${a.id}-post-${postNo}`;
    parts.push(
      verticalMember(
        fctx,
        {
          id,
          prefix: "PG",
          category: "post",
          name: "Poteau de garde-corps",
          material: spec.material,
        },
        center,
        dir,
        postSection,
        zr(p.w),
        zr(p.w) + infillTop,
      ),
    );
    postPartIds.push(id);
    postIdAt.set(p.w, id);
  }

  // Main courante continue (balayage), prolongée horizontalement aux extrémités de l'escalier.
  const hPath: Vec3[] = path.map((p, i) => ({ x: p.x, y: p.y, z: ref[i]! + H - hh / 2 }));
  if (a.extensionBottom && a.extensionBottom > 0) {
    const t = tangentAt(path, w, 0);
    const p = V.addScaled(path[0]!, t, -a.extensionBottom);
    hPath.unshift({ x: p.x, y: p.y, z: hPath[0]!.z });
  }
  if (a.extensionTop && a.extensionTop > 0) {
    const t = tangentAt(path, w, w[w.length - 1]!);
    const p = V.addScaled(path[path.length - 1]!, t, a.extensionTop);
    hPath.push({ x: p.x, y: p.y, z: hPath[hPath.length - 1]!.z });
  }
  const handrailId = `${a.id}-handrail`;
  parts.push(
    sweptMember(
      fctx,
      {
        id: handrailId,
        prefix: "MC",
        category: "handrail",
        name: a.kind === "rake" ? "Main courante de garde-corps" : "Main courante de trémie",
        material: spec.material,
      },
      hPath,
      hr.section,
      `|${a.id}`,
    ),
  );

  // Remplissage par travée.
  const gaps: GapMeasure[] = [];
  const footholds: Foothold[] = [];
  const meshOpenings: GapMeasure[] = [];
  const infillPartIds: string[] = [];
  const material = infillMaterial(infill, spec);
  let pieceNo = 0;
  for (let k = 0; k + 1 < posts.length; k++) {
    const p0 = posts[k]!;
    const p1 = posts[k + 1]!;
    const c0 = p0.w + p0.size / 2;
    const c1 = p1.w - p1.size / 2;
    const clear = c1 - c0;
    if (clear <= 1e-6) continue;
    const bay = `${a.label}, travée ${k + 1}`;
    const minSlope = Math.min(...slopesIn(w, ref, c0, c1));
    const cos = 1 / Math.sqrt(1 + minSlope * minSlope);
    const postLoc = part(postIdAt.get(p0.w) ?? postIdAt.get(p1.w) ?? handrailId);
    switch (infill.kind) {
      case "balusters": {
        const b = sectionWidth(infill.section);
        const target = infill.spacing - b;
        if (target <= 0) {
          throw new GuardError(
            `Balustres : entraxe ${infill.spacing} mm inférieur ou égal à la section (${b} mm).`,
          );
        }
        // Plus petit nombre respectant l'entraxe, borné à ce qui tient dans la travée.
        const n = Math.min(
          Math.floor(clear / b + 1e-9),
          Math.max(0, Math.ceil((clear - target) / (target + b) - 1e-9)),
        );
        const gap = (clear - n * b) / (n + 1);
        let first: string | undefined;
        for (let i = 0; i < n; i++) {
          const x = c0 + gap * (i + 1) + b * (i + 0.5);
          const id = `${a.id}-baluster-${++pieceNo}`;
          first ??= id;
          parts.push(
            verticalMember(
              fctx,
              { id, prefix: "BA", category: "baluster", name: "Balustre", material },
              pointAt(path, w, x),
              tangentAt(path, w, x),
              infill.section,
              zr(x) + bottomGap,
              zr(x) + infillTop,
            ),
          );
          infillPartIds.push(id);
        }
        const loc = first ? part(first) : postLoc;
        gaps.push({
          value: gap,
          zBottom: bottomGap,
          zTop: infillTop,
          location: loc,
          label: `entre balustres, ${bay}`,
          kind: "vertical",
        });
        gaps.push({
          value: bottomGap * cos,
          zBottom: 0,
          zTop: bottomGap,
          location: loc,
          label: `sous les balustres, ${bay}`,
          kind: "bottom",
        });
        break;
      }
      case "rails":
      case "cables": {
        const section =
          infill.kind === "rails"
            ? infill.section
            : { kind: "round" as const, diameter: infill.diameter };
        const rh = sectionHeight(section);
        const count = infill.count;
        const g = (infillTop - bottomGap - count * rh) / count;
        if (g < 0) {
          throw new GuardError(
            `${infill.kind === "rails" ? "Lisses" : "Câbles"} : ${count} éléments de ${rh} mm ne tiennent pas entre ${bottomGap} et ${fmt(infillTop)} mm.`,
          );
        }
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          const zb = bottomGap + i * (rh + g);
          const id = `${a.id}-${infill.kind === "rails" ? "rail" : "cable"}-${++pieceNo}`;
          const { pts } = subPath3(path, w, ref, c0, c1, zb + rh / 2);
          parts.push(
            sweptMember(
              fctx,
              {
                id,
                prefix: infill.kind === "rails" ? "LS" : "CA",
                category: "infill",
                name: infill.kind === "rails" ? "Lisse" : "Câble",
                material,
              },
              pts,
              section,
            ),
          );
          ids.push(id);
          infillPartIds.push(id);
          footholds.push({
            x: zb + rh,
            location: part(id),
            label: `${infill.kind === "rails" ? "lisse" : "câble"} ${i + 1}, ${bay}`,
          });
        }
        gaps.push({
          value: bottomGap * cos,
          zBottom: 0,
          zTop: bottomGap,
          location: part(ids[0]!),
          label: `sous la première ${infill.kind === "rails" ? "lisse" : "file de câble"}, ${bay}`,
          kind: "bottom",
        });
        for (let i = 0; i < count; i++) {
          const zb = bottomGap + i * (rh + g) + rh;
          gaps.push({
            value: g * cos,
            zBottom: zb,
            zTop: zb + g,
            location: part(ids[i]!),
            label:
              i + 1 < count
                ? `entre ${infill.kind === "rails" ? "lisses" : "câbles"} ${i + 1} et ${i + 2}, ${bay}`
                : `entre ${infill.kind === "rails" ? "la dernière lisse" : "le dernier câble"} et la main courante, ${bay}`,
            kind: "horizontal",
          });
        }
        break;
      }
      case "glass":
      case "perforated":
      case "panel": {
        const g = infill.panelGap;
        const q0 = c0 + g;
        const q1 = c1 - g;
        if (q1 - q0 <= 1) {
          gaps.push({
            value: clear,
            zBottom: bottomGap,
            zTop: infillTop,
            location: postLoc,
            label: `entre poteaux, ${bay}`,
            kind: "vertical",
          });
          break;
        }
        const id = `${a.id}-panel-${++pieceNo}`;
        const bottom = subPath3(path, w, ref, q0, q1, bottomGap);
        const top = subPath3(path, w, ref, q0, q1, infillTop);
        const names = {
          glass: "Panneau de verre",
          perforated: "Tôle perforée",
          panel: "Panneau plein",
        };
        parts.push(
          panelMember(
            fctx,
            { id, prefix: "PN", category: "infill", name: names[infill.kind], material },
            bottom.pts,
            top.pts,
            bottom.normals,
            infill.thickness,
          ),
        );
        infillPartIds.push(id);
        for (const side of ["début", "fin"]) {
          gaps.push({
            value: g,
            zBottom: bottomGap,
            zTop: infillTop,
            location: part(id),
            label: `entre panneau et poteau (${side}), ${bay}`,
            kind: "vertical",
          });
        }
        gaps.push({
          value: bottomGap * cos,
          zBottom: 0,
          zTop: bottomGap,
          location: part(id),
          label: `sous le panneau, ${bay}`,
          kind: "bottom",
        });
        if (infill.kind === "perforated") {
          meshOpenings.push({
            value: infill.holeDiameter,
            zBottom: bottomGap,
            zTop: infillTop,
            location: part(id),
            label: `perforations, ${bay}`,
            kind: "vertical",
          });
        }
        break;
      }
    }
  }

  // Pentes et longueur horizontale de la ligne de référence.
  let maxSlope = 0;
  let horizontal = 0;
  for (let i = 0; i + 1 < w.length; i++) {
    const len = w[i + 1]! - w[i]!;
    if (len < 1e-9) continue;
    const s = Math.abs(ref[i + 1]! - ref[i]!) / len;
    maxSlope = Math.max(maxSlope, s);
    if (s < 1e-6) horizontal += len;
  }
  // Épaisseur E de l'élément de protection (h(E), GC_HAUTEUR_2024) : éléments **continus** au
  // sommet du garde-corps (main courante, panneau) ; les poteaux et balustres, ponctuels, ne
  // l'épaississent pas (une épaisseur plus grande abaisserait à tort la hauteur exigée).
  const continuous =
    infill.kind === "glass" || infill.kind === "perforated" || infill.kind === "panel";
  const thickness = Math.max(sectionWidth(hr.section), continuous ? infillThickness(infill) : 0);
  return {
    parts,
    run: {
      id: a.id,
      kind: a.kind,
      ...(a.side ? { side: a.side } : {}),
      label: a.label,
      path,
      ref,
      height: H,
      thickness,
      maxSlopeDeg: (Math.atan(maxSlope) * 180) / Math.PI,
      horizontalLength: horizontal,
      nosingHeights: a.nosingHeights,
      fall: a.fall,
      infill: infill.kind,
      gaps,
      footholds,
      meshOpenings,
      primaryPartId: handrailId,
      postPartIds,
      infillPartIds,
      handrailPartId: handrailId,
    },
  };
}

/** Prolongements résolus (`auto` = giron nominal). */
function extensions(spec: GuardsSpec, stepping: Stepping): { bottom: Mm; top: Mm } {
  const g = Number.isFinite(stepping.going) ? stepping.going : 0;
  const e = spec.handrail.extensions;
  return { bottom: e.bottom === "auto" ? g : e.bottom, top: e.top === "auto" ? g : e.top };
}

/**
 * Portion de bord : chemin décalé, niveaux de référence, nez couverts.
 *
 * Le chemin est le bord décalé de `offsetDistance` vers le vide (`offsetStations`) : près d'un
 * angle concave (jour d'un U ou d'un demi-tournant), les stations qui tombent dans le retrait de
 * l'onglet sont fusionnées sur l'onglet, avec le **plus haut** de leurs niveaux de référence
 * (la main courante n'y passe jamais sous la hauteur prévue au-dessus d'un nez fusionné).
 * `nosingRef(k)` : niveau de référence du chemin **construit** au droit du nez k (hauteurs « à
 * la verticale du nez » mesurées sur la géométrie réelle).
 */
function edgePortion(
  edge: SideEdge,
  iv: SideInterval,
  offsetDistance: Mm,
  stepping: Stepping,
  label: string,
): {
  path: Vec2[];
  ref: number[];
  u: number[];
  nosings: number[];
  nosingRef: (k: number) => Mm;
  touchesBottom: boolean;
  touchesTop: boolean;
} {
  const extra = [...edge.nosingU, ...edge.profileU];
  const sl = slice(edge.points, edge.cum, iv.from, iv.to, extra);
  const d = edge.voidSign * offsetDistance;
  const off = offsetStations(sl.points, d);
  if (!off) {
    throw new GuardError(
      `${label} : décalage de ${fmt(Math.abs(offsetDistance))} mm impossible, un segment du bord est plus court que les retraits des angles (jour trop étroit ?) ; réduire le décalage ou déclarer ce côté « mur ».`,
    );
  }
  const last = sl.s.length - 1;
  const stationRef = sl.s.map((u, i) => refAt(edge, u, i === last ? "before" : "after"));
  const path = off.points;
  const ref = path.map(() => -Infinity);
  const u = path.map(() => Number.NaN);
  sl.s.forEach((s, j) => {
    const g = off.group[j]!;
    ref[g] = Math.max(ref[g]!, stationRef[j]!);
    if (off.corner[j] || Number.isNaN(u[g]!)) u[g] = s;
  });
  // Nez couverts par la travée (hors nez aboutissant sur un poteau d'angle).
  const nosings: number[] = [];
  edge.nosingU.forEach((uk, k) => {
    if (uk >= iv.from - 1e-6 && uk <= iv.to + 1e-6 && !edge.atPost[k]) nosings.push(k);
  });
  const nosingRef = (k: number): Mm => {
    const uk = edge.nosingU[k]!;
    let best = 0;
    for (let j = 1; j < sl.s.length; j++)
      if (Math.abs(sl.s[j]! - uk) < Math.abs(sl.s[best]! - uk)) best = j;
    return ref[off.group[best]!]!;
  };
  const n = stepping.nosings.length;
  return {
    path,
    ref,
    u,
    nosings,
    nosingRef,
    touchesBottom: n > 0 && iv.from <= edge.nosingU[0]! + 1,
    touchesTop: n > 0 && iv.to >= edge.nosingU[n - 1]! - 1,
  };
}

/** Côtés libres de la trémie : chaînes de polylignes (CCW) hors arrivée et murs. */
function openingChains(
  poly: readonly Vec2[],
  stepping: Stepping,
  walls: readonly Wall[],
  tolerance: Mm,
): Vec2[][] {
  const n = poly.length;
  const last = stepping.nosings[stepping.nosings.length - 1];
  const arrival: Wall | null = last
    ? { id: "__arrival__", a: last.q, b: last.r, thickness: 0, loadBearing: false }
    : null;
  const chains: Vec2[][] = [];
  let current: Vec2[] | null = null;
  let firstStartsAtOrigin = false;
  for (let i = 0; i < n; i++) {
    const A = poly[i]!;
    const B = poly[(i + 1) % n]!;
    const L = V.distance(A, B);
    if (L < 1e-6) continue;
    const d = V.scale(V.sub(B, A), 1 / L);
    const excluded: { from: number; to: number }[] = [];
    for (const wall of arrival ? [arrival, ...walls] : walls) {
      const c = wallCover(A, B, wall, tolerance, 0);
      if (c) excluded.push({ from: c.from, to: c.to });
    }
    excluded.sort((x, y) => x.from - y.from);
    const free: { from: number; to: number }[] = [];
    let cursor = 0;
    for (const e of excluded) {
      if (e.from > cursor + 1) free.push({ from: cursor, to: e.from });
      cursor = Math.max(cursor, e.to);
    }
    if (cursor < L - 1) free.push({ from: cursor, to: L });
    for (const f of free) {
      const p0 = V.addScaled(A, d, f.from);
      const p1 = V.addScaled(A, d, f.to);
      if (current && f.from < 1e-6 && V.distance(current[current.length - 1]!, p0) < 1e-6) {
        current.push(p1);
      } else {
        current = [p0, p1];
        chains.push(current);
        if (chains.length === 1 && i === 0 && f.from < 1e-6) firstStartsAtOrigin = true;
      }
      if (f.to < L - 1e-6) current = null;
    }
    if (free.length === 0 || free[free.length - 1]!.to < L - 1e-6) current = null;
  }
  // Raccord de la dernière chaîne sur la première (tour complet de la trémie).
  if (chains.length > 1 && firstStartsAtOrigin) {
    const lastChain = chains[chains.length - 1]!;
    if (V.distance(lastChain[lastChain.length - 1]!, poly[0]!) < 1e-6) {
      const first = chains.shift()!;
      lastChain.push(...first.slice(1));
    }
  }
  return chains;
}

/** Calcule les garde-corps et mains courantes d'un escalier (voir l'en-tête du module). */
export function computeGuards(
  project: Project,
  layout: Layout,
  stepping: Stepping,
): GuardsAnalysis {
  const spec: GuardsSpec = project.guards ?? GuardsSpecSchema.parse({});
  const fctx: PartFactoryContext = {
    marks: new MarkRegistry(),
    profile: resolveWorkshopProfile(project.workshop),
  };
  const notes: string[] = [];
  const errors: string[] = [];
  const parts: Part[] = [];
  const runs: GuardRun[] = [];
  const handrails: HandrailRun[] = [];
  const hr = spec.handrail;
  const hw = sectionWidth(hr.section);
  const hh = sectionHeight(hr.section);
  const ext = extensions(spec, stepping);

  const sideResults = (["inner", "outer"] as const).map((s) =>
    analyzeSide(s, layout, stepping, project, spec),
  );
  const sides: SideAnalysis[] = sideResults.map((r) => r.analysis);

  // Côtés libres de la trémie (calculés d'abord : un rampant qui y aboutit se prolonge par eux).
  const poly = openingPolygon(project.site.opening);
  const openingPaths = poly
    ? openingChains(poly, stepping, project.site.walls, spec.wallTolerance).map((chain) => ({
        chain,
        path: offset(chain, -spec.opening.setback),
      }))
    : [];
  /** Longueur du garde-corps de trémie qui prolonge un rampant finissant en `p`, sinon 0. */
  const continuation = (p: Vec2): Mm => {
    if (!spec.opening.enabled) return 0;
    const reach = spec.flight.edgeOffset + spec.opening.setback + spec.posts.size;
    for (const { path } of openingPaths) {
      const ends = [path[0]!, path[path.length - 1]!];
      if (ends.some((e) => V.distance(e, p) <= reach)) {
        const w = cumulative(path);
        return w[w.length - 1]!;
      }
    }
    return 0;
  };

  // Jour trop étroit (sous la sphère T1) : pas de garde-corps de jour, erreur de modèle lisible
  // (les deux rampants décalés vers le vide s'y croiseraient) ; les autres lignes sont calculées.
  const jour = jourWidth(layout, project.stair.layout.turns);
  const narrow = narrowJourThreshold();
  const narrowJour = narrow !== null && jour < narrow;

  // Garde-corps de volée.
  for (const { edge, analysis } of sideResults) {
    if (!spec.flight.enabled || stepping.nosings.length === 0) break;
    const hasVoid = analysis.intervals.some((iv) => iv.kind === "void" && iv.to - iv.from >= 1);
    if (analysis.side === "inner" && narrowJour && hasVoid) {
      errors.push(
        `${NARROW_JOUR_ERROR_PREFIX} : jour de ${fmt(jour, 0)} mm, plus étroit que la sphère T1 (${fmt(narrow, 0)} mm) : les garde-corps des volées qui le bordent (décalés de ${fmt(spec.flight.edgeOffset, 0)} mm vers le vide) n'y sont pas construits. Élargir le jour (volée centrale plus longue) ou régler le côté jour des garde-corps sur « mur » si le jour est fermé.`,
      );
      continue;
    }
    // Portions vides, coupées aux poteaux d'angle du tracé (le garde-corps s'y arrête).
    const voids: SideInterval[] = [];
    for (const iv of analysis.intervals) {
      if (iv.kind !== "void" || iv.to - iv.from < 1) continue;
      let from = iv.from;
      for (const nw of edge.newels) {
        if (nw.u > from + 1 && nw.u < iv.to - 1) {
          voids.push({ ...iv, from, to: nw.u });
          from = nw.u;
        }
      }
      voids.push({ ...iv, from });
    }
    let rakeNo = 0;
    for (const iv of voids) {
      rakeNo++;
      const label = `garde-corps de volée ${SIDE_LABEL[analysis.side]}${voids.length > 1 ? ` n° ${rakeNo}` : ""}`;
      let portion: ReturnType<typeof edgePortion>;
      try {
        portion = edgePortion(edge, iv, spec.flight.edgeOffset, stepping, `Garde-corps (${label})`);
      } catch (e) {
        // Décalage impossible (segment de bord plus court que les retraits des angles) : cette
        // ligne n'est pas produite, erreur de modèle ; les autres lignes restent calculées.
        if (!(e instanceof GuardError)) throw e;
        errors.push(`${e.message} Ligne non générée.`);
        continue;
      }
      if (portion.path.length < 2) continue;
      const newelVertices = new Map<number, Mm>();
      for (const nw of edge.newels) {
        const i = portion.u.findIndex((u) => Math.abs(u - nw.u) < 1e-3);
        if (i >= 0) newelVertices.set(i, nw.size);
      }
      const H = spec.flight.height;
      const nosingHeights = portion.nosings.map((k) => ({
        index: k,
        height: portion.nosingRef(k) + H - stepping.nosings[k]!.z,
      }));
      const fall = Math.max(0, ...portion.ref);
      const id = `guard-${analysis.side}-${rakeNo}`;
      // Arrivée sur un garde-corps de trémie : c'est lui qui prolonge la main courante.
      const continued = portion.touchesTop
        ? continuation(portion.path[portion.path.length - 1]!)
        : 0;
      if (continued > 0) {
        notes.push(
          `Garde-corps ${SIDE_LABEL[analysis.side]} : prolongé à l'arrivée par le garde-corps de trémie (${fmt(continued, 0)} mm), sans prolongement propre de la main courante.`,
        );
      }
      const out = buildLine(fctx, spec, {
        id,
        kind: "rake",
        side: analysis.side,
        label,
        path: portion.path,
        ref: portion.ref,
        height: H,
        newelVertices,
        ...(portion.touchesBottom ? { extensionBottom: ext.bottom } : {}),
        ...(portion.touchesTop && continued === 0 ? { extensionTop: ext.top } : {}),
        nosingHeights,
        fall,
      });
      runs.push(out.run);
      parts.push(...out.parts);
      handrails.push({
        id: `${id}-handrail`,
        partId: out.run.handrailPartId!,
        side: analysis.side,
        onGuard: true,
        from: iv.from,
        to: iv.to,
        nosingHeights,
        ...(portion.touchesBottom ? { extensionBottom: ext.bottom } : {}),
        ...(portion.touchesTop ? { extensionTop: continued > 0 ? continued : ext.top } : {}),
        sectionWidth: hw,
        intrusion: Math.max(0, hw / 2 - spec.flight.edgeOffset),
      });
      if (newelVertices.size > 0) {
        notes.push(
          `Garde-corps ${SIDE_LABEL[analysis.side]} : le poteau d'angle du tracé tient lieu de poteau de garde-corps (aucune pièce ajoutée).`,
        );
      }
    }
  }

  // Mains courantes murales.
  const hasGuard = runs.length > 0;
  const wallSides = new Set<StairSide>();
  switch (hr.wallSides) {
    case "inner":
    case "outer":
      wallSides.add(hr.wallSides);
      break;
    case "both":
      wallSides.add("inner").add("outer");
      break;
    case "auto":
      if (!hasGuard) {
        const outerWall = sides[1]!.intervals.some((iv) => iv.kind === "wall");
        wallSides.add(outerWall ? "outer" : "inner");
      } else {
        // Continuité (MC_DISCONTINUITE) : un côté dont la main courante est portée par un
        // garde-corps la poursuit en main courante murale le long de ses portions murales.
        for (const r of runs) if (r.side) wallSides.add(r.side);
      }
      break;
    case "none":
      break;
  }
  let wallNo = 0;
  for (const { edge, analysis } of sideResults) {
    if (!wallSides.has(analysis.side) || stepping.nosings.length === 0) continue;
    for (const iv of analysis.intervals) {
      if (iv.kind !== "wall" || iv.to - iv.from < 1) continue;
      wallNo++;
      const face = iv.wallFaceDistance ?? 0;
      const axis = face - hr.wallClearance - hw / 2;
      const portion = edgePortion(
        edge,
        iv,
        axis,
        stepping,
        `Main courante murale ${SIDE_LABEL[analysis.side]}`,
      );
      if (portion.path.length < 2) continue;
      const path3: Vec3[] = portion.path.map((p, i) => ({
        x: p.x,
        y: p.y,
        z: portion.ref[i]! + hr.height - hh / 2,
      }));
      const w = cumulative(portion.path);
      if (portion.touchesBottom && ext.bottom > 0) {
        const p = V.addScaled(portion.path[0]!, tangentAt(portion.path, w, 0), -ext.bottom);
        path3.unshift({ x: p.x, y: p.y, z: path3[0]!.z });
      }
      if (portion.touchesTop && ext.top > 0) {
        const t = tangentAt(portion.path, w, w[w.length - 1]!);
        const p = V.addScaled(portion.path[portion.path.length - 1]!, t, ext.top);
        path3.push({ x: p.x, y: p.y, z: path3[path3.length - 1]!.z });
      }
      const id = `handrail-wall-${analysis.side}-${wallNo}`;
      parts.push(
        sweptMember(
          fctx,
          {
            id,
            prefix: "MC",
            category: "handrail",
            name: "Main courante murale",
            material: spec.material,
          },
          path3,
          hr.section,
          `|${id}`,
        ),
      );
      handrails.push({
        id,
        partId: id,
        side: analysis.side,
        onGuard: false,
        from: iv.from,
        to: iv.to,
        nosingHeights: portion.nosings.map((k) => ({
          index: k,
          height: portion.nosingRef(k) + hr.height - stepping.nosings[k]!.z,
        })),
        ...(portion.touchesBottom ? { extensionBottom: ext.bottom } : {}),
        ...(portion.touchesTop ? { extensionTop: ext.top } : {}),
        wallClearance: hr.wallClearance,
        sectionWidth: hw,
        intrusion: Math.max(0, hr.wallClearance + hw - face),
      });
      if (iv.wallId === undefined) {
        notes.push(
          `Main courante murale ${SIDE_LABEL[analysis.side]} : mur imposé sans mur du site, nu du mur supposé au bord de l'emmarchement.`,
        );
      }
    }
  }

  // Garde-corps de trémie.
  const unguardedOpeningEdges: { a: Vec2; b: Vec2 }[] = [];
  const openingFall = project.site.floorToFloor;
  {
    let openingNo = 0;
    for (const { chain, path } of openingPaths) {
      if (!spec.opening.enabled) {
        for (let i = 0; i + 1 < chain.length; i++)
          unguardedOpeningEdges.push({ a: chain[i]!, b: chain[i + 1]! });
        continue;
      }
      openingNo++;
      const out = buildLine(fctx, spec, {
        id: `guard-opening-${openingNo}`,
        kind: "opening",
        label: `garde-corps de trémie${openingPaths.length > 1 ? ` n° ${openingNo}` : ""}`,
        path,
        ref: path.map(() => project.site.floorToFloor),
        height: spec.opening.height,
        newelVertices: new Map(),
        nosingHeights: [],
        fall: openingFall,
      });
      runs.push(out.run);
      parts.push(...out.parts);
    }
  }

  // Remarques.
  if (runs.length > 0 || handrails.length > 0) {
    const count = (c: Part["category"]): number => parts.filter((p) => p.category === c).length;
    notes.push(
      `Garde-corps : ${runs.length} ligne(s), ${count("post")} poteau(x), ${count("baluster") + count("infill")} élément(s) de remplissage, ${count("handrail")} main(s) courante(s) ; sections, entraxes, jeux et reculs par défaut à valider (voir LEDGER).`,
    );
  }
  if (spec.infill.kind === "cables" && runs.length > 0) {
    notes.push(
      "Câbles : traités comme des lisses (SPEC X12) ; leurs vides ne doivent pas augmenter dans le temps (détente, NF P01-012:2024) — prévoir un dispositif de retension.",
    );
  }
  if (spec.infill.kind === "glass" && runs.length > 0) {
    notes.push(
      "Verre (V1) : seuls les jeux et vides sont contrôlés ; produit (feuilleté 1B1, NF DTU 39 P5), pinces et essais NF P01-013 non vérifiés.",
    );
  }
  return {
    spec,
    sides,
    runs,
    handrails,
    unguardedOpeningEdges,
    openingFall,
    parts,
    notes: [...new Set(notes)],
    errors: [...new Set(errors)],
  };
}
