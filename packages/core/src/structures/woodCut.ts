/**
 * Plugin `wood-cut` : limons bois à l'anglaise (crémaillères), C §1.4.
 *
 * - **Escalier droit seulement au J3a** (le tableau FCBA ne couvre que l'escalier droit) : un
 *   tracé tournant rend une erreur explicite et aucune crémaillère. Cage saisie (ADR-0010,
 *   sous-lot 6b) : un tronçon droit, de largeur constante (mêmes pièces que la volée) ou
 *   variable (crémaillères sous les bords inclinés, faces du tracé, dents coupées en biais
 *   signalées, domaine FCBA sur la plus longue crémaillère ; à valider, QUESTIONS F17).
 * - **Deux crémaillères** (par paire, domaine du tableau FCBA), sous les extrémités des
 *   marches : face extérieure de chaque crémaillère à `inset` du bord de l'emmarchement
 *   (C_i, C_e), épaisseur prise vers l'intérieur ; les marches reposent à plat sur les dents
 *   [choix Blondel à valider : position des crémaillères sous les marches].
 * - **Entailles** : pour chaque marche, assise horizontale au niveau du dessous de la marche,
 *   de la face verticale de la dent précédente à la suivante ; face verticale d'une dent =
 *   ligne de nez décalée du débord et, s'il y a des contremarches pleines, de leur épaisseur
 *   (la contremarche s'appuie devant la dent).
 * - **Reste sous entaille** h_res : distance perpendiculaire entre les fonds d'entaille et la
 *   sous-face rampante (rive basse droite). `auto` : valeur exigée par le tableau FCBA quand il
 *   est exploitable, sinon `residualFallback` (à valider).
 * - Contrôles : CREMAILLERE_REGLE_MOYENS (tableau FCBA lu dans rules.yaml, `non-evaluee` hors
 *   de son domaine ; reste **saisi** d'un feuillu en classe `auto` D30 dans le domaine contrôlé
 *   contre `residualFallback`, QUESTIONS A38 (15)), LIMON_EPAISSEUR_MIN_DTU, longueur de plateau
 *   et débit (profil d'atelier).
 *
 * Domaine d'exploitation du tableau [hypothèse Blondel, à valider] : escalier droit, classe de
 * résistance connue (colonnes C30 résineux, D40 feuillus ; `auto` d'un feuillu D30 : aucune
 * colonne, tableau non exploitable et reste de repli, QUESTIONS A37 (2), décision du
 * 2026-10-10), épaisseur ≥ la plus petite épaisseur tabulée, hauteur à monter ≤ celle de l'exemple (2,70 m) et projection horizontale de la
 * crémaillère ≤ celle de l'exemple (2,70 m / tan 38°) : moment de flexion d'une poutre
 * rampante ∝ portée horizontale², donc exemple du côté de la sécurité.
 */
import { dec, msg, textMessage, type Message } from "@blondel/i18n";
import { z } from "zod";
import { intersectLines } from "../geom2d/intersect.js";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Part } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { StructureContext, StructureKind, StructureOutput } from "../model/plugins.js";
import {
  WOOD_MATERIALS,
  resolveWorkshopProfile,
  type WoodMaterialId,
} from "../workshop/profile.js";
import {
  CheckCollector,
  FAB_RULES,
  flightsOnlyError,
  pluginRuleDef,
  stringerRulesOutOfDomain,
} from "./checks.js";
import {
  CREMAILLERE_RULE_ID,
  fallbackThicknessOutOfRange,
  fcbaTable,
  requiredResidual,
  type FcbaTable,
  type StrengthClass,
} from "./fcba.js";
import { area, clipHalfPlane, minAreaRect, pointSegmentDistance, removeCollinear } from "./geom.js";
import { HARDWOOD_WOOD_CLASS } from "../precheck/settings.js";
import { stairGeometry } from "./legs.js";
import { woodQuantities } from "./quantities.js";
import { stockOf } from "./woodHoused.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();

