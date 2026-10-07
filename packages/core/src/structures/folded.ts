/**
 * Marches en tôle pliée (C §2.6, CHALLENGE G5, SPEC §2.4) : profils en **Z** (dessus + nez
 * plié en contremarche + retour) et en **U** (nez + dessus + retour arrière).
 *
 * **Section** (plan vertical perpendiculaire au nez, X vers l'arrière de la marche, Y vers le
 * haut, origine = arête extérieure du nez, ligne de nez à X = 0, dessus de marche à Y = 0) :
 *
 * - `Z` : dessus de X = D (bord arrière libre, contre la contremarche de la pièce suivante) au
 *   nez ; pli vers le bas (contremarche, face avant sur la ligne de nez) ; pli vers l'avant
 *   (retour, sous le dessus de la marche précédente, de longueur L_r depuis la ligne de nez).
 *   Contremarche : du dessus (Y = 0) au dessus du retour, à `riserDrop` sous le dessus.
 * - `U` : aile de nez (hauteur extérieure H_n) ; dessus de X = 0 à X = D ; aile arrière
 *   (hauteur extérieure H_b, face arrière sur la ligne du nez suivant).
 *
 * Plis à 90° (contremarche verticale, dessus horizontal), rayon intérieur r et facteur K de la
 * loi de pli du profil d'atelier. **Développé en fibre neutre** :
 * L = Σ ailes droites + Σ θ·(r + K·t), aile droite = cote extérieure − retraits extérieurs
 * (r + t)·tan(θ/2) de ses plis.
 *
 * **Développé en plan** (marches balancées : lignes de pli non parallèles, pièces toutes
 * différentes) : le dessus est le contour de la marche en plan (vu de dessus, face de
 * référence = dessus de marche), rogné à r + t des lignes de moule des plis (lignes de nez) ;
 * chaque aile verticale se déplie perpendiculairement à sa ligne de pli, en bande rectangulaire
 * limitée à la plus courte des deux étendues (ligne de moule, ligne de tangence) : l'aile ne
 * dépasse jamais le jeu latéral. Les lignes de pli sont tracées au **milieu** de la zone de
 * pli (longueur θ·(r + K·t)). Pas de dégagement de pli (entaille de décharge) dessiné.
 */
