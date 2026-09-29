/**
 * Cotes 3D principales et mesures affichées en surimpression de la vue 3D (jalon 6) :
 * hauteur à monter H, emmarchement (largeur au premier nez non balancé), reculement (le long de la ligne de
 * foulée, du premier au dernier nez). Valeurs lues dans le modèle du cœur ; aucune règle métier.
 *
 * Points en mm dans le repère du cœur ; la projection à l'écran est faite par la vue.
 */
import { curvePointAt, type Model, type Vec3 } from "@blondel/core";
import { formatLength } from "../lib/units.js";

export interface Annotation {
  readonly id: string;
  readonly kind: "dimension" | "measure";
  /** Polyligne (au moins 2 points), mm. */
  readonly points: readonly Vec3[];
  readonly label: string;
}

/** Décalage de la cote de hauteur vers l'extérieur du premier nez (mm, présentation). */
export const HEIGHT_DIMENSION_OFFSET = 250;
/** Nombre de segments de la cote de reculement le long de la ligne de foulée. */
export const RUN_SAMPLES = 48;

export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Libellé d'une longueur en mm (arrondi au dixième). */
export function mmLabel(prefix: string, mm: number): string {
  return `${prefix} ${formatLength(mm, "mm")}`;
}

/** Cotes principales du modèle (vide sans nez). */
export function mainDimensions(model: Model): Annotation[] {
  const { nosings, rises, run } = model.stepping;
  const first = nosings[0];
  const last = nosings[nosings.length - 1];
  if (!first || !last) return [];
  const out: Annotation[] = [];
  const H = rises.reduce((a, b) => a + b, 0);
  const foot = {
    x: first.r.x + first.dir.x * HEIGHT_DIMENSION_OFFSET,
    y: first.r.y + first.dir.y * HEIGHT_DIMENSION_OFFSET,
  };
  out.push({
    id: "dim-H",
    kind: "dimension",
    points: [
      { ...foot, z: 0 },
      { ...foot, z: H },
    ],
    label: mmLabel("H =", H),
  });
  // Emmarchement : largeur mesurée sur une ligne de nez **non balancée** (perpendiculaire aux
  // bords ou radiale) ; un nez balancé est oblique et Q–R y dépasse la largeur.
  const e = nosings.find((n) => !n.balanced) ?? first;
  const q: Vec3 = { x: e.q.x, y: e.q.y, z: e.z };
  const r: Vec3 = { x: e.r.x, y: e.r.y, z: e.z };
  out.push({
    id: "dim-E",
    kind: "dimension",
    points: [q, r],
    label: mmLabel("E =", distance(q, r)),
  });
  if (last.s > first.s) {
    const pts: Vec3[] = [];
    for (let i = 0; i <= RUN_SAMPLES; i++) {
      const s = first.s + ((last.s - first.s) * i) / RUN_SAMPLES;
      const p = curvePointAt(model.layout.walkline, s);
      pts.push({ x: p.x, y: p.y, z: 0 });
    }
    out.push({ id: "dim-run", kind: "dimension", points: pts, label: mmLabel("Reculement", run) });
  }
  return out;
}

/** Point de mesure : position affichée (vue éclatée comprise) et position réelle de la pièce. */
export interface MeasurePoint {
  readonly shown: Vec3;
  readonly real: Vec3;
}

/** Point mesuré sur une pièce : position réelle (mm, repère du cœur, hors vue éclatée). */
export interface PickedPoint {
  readonly partId: string;
  readonly real: Vec3;
}

const NO_OFFSET: Vec3 = { x: 0, y: 0, z: 0 };

/** Point cliqué sur la pièce `partId` (position affichée) → position réelle de la pièce. */
export function pickPoint(
  partId: string,
  shown: Vec3,
  offsets: ReadonlyMap<string, Vec3>,
): PickedPoint {
  const o = offsets.get(partId) ?? NO_OFFSET;
  return { partId, real: { x: shown.x - o.x, y: shown.y - o.y, z: shown.z - o.z } };
}

/**
 * Position affichée d'un point mesuré avec l'éclatement **courant** : le segment de mesure suit
 * les pièces quand le curseur de la vue éclatée bouge après la mesure.
 */
export function pickedToMeasure(p: PickedPoint, offsets: ReadonlyMap<string, Vec3>): MeasurePoint {
  const o = offsets.get(p.partId) ?? NO_OFFSET;
  return { shown: { x: p.real.x + o.x, y: p.real.y + o.y, z: p.real.z + o.z }, real: p.real };
}

/**
 * Mesure point à point : segment affiché entre les points montrés, longueur **réelle** (hors
 * déplacement de la vue éclatée). Un seul point : repère sans longueur.
 */
export function measureAnnotation(points: readonly MeasurePoint[]): Annotation | undefined {
  const [a, b] = points;
  if (!a) return undefined;
  if (!b) return { id: "measure", kind: "measure", points: [a.shown, a.shown], label: "" };
  return {
    id: "measure",
    kind: "measure",
    points: [a.shown, b.shown],
    label: formatLength(distance(a.real, b.real), "mm"),
  };
}

/** Point milieu (en longueur) d'une polyligne, pour placer son libellé. */
export function polylineMidpoint(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const l = distance(a, b);
    if (acc + l >= total / 2 && l > 0) {
      const t = (total / 2 - acc) / l;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    acc += l;
  }
  return points[0]!;
}