export const WoodCutParamsSchema = z.object({
  material: z.enum(WOOD_MATERIALS).default("wood-oak"),
  /** Épaisseur finie des crémaillères. */
  thickness: mmPos.default(45),
  /** Reste sous entaille (perpendiculaire à la sous-face) ; `auto` : tableau FCBA ou repli. */
  residual: z.union([mmPos, z.literal("auto")]).default("auto"),
  /** Reste sous entaille retenu quand le tableau FCBA n'est pas exploitable (à valider). */
  residualFallback: mmPos.default(180),
  /**
   * Classe de résistance (colonne du tableau FCBA) ; `auto` : C30 pour le pin ; aucune colonne
   * pour chêne, hêtre, frêne, classés D30 (QUESTIONS A36 (1) ; tableau non exploitable, reste de
   * repli, A37 (2), décision du 2026-10-10) ; inconnue pour le lamellé-collé. Une classe C30 ou
   * D40 saisie est lue telle quelle.
   */
  strengthClass: z.enum(["C30", "D40", "unknown", "auto"]).default("auto"),
  /** Retrait de la face extérieure des crémaillères sous le bout des marches (à valider). */
  inset: mmNonNeg.default(0),
});
export type WoodCutParams = z.output<typeof WoodCutParamsSchema>;

/**
 * Classe FCBA `auto` (lecture des tableaux de reste sous entaille, colonnes C30 / D40) : C30 pour
 * le pin ; pour les essences feuillues (chêne, hêtre, frêne), classées **D30** par QUESTIONS
 * A36 (1) (`HARDWOOD_WOOD_CLASS`), **aucune colonne** : le tableau ne donne que « résineux ≥ C30 »
 * (E_0,mean 12 000 MPa) et « feuillus ≥ D40 » (C §1.4 [1]) ; la colonne D40 n'est pas
 * sécuritaire pour un bois D30 (f_m,k 30 contre 40 MPa) et la colonne C30 suppose un module que
 * D30 n'a pas (E_0,mean 11 000 MPa, EN 338:2016 via C §1.11 [84][89]) : le tableau est déclaré
 * non exploitable et le reste de repli `residualFallback` s'applique (QUESTIONS A37 (2), décision
 * du 2026-10-10 ; raison `structure.woodCut.fcba.hardwoodD30`, `fcbaUnknownClassReason`).
 * Inconnue pour le lamellé-collé.
 */
const AUTO_CLASS: Readonly<Record<WoodMaterialId, StrengthClass | "unknown">> = {
  "wood-pine": "C30",
  "wood-oak": "unknown",
  "wood-beech": "unknown",
  "wood-ash": "unknown",
  "wood-glulam": "unknown",
};

/**
 * Raison pour laquelle le tableau FCBA n'est pas lu quand la classe retenue est inconnue :
 * essence feuillue en classe `auto` (D30, aucune colonne du tableau, QUESTIONS A37 (2)) ou classe
 * inconnue (lamellé-collé, classe non précisée). Partagée avec `wood-central`.
 */
export function fcbaUnknownClassReason(
  material: WoodMaterialId,
  strengthClass: StrengthClass | "unknown" | "auto",
): Message {
  return strengthClass === "auto" && HARDWOOD_WOOD_CLASS[material] !== undefined
    ? msg("structure.woodCut.fcba.hardwoodD30")
    : msg("structure.woodCut.fcba.unknownClass");
}

/**
 * Raison de domaine du tableau FCBA, indépendante de la classe : hauteur à monter, puis
 * projection horizontale au-delà de l'exemple publié ; `null` dans le domaine. Partagée avec
 * `wood-central`.
 */
export function fcbaDomainReason(table: FcbaTable, rise: Mm, run: Mm): Message | null {
  if (rise > table.floorToFloor) {
    return msg("structure.woodCut.fcba.totalRise", {
      rise: dec(rise, 0),
      max: dec(table.floorToFloor, 0),
    });
  }
  const maxRun = table.floorToFloor / Math.tan((table.pitchDeg * Math.PI) / 180);
  if (run > maxRun + 1e-6) {
    return msg("structure.woodCut.fcba.run", {
      run: dec(run, 0),
      max: dec(maxRun, 0),
      floorToFloor: dec(table.floorToFloor, 0),
      pitch: dec(table.pitchDeg, 0),
    });
  }
  return null;
}