import { dec, msg, MessageError, textMessage, type Message } from "@blondel/i18n";
import { segmentIntersect } from "../geom2d/intersect.js";
import { ensureCCW, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import { bendAllowance, outsideSetback, type ResolvedBend } from "../workshop/metal.js";
import { clipHalfPlane, dedupe, isSimplePolygon, removeCollinear } from "./geom.js";
import { holePolygon } from "./steelCommon.js";

export type FoldedProfile = "Z" | "U";

/** Élément de la ligne moyenne d'une section : droite ou pli (tournant à gauche +1 / droite −1). */
export type SectionStep =
  | { readonly kind: "line"; readonly length: Mm }
  | { readonly kind: "arc"; readonly turn: 1 | -1; readonly angle: number; readonly radius: Mm };

/** Pli d'une section : angle (rad) et sens par rapport à la face de référence (dessus). */
export interface SectionBend {
  readonly angle: number;
  /** Vrai : l'aile suivante se relève vers la face de référence (dessus de marche). */
  readonly up: boolean;
}

/** Section d'une tôle pliée : ailes droites (dans l'ordre) séparées par les plis. */
export interface FoldedSection {
  /** `L` : contremarche d'arrivée des marches en Z (`arrivalRiserSection`). */
  readonly profile: FoldedProfile | "L";
  readonly thickness: Mm;
  readonly innerRadius: Mm;
  /** Longueurs droites des ailes (n + 1 pour n plis). */
  readonly straights: readonly Mm[];
  readonly bends: readonly SectionBend[];
  /** Nom des ailes, dans l'ordre. */
  readonly flangeNames: readonly Message[];
  /** Ligne moyenne (départ, direction, éléments) dans le repère de section. */
  readonly start: Vec2;
  readonly heading: Vec2;
  readonly steps: readonly SectionStep[];
}

/** Longueur développée en fibre neutre : Σ ailes droites + Σ θ·(r + K·t). */
export function flatLength(section: FoldedSection, k: number): Mm {
  const s = section.straights.reduce((a, b) => a + b, 0);
  const b = section.bends.reduce(
    (a, x) => a + bendAllowance(x.angle, section.innerRadius, k, section.thickness),
    0,
  );
  return s + b;
}

const QUARTER = Math.PI / 2;

/** Noms des ailes (développés, messages d'erreur, contrôles de pliage). */
const FLANGE = {
  top: msg("structure.steel.folded.flange.top"),
  riser: msg("structure.steel.folded.flange.riser"),
  return: msg("structure.steel.folded.flange.return"),
  nose: msg("structure.steel.folded.flange.nose"),
  rearReturn: msg("structure.steel.folded.flange.rearReturn"),
} as const;

/** Libellé d'une ligne de pli : « P1 · 90° vers le bas · r_int 6,5 ». */
function bendLabel(n: number, angle: number, up: boolean, r: Mm): Message {
  return msg(up ? "structure.steel.folded.bendLine.up" : "structure.steel.folded.bendLine.down", {
    n,
    angle: dec(deg(angle), 0),
    radius: dec(r, 1),
  });
}

/** Aile sans partie droite (cotes incompatibles avec le rayon de pli). */
function flangeError(mark: string, flange: Message, length: Mm, r: Mm): MessageError {
  return new MessageError(
    msg("structure.steel.folded.error.flangeNoStraight", {
      mark,
      flange,
      length: dec(length, 1),
      radius: dec(r, 1),
    }),
  );
}

export interface ZSectionInput {
  /** Profondeur du dessus D (nez → bord arrière), mm. */
  readonly depth: Mm;
  /** Distance verticale du dessus de la marche au dessus du retour, mm. */
  readonly riserDrop: Mm;
  /** Longueur du retour depuis la ligne de nez (face avant de la contremarche), mm. */
  readonly returnLength: Mm;
  readonly thickness: Mm;
  readonly innerRadius: Mm;
}

/** Section en Z (voir l'en-tête). Ailes droites : D − t − r ; riserDrop − t − 2r ; L_r − r. */
export function zSection(i: ZSectionInput): FoldedSection {
  const { thickness: t, innerRadius: r } = i;
  const plate = i.depth - t - r;
  const riser = i.riserDrop - t - 2 * r;
  const ret = i.returnLength - r;
  const rc = r + t / 2;
  return {
    profile: "Z",
    thickness: t,
    innerRadius: r,
    straights: [plate, riser, ret],
    bends: [
      { angle: QUARTER, up: false },
      { angle: QUARTER, up: true },
    ],
    flangeNames: [FLANGE.top, FLANGE.riser, FLANGE.return],
    start: V.vec(i.depth, -t / 2),
    heading: V.vec(-1, 0),
    steps: [
      { kind: "line", length: plate },
      { kind: "arc", turn: 1, angle: QUARTER, radius: rc },
      { kind: "line", length: riser },
      { kind: "arc", turn: -1, angle: QUARTER, radius: rc },
      { kind: "line", length: ret },
    ],
  };
}

export interface ArrivalRiserSectionInput {
  /** Distance verticale de l'arête haute de la contremarche au dessus du retour, mm. */
  readonly riserDrop: Mm;
  /** Longueur du retour depuis la ligne de nez (face avant de la contremarche), mm. */
  readonly returnLength: Mm;
  readonly thickness: Mm;
  readonly innerRadius: Mm;
}

/**
 * Section en L de la contremarche d'arrivée des marches en Z (décision A11 : plat plié fixé au
 * chevêtre), même repère que `zSection` (X vers l'arrière, Y vers le haut, origine sur la ligne
 * du nez d'arrivée à l'arête haute) : contremarche verticale, face avant sur la ligne de nez, de
 * l'arête haute (Y = 0) au dessus du retour (Y = −riserDrop) ; pli vers l'avant ; retour sous le
 * dessus de la dernière marche, de longueur L_r depuis la ligne de nez. Ailes droites :
 * riserDrop − r ; L_r − r.
 */
export function arrivalRiserSection(i: ArrivalRiserSectionInput): FoldedSection {
  const { thickness: t, innerRadius: r } = i;
  const riser = i.riserDrop - r;
  const ret = i.returnLength - r;
  return {
    profile: "L",
    thickness: t,
    innerRadius: r,
    straights: [riser, ret],
    bends: [{ angle: QUARTER, up: true }],
    flangeNames: [FLANGE.riser, FLANGE.return],
    start: V.vec(t / 2, 0),
    heading: V.vec(0, -1),
    steps: [
      { kind: "line", length: riser },
      { kind: "arc", turn: -1, angle: QUARTER, radius: r + t / 2 },
      { kind: "line", length: ret },
    ],
  };
}

export interface USectionInput {
  readonly depth: Mm;
  /** Hauteurs extérieures de l'aile de nez et de l'aile arrière, mm. */
  readonly noseHeight: Mm;
  readonly rearHeight: Mm;
  readonly thickness: Mm;
  readonly innerRadius: Mm;
}

/** Section en U. Ailes droites : H_n − t − r ; D − 2(t + r) ; H_b − t − r. */
export function uSection(i: USectionInput): FoldedSection {
  const { thickness: t, innerRadius: r } = i;
  const nose = i.noseHeight - t - r;
  const plate = i.depth - 2 * (t + r);
  const rear = i.rearHeight - t - r;
  const rc = r + t / 2;
  return {
    profile: "U",
    thickness: t,
    innerRadius: r,
    straights: [nose, plate, rear],
    bends: [
      { angle: QUARTER, up: false },
      { angle: QUARTER, up: false },
    ],
    flangeNames: [FLANGE.nose, FLANGE.top, FLANGE.rearReturn],
    start: V.vec(t / 2, -i.noseHeight),
    heading: V.vec(0, 1),
    steps: [
      { kind: "line", length: nose },
      { kind: "arc", turn: -1, angle: QUARTER, radius: rc },
      { kind: "line", length: plate },
      { kind: "arc", turn: -1, angle: QUARTER, radius: rc },
      { kind: "line", length: rear },
    ],
  };
}

/**
 * Contour fermé de la section (ligne moyenne décalée de ± t/2, arcs échantillonnés tous les
 * 7,5° au plus), repère de section.
 */
export function sectionPolygon(section: FoldedSection): Polygon2 {
  const pts: { p: Vec2; n: Vec2 }[] = [];
  let p = section.start;
  let h = V.normalize(section.heading);
  const push = (q: Vec2, dir: Vec2): void => {
    pts.push({ p: q, n: V.perpLeft(dir) });
  };
  push(p, h);
  for (const s of section.steps) {
    if (s.kind === "line") {
      p = V.addScaled(p, h, s.length);
      push(p, h);
    } else {
      const toCenter = s.turn === 1 ? V.perpLeft(h) : V.perpRight(h);
      const c = V.addScaled(p, toCenter, s.radius);
      const n = Math.max(2, Math.ceil(s.angle / (Math.PI / 24)));
      const start = V.sub(p, c);
      for (let j = 1; j <= n; j++) {
        const a = (s.turn * s.angle * j) / n;
        const q = V.add(c, V.rotate(start, a));
        const dir = V.rotate(h, a);
        push(q, dir);
      }
      h = V.rotate(h, s.turn * s.angle);
      p = pts[pts.length - 1]!.p;
    }
  }
  const t = section.thickness / 2;
  const left = pts.map(({ p: q, n }) => V.addScaled(q, n, t));
  const right = pts.map(({ p: q, n }) => V.addScaled(q, n, -t));
  return ensureCCW(removeCollinear(dedupe([...left, ...right.reverse()])));
}

// ------------------------------------------------------------------ Développé en plan

export interface PlanLine {
  readonly p: Vec2;
  readonly dir: Vec2;
}

export interface FoldedTreadInput {
  readonly profile: FoldedProfile;
  /** Contour du dessus en plan (CCW), jeux latéraux déjà retirés. */
  readonly plate: Polygon2;
  /** Ligne de nez avant (moule du premier pli). */
  readonly front: PlanLine;
  /** Ligne de nez arrière (U : moule du pli arrière ; Z : bord libre). */
  readonly rear: PlanLine;
  readonly bend: ResolvedBend;
  /** Z : distance verticale du dessus au dessus du retour. */
  readonly riserDrop: Mm;
  /** Z : longueur du retour depuis la ligne de nez. */
  readonly returnLength: Mm;
  /** U : hauteurs extérieures des ailes de nez et arrière. */
  readonly noseHeight: Mm;
  readonly rearHeight: Mm;
  readonly mark: string;
}

/** Ligne de pli en plan (monde) et dans le développé. */
export interface BendLineInfo {
  /** Repère de la ligne de pli (« P1 »). */
  readonly mark: string;
  readonly label: Message;
  readonly length: Mm;
  readonly angleDeg: number;
  readonly up: boolean;
}

/** Longueur intérieure d'une aile aux deux extrémités de la ligne de pli voisine. */
export interface FlangeCheck {
  readonly label: Message;
  readonly atStart: Mm;
  readonly atEnd: Mm;
}

export interface FoldedTreadResult {
  readonly flat: FlatPattern;
  /** Contour développé dans le repère plan monde (avant mise à plat locale). */
  readonly worldOutline: Polygon2;
  /**
   * Dessus plan de la marche en plan (repère monde, CCW) : contour du dessus rogné aux lignes de
   * tangence des plis, c.-à-d. la partie plane du développé (perçages de fixation, A31).
   */
  readonly top: Polygon2;
  readonly bendLines: readonly BendLineInfo[];
  readonly flanges: readonly FlangeCheck[];
  /** Section au milieu de la ligne de pli avant (profondeur D mesurée là). */
  readonly section: FoldedSection;
  /** Étendue [s0 ; s1] de la ligne de pli avant le long de `frontAxis`, depuis `frontOrigin`. */
  readonly frontOrigin: Vec2;
  readonly frontAxis: Vec2;
  /** Normale horizontale de la ligne de nez avant, vers l'arrière de la marche. */
  readonly inward: Vec2;
  readonly s0: Mm;
  readonly s1: Mm;
  /** Lignes de pli parallèles et dessus quadrilatère : section constante (solide exact). */
  readonly prismatic: boolean;
  readonly flatArea: number;
}

const ON_LINE = 1e-6;

function inwardNormal(line: PlanLine, poly: Polygon2): Vec2 {
  const d = V.normalize(line.dir);
  let n = V.perpLeft(d);
  let c = V.ZERO;
  for (const p of poly) c = V.add(c, p);
  c = V.scale(c, 1 / poly.length);
  if (V.dot(V.sub(c, line.p), n) < 0) n = V.scale(n, -1);
  return n;
}

/** Distance le long de `inward` depuis `from` jusqu'à la droite `to` (∞ si parallèle). */
function rayToLine(from: Vec2, inward: Vec2, to: PlanLine): Mm {
  const n = V.perpLeft(V.normalize(to.dir));
  const den = V.dot(inward, n);
  if (Math.abs(den) < 1e-12) return Infinity;
  return V.dot(V.sub(to.p, from), n) / den;
}

interface Strip {
  /** Origine de la ligne de tangence, normale vers le dessus. */
  readonly tangentOrigin: Vec2;
  readonly inward: Vec2;
  readonly along: Vec2;
  readonly s0: Mm;
  readonly s1: Mm;
  readonly width: Mm;
}

/** Étendue d'une ligne de pli : bande sur l'arête du dessus portée par la ligne de tangence. */
function stripRange(
  plate: Polygon2,
  clipped: Polygon2,
  mold: PlanLine,
  inward: Vec2,
  setback: Mm,
): { origin: Vec2; along: Vec2; s0: Mm; s1: Mm; e0: Mm; e1: Mm } | null {
  const origin = V.addScaled(mold.p, inward, setback);
  const along = V.perpRight(inward);
  // Arête la plus longue portée par la droite (un dessus non convexe peut la recouper ailleurs).
  const longest = (poly: Polygon2, o: Vec2): [Mm, Mm] | null => {
    let best: [Mm, Mm] | null = null;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const on = (p: Vec2): boolean => Math.abs(V.dot(V.sub(p, o), inward)) <= ON_LINE;
      if (!on(a) || !on(b)) continue;
      const xa = V.dot(V.sub(a, origin), along);
      const xb = V.dot(V.sub(b, origin), along);
      const seg: [Mm, Mm] = [Math.min(xa, xb), Math.max(xa, xb)];
      if (!best || seg[1] - seg[0] > best[1] - best[0]) best = seg;
    }
    return best;
  };
  const eT = longest(clipped, origin);
  const eM = longest(plate, mold.p);
  if (!eT || !eM) return null;
  const [e0, e1] = eT;
  const [m0, m1] = eM;
  return { origin, along, s0: Math.max(e0, m0), s1: Math.min(e1, m1), e0, e1 };
}

