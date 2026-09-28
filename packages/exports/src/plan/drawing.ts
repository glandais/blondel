/**
 * Dessin de plan indépendant du format : ce qu'il faut tracer (en mm, repère monde), sans
 * décider comment. `renderPlanSvg` et `exportPlanDxf` en sont deux rendus : une seule
 * implémentation de la cotation (ADR-0005).
 */
import {
  curveLength,
  curvePointAt,
  curveTangentAt,
  vec2,
  type Mm,
  type Model,
  type Project,
  type Severity,
  type TreadKind,
  type Vec2,
} from "@blondel/core";
import {
  locateViolations,
  openingPolygon,
  violationSummary,
  worstSeverity,
} from "../annotations.js";
import { formatFr } from "../format.js";
import { bandContour, curvePath, pathExtentPoints, polygonPath, type PlanPath } from "../path.js";

/** Fonction d'un élément de dessin (calque DXF, groupe SVG). */
export type PlanLayer = "CONTOUR" | "MARCHES" | "NEZ" | "FOULEE" | "TREMIE" | "COTES" | "TEXTE";

export type DimensionRole = "width" | "leg" | "run" | "going" | "height";

/**
 * Cote linéaire alignée : points mesurés `a` et `b`, ligne de cote décalée de `offset` selon
 * la normale unitaire `normal`. La valeur affichée est la distance réelle |ab|.
 */
export interface Dimension {
  readonly role: DimensionRole;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly normal: Vec2;
  readonly offset: Mm;
  readonly value: Mm;
  readonly text: string;
}

export interface PlanTread {
  readonly number: number;
  readonly kind: TreadKind;
  readonly surface: PlanPath;
  /** Position du numéro (milieu de la marche, côté mur de la ligne de foulée). */
  readonly label: Vec2;
  readonly severity?: Severity;
}

export interface PlanNosing {
  readonly index: number;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly balanced: boolean;
  readonly severity?: Severity;
}

export interface PlanDrawing {
  /** Contour de l'escalier (jour, arrivée, mur, départ), arcs exacts. */
  readonly contour: PlanPath;
  readonly treads: readonly PlanTread[];
  readonly nosings: readonly PlanNosing[];
  /** Ligne de foulée complète, cercle de départ, flèche de montée (triangle fermé). */
  readonly walkline: PlanPath;
  readonly walklineStart: { readonly center: Vec2; readonly radius: Mm };
  readonly arrow: PlanPath;
  readonly opening?: PlanPath;
  readonly dimensions: readonly Dimension[];
  readonly markers: readonly {
    readonly at: Vec2;
    readonly radius: Mm;
    readonly severity: Severity;
  }[];
  /** Lignes du cartouche (hauteur, 2h + g, reculement…). */
  readonly cartouche: readonly string[];
  /** Emprise (mm) de tout le dessin, cotes comprises, cartouche exclu. */
  readonly bounds: { readonly min: Vec2; readonly max: Vec2 };
  /** Hauteur de texte de référence (mm) choisie pour ce dessin. */
  readonly textHeight: Mm;
}

export interface PlanDrawingOptions {
  /** Projet source : fournit la trémie (optionnel, le `Model` ne la porte pas). */
  readonly project?: Project;
  /** Distance entre l'élément coté et la ligne de cote (mm). Défaut : 3 × hauteur de texte. */
  readonly dimensionOffset?: Mm;
  /** Hauteur de texte (mm). Défaut : proportionnelle à l'emmarchement, bornée à [40 ; 100]. */
  readonly textHeight?: Mm;
  /** Décimales des cotes (défaut 0 : cotes d'implantation au mm, ADR-0003). */
  readonly decimals?: number;
}

const fmt = (v: number, decimals: number): string =>
  formatFr(v, { decimals, thousands: " ", trimZeros: false });

/** Normale unitaire vers l'extérieur du mur (côté opposé au jour) pour une tangente donnée. */
function outwardFromOuter(tangent: Vec2, innerSide: "left" | "right"): Vec2 {
  return innerSide === "left" ? vec2.perpRight(tangent) : vec2.perpLeft(tangent);
}

function dimension(
  role: DimensionRole,
  a: Vec2,
  b: Vec2,
  normal: Vec2,
  offset: Mm,
  decimals: number,
  prefix = "",
): Dimension {
  const value = vec2.distance(a, b);
  return { role, a, b, normal, offset, value, text: `${prefix}${fmt(value, decimals)}` };
}