/**
 * Raison complète d'une classe inconnue (relecture A37 (2)) : celle de la classe, suivie de la
 * raison de domaine quand la géométrie est aussi hors de l'exemple publié, pour qu'une classe
 * saisie ensuite (C30, D40) ne découvre pas seulement alors un second obstacle.
 */
export function fcbaUnknownClassFullReason(
  material: WoodMaterialId,
  strengthClass: StrengthClass | "unknown" | "auto",
  domain: Message | null,
): Message {
  const base = fcbaUnknownClassReason(material, strengthClass);
  return domain ? msg("compliance.join.semicolon", { first: base, next: domain }) : base;
}

/**
 * Classe D30 d'une essence feuillue en classe `auto` quand le reste sous entaille **saisi** est
 * contrôlé contre le reste de repli (QUESTIONS A38 (15), décision du 2026-10-11) : classe
 * inconnue du tableau FCBA pour la seule raison de l'essence feuillue (`HARDWOOD_WOOD_CLASS`),
 * domaine du tableau tenu (`domain` nul, épaisseur au moins la plus petite épaisseur tabulée de
 * chaque colonne : `outOfRange` nul) et reste saisi ; `null` sinon (contrôle inchangé).
 */
function hardwoodFallbackClass(
  params: WoodCutParams,
  cls: StrengthClass | "unknown",
  domain: Message | null,
  outOfRange: StrengthClass | null,
): string | null {
  if (params.residual === "auto" || cls !== "unknown" || domain !== null) return null;
  if (params.strengthClass !== "auto" || outOfRange !== null) return null;
  return HARDWOOD_WOOD_CLASS[params.material] ?? null;
}

export interface CarriageDetail {
  readonly part: Part;
  readonly outline: Polygon2;
  /** Fonds d'entaille (u, z). */
  readonly notches: readonly Vec2[];
  /** Rive basse : point et direction. */
  readonly lowerRive: { readonly point: Vec2; readonly dir: Vec2 };
  /** Reste sous entaille mesuré (min perpendiculaire). */
  readonly residual: Mm;
  readonly mirrored: boolean;
}

export interface CutResult {
  readonly output: StructureOutput;
  readonly carriages: readonly CarriageDetail[];
  readonly residual: Mm;
  /** Raison pour laquelle le tableau FCBA n'est pas exploitable (absent : exploitable). */
  readonly fcbaUnusable?: Message;
}

/** Point de la ligne de nez décalée de d vers le haut qui coupe la droite (a, dir). */
function crossing(nosing: NosingLine, climb: Vec2, d: Mm, a: Vec2, dir: Vec2): Mm | null {
  let up = V.perpLeft(nosing.dir);
  if (V.dot(up, climb) < 0) up = V.scale(up, -1);
  const hit = intersectLines(
    { origin: V.addScaled(nosing.p, up, d), dir: nosing.dir },
    { origin: a, dir },
  );
  return hit ? V.dot(V.sub(hit.point, a), dir) : null;
}

/** Biais (degrés) au-delà duquel la coupe en biais des dents est signalée (arrondi d'affichage). */
const SKEW_NOTE_DEG = 0.05;

/** Angle (degrés) entre la crémaillère et la normale horizontale d'une ligne de nez. */
function skewAngle(dir: Vec2, nosing: NosingLine): number {
  const normal = V.normalize(V.perpLeft(nosing.dir));
  const c = Math.min(1, Math.abs(V.dot(V.normalize(dir), normal)));
  return (Math.acos(c) * 180) / Math.PI;
}