/** Insère la bande dépliée d'une aile sous l'arête portée par la ligne de tangence. */
function spliceStrip(poly: readonly Vec2[], strip: Strip): Vec2[] | null {
  const { tangentOrigin: o, inward, along } = strip;
  const n = poly.length;
  const on = (p: Vec2): boolean => Math.abs(V.dot(V.sub(p, o), inward)) <= ON_LINE;
  const x = (p: Vec2): Mm => V.dot(V.sub(p, o), along);
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    if (!on(a) || !on(b) || !(x(b) > x(a))) continue;
    if (strip.s0 < x(a) - 1e-6 || strip.s1 > x(b) + 1e-6) continue;
    const at = (s: Mm, w: Mm): Vec2 => V.addScaled(V.addScaled(o, along, s), inward, -w);
    const insert = [
      at(strip.s0, 0),
      at(strip.s0, strip.width),
      at(strip.s1, strip.width),
      at(strip.s1, 0),
    ];
    return dedupe([...poly.slice(0, i + 1), ...insert, ...poly.slice(i + 1)]);
  }
  return null;
}

const deg = (a: number): number => (a * 180) / Math.PI;

/**
 * Développé 1:1 d'une marche en tôle pliée (voir l'en-tête). Lève une erreur (message français)
 * si la géométrie ne permet pas le pliage (aile droite négative, arête introuvable).
 */