/** Construit le dessin de plan d'un modèle. */
export function buildPlanDrawing(model: Model, options: PlanDrawingOptions = {}): PlanDrawing {
  const { layout, stepping } = model;
  const decimals = options.decimals ?? 0;
  const first = stepping.nosings[0];
  // Emmarchement E : largeur de la ligne de départ (entre bords). Le nez 0 ne convient pas :
  // balancé (zone « libre » d'un quart tournant bas, CHALLENGE G3), |q₀r₀| dépasse E.
  const departInner = curvePointAt(layout.inner, 0);
  const departOuter = curvePointAt(layout.outer, 0);
  const width = vec2.distance(departInner, departOuter);
  const textHeight = options.textHeight ?? Math.min(100, Math.max(40, width / 15));
  const dimOffset = options.dimensionOffset ?? 3 * textHeight;
  const violations = locateViolations(model.compliance);

  const contour = bandContour(layout.inner, layout.outer);

  // Marches : surface de marche visible, numéro au milieu côté mur.
  const nosingByIndex = new Map(stepping.nosings.map((n) => [n.index, n]));
  const treads: PlanTread[] = stepping.treads.map((t) => {
    const n0 = nosingByIndex.get(t.number - 1);
    const n1 = nosingByIndex.get(t.number);
    let label: Vec2;
    if (n0 && n1) {
      const m0 = vec2.lerp(n0.p, n0.r, 0.5);
      const m1 = vec2.lerp(n1.p, n1.r, 0.5);
      label = vec2.lerp(m0, m1, 0.5);
    } else {
      const pts = t.walkingSurface;
      label = pts.reduce((acc, p) => vec2.add(acc, vec2.scale(p, 1 / pts.length)), vec2.ZERO);
    }
    const severity = violations.treads.get(t.number);
    return {
      number: t.number,
      kind: t.kind,
      surface: polygonPath(t.walkingSurface),
      label,
      ...(severity !== undefined ? { severity } : {}),
    };
  });

  const nosings: PlanNosing[] = stepping.nosings.map((n) => {
    const severity = violations.nosings.get(n.index);
    return {
      index: n.index,
      a: n.q,
      b: n.r,
      balanced: n.balanced,
      ...(severity !== undefined ? { severity } : {}),
    };
  });

  // Ligne de foulée : cercle au départ, flèche de montée à l'arrivée.
  const walkline = curvePath(layout.walkline);
  const L = curveLength(layout.walkline);
  const start = curvePointAt(layout.walkline, 0);
  const end = curvePointAt(layout.walkline, L);
  const tEnd = curveTangentAt(layout.walkline, L);
  // Modèle partiel (`Model.errors`) : giron éventuellement non fini, la flèche reste dessinée.
  const going = Number.isFinite(stepping.going) ? stepping.going : 0;
  const arrowLen = Math.min(Math.max(going * 0.6, 2 * textHeight), 250);
  const back = vec2.addScaled(end, tEnd, -arrowLen);
  const side = vec2.scale(vec2.perpLeft(tEnd), arrowLen / 3);
  const arrow = polygonPath([end, vec2.add(back, side), vec2.sub(back, side)]);

  const opening = openingPolygon(options.project);

  // ---------------------------------------------------------------- cotes
  const dims: Dimension[] = [];
  if (width > 0) {
    const t0 = curveTangentAt(layout.walkline, 0);
    dims.push(
      dimension("width", departInner, departOuter, vec2.scale(t0, -1), dimOffset, decimals),
    );
  }
  // Longueurs de volées : tronçons droits du bord extérieur (mesure de `LegSchema.length`).
  for (const seg of layout.outer.segments) {
    if (seg.kind !== "line") continue;
    const len = vec2.distance(seg.a, seg.b);
    if (len < 1) continue;
    const t = vec2.normalize(vec2.sub(seg.b, seg.a));
    dims.push(
      dimension("leg", seg.a, seg.b, outwardFromOuter(t, layout.innerSide), dimOffset, decimals),
    );
  }
  const last = stepping.nosings[stepping.nosings.length - 1];
  if (first && last && layout.turns.length === 0 && last !== first) {
    // Droit : reculement coté côté jour, du premier au dernier nez.
    const t = vec2.normalize(vec2.sub(last.q, first.q));
    const inward = vec2.scale(outwardFromOuter(t, layout.innerSide), -1);
    const run = dimension("run", first.q, last.q, inward, dimOffset, decimals);
    // Reculement égal à la longueur de volée : une seule cote (celle de la volée).
    if (!dims.some((d) => d.role === "leg" && Math.abs(d.value - run.value) < 0.5)) dims.push(run);
  }
  // Giron sur la ligne de foulée : première marche droite entre deux nez non balancés.
  for (let k = 0; k + 1 < stepping.nosings.length; k++) {
    const n0 = stepping.nosings[k]!;
    const n1 = stepping.nosings[k + 1]!;
    const tread = stepping.treads.find((t) => t.number === n1.index);
    if (n0.balanced || n1.balanced || tread?.kind !== "straight") continue;
    const t = vec2.normalize(vec2.sub(n1.p, n0.p));
    const inward = vec2.scale(outwardFromOuter(t, layout.innerSide), -1);
    const off = Math.min(layout.walklineOffset / 2, dimOffset);
    dims.push(dimension("going", n0.p, n1.p, inward, off, Math.max(decimals, 1), "g = "));
    break;
  }

  const markers = violations.points.map((p) => ({
    at: p.at,
    radius: textHeight,
    severity: p.severity,
  }));

  // ---------------------------------------------------------------- cartouche
  const H = stepping.rises.reduce((a, b) => a + b, 0);
  const n = stepping.riserCount;
  const cartouche: string[] = [
    `Hauteur à monter H = ${fmt(H, 0)} mm`,
    `${n} hauteurs de h = ${fmt(stepping.rise, 1)} mm`,
  ];
  const r0 = stepping.rises[0];
  if (r0 !== undefined && Math.abs(r0 - stepping.rise) > 0.05) {
    cartouche.push(`1re hauteur h1 = ${fmt(r0, 1)} mm`);
  }
  cartouche.push(
    `Giron g = ${fmt(stepping.going, 1)} mm`,
    `2h + g = ${fmt(stepping.blondel, 1)} mm`,
    `Reculement (ligne de foulée) = ${fmt(stepping.run, 0)} mm`,
    `Emmarchement E = ${fmt(width, 0)} mm`,
  );
  if (model.headroom) cartouche.push(`Échappée minimale = ${fmt(model.headroom.min, 0)} mm`);
  const s = violationSummary(model.compliance);
  cartouche.push(
    `Contrôle de conception : ${s.bloquant} bloquant(s), ${s.avertissement} avertissement(s), ${s.conseil} conseil(s)`,
  );
  if (stepping.balancedZones.length > 0) {
    const zones = stepping.balancedZones.map((z) => `${z.method} nez ${z.from}→${z.to}`).join(", ");
    cartouche.push(`Balancement : ${zones}`);
  }

  // ---------------------------------------------------------------- emprise
  const pts: Vec2[] = [...pathExtentPoints(contour), ...pathExtentPoints(walkline)];
  for (const t of treads) pts.push(...t.surface.vertices);
  if (opening) pts.push(...opening);
  for (const d of dims) {
    const o = vec2.scale(d.normal, d.offset + 1.5 * textHeight);
    pts.push(vec2.add(d.a, o), vec2.add(d.b, o));
  }
  for (const m of markers) {
    pts.push(
      vec2.sub(m.at, { x: m.radius, y: m.radius }),
      vec2.add(m.at, { x: m.radius, y: m.radius }),
    );
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bounds = {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };

  return {
    contour,
    treads,
    nosings,
    walkline,
    walklineStart: { center: start, radius: textHeight / 2 },
    arrow,
    ...(opening ? { opening: polygonPath(opening) } : {}),
    dimensions: dims,
    markers,
    cartouche,
    bounds,
    textHeight,
  };
}

/** Géométrie d'une cote : ligne de cote, lignes d'attache, position et angle du texte. */
export interface DimensionGeometry {
  readonly line: readonly [Vec2, Vec2];
  readonly extensions: readonly (readonly [Vec2, Vec2])[];
  /** Traits obliques (convention architecture) aux deux extrémités. */
  readonly ticks: readonly (readonly [Vec2, Vec2])[];
  readonly textAt: Vec2;
  /** Angle du texte (rad, sens trigonométrique), ramené dans ]−90° ; 90°] pour la lisibilité. */
  readonly textAngle: number;
}

export function dimensionGeometry(d: Dimension, textHeight: Mm): DimensionGeometry {
  const o = vec2.scale(d.normal, d.offset);
  const a1 = vec2.add(d.a, o);
  const b1 = vec2.add(d.b, o);
  const gap = textHeight * 0.3;
  const over = textHeight * 0.4;
  const ext = (p: Vec2): readonly [Vec2, Vec2] => [
    vec2.addScaled(p, d.normal, Math.sign(d.offset) * gap),
    vec2.addScaled(p, d.normal, d.offset + Math.sign(d.offset) * over),
  ];
  // Cote nulle (modèle partiel) : direction quelconque perpendiculaire à la normale.
  const u = d.value > 1e-9 ? vec2.normalize(vec2.sub(d.b, d.a)) : vec2.perpRight(d.normal);
  const tickDir = vec2.scale(vec2.normalize(vec2.add(u, d.normal)), textHeight * 0.35);
  const tick = (p: Vec2): readonly [Vec2, Vec2] => [vec2.sub(p, tickDir), vec2.add(p, tickDir)];
  let angle = Math.atan2(u.y, u.x);
  if (angle > Math.PI / 2 + 1e-9) angle -= Math.PI;
  else if (angle <= -Math.PI / 2 + 1e-9) angle += Math.PI;
  // Texte centré (horizontalement et verticalement) du côté extérieur de la ligne de cote.
  const textAt = vec2.addScaled(
    vec2.lerp(a1, b1, 0.5),
    d.normal,
    Math.sign(d.offset || 1) * textHeight * 0.8,
  );
  return {
    line: [a1, b1],
    extensions: d.offset === 0 ? [] : [ext(d.a), ext(d.b)],
    ticks: [tick(a1), tick(b1)],
    textAt,
    textAngle: angle,
  };
}
