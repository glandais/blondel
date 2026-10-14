/**
 * Auto-recouvrement d'une cage (ADR-0010, sous-lot 2d ; hélicoïdal, F10 P3, décision (10a)) :
 * une cage qui repasse au-dessus d'elle-même forme son propre plafond (CHALLENGE G4). L'étape
 * d'échappée est la **seule** source des sous-faces (`Model.soffits`), cage saisie comme
 * hélicoïdal : le découpage n'en porte pas.
 *
 * - **Détection** (`cageSelfCovers`) : cumul de balayage de la cage d'au moins un tour (somme
 *   signée des angles de jonction et des balayages des axes en arc, prise au plus loin le long
 *   de la montée), ou tronçons qui se superposent en plan (constat du tracé
 *   `layout.cage.sectionsOverlap`, `layout/cage/overlap.ts`). Constat géométrique, sans seuil.
 * - **Sous-faces** (`cageSoffits`) : chaque marche (contour de pièce `Tread.outline`, prolongé
 *   sous le nez supérieur, altitude z − `treads.thickness`, abscisse de son nez avant). Une
 *   sous-face ne compte qu'au-dessus des parties situées plus bas dans la montée
 *   (`selfcover.ts`) : la marche
 *   courante et les précédentes sont exclues, seules les parties d'un « tour » plus haut forment
 *   plafond. L'échappée passe alors par `selfCoveredHeadroom`.
 *
 * - **Contours non fiables** (`cageOutlineDefect`) : quand une partie de la cage passe sur une
 *   autre, une ligne de nez peut rencontrer le bord de l'autre partie avant le sien
 *   (`balancing/postprocess.ts`, `firstHit`) ; le contour de la marche s'étend alors loin de sa
 *   propre portion d'escalier (recouvrement parallèle, tronçons en arc, spirale de paliers) et
 *   une sous-face fausse couvrirait la marche voisine (échappée de −épaisseur). Un tel contour
 *   rend l'échappée non calculée (erreur du modèle) plutôt qu'une valeur fausse. Critère
 *   géométrique, sans seuil métier : chaque sommet du contour est à moins de `reach` (plus
 *   grande largeur de la cage + débord de nez) de la portion de Γ comprise entre ses nez,
 *   prolongée de `reach` de part et d'autre, ou confondu avec un coin d'une zone tournante qui
 *   touche cette portion (coin extérieur d'un mur vif). Un contour faux mais resté dans ce
 *   voisinage n'est pas détecté (limite consignée au journal du sous-lot 2d).
 *
 * Les sous-faces sont déduites ici, au moment de l'échappée (`cageHeadroomCeilings`, étape
 * d'échappée du pipeline extraite en fonction pure).
 *
 * **Hélicoïdal** (cage d'origine `helical`, `Layout.helicalOrigin`, F10 sous-lot P3) : sous-faces
 * **toujours** posées, même sous un tour (convention de l'hélicoïdal depuis le jalon 5a, gardée
 * telle quelle : mêmes plafonds, donc même échappée qu'avant P3), `helicalSoffits` : marches
 * (`cageSoffits`) puis palier d'arrivée (`helicalOrigin.arrivalOutline`, altitude du nez
 * d'arrivée − épaisseur des marches, épaisseur supposée égale à celle des marches, à valider).
 * Pas de contrôle `cageOutlineDefect` (comportement d'avant P3) : les lignes de nez y sont
 * rayonnantes, leurs intersections d'un tour à l'autre départagées par l'abscisse attendue
 * (`firstHit`, `nearS`), et `cageOutlineReach` lit le tracé saisi en cage, que l'hélicoïdal n'a
 * pas. Un modèle partiel (échappée non atteinte) n'a pas de sous-faces : l'élévation d'un
 * hélicoïdal partiel ne les dessine plus (avant P3, celles du découpage l'étaient).
 */
import { curveLength, subCurve } from "../geom2d/curve.js";
import { distanceToCurve } from "../geom2d/intersect.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { Layout, NosingLine, Soffit, Stepping, Tread } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { CageLayoutSpec } from "../model/project.js";

/** Tour complet (degrés) : seuil géométrique du cumul de balayage, pas une valeur métier. */
const FULL_TURN_DEG = 360;

/** Clé du constat du tracé « tronçons qui se superposent en plan ». */
const SECTIONS_OVERLAP_KEY = "layout.cage.sectionsOverlap";

/**
 * Plus grand cumul (degrés, en valeur absolue) des balayages signés de la cage le long de la
 * montée : jonctions (angle signé) et axes en arc (balayage signé), dans l'ordre.
 */
export function cageMaxSweep(spec: CageLayoutSpec): number {
  let sum = 0;
  let max = 0;
  spec.sections.forEach((section, i) => {
    if (section.axis.kind === "arc") {
      sum += section.axis.sweep;
      max = Math.max(max, Math.abs(sum));
    }
    const j = spec.junctions[i];
    if (j) {
      sum += j.angle;
      max = Math.max(max, Math.abs(sum));
    }
  });
  return max;
}