export function developFoldedTread(input: FoldedTreadInput): FoldedTreadResult {
  const { bend } = input;
  const t = bend.thickness;
  const r = bend.innerRadius;
  const k = bend.k;
  const plate = ensureCCW(removeCollinear(dedupe(input.plate)));
  const inF = inwardNormal(input.front, plate);
  const inR = inwardNormal(input.rear, plate);
  const setback = outsideSetback(QUARTER, r, t);
  const ba = bendAllowance(QUARTER, r, k, t);

  let clipped: Polygon2 = clipHalfPlane(plate, V.addScaled(input.front.p, inF, setback), inF);
  if (input.profile === "U") {
    clipped = clipHalfPlane(clipped, V.addScaled(input.rear.p, inR, setback), inR);
  }
  clipped = ensureCCW(removeCollinear(dedupe(clipped)));
  if (clipped.length < 3) {
    throw new MessageError(msg("structure.steel.folded.error.topTooShort", { mark: input.mark }));
  }

  const fr = stripRange(plate, clipped, input.front, inF, setback);
  if (!fr || !(fr.s1 - fr.s0 > 1)) {
    throw new MessageError(
      msg("structure.steel.folded.error.noseBendLineNotFound", { mark: input.mark }),
    );
  }
  const mid = V.addScaled(fr.origin, fr.along, (fr.s0 + fr.s1) / 2);
  const moldMid = V.addScaled(mid, inF, -setback);
  const depthMid = rayToLine(moldMid, inF, input.rear);
  const section =
    input.profile === "Z"
      ? zSection({
          depth: depthMid,
          riserDrop: input.riserDrop,
          returnLength: input.returnLength,
          thickness: t,
          innerRadius: r,
        })
      : uSection({
          depth: depthMid,
          noseHeight: input.noseHeight,
          rearHeight: input.rearHeight,
          thickness: t,
          innerRadius: r,
        });
  // Ailes à section constante (hors dessus) : doivent être positives.
  const fixed = input.profile === "Z" ? [1, 2] : [0, 2];
  for (const i of fixed) {
    if (!(section.straights[i]! > 0)) {
      throw flangeError(input.mark, section.flangeNames[i]!, section.straights[i]!, r);
    }
  }

  const lines: FlatPattern["lines"][number][] = [];
  const bendLines: BendLineInfo[] = [];
  const addBend = (
    o: Vec2,
    along: Vec2,
    inward: Vec2,
    s0: Mm,
    s1: Mm,
    dist: Mm,
    b: SectionBend,
    n: number,
  ): void => {
    const label = bendLabel(n, b.angle, b.up, r);
    const pa = V.addScaled(V.addScaled(o, along, s0), inward, -dist);
    const pb = V.addScaled(V.addScaled(o, along, s1), inward, -dist);
    lines.push({
      kind: "bend",
      a: pa,
      b: pb,
      label,
      bendAngle: deg(b.angle),
      bendUp: b.up,
      bendRadius: r,
    });
    bendLines.push({ mark: `P${n}`, label, length: s1 - s0, angleDeg: deg(b.angle), up: b.up });
  };

  let outline: Polygon2 | null = clipped;
  const flanges: FlangeCheck[] = [];
  // Profondeur (ligne de nez avant → ligne arrière) aux deux extrémités de la ligne de pli.
  const depthAt = (s: Mm): Mm =>
    rayToLine(V.addScaled(V.addScaled(fr.origin, fr.along, s), inF, -setback), inF, input.rear);
  const d0 = depthAt(fr.s0);
  const d1 = depthAt(fr.s1);
  if (input.profile === "Z") {
    const [, riser, ret] = section.straights as [Mm, Mm, Mm];
    const width = ba + riser + ba + ret;
    outline = spliceStrip(outline, {
      tangentOrigin: fr.origin,
      inward: inF,
      along: fr.along,
      s0: fr.s0,
      s1: fr.s1,
      width,
    });
    addBend(fr.origin, fr.along, inF, fr.s0, fr.s1, ba / 2, section.bends[0]!, 1);
    addBend(fr.origin, fr.along, inF, fr.s0, fr.s1, ba + riser + ba / 2, section.bends[1]!, 2);
    flanges.push(
      { label: FLANGE.top, atStart: d0 - t, atEnd: d1 - t },
      { label: FLANGE.riser, atStart: riser + r, atEnd: riser + r },
      { label: FLANGE.return, atStart: ret + r, atEnd: ret + r },
    );
  } else {
    const [nose, , rear] = section.straights as [Mm, Mm, Mm];
    outline = spliceStrip(outline, {
      tangentOrigin: fr.origin,
      inward: inF,
      along: fr.along,
      s0: fr.s0,
      s1: fr.s1,
      width: ba + nose,
    });
    addBend(fr.origin, fr.along, inF, fr.s0, fr.s1, ba / 2, section.bends[0]!, 1);
    const rr = stripRange(plate, clipped, input.rear, inR, setback);
    if (!rr || !(rr.s1 - rr.s0 > 1) || !outline) {
      throw new MessageError(
        msg("structure.steel.folded.error.rearBendLineNotFound", { mark: input.mark }),
      );
    }
    outline = spliceStrip(outline, {
      tangentOrigin: rr.origin,
      inward: inR,
      along: rr.along,
      s0: rr.s0,
      s1: rr.s1,
      width: ba + rear,
    });
    addBend(rr.origin, rr.along, inR, rr.s0, rr.s1, ba / 2, section.bends[1]!, 2);
    flanges.push(
      { label: FLANGE.nose, atStart: nose + r, atEnd: nose + r },
      { label: FLANGE.top, atStart: d0 - 2 * t - r, atEnd: d1 - 2 * t - r },
      { label: FLANGE.rearReturn, atStart: rear + r, atEnd: rear + r },
    );
  }
  if (!outline) {
    throw new MessageError(
      msg("structure.steel.folded.error.bendEdgeNotFound", { mark: input.mark }),
    );
  }
  outline = ensureCCW(removeCollinear(dedupe(outline)));
  if (!isSimplePolygon(outline)) {
    throw new MessageError(msg("structure.steel.folded.error.notSimple", { mark: input.mark }));
  }
  const worldOutline = outline;

  // Mise à plat locale : x le long de la ligne de pli avant, y vers l'arrière, minimum à 0.
  const T = flatTransform(outline, fr.along, inF);
  const outer = outline.map(T);
  let cx = 0;
  let cy = 0;
  for (const p of clipped) {
    cx += p.x;
    cy += p.y;
  }
  const centroid = T(V.vec(cx / clipped.length, cy / clipped.length));
  const flatLines = lines.map((l) => ({ ...l, a: T(l.a), b: T(l.b) }));
  flatLines.push({
    kind: "text",
    a: V.vec(centroid.x - 20, centroid.y),
    b: V.vec(centroid.x + 20, centroid.y),
    label: textMessage(input.mark),
  });

  const parallel =
    Math.abs(V.cross(V.normalize(input.front.dir), V.normalize(input.rear.dir))) < 1e-9;
  return {
    flat: {
      outline: { outer, holes: [] },
      lines: flatLines,
      thickness: t,
      reference: {
        kind: "neutral-fiber",
        description: msg("structure.steel.folded.reference.tread", {
          profile: input.profile,
          k: dec(k, 3),
          radius: dec(r, 1),
          thickness: dec(t, 1),
          method: bend.method,
        }),
      },
    },
    worldOutline,
    top: clipped,
    bendLines,
    flanges,
    section,
    frontOrigin: fr.origin,
    frontAxis: fr.along,
    inward: inF,
    s0: fr.s0,
    s1: fr.s1,
    prismatic: parallel && plate.length === 4,
    flatArea: Math.abs(signedArea(outline)),
  };
}

