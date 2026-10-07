/**
 * Sabots du limon central bois (`wood-central`, QUESTIONS A29 n° 5 : « sabots ou platines
 * métalliques » pour ancrer la poutre bois) : tôles pliées en U au pied et en tête de la poutre.
 *
 * Convention Blondel **à valider** (QUESTIONS A33, aucune source chiffrée) :
 * - **Sabot de pied** (`SP1`) : semelle (âme du U) posée au sol sous la poutre, le long de la
 *   trace sur `anchors.length` depuis la face avant de la poutre ; joues relevées sur les deux
 *   faces de la poutre, de hauteur `anchors.cheekDepth` ramenée au dessous de la première
 *   marche (jeu d'atelier déduit) ; largeur intérieure b + 2 × jeu (`wood.clearance`). La poutre
 *   est coupée de niveau sur le dessus de la semelle.
 * - **Sabot de tête** (`ST1`) : âme verticale contre le chevêtre, de hauteur `anchors.length`
 *   depuis le dessous de la poutre à sa coupe de tête ; joues de `anchors.cheekDepth` le long des
 *   faces de la poutre. La poutre est coupée d'aplomb à l'épaisseur de l'âme et au jeu du
 *   chevêtre.
 * - Chevilles (`anchors.anchors`) dans l'âme, sur son axe, entre les joues (posées avant la
 *   poutre) ; boulons (`anchors.bolts`) traversant les deux joues et la poutre, à mi-hauteur
 *   des joues au pied, à mi-longueur des joues en tête, répartis à la pince `holeEdgeDistance`.
 * - Développé à la fibre neutre (loi de pli du profil d'atelier pour la nuance et l'épaisseur,
 *   `bendAllowance`), deux lignes de pli à 90°.
 * - Sabot logé (`FAB_SABOT_EMPRISE`) : semelle ≤ longueur de la coupe au sol, âme de tête ≤
 *   hauteur de la coupe de tête ; sinon le sabot est **réduit** à la place disponible (constat
 *   en violation), ou **non généré** si elle ne laisse pas deux pinces de perçage. Sur une
 *   trace courbe, le sabot reste droit (tangent à la trace à son attache) : l'écart entre ses
 *   joues et les faces de la poutre cintrée est comparé au jeu d'atelier (`wood.clearance`) ;
 *   au-delà, constat en violation (joues à cintrer ou à raccourcir, QUESTIONS A34).
 * - Perçages des boulons de sabot dans la poutre (`beamHoles`, développement à l'axe) : repris
 *   sur le développé de la poutre et écartés des boulons de marche.
 */
