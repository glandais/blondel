/**
 * Lignes de mesure réglementaires distinctes de la ligne de conception (SPEC X9, LEDGER l. 50).
 *
 * La ligne de foulée de conception (Γ) est libre ; les girons réglementaires se mesurent sur une
 * ligne de mesure à distance d du bord du jour (DTU : milieu si E ≤ 1 200 mm, 600 mm sinon ;
 * accessibilité : idem ; ERP tournant et hélicoïdal bois : 600 mm), A-regles §1.4 et §2.1,
 * B-geometrie §2.2. Méthode (B §2.2, K1 / K9) : la ligne de mesure est la ligne à distance d du
 * jour, construite comme Γ (qui est à d_f du jour) : courbe décalée de Γ de d − d_f, du côté du
 * jour du tournant voisin (poteau, jour en arc et S / Z compris, mêmes conventions que le tracé) ;
 * le giron d'une marche est la longueur de cette courbe entre ses intersections avec les deux
 * lignes de nez qui la bornent (même convention que `Tread.going`, longueur de Γ entre deux nez).
 *
 * Seules les marches balancées sont mesurées : les nez d'une marche droite sont parallèles, son
 * giron est le même sur toute ligne parallèle aux bords.
 */
import { errorMessage, msg, type Message } from "@blondel/i18n";
import { intersectLineCurve } from "../geom2d/intersect.js";
import { offsetCurve } from "../geom2d/offset.js";
import * as V from "../geom2d/vec.js";
import type { Layout, NosingLine, Stepping, Tread } from "../model/derived.js";
import type { Curve2, Mm } from "../model/primitives.js";
import { collarSideAt, otherSide, type Side } from "../stepping/sides.js";

export interface MeasuredGoing {
  readonly tread: Tread;
  /** Giron sur la ligne de mesure (mm). */
  readonly going: Mm;
}

export type MeasurementResult =
  | { readonly ok: true; readonly goings: readonly MeasuredGoing[] }
  | { readonly ok: false; readonly reason: Message };

/** Tolérance relative des intersections sur le segment de nez Q → R. */
const T_EPS = 1e-6;

/**
 * Abscisse, sur la ligne de mesure `curve`, de l'intersection avec la ligne de nez `nl` : celle
 * du segment Q R la plus proche de la distance d au bord du jour (extrémité Q ou R). `null` si
 * la ligne de nez ne coupe pas la ligne de mesure dans l'emmarchement.
 */
function abscissaOn(curve: Curve2, nl: NosingLine, jourAtQ: boolean, d: Mm): Mm | null {
  const dir = V.sub(nl.r, nl.q);
  if (!(V.norm(dir) > 0)) return null;
  const jourEnd = jourAtQ ? nl.q : nl.r;
  let best: { s: Mm; err: number } | null = null;
  for (const h of intersectLineCurve({ origin: nl.q, dir }, curve)) {
    if (h.t < -T_EPS || h.t > 1 + T_EPS) continue;
    const err = Math.abs(V.distance(h.point, jourEnd) - d);
    if (best === null || err < best.err) best = { s: h.s, err };
  }
  return best?.s ?? null;
}

/**
 * Girons des marches balancées mesurés sur la ligne de mesure à distance `d` du bord du jour
 * (côté du jour du tournant le plus proche, `collarSideAt` : S / Z compris ; hélicoïdal : bord
 * intérieur).
 */
export function goingsOnMeasurementLine(
  layout: Layout,
  stepping: Stepping,
  d: Mm,
): MeasurementResult {
  const shift = d - layout.walklineOffset;
  const helical = layout.helical;
  if (helical) {
    // Hélicoïdal : Γ est un cercle de rayon r_Γ (en plan, parcouru sur plus d'un tour) ; la
    // ligne de mesure est le cercle concentrique de rayon r_Γ + d − d_f, chaque marche y
    // occupe le même angle.
    const radius = helical.walklineRadius + shift;
    // Le cercle de mesure doit couper les marches (entre le bord intérieur et le bord extérieur).
    if (!(radius > 0) || radius < helical.innerRadius - 1e-9 || radius > helical.outerRadius + 1e-9)
      return { ok: false, reason: msg("compliance.measurementLine.outsideWidth") };
    return {
      ok: true,
      goings: stepping.treads
        .filter((t) => t.kind === "winder")
        .map((tread) => ({ tread, going: radius * helical.stepAngle })),
    };
  }
  const curves = new Map<Side, Curve2>();
  const curveFor = (side: Side): Curve2 => {
    let c = curves.get(side);
    if (!c) {
      // Γ est à d_f du jour (au droit de chaque tournant, côté `side`) : la ligne de mesure en
      // est la décalée de d − d_f, vers le jour si d < d_f (Γ orientée dans le sens de la
      // montée, jour à gauche → décalage vers la gauche).
      c =
        Math.abs(shift) <= 1e-9
          ? layout.walkline
          : offsetCurve(layout.walkline, Math.abs(shift), shift < 0 ? side : otherSide(side));
      curves.set(side, c);
    }
    return c;
  };
  const goings: MeasuredGoing[] = [];
  for (const t of stepping.treads) {
    if (t.kind !== "winder") continue;
    const a = stepping.nosings[t.number - 1];
    const b = stepping.nosings[t.number];
    if (!a || !b)
      return {
        ok: false,
        reason: msg("compliance.measurementLine.missingNosings", { tread: t.number }),
      };
    const side = collarSideAt(layout, (a.s + b.s) / 2);
    let curve: Curve2;
    try {
      curve = curveFor(side);
    } catch (e) {
      return {
        ok: false,
        reason: msg("compliance.measurementLine.notConstructible", { detail: errorMessage(e) }),
      };
    }
    const jourAtQ = side === layout.innerSide;
    const sa = abscissaOn(curve, a, jourAtQ, d);
    const sb = abscissaOn(curve, b, jourAtQ, d);
    if (sa === null || sb === null)
      return {
        ok: false,
        reason: msg("compliance.measurementLine.noIntersection", { tread: t.number }),
      };
    goings.push({ tread: t, going: sb - sa });
  }
  return { ok: true, goings };
}