/**
 * Mise à plat locale du développé d'une marche (déplacement plan, sans retournement) : x le long
 * de la ligne de pli avant (`ax`), y vers l'arrière (`ay`), minimums du contour monde à 0.
 */
function flatTransform(outline: Polygon2, ax: Vec2, ay: Vec2): (p: Vec2) => Vec2 {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of outline) {
    minX = Math.min(minX, V.dot(p, ax));
    minY = Math.min(minY, V.dot(p, ay));
  }
  return (p) => V.vec(V.dot(p, ax) - minX, V.dot(p, ay) - minY);
}

/**
 * Transformation rigide qui met à plat le développé d'une marche : point du plan (repère monde,
 * dans le dessus) ↦ point du développé `result.flat` (même transformation que celle qui envoie
 * `result.worldOutline` sur `result.flat.outline.outer`).
 */
export function foldedFlatTransform(result: FoldedTreadResult): (p: Vec2) => Vec2 {
  return flatTransform(result.worldOutline, result.frontAxis, result.inward);
}

/**
 * Retrait latéral du dessus : chaque arête du contour (CCW) est décalée vers l'intérieur de
 * `clearance`, sauf les arêtes portées par l'une des lignes `keep` (lignes de nez, moules des
 * plis) ; sommets aux intersections des arêtes décalées (onglet). `null` si le contour obtenu
 * n'est pas simple ou s'inverse.
 */
