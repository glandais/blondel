/**
 * Jour « de développement » utilisé par les stratégies de balancement (σ des collets).
 *
 * Choix Blondel [ANALYSE] : avec un poteau d'angle (`newel`), le bord réel C_i contourne le
 * poteau (décrochements de a/2 et faces du poteau). Développer le limon sur ce contour n'a pas
 * de sens (les deux limons sont assemblés dans le poteau et le contour ajoute ~2a de longueur
 * au droit de l'angle). Les stratégies travaillent donc sur le jour **virtuel** formé par les
 * faces internes des limons prolongées jusqu'à leur intersection K (centre du poteau, même
 * point que le centre de l'arc de Γ, cf. tracé) ; la ligne de nez obtenue (par P_k et le point
 * σ_k de ce jour virtuel) est ensuite coupée par le bord réel : Q_k est sa première
 * intersection avec le contour du poteau ou le limon. Jour vif ou en arc : jour réel.
 */
import type { Layout } from "../model/derived.js";
import type { Curve2, CurveSeg } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { makeCurve } from "../geom2d/curve.js";
import { lineSeg, segEnd, segStart } from "../geom2d/segment.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { turnCollarSide } from "./sides.js";

export function developmentInner(layout: Layout, project: Project): Curve2 {
  const turns = project.stair.layout.turns;
  let segs: readonly CurveSeg[] = layout.inner.segments;
  let changed = false;
  turns.forEach((t, j) => {
    if (t.inner.kind !== "newel") return;
    // S / Z : seuls les poteaux des tournants dont le jour est sur `layout.inner` (vue retournée
    // du tracé pour l'autre côté, `sides.ts`).
    if (turnCollarSide(layout, j) !== layout.innerSide) return;
    const k = layout.turns[j]?.innerCorner;
    if (!k) return;
    // Segments dont les deux extrémités sont sur (ou dans) le poteau : contour à remplacer.
    const reach = (t.inner.size / 2) * Math.SQRT2 + GEOM_EPS;
    const inside = (seg: CurveSeg): boolean =>
      seg.kind === "line" &&
      V.distance(segStart(seg), k) <= reach &&
      V.distance(segEnd(seg), k) <= reach;
    let first = -1;
    let last = -1;
    segs.forEach((seg, i) => {
      if (!inside(seg)) return;
      if (first < 0) first = i;
      if (last < 0 || last === i - 1) last = i;
    });
    if (first < 0) return;
    const a = segStart(segs[first]!);
    const b = segEnd(segs[last]!);
    const replacement: CurveSeg[] = [];
    if (V.distance(a, k) > GEOM_EPS) replacement.push(lineSeg(a, k));
    if (V.distance(k, b) > GEOM_EPS) replacement.push(lineSeg(k, b));
    segs = [...segs.slice(0, first), ...replacement, ...segs.slice(last + 1)];
    changed = true;
  });
  return changed ? makeCurve(segs) : layout.inner;
}