/** Vrai si la cage repasse au-dessus d'elle-même (voir l'en-tête). */
export function cageSelfCovers(spec: CageLayoutSpec, layout: Layout): boolean {
  if (cageMaxSweep(spec) >= FULL_TURN_DEG) return true;
  return (layout.errors ?? []).some((e) => e.key === SECTIONS_OVERLAP_KEY);
}

/** Sous-faces des marches d'une cage (voir l'en-tête). */
export function cageSoffits(
  stepping: Pick<Stepping, "treads" | "nosings">,
  thickness: Mm,
): Soffit[] {
  const out: Soffit[] = [];
  for (const t of stepping.treads) {
    const front = stepping.nosings[t.number - 1];
    if (!front || t.outline.length < 3) continue;
    out.push({ outline: t.outline, z: t.z - thickness, sStart: front.s, tread: t.number });
  }
  return out;
}

/**
 * Sous-faces d'un hélicoïdal (voir l'en-tête) : marches, puis palier d'arrivée s'il y en a un.
 */
export function helicalSoffits(
  layout: Pick<Layout, "helicalOrigin">,
  stepping: { readonly treads: readonly Tread[]; readonly nosings: readonly NosingLine[] },
  thickness: Mm,
): Soffit[] {
  const soffits = cageSoffits(stepping, thickness);
  const last = stepping.nosings[stepping.nosings.length - 1];
  const arrival = layout.helicalOrigin?.arrivalOutline;
  if (arrival && last) soffits.push({ outline: arrival, z: last.z - thickness, sStart: last.s });
  return soffits;
}

/**
 * Portée d'un contour de marche (voir l'en-tête) : plus grande largeur de la cage (départs et
 * arrivées de tous les tronçons) augmentée du débord de nez.
 */
export function cageOutlineReach(spec: CageLayoutSpec, nosing: Mm): Mm {
  return Math.max(...spec.sections.flatMap((s) => [s.width, s.widthEnd ?? s.width])) + nosing;
}

/**
 * Première marche dont le contour sort de sa portion d'escalier (voir l'en-tête), ou `null` si
 * tous les contours sont fiables.
 */
export function cageOutlineDefect(stepping: Stepping, layout: Layout, reach: Mm): number | null {
  const total = curveLength(layout.walkline);
  for (const t of stepping.treads) {
    const front = stepping.nosings[t.number - 1];
    const back = stepping.nosings[t.number];
    if (!front || t.outline.length < 3) continue;
    const s0 = Math.max(0, front.s - reach);
    const s1 = Math.min(total, (back?.s ?? total) + reach);
    const portion = subCurve(layout.walkline, s0, s1);
    const corners = layout.turns
      .filter((z) => z.sEnd >= s0 - GEOM_EPS && z.sStart <= s1 + GEOM_EPS)
      .flatMap((z) => [z.innerCorner, z.outerCorner]);
    for (const q of t.outline) {
      if (distanceToCurve(q, portion) <= reach + GEOM_EPS) continue;
      if (corners.some((c) => V.distance(c, q) <= GEOM_EPS)) continue;
      return t.number;
    }
  }
  return null;
}

/**
 * Plafonds propres d'une cage pour l'échappée (étape d'échappée du pipeline, `build.ts`,
 * extraite en fonction pure, F10 sous-lot P1) : `defect` si un contour de marche d'une cage
 * saisie n'est pas fiable (échappée non calculée, erreur `headroom.error.cageTreadOutline`),
 * sinon les sous-faces à passer à `computeHeadroom` (`undefined` : la cage ne se recouvre pas,
 * ou tracé à volées). Hélicoïdal (`layout.helicalOrigin`, `spec` indéfini) : toujours ses
 * sous-faces, palier d'arrivée compris (voir l'en-tête). Seule source des sous-faces du modèle.
 */
export function cageHeadroomCeilings(
  spec: CageLayoutSpec | undefined,
  layout: Layout,
  stepping: Stepping,
  thickness: Mm,
  nosing: Mm,
):
  | { readonly kind: "defect"; readonly tread: number }
  | { readonly kind: "ceilings"; readonly soffits?: readonly Soffit[] } {
  if (layout.helicalOrigin) {
    return { kind: "ceilings", soffits: helicalSoffits(layout, stepping, thickness) };
  }
  if (spec === undefined || !cageSelfCovers(spec, layout)) return { kind: "ceilings" };
  const tread = cageOutlineDefect(stepping, layout, cageOutlineReach(spec, nosing));
  if (tread !== null) return { kind: "defect", tread };
  return { kind: "ceilings", soffits: cageSoffits(stepping, thickness) };
}