export function insetPlate(
  poly: Polygon2,
  keep: readonly PlanLine[],
  clearance: Mm,
): Polygon2 | null {
  const P = ensureCCW(removeCollinear(dedupe(poly)));
  const n = P.length;
  if (n < 3) return null;
  if (!(clearance > 0)) return P;
  const onLine = (p: Vec2, l: PlanLine): boolean =>
    Math.abs(V.cross(V.normalize(l.dir), V.sub(p, l.p))) <= 1e-6;
  const offset = P.map((p, i) => {
    const q = P[(i + 1) % n]!;
    return keep.some((l) => onLine(p, l) && onLine(q, l)) ? 0 : clearance;
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i - 1 + n) % n;
    const p0 = P[j]!;
    const p1 = P[i]!;
    const p2 = P[(i + 1) % n]!;
    const e0 = V.normalize(V.sub(p1, p0));
    const e1 = V.normalize(V.sub(p2, p1));
    const a0 = V.addScaled(p0, V.perpLeft(e0), offset[j]!);
    const a1 = V.addScaled(p1, V.perpLeft(e1), offset[i]!);
    const den = V.cross(e0, e1);
    if (Math.abs(den) < 1e-9) {
      out.push(V.addScaled(p1, V.perpLeft(e1), Math.max(offset[j]!, offset[i]!)));
      continue;
    }
    const t = V.cross(V.sub(a1, a0), e1) / den;
    out.push(V.addScaled(a0, e0, t));
  }
  const res = untangle(removeCollinear(dedupe(out)));
  if (!res || res.length < 3 || signedArea(res) <= 0 || !isSimplePolygon(res)) return null;
  return res;
}