export function buildWoodCut(ctx: StructureContext, params: WoodCutParams): CutResult {
  const { project, layout, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const notes: Message[] = [];
  const nosings = stepping.nosings;
  const n = nosings.length;
  const e = params.thickness;
  const spec = project.stair.treads;
  const table = fcbaTable();
  const cls = params.strengthClass === "auto" ? AUTO_CLASS[params.material] : params.strengthClass;

  const helical = flightsOnlyError("wood-cut", msg("structure.woodCut.shortLabel"), layout);
  if (helical) {
    return {
      output: { parts: [], checks: [], notes, errors: [helical] },
      carriages: [],
      residual: Number.NaN,
    };
  }
  // Escalier droit seulement : aucune jonction (tournant ou palier droit) dans le tracé.
  if (layout.turns.length > 0) {
    return {
      output: {
        parts: [],
        checks: [],
        notes,
        errors: [msg("structure.woodCut.turningUnsupported")],
      },
      carriages: [],
      residual: Number.NaN,
      fcbaUnusable: msg("structure.woodCut.fcba.turning"),
    };
  }
  if (n < 2) {
    return {
      output: {
        parts: [],
        checks: [],
        notes,
        errors: [msg("structure.woodCut.emptyStepping")],
      },
      carriages: [],
      residual: Number.NaN,
    };
  }

  const geo = stairGeometry(project, layout);
  const leg = geo.legs[0]!;
  const tm = spec.thickness;
  const toothOffset = spec.nosing + (spec.risers === "full" ? spec.riserThickness : 0);
  // Face extérieure de chaque crémaillère (bord de l'emmarchement) : volée unique (`legs`) ; cage
  // saisie (sous-lot 6b, un tronçon droit, largeur éventuellement variable) : face du tracé
  // (`StairGeometry.faces`), bord incliné d'un trapèze compris.
  const cage = layout.cage === true;
  const edgeOf = (side: "inner" | "outer"): { start: Vec2; dir: Vec2; inward: Vec2 } => {
    const face = cage ? geo.faces.find((f) => f.side === side) : undefined;
    if (face) return { start: face.a, dir: face.dir, inward: V.scale(face.into, -1) };
    return side === "inner"
      ? { start: leg.innerOrigin, dir: leg.u, inward: leg.n }
      : { start: leg.outerStart, dir: leg.u, inward: V.scale(leg.n, -1) };
  };
  /** Abscisses des dents le long de la face intérieure d'une crémaillère (`null` : parallèles). */
  const teethOf = (side: "inner" | "outer"): { a: Vec2; dir: Vec2; into: Vec2; us: Mm[] } => {
    const edge = edgeOf(side);
    const a = V.addScaled(edge.start, edge.inward, params.inset + e);
    const us: Mm[] = [];
    for (const k of nosings) {
      const u = crossing(k, edge.dir, toothOffset, a, edge.dir);
      if (u === null) break;
      us.push(u);
    }
    return { a, dir: edge.dir, into: V.scale(edge.inward, -1), us };
  };
  const teeth = { inner: teethOf("inner"), outer: teethOf("outer") };
  const H = project.site.floorToFloor;
  // Portée horizontale : ligne de foulée ; cage saisie, aussi la plus longue crémaillère (bord
  // incliné d'un trapèze, plus long que la ligne de foulée : domaine FCBA du côté de la sécurité).
  const walkRun = Math.abs(nosings[n - 1]!.s - nosings[0]!.s);
  const run = cage
    ? Math.max(
        walkRun,
        ...Object.values(teeth)
          .filter((t) => t.us.length === n)
          .map((t) => Math.abs(t.us[n - 1]! - t.us[0]!)),
      )
    : walkRun;
  const domain = fcbaDomainReason(table, H, run);
  let fcbaUnusable: Message | undefined;
  let required: number | null = null;
  // Feuillu D30 en classe `auto` plus mince que le tableau : même raison d'épaisseur qu'un
  // résineux (relecture A38 (15)), le repli ne vaut que dans le domaine d'épaisseur.
  const outOfRange =
    cls === "unknown" && HARDWOOD_WOOD_CLASS[params.material] !== undefined
      ? fallbackThicknessOutOfRange(table, e)
      : null;
  if (cls === "unknown") {
    fcbaUnusable = fcbaUnknownClassFullReason(params.material, params.strengthClass, domain);
    if (outOfRange !== null)
      fcbaUnusable = msg("compliance.join.semicolon", {
        first: fcbaUnusable,
        next: msg("structure.woodCut.fcba.belowSmallestThickness", {
          thickness: dec(e, 0),
          cls: outOfRange,
        }),
      });
  } else {
    required = requiredResidual(table, cls, e);
    if (required === null)
      fcbaUnusable = msg("structure.woodCut.fcba.belowSmallestThickness", {
        thickness: dec(e, 0),
        cls,
      });
    else if (domain) fcbaUnusable = domain;
  }
  const residual =
    params.residual !== "auto"
      ? params.residual
      : fcbaUnusable === undefined && required !== null
        ? required
        : params.residualFallback;
  // Reste **saisi** d'une essence feuillue en classe `auto` (D30, aucune colonne FCBA), dans le
  // domaine du tableau : contrôlé contre le reste de repli `residualFallback` (QUESTIONS A38 (15),
  // décision du 2026-10-11) au lieu de « non évalué ». Reste `auto` (= repli), lamellé-collé,
  // classe saisie, hors domaine ou épaisseur sous le tableau : inchangé.
  const hardwoodFallback = hardwoodFallbackClass(params, cls, domain, outOfRange);

  const carriages: CarriageDetail[] = [];
  const stocks = new Map<string, ReturnType<typeof stockOf>>();
  for (const side of ["inner", "outer"] as const) {
    const sideName =
      side === "inner" ? msg("structure.woodCut.side.inner") : msg("structure.woodCut.side.outer");
    const { a, dir, into, us } = teeth[side];
    if (us.length !== n) {
      notes.push(msg("structure.woodCut.parallelNosings", { side: sideName }));
      continue;
    }
    // Bord incliné (trapèze d'une cage saisie) : les lignes de nez ne sont pas d'équerre sur la
    // crémaillère, la face d'about des dents est coupée en biais (cotes sur la face de référence).
    const skew = cage ? skewAngle(dir, nosings[0]!) : 0;
    if (skew > SKEW_NOTE_DEG) {
      notes.push(msg("structure.woodCut.note.skewTeeth", { side: sideName, angle: dec(skew, 1) }));
    }
    const z = nosings.map((k) => k.z);
    const top: Vec2[] = [V.vec(us[0]!, 0)];
    for (let k = 0; k + 1 < n; k++) {
      top.push(V.vec(us[k]!, z[k]! - tm), V.vec(us[k + 1]!, z[k]! - tm));
    }
    const notches = us.slice(1).map((u, i) => V.vec(u, z[i]! - tm));
    // Rive basse : direction des fonds d'entaille, décalée du reste sous entaille.
    const w =
      notches.length >= 2
        ? V.normalize(V.sub(notches[notches.length - 1]!, notches[0]!))
        : V.normalize(V.vec(us[n - 1]! - us[0]!, z[n - 1]! - z[0]!));
    const down = V.perpRight(w);
    const ref = notches[0] ?? V.vec(us[0]!, z[0]! - tm);
    const worst = Math.max(
      ...(notches.length > 0 ? notches : [ref]).map((p) => V.dot(V.sub(p, ref), down)),
    );
    const rivePoint = V.addScaled(ref, down, residual + worst);
    const riveAt = (u: Mm): Mm => rivePoint.y + ((u - rivePoint.x) * w.y) / w.x;
    const raw = [...top, V.vec(us[n - 1]!, riveAt(us[n - 1]!)), V.vec(us[0]!, riveAt(us[0]!))];
    let outline = ensureCCW(
      removeCollinear(clipHalfPlane(ensureCCW(raw), V.vec(0, 0), V.vec(0, 1))),
    );
    if (outline.length < 3 || area(outline) <= 0) {
      notes.push(msg("structure.woodCut.degenerateOutline", { side: sideName }));
      continue;
    }
    const measured = Math.min(
      ...(notches.length > 0 ? notches : [ref]).map((p) =>
        pointSegmentDistance(p, V.addScaled(rivePoint, w, -1e5), V.addScaled(rivePoint, w, 1e5)),
      ),
    );
    const mirrored = V.dot(V.perpRight(into), dir) < 0;
    let uMin = Infinity;
    let uMax = -Infinity;
    for (const p of outline) {
      uMin = Math.min(uMin, p.x);
      uMax = Math.max(uMax, p.x);
    }
    const T = (p: Vec2): Vec2 => (mirrored ? V.vec(uMax - p.x, p.y) : V.vec(p.x - uMin, p.y));
    const flatOuter = mirrored ? outline.map(T).reverse() : outline.map(T);
    const id = side === "inner" ? "carriage-inner-1" : "carriage-outer-1";
    const mark = side === "inner" ? "CI1" : "CE1";
    const lines: FlatPattern["lines"][number][] = [];
    if (notches.length >= 2) {
      lines.push({
        kind: "mark",
        a: T(notches[0]!),
        b: T(notches[notches.length - 1]!),
        label: msg("structure.woodCut.flat.notchBottom"),
      });
    }
    const mid = (uMin + uMax) / 2;
    const yMid = Math.max(riveAt(mid), 0) + residual / 2;
    const la = T(V.vec(mid - 20, yMid));
    const lb = T(V.vec(mid + 20, yMid));
    lines.push({
      kind: "text",
      a: mirrored ? lb : la,
      b: mirrored ? la : lb,
      label: textMessage(mark),
    });
    const flat: FlatPattern = {
      outline: { outer: flatOuter, holes: [] },
      lines,
      thickness: e,
      reference: {
        kind: "face",
        description: msg("structure.woodCut.flat.reference", { side: sideName }),
      },
    };
    const box = minAreaRect(outline);
    const st = stockOf(box.length, box.width, e, profile);
    stocks.set(id, st);
    const devArea = area(outline);
    const xDir = mirrored ? V.scale(dir, -1) : dir;
    const origin = V.addScaled(a, dir, mirrored ? uMax : uMin);
    const slope = Math.atan2(w.y, w.x);
    const part: Part = {
      id,
      mark,
      category: "carriage",
      name: msg("structure.woodCut.part.carriage", { side: sideName }),
      material: params.material,
      solid: {
        kind: "extrusion",
        frame: {
          origin: { x: origin.x, y: origin.y, z: 0 },
          xAxis: { x: xDir.x, y: xDir.y, z: 0 },
          yAxis: { x: 0, y: 0, z: 1 },
          zAxis: { x: into.x, y: into.y, z: 0 },
        },
        profile: flat.outline,
        depth: e,
      },
      flat,
      section: msg("structure.common.section.rect", {
        thickness: dec(e, 0),
        width: dec(Math.ceil(box.width), 0),
      }),
      stock: st.stock,
      quantities: woodQuantities(
        { volumeMm3: devArea * e, surfaceMm2: devArea, length: box.length },
        params.material,
        profile,
        st.stock,
      ),
      grain: { x: dir.x * Math.cos(slope), y: dir.y * Math.cos(slope), z: Math.sin(slope) },
    };
    outline = removeCollinear(outline);
    carriages.push({
      part,
      outline,
      notches,
      lowerRive: { point: rivePoint, dir: w },
      residual: measured,
      mirrored,
    });
  }

  // Contrôles.
  const checks = new CheckCollector(project, stepping);
  const loc = (p: Part) => ({ partId: p.id });
  const cremaillere = checks.yamlRule(CREMAILLERE_RULE_ID);
  if (cremaillere && carriages.length > 0) {
    if (hardwoodFallback !== null) {
      checks.addItems(
        cremaillere,
        carriages.map((c) => ({
          value: c.residual,
          label: textMessage(c.part.mark),
          ...loc(c.part),
        })),
        msg("structure.woodCut.check.residualHardwoodFallback", {
          cls: hardwoodFallback,
          fallback: dec(params.residualFallback, 0),
          thickness: dec(e, 0),
        }),
        { min: params.residualFallback, max: null },
      );
    } else if (fcbaUnusable !== undefined || required === null) {
      checks.add(cremaillere, [
        {
          status: "non-evaluee",
          message: msg("structure.woodCut.check.fcbaUnusable", {
            reason: fcbaUnusable ?? msg("structure.woodCut.fcba.missingValue"),
          }),
        },
      ]);
    } else {
      checks.addItems(
        cremaillere,
        carriages.map((c) => ({
          value: c.residual,
          label: textMessage(c.part.mark),
          ...loc(c.part),
        })),
        msg("structure.woodCut.check.residual", { cls, thickness: dec(e, 0) }),
        { min: required, max: null },
      );
    }
  }
  const thicknessRule = checks.yamlRule("LIMON_EPAISSEUR_MIN_DTU");
  if (thicknessRule && carriages.length > 0) {
    // Domaine des règles de moyens : plus grande largeur des tronçons (`legs.ts`).
    const outside = stringerRulesOutOfDomain(thicknessRule, geo.maxWidth);
    if (outside !== null) {
      checks.add(thicknessRule, [
        {
          status: "non-evaluee",
          message: msg("structure.woodCut.check.outOfDomain", { detail: outside }),
        },
      ]);
    } else {
      checks.addItems(
        thicknessRule,
        carriages.map((c) => ({ value: e, label: textMessage(c.part.mark), ...loc(c.part) })),
        msg("structure.woodCut.check.thickness"),
        { min: thicknessRule.min, max: thicknessRule.max },
      );
    }
  }
  if (carriages.length > 0) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.boardLength),
      carriages.map((c) => ({
        value: c.part.stock!.length,
        label: textMessage(c.part.mark),
        ...loc(c.part),
      })),
      msg("structure.common.check.boardLength"),
      { min: null, max: profile.wood.maxBoardLength },
    );
    checks.add(
      pluginRuleDef(FAB_RULES.stockAvailable),
      carriages.map((c) => {
        const st = stocks.get(c.part.id)!;
        const ok = st.widthOk && st.thicknessOk;
        return {
          status: ok ? ("ok" as const) : ("violation" as const),
          measured: st.need.w,
          location: { kind: "part" as const, partId: c.part.id },
          message: ok
            ? msg("structure.common.check.stockAvailable", {
                mark: c.part.mark,
                width: dec(st.stock.width, 0),
                thickness: dec(st.stock.thickness, 0),
              })
            : msg("structure.woodCut.check.stockMissing", {
                mark: c.part.mark,
                width: dec(st.need.w, 0),
                thickness: dec(st.need.t, 0),
              }),
        };
      }),
    );
  }
  notes.push(
    params.residual !== "auto"
      ? msg("structure.woodCut.summary.entered", { residual: dec(residual, 0) })
      : fcbaUnusable === undefined
        ? msg("structure.woodCut.summary.fcba", { residual: dec(residual, 0), cls })
        : msg("structure.woodCut.summary.fallback", {
            residual: dec(residual, 0),
            reason: fcbaUnusable,
          }),
  );

  // Assemblages : chaque crémaillère porte toutes les marches (escalier droit).
  const assemblies = carriages.flatMap((c) =>
    stepping.treads.map((t) => ({ a: { partId: c.part.id }, b: { treadNumber: t.number } })),
  );
  return {
    output: {
      parts: carriages.map((c) => c.part),
      checks: checks.results,
      notes,
      ...(params.residual === "auto" && Number.isFinite(residual)
        ? { autoValues: { residual } }
        : {}),
      ...(assemblies.length > 0 ? { assemblies } : {}),
    },
    carriages,
    residual,
    ...(fcbaUnusable !== undefined ? { fcbaUnusable } : {}),
  };
}

export const WOOD_CUT: StructureKind<WoodCutParams> = {
  kind: "wood-cut",
  labelKey: "structure.woodCut.label",
  family: "bois",
  paramsSchema: WoodCutParamsSchema,
  defaults: (_ctx: StructureContext) => WoodCutParamsSchema.parse({}),
  build: (ctx, params) => buildWoodCut(ctx, params).output,
  capabilities: {
    // Cage saisie (sous-lot 6b) : un tronçon droit, largeur éventuellement variable (crémaillères
    // sous les bords inclinés) ; un tournant reste refusé par le plugin (escalier droit
    // seulement, comme en volées), un palier droit par le garde-fou (`straightLanding` non
    // déclaré).
    cage: ["variableWidth"],
  },
};