import { dec, errorMessage, msg, textMessage, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, Part, PartFixing } from "../model/derived.js";
import type { PartAssembly } from "../model/plugins.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import type { Finding } from "../rules/types.js";
import { sourceSpec } from "../rules/sources.js";
import {
  bendAllowance,
  findBendLaw,
  minBendRadiusFactor,
  resolveBend,
  type ResolvedBend,
} from "../workshop/metal.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import {
  pluginRuleDef,
  type CheckCollector,
  type CheckItem,
  type PluginRuleSpec,
} from "./checks.js";
import { flatLength, sectionPolygon, uSection } from "./folded.js";
import { minAreaRect } from "./geom.js";
import {
  STEEL_RULES,
  holePolygon,
  plateMeasures,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";
import type { WoodCentralParams } from "./woodCentralParams.js";

/** Identifiants et repères des sabots (contrat de la vague). */
export const WOOD_CENTRAL_SHOE_FOOT_ID = "wood-central-shoe-foot";
export const WOOD_CENTRAL_SHOE_HEAD_ID = "wood-central-shoe-head";
export const WOOD_CENTRAL_SHOE_FOOT_MARK = "SP1";
export const WOOD_CENTRAL_SHOE_HEAD_MARK = "ST1";

/** Repères de la poutre lus par les sabots (développement à l'axe, u = σ). */
export interface ShoeBeamGeometry {
  readonly beamId: string;
  readonly beamMark: string;
  /** Face avant de la poutre (début de la coupe au sol), σ. */
  readonly frontSigma: Mm;
  /** Longueur de la coupe au sol (0 : la poutre ne touche pas le sol). */
  readonly floorCutLength: Mm;
  /** Dessous de la première marche (dessus de l'assise 1), mm. */
  readonly firstSeatZ: Mm;
  /** Face du chevêtre (âme du sabot de tête contre elle), σ. */
  readonly trimmerSigma: Mm;
  /** Dessous et dessus de la poutre à sa coupe de tête, mm. */
  readonly headBottom: Mm;
  readonly headTop: Mm;
}

export interface WoodCentralShoesInput {
  readonly params: WoodCentralParams;
  readonly trace: CentralTrace;
  readonly profile: WorkshopProfile;
  readonly beam: ShoeBeamGeometry;
  readonly checks: CheckCollector;
}

/** Perçage horizontal d'un boulon de sabot au travers de la poutre (développement à l'axe). */
export interface ShoeBeamHole {
  /** Repère du sabot. */
  readonly mark: string;
  /** Abscisse sur la trace et altitude du centre du perçage, mm. */
  readonly sigma: Mm;
  readonly z: Mm;
  readonly diameter: Mm;
}

export interface WoodCentralShoesResult {
  readonly parts: readonly Part[];
  /** Perçages des boulons de sabot au travers de la poutre. */
  readonly beamHoles: readonly ShoeBeamHole[];
  readonly assemblies: readonly PartAssembly[];
  readonly notes: readonly Message[];
  readonly errors: readonly Message[];
}

/**
 * Sabot logé sur la poutre (semelle sur la coupe au sol, âme dans la hauteur de la coupe de
 * tête), repris par `WOOD_CENTRAL_BEAM_RULES.shoeFit`.
 */
export const SHOE_FIT_RULE = {
  id: "FAB_SABOT_EMPRISE",
  ...sourceSpec(msg("compliance.source.woodCentralShoeFit")),
  confidence: "faible",
  nature: "metier",
  severity: "avertissement",
  unit: "mm",
} as const satisfies PluginRuleSpec;

const v3 = (p: Vec2, z: Mm): Vec3 => ({ x: p.x, y: p.y, z });
const h3 = (p: Vec2): Vec3 => ({ x: p.x, y: p.y, z: 0 });
const QUARTER = Math.PI / 2;

/** `n` abscisses réparties sur [edge ; L − edge] (une seule : au milieu). */
export function spread(length: Mm, edge: Mm, n: number): Mm[] {
  if (n <= 0) return [];
  if (n === 1) return [length / 2];
  return Array.from({ length: n }, (_, i) => edge + ((length - 2 * edge) * i) / (n - 1));
}

/** Longueur arrondie au pas supérieur (longueurs commerciales). */
export function roundUpTo(length: Mm, step: Mm): Mm {
  return step > 0 ? Math.ceil(length / step - 1e-9) * step : length;
}

interface ShoeSpec {
  readonly id: string;
  readonly mark: string;
  readonly foot: boolean;
  /** Hauteur extérieure des joues (saillie perpendiculaire à l'âme). */
  readonly cheek: Mm;
  /** Longueur d'extrusion (pied : semelle le long de la trace ; tête : hauteur de l'âme). */
  readonly length: Mm;
}

interface BuiltShoe {
  readonly part: Part;
  readonly beamHoles: readonly ShoeBeamHole[];
  readonly cheekInner: Mm;
  readonly webInner: Mm;
  readonly bendLength: Mm;
}

/**
 * Sabots de pied et de tête. Ne lève pas (erreur de loi de pli : `errors`, sabots absents).
 * Ajoute les contrôles d'emprise, de pliage et de découpe à `checks`.
 */
export function buildWoodCentralShoes(input: WoodCentralShoesInput): WoodCentralShoesResult {
  const shoeFitRule = SHOE_FIT_RULE;
  const { params, profile, beam, checks } = input;
  const an = params.anchors;
  const notes: Message[] = [];
  const errors: Message[] = [];
  if (!an.foot && !an.head) {
    checks.add(pluginRuleDef(shoeFitRule), [
      { status: "ok", message: msg("structure.woodCentral.check.shoe.none") },
    ]);
    return { parts: [], beamHoles: [], assemblies: [], notes, errors };
  }
  const t = an.thickness;
  const c = profile.wood.clearance;
  const minLength = 2 * an.holeEdgeDistance;

  // Emprise : semelle sur la coupe au sol, âme de tête dans la hauteur de la coupe de tête.
  const fit: Finding[] = [];
  const specs: ShoeSpec[] = [];
  const loc = { kind: "part" as const, partId: beam.beamId };
  if (an.foot) {
    const mark = WOOD_CENTRAL_SHOE_FOOT_MARK;
    const cut = beam.floorCutLength;
    const L = Math.min(an.length, cut);
    if (an.length <= cut + 1e-6) {
      fit.push({
        status: "ok",
        measured: an.length,
        max: cut,
        location: loc,
        message: msg("structure.woodCentral.check.shoe.footOk", {
          mark,
          length: dec(an.length, 0),
          cut: dec(cut, 0),
        }),
      });
    } else {
      fit.push({
        status: "violation",
        measured: an.length,
        max: cut,
        location: loc,
        message:
          L >= minLength
            ? msg("structure.woodCentral.check.shoe.footReduced", {
                mark,
                wanted: dec(an.length, 0),
                cut: dec(cut, 0),
                length: dec(L, 0),
              })
            : msg("structure.woodCentral.check.shoe.footMissing", { mark, cut: dec(cut, 0) }),
      });
    }
    // Joues sous la première marche (dessus des joues au plus au dessous de la marche − jeu).
    const room = beam.firstSeatZ - c;
    const cheek = Math.min(an.cheekDepth, room);
    if (cheek < an.cheekDepth - 1e-6) {
      notes.push(
        msg("structure.woodCentral.note.footCheekReduced", { mark, height: dec(cheek, 0) }),
      );
    }
    if (L >= minLength)
      specs.push({ id: WOOD_CENTRAL_SHOE_FOOT_ID, mark, foot: true, cheek, length: L });
  }
  if (an.head) {
    const mark = WOOD_CENTRAL_SHOE_HEAD_MARK;
    const height = Math.max(0, beam.headTop - beam.headBottom);
    const L = Math.min(an.length, height);
    if (an.length <= height + 1e-6) {
      fit.push({
        status: "ok",
        measured: an.length,
        max: height,
        location: loc,
        message: msg("structure.woodCentral.check.shoe.headOk", {
          mark,
          length: dec(an.length, 0),
          height: dec(height, 0),
        }),
      });
    } else {
      fit.push({
        status: "violation",
        measured: an.length,
        max: height,
        location: loc,
        message:
          L >= minLength
            ? msg("structure.woodCentral.check.shoe.headReduced", {
                mark,
                wanted: dec(an.length, 0),
                height: dec(height, 0),
                length: dec(L, 0),
              })
            : msg("structure.woodCentral.check.shoe.headMissing", {
                mark,
                height: dec(height, 0),
              }),
      });
    }
    if (L >= minLength) {
      specs.push({
        id: WOOD_CENTRAL_SHOE_HEAD_ID,
        mark,
        foot: false,
        cheek: an.cheekDepth,
        length: L,
      });
    }
  }
  // Sabot droit sur une trace courbe : écart des joues aux faces de la poutre cintrée.
  for (const s of specs) {
    const at = s.foot ? beam.frontSigma : beam.trimmerSigma;
    const from = s.foot ? at : at - s.cheek;
    const to = s.foot ? at + s.length : at;
    const gap = straightShoeGap(input.trace, at, from, to, params.section.width);
    if (gap > c + 1e-6) {
      fit.push({
        status: "violation",
        measured: gap,
        max: c,
        location: loc,
        message: msg("structure.woodCentral.check.shoe.curved", {
          mark: s.mark,
          gap: dec(gap, 1),
          clearance: dec(c, 1),
          length: dec(to - from, 0),
        }),
      });
    }
  }
  checks.add(pluginRuleDef(shoeFitRule), fit);
  if (specs.length === 0) return { parts: [], beamHoles: [], assemblies: [], notes, errors };

  // Loi de pli de la tôle (profil d'atelier).
  const metal = profile.metal;
  const law = findBendLaw(metal, an.grade, t);
  let bend: ResolvedBend | null = null;
  if (law) {
    try {
      bend = resolveBend(law, metal.defaultK);
    } catch (err) {
      errors.push(
        msg("structure.woodCentral.error.shoeBendLaw", {
          detail: errorMessage(err),
        }),
      );
    }
  }
  checks.add(pluginRuleDef(STEEL_RULES.bendLaw), [
    bend
      ? {
          status: "ok",
          measured: t,
          message: msg("structure.steelFlat.check.bendLaw", {
            grade: an.grade,
            thickness: dec(t, 1),
            radius: dec(bend.innerRadius, 1),
            method: bend.method,
            k: dec(bend.k, 3),
          }),
        }
      : {
          status: "violation",
          measured: t,
          message: msg("structure.steelFlat.check.noBendLaw", {
            grade: an.grade,
            thickness: dec(t, 1),
          }),
        },
  ]);
  if (!bend) {
    if (!law) {
      errors.push(
        msg("structure.woodCentral.error.shoeNoBendLaw", { grade: an.grade, thickness: dec(t, 1) }),
      );
    }
    return { parts: [], beamHoles: [], assemblies: [], notes, errors };
  }

  const built: BuiltShoe[] = [];
  for (const s of specs) {
    const shoe = shoeOf(input, bend, s);
    if (shoe) built.push(shoe);
    else {
      errors.push(
        msg("structure.woodCentral.error.shoeSection", {
          mark: s.mark,
          cheek: dec(s.cheek, 0),
          thickness: dec(t, 0),
          radius: dec(bend.innerRadius, 1),
        }),
      );
    }
  }
  addShoeChecks(checks, an.grade, metal, bend, built);
  return {
    parts: built.map((b) => b.part),
    beamHoles: built.flatMap((b) => b.beamHoles),
    assemblies: built.map((b) => ({ a: { partId: b.part.id }, b: { partId: beam.beamId } })),
    notes,
    errors,
  };
}

/** Sabot en U : section, développé, solide, fixations ; `null` si une aile n'a pas de partie droite. */
function shoeOf(input: WoodCentralShoesInput, bend: ResolvedBend, s: ShoeSpec): BuiltShoe | null {
  const { params, trace, profile, beam } = input;
  const an = params.anchors;
  const t = an.thickness;
  const r = bend.innerRadius;
  const b = params.section.width;
  const c = profile.wood.clearance;
  const webInner = b + 2 * c;
  const wOut = webInner + 2 * t;
  const section = uSection({
    depth: wOut,
    noseHeight: s.cheek,
    rearHeight: s.cheek,
    thickness: t,
    innerRadius: r,
  });
  if (section.straights.some((x) => !(x > 1e-6))) return null;
  const ba = bendAllowance(QUARTER, r, bend.k, t);
  const D = flatLength(section, bend.k);
  const Y = s.length;
  const s0 = section.straights[0]!;
  const s1 = section.straights[1]!;
  const bendXs = [s0 + ba / 2, s0 + ba + s1 + ba / 2];

  // Perçages : chevilles sur l'axe de l'âme, boulons au milieu des joues (deux joues alignées).
  const holes: Vec2[][] = [];
  for (const y of spread(Y, an.holeEdgeDistance, an.anchors)) {
    holes.push(holePolygon(V.vec(D / 2, y), an.anchorHoleDiameter));
  }
  const xCheek = (s.cheek - t) / 2;
  const beamHoles: ShoeBeamHole[] = [];
  for (const y of spread(Y, an.holeEdgeDistance, an.bolts)) {
    holes.push(holePolygon(V.vec(xCheek, y), an.boltHoleDiameter));
    holes.push(holePolygon(V.vec(D - xCheek, y), an.boltHoleDiameter));
    // Même perçage dans la poutre : à (joue − t) / 2 du bord libre de la joue (bord à
    // z = joue au pied, à σ = chevêtre − joue en tête), à y le long de l'âme.
    beamHoles.push(
      s.foot
        ? {
            mark: s.mark,
            sigma: beam.frontSigma + y,
            z: (s.cheek + t) / 2,
            diameter: an.boltHoleDiameter,
          }
        : {
            mark: s.mark,
            sigma: beam.trimmerSigma - (s.cheek + t) / 2,
            z: beam.headBottom + y,
            diameter: an.boltHoleDiameter,
          },
    );
  }
  const lines: FlatPattern["lines"][number][] = bendXs.map((x, i) => ({
    kind: "bend" as const,
    a: V.vec(x, 0),
    b: V.vec(x, Y),
    label: msg("structure.steel.folded.bendLine.down", {
      n: i + 1,
      angle: dec(90, 0),
      radius: dec(r, 1),
    }),
    bendAngle: 90,
    bendUp: false,
    bendRadius: r,
  }));
  lines.push({
    kind: "text",
    a: V.vec(D / 2 - 20, Y / 2),
    b: V.vec(D / 2 + 20, Y / 2),
    label: textMessage(s.mark),
  });
  const flat: FlatPattern = {
    outline: {
      outer: [V.vec(0, 0), V.vec(D, 0), V.vec(D, Y), V.vec(0, Y)],
      holes,
    },
    lines,
    thickness: t,
    reference: {
      kind: "neutral-fiber",
      description: msg(
        s.foot
          ? "structure.woodCentral.reference.shoeFoot"
          : "structure.woodCentral.reference.shoeHead",
        { mark: s.mark, beam: beam.beamMark },
      ),
    },
  };

  // Solide : section en U extrudée (pied : le long de la trace ; tête : verticale).
  const profileU = sectionPolygon(section);
  const at = s.foot ? beam.frontSigma : beam.trimmerSigma;
  const tan = trace.tangent(at);
  const left = trace.left(at);
  const o = V.addScaled(trace.point(at), left, wOut / 2);
  const solid: Part["solid"] = s.foot
    ? {
        kind: "extrusion",
        frame: {
          origin: v3(o, 0),
          xAxis: h3(V.scale(left, -1)),
          yAxis: { x: 0, y: 0, z: -1 },
          zAxis: h3(tan),
        },
        profile: { outer: profileU, holes: [] },
        depth: Y,
      }
    : {
        kind: "extrusion",
        frame: {
          origin: v3(o, beam.headBottom),
          xAxis: h3(V.scale(left, -1)),
          yAxis: h3(tan),
          zAxis: { x: 0, y: 0, z: 1 },
        },
        profile: { outer: profileU, holes: [] },
        depth: Y,
      };

  const meas = plateMeasures(flat.outline, t);
  const box = minAreaRect(flat.outline.outer);
  const fixings: PartFixing[] = [];
  if (an.anchors > 0) {
    fixings.push({
      joint: s.foot ? "plateFloor" : "plateTrimmer",
      points: an.anchors,
      holeDiameter: an.anchorHoleDiameter,
    });
  }
  if (an.bolts > 0) {
    fixings.push({
      joint: "shoeBolted",
      points: an.bolts,
      holeDiameter: an.boltHoleDiameter,
      length: roundUpTo(b + 2 * t + 2 * c + params.bolts.protrusion, params.bolts.lengthStep),
      with: [beam.beamId],
    });
  }
  const part: Part = {
    id: s.id,
    mark: s.mark,
    category: "fixing",
    name: msg(
      s.foot ? "structure.woodCentral.part.shoeFoot" : "structure.woodCentral.part.shoeHead",
    ),
    material: steelMaterial(an.finish),
    solid,
    flat,
    section: msg("structure.woodCentral.section.shoe", {
      thickness: dec(t, 0),
      grade: an.grade,
    }),
    stock: { length: box.length, width: box.width, thickness: t },
    quantities: steelQuantities(
      {
        volumeMm3: meas.volumeMm3,
        treatedSurfaceMm2: meas.treatedSurfaceMm2,
        length: box.length,
        cuts: 1,
        laserCut: meas.laserCut,
        bends: 2,
        bendLength: 2 * Y,
        holes: holes.length,
      },
      profile,
    ),
    assembledWith: [beam.beamId],
    ...(fixings.length > 0 ? { fixings } : {}),
  };
  return { part, beamHoles, cheekInner: s.cheek - t, webInner, bendLength: Y };
}

/**
 * Plus grand écart latéral (mm) entre les faces de la poutre (± b/2 de la trace) sur
 * σ ∈ [from ; to] et les joues d'un sabot droit posé tangent à la trace en `at` : nul sur une
 * trace droite, ≈ L² / 2R sur un arc de rayon R.
 */
export function straightShoeGap(trace: CentralTrace, at: Mm, from: Mm, to: Mm, b: Mm): Mm {
  const p0 = trace.point(at);
  const l0 = trace.left(at);
  const n = Math.max(2, Math.ceil(Math.abs(to - from) / 5));
  let gap = 0;
  for (let i = 0; i <= n; i++) {
    const s = from + ((to - from) * i) / n;
    const p = trace.point(s);
    const l = trace.left(s);
    for (const w of [-b / 2, b / 2]) {
      const q = V.addScaled(p, l, w);
      gap = Math.max(gap, Math.abs(V.dot(l0, V.sub(q, p0)) - w));
    }
  }
  return gap;
}

/** Contrôles de pliage et de découpe des sabots (règles métal existantes). */
function addShoeChecks(
  checks: CheckCollector,
  grade: WoodCentralParams["anchors"]["grade"],
  metal: WorkshopProfile["metal"],
  bend: ResolvedBend,
  shoes: readonly BuiltShoe[],
): void {
  if (shoes.length === 0) return;
  const rule = (spec: PluginRuleSpec) => pluginRuleDef(spec);
  checks.addItems(
    rule(STEEL_RULES.bendRadius),
    [
      {
        value: bend.innerRadius,
        label: msg("structure.steel.check.gradeThickness", {
          grade,
          thickness: dec(bend.thickness, 1),
        }),
      },
    ],
    msg("structure.steel.quantity.bendInnerRadius"),
    { min: minBendRadiusFactor(grade) * bend.thickness - 1e-9, max: null },
  );
  const flanges: CheckItem[] = shoes.flatMap((s) => [
    {
      value: s.cheekInner,
      label: msg("structure.woodCentral.check.shoeCheek", { mark: s.part.mark }),
      partId: s.part.id,
    },
    {
      value: s.webInner,
      label: msg("structure.woodCentral.check.shoeWeb", { mark: s.part.mark }),
      partId: s.part.id,
    },
  ]);
  checks.addItems(
    rule(STEEL_RULES.bendFlange),
    flanges,
    msg("structure.steel.quantity.innerFlangeLength"),
    { min: bend.minFlange - 1e-9, max: null },
  );
  checks.addItems(
    rule(STEEL_RULES.pressBrake),
    shoes.map((s) => ({ value: s.bendLength, label: textMessage(s.part.mark), partId: s.part.id })),
    msg("structure.steel.quantity.bendLength"),
    { min: null, max: metal.pressBrake.maxLength },
  );
  checks.addItems(
    rule(STEEL_RULES.pressBrake),
    [{ value: bend.thickness, label: msg("structure.steel.check.foldedPlateThickness") }],
    msg("structure.steel.quantity.foldedThickness"),
    { min: null, max: metal.pressBrake.maxThickness },
  );
  checks.addItems(
    rule(STEEL_RULES.laser),
    shoes.map((s) => ({
      value: s.part.flat!.thickness,
      label: textMessage(s.part.mark),
      partId: s.part.id,
    })),
    msg("structure.steel.quantity.cutThickness"),
    { min: null, max: metal.laser.maxThickness },
  );
}