/**
 * Supprime les boucles d'un contour qui se recoupe (décalage en onglet autour d'un poteau :
 * languette de tôle détachée) : à chaque recoupement, le contour est scindé en deux boucles et
 * seule la boucle directe (CCW) d'aire maximale est gardée.
 */
export function untangle(poly: Polygon2, maxIter = 32): Polygon2 | null {
  let P: Vec2[] = [...poly];
  for (let iter = 0; iter < maxIter; iter++) {
    const n = P.length;
    if (n < 3) return null;
    let split: { i: number; j: number; point: Vec2 } | null = null;
    for (let i = 0; i < n && !split; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const hit = segmentIntersect(P[i]!, P[(i + 1) % n]!, P[j]!, P[(j + 1) % n]!);
        if (hit) {
          split = { i, j, point: hit.point };
          break;
        }
      }
    }
    if (!split) return P;
    const { i, j, point } = split;
    const loopA = dedupe([point, ...P.slice(i + 1, j + 1)]);
    const loopB = dedupe([point, ...P.slice(j + 1), ...P.slice(0, i + 1)]);
    const candidates = [loopA, loopB].filter((l) => l.length >= 3 && signedArea(l) > 0);
    if (candidates.length === 0) return null;
    P = candidates.reduce((best, l) => (signedArea(l) > signedArea(best) ? l : best));
  }
  return null;
}

// ------------------------------------------------------------------ Contremarche d'arrivée (Z)

export interface ArrivalRiserInput {
  /** Extrémités de la contremarche sur la ligne du nez d'arrivée (jeux latéraux retirés). */
  readonly start: Vec2;
  readonly end: Vec2;
  /** Normale horizontale unitaire de la ligne de nez, vers le haut de l'escalier (chevêtre). */
  readonly up: Vec2;
  /** Altitude de l'arête haute, mm. */
  readonly zTop: Mm;
  /** Distance verticale de l'arête haute au dessus du retour, mm. */
  readonly riserDrop: Mm;
  readonly returnLength: Mm;
  readonly bend: ResolvedBend;
  /** Perçages de fixation au chevêtre (dans la contremarche, à mi-hauteur de l'aile droite). */
  readonly holes: number;
  readonly holeDiameter: Mm;
  readonly holeEdgeDistance: Mm;
  readonly mark: string;
}

export interface ArrivalRiserResult {
  readonly flat: FlatPattern;
  readonly section: FoldedSection;
  /** Repère du solide (extrusion de la section le long de la ligne de nez). */
  readonly frame: {
    readonly origin: { readonly x: number; readonly y: number; readonly z: number };
    readonly xAxis: { readonly x: number; readonly y: number; readonly z: number };
    readonly yAxis: { readonly x: number; readonly y: number; readonly z: number };
    readonly zAxis: { readonly x: number; readonly y: number; readonly z: number };
  };
  readonly length: Mm;
  readonly bendLines: readonly BendLineInfo[];
  readonly flanges: readonly FlangeCheck[];
  /** Centres des perçages dans le développé. */
  readonly holeCenters: readonly Vec2[];
}

/**
 * Contremarche d'arrivée des marches pliées en Z (décision A11) : plat plié en L fixé au
 * chevêtre, section `arrivalRiserSection` extrudée le long de la ligne du nez d'arrivée.
 * Développé rectangulaire en fibre neutre, vu sur la face avant : x le long de la ligne de nez,
 * y vers le haut depuis le bord libre du retour ; ligne de pli au milieu de la zone de pli ;
 * perçages de fixation à mi-hauteur de l'aile droite de la contremarche. Lève une erreur
 * (message français) si une aile n'a pas de partie droite.
 */
export function developArrivalRiser(input: ArrivalRiserInput): ArrivalRiserResult {
  const { bend } = input;
  const t = bend.thickness;
  const r = bend.innerRadius;
  const section = arrivalRiserSection({
    riserDrop: input.riserDrop,
    returnLength: input.returnLength,
    thickness: t,
    innerRadius: r,
  });
  section.straights.forEach((len, i) => {
    if (!(len > 0)) {
      throw flangeError(input.mark, section.flangeNames[i]!, len, r);
    }
  });
  const length = V.distance(input.start, input.end);
  if (!(length > 1)) {
    throw new MessageError(
      msg("structure.steel.folded.error.arrivalNosingTooShort", { mark: input.mark }),
    );
  }
  const [riser, ret] = section.straights as [Mm, Mm];
  const ba = bendAllowance(QUARTER, r, bend.k, t);
  const width = ret + ba + riser;
  const up = V.normalize(input.up);
  // Repère direct : X = vers le haut de l'escalier, Y = vertical, Z = X × Y = perpRight(X).
  const along = V.perpRight(up);
  const origin = V.dot(V.sub(input.end, input.start), along) >= 0 ? input.start : input.end;
  const bendY = ret + ba / 2;
  const bendB = section.bends[0]!;
  const label = bendLabel(1, bendB.angle, bendB.up, r);
  const n = Math.max(0, Math.floor(input.holes));
  const hy = ret + ba + riser / 2;
  const e = Math.min(input.holeEdgeDistance, length / 2);
  const holeCenters =
    n === 0
      ? []
      : n === 1
        ? [V.vec(length / 2, hy)]
        : Array.from({ length: n }, (_, i) => V.vec(e + ((length - 2 * e) * i) / (n - 1), hy));
  const flat: FlatPattern = {
    outline: {
      outer: [V.vec(0, 0), V.vec(length, 0), V.vec(length, width), V.vec(0, width)],
      holes: holeCenters.map((c) => holePolygon(c, input.holeDiameter)),
    },
    lines: [
      {
        kind: "bend",
        a: V.vec(0, bendY),
        b: V.vec(length, bendY),
        label,
        bendAngle: deg(bendB.angle),
        bendUp: bendB.up,
        bendRadius: r,
      },
      {
        kind: "text",
        a: V.vec(length / 2 - 20, ret + ba + riser * 0.75),
        b: V.vec(length / 2 + 20, ret + ba + riser * 0.75),
        label: textMessage(input.mark),
      },
    ],
    thickness: t,
    reference: {
      kind: "neutral-fiber",
      description: msg("structure.steel.folded.reference.arrivalRiser", {
        k: dec(bend.k, 3),
        radius: dec(r, 1),
        thickness: dec(t, 1),
        method: bend.method,
      }),
    },
  };
  return {
    flat,
    section,
    frame: {
      origin: { x: origin.x, y: origin.y, z: input.zTop },
      xAxis: { x: up.x, y: up.y, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: along.x, y: along.y, z: 0 },
    },
    length,
    bendLines: [{ mark: "P1", label, length, angleDeg: deg(bendB.angle), up: bendB.up }],
    flanges: [
      { label: FLANGE.riser, atStart: riser + r, atEnd: riser + r },
      { label: FLANGE.return, atStart: ret + r, atEnd: ret + r },
    ],
    holeCenters,
  };
}
