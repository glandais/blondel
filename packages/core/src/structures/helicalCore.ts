/**
 * Plugin de structure **`helical-core`** (jalon 5a) : escalier hélicoïdal à fût central.
 *
 * - **Fût** (`helical-column`, repère F1) : tube acier (paroi `column.wallThickness`) ou rond
 *   bois plein, de rayon r_f du tracé, du sol fini bas au plancher haut (+ `topExtension`).
 * - **Marches en porte-à-faux sur le fût** : bois (pièces de base conservées) ou tôle plane
 *   (`treads.material = "steel"` : les pièces `tread-N` sont remplacées par des tôles de même
 *   contour, développé = contour 1:1). Le détail de fixation au fût (bague, platine) n'est pas
 *   modélisé. Le porte-à-faux sort des règles de moyens du DTU (C §1.8) : contrôle
 *   `HELICOIDAL_PORTE_A_FAUX` en avertissement « justification requise » tant que
 *   `cantileverJustification` (référence de note de calcul ou d'avis technique) est vide.
 * - **Palier d'arrivée** (`landing-arrival`, PA) : secteur du tracé, dessus au niveau H.
 * - **Limon extérieur hélicoïdal** facultatif (`outerStringer.enabled`, `helical-stringer`, LE1) :
 *   plat roulé, face intérieure au rayon R_e. Développé **exact** (B §4.3) : sur la fibre neutre
 *   r_n = R_e + e/2, la bande hélicoïdale se développe en parallélogramme (σ = r_n·u, z) dont les
 *   rives sont des droites de pente b / r_n (b = montée par radian de la ligne des nez) ; la
 *   longueur d'une rive vaut √((r_n·Θ)² + (b·Θ)²) = Θ·√(r_n² + b²). Génératrices de roulage
 *   verticales ; bas du flan coupé au sol fini.
 * - **Main courante hélicoïdale** (`helical-handrail`, MC1) : balayage d'une section ronde le
 *   long de l'hélice de rayon r_mc, à `handrail.height` au-dessus de la ligne des nez prise au
 *   même rayon (B §4.3) ; rayon de cintrage ρ = (r² + b²)/r et torsion τ = b/(r² + b²) en
 *   remarque (réglage de la cintreuse).
 *
 * Valeurs par défaut non sourcées marquées « à valider » (ledger §2). Tracé à jour central
 * (`core.kind = "well"`) ou escalier à volées : erreur explicite, aucune pièce.
 */
import { z } from "zod";
import { arcPoints, helicalAngleAt, helicalPoint } from "../layout/helical.js";
import { ensureCCW, signedArea } from "../geom2d/polygon.js";
import type {
  FlatPattern,
  HelicalLayout,
  MaterialId,
  Part,
  RuleResult,
  SolidDesc,
  Stepping,
} from "../model/derived.js";
import type { StructureContext, StructureKind, StructureOutput } from "../model/plugins.js";
import type { Frame3, Mm, Polygon2, Shape2, Vec2, Vec3 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { DEFAULT_WOOD_MATERIAL } from "../parts/basic.js";
import { fmt } from "../rules/check.js";
import { getRule } from "../rules/table.js";
import type { Finding } from "../rules/types.js";
import { STEEL_GRADES } from "../workshop/metal.js";
import {
  resolveWorkshopProfile,
  WOOD_MATERIALS,
  type WorkshopProfile,
} from "../workshop/profile.js";
import { CheckCollector, pluginRuleDef, type PluginRuleSpec } from "./checks.js";
import { minAreaRect } from "./geom.js";
import { woodQuantities } from "./quantities.js";
import { getStructure, registerStructure } from "./registry.js";
import {
  deduceExecutionClass,
  plateMeasures,
  STEEL_RULES,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";

const mmPos = z.number().positive();
const DEG = Math.PI / 180;
/** Pas angulaire maximal d'échantillonnage des hélices 3D (limon, main courante). */
const HELIX_STEP = 5 * DEG;

/** Hauteur de main courante par défaut : minimum de `GC_HAUTEUR_RAMPANT_2024` (rules.yaml). */
const DEFAULT_HANDRAIL_HEIGHT: Mm = (() => {
  const min = getRule("GC_HAUTEUR_RAMPANT_2024").min;
  if (min === null) throw new Error("GC_HAUTEUR_RAMPANT_2024 sans seuil.");
  return min;
})();

export const HelicalCoreParamsSchema = z.object({
  /** Nuance d'acier des pièces métal (S355 ⇒ EXC2, C §2.1). */
  grade: z.enum(STEEL_GRADES).default("S235"),
  finish: z.enum(["raw", "painted", "galvanized"]).default("painted"),
  column: z
    .object({
      material: z.enum(["steel", "wood"]).default("steel"),
      /** Paroi du tube acier (mm) — à valider. */
      wallThickness: mmPos.default(5),
      /** Essence du fût bois. */
      wood: z.enum(WOOD_MATERIALS).default("wood-oak"),
      /** Dépassement au-dessus du plancher haut (mm) — à valider. */
      topExtension: z.number().nonnegative().default(0),
    })
    .prefault({}),
  treads: z
    .object({
      /** Marches bois (pièces de base) ou tôle plane. */
      material: z.enum(["wood", "steel"]).default("wood"),
      /** Épaisseur de la tôle des marches acier (mm) — à valider. */
      plateThickness: mmPos.default(8),
    })
    .prefault({}),
  outerStringer: z
    .object({
      enabled: z.boolean().default(false),
      /** Hauteur du plat (mm) : exemple relevé de 250 mm (C §2.2 [50], confiance faible). */
      height: mmPos.default(250),
      /** Épaisseur (mm) : limons en tôle de 8 mm relevés (C §2.2 [20], exemple à valider). */
      thickness: mmPos.default(8),
      /** Rive haute au-dessus de la ligne des nez (mm) — à valider. */
      topAboveNosing: z.number().default(50),
    })
    .prefault({}),
  handrail: z
    .object({
      enabled: z.boolean().default(true),
      material: z.enum(["steel", "wood"]).default("steel"),
      /** Hauteur au-dessus de la ligne des nez (défaut : minimum de GC_HAUTEUR_RAMPANT_2024). */
      height: mmPos.default(DEFAULT_HANDRAIL_HEIGHT),
      /** Diamètre (mm) : Ø 42 relevé (C §2.2 [50], confiance faible). */
      diameter: mmPos.default(42),
      /** Décalage radial de l'axe par rapport au bout des marches (ou à l'axe du limon), mm. */
      radiusOffset: z.number().default(0),
    })
    .prefault({}),
  /**
   * Référence de la justification du porte-à-faux (note de calcul, avis technique) ; vide :
   * avertissement « justification requise » (C §1.8).
   */
  cantileverJustification: z.string().default(""),
});
export type HelicalCoreParams = z.output<typeof HelicalCoreParamsSchema>;

/** Contrôles propres au plugin (hors rules.yaml). */
export const HELICAL_RULES = {
  cantilever: {
    id: "HELICOIDAL_PORTE_A_FAUX",
    description:
      "Marches en porte-à-faux sur le fût : hors règles de moyens du NF DTU 36.3, justification (note de calcul ou avis technique) requise",
    source:
      "docs/research/C-structures.md §1.8 [48] (porte-à-faux et escaliers suspendus hors règles de moyens)",
    confidence: "moyen",
    nature: "metier",
    severity: "avertissement",
    unit: null,
  },
  rolling: {
    id: "FAB_ROULAGE_LIMON",
    description:
      "Limon hélicoïdal roulé : rayon intérieur, hauteur le long des génératrices et épaisseur dans les capacités de la rouleuse du profil d'atelier",
    source:
      "Profil d'atelier Blondel, rouleuse (C §2.4 [16], valeurs par défaut à valider, LEDGER §2)",
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

// ------------------------------------------------------------------ géométrie commune

const IDENTITY_AXES = {
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
} as const;

/** Extrusion verticale d'un contour en plan (repère local au premier sommet). */
function verticalExtrusion(outline: Polygon2, zBottom: Mm, depth: Mm, holes: Polygon2[] = []) {
  const o = outline[0]!;
  const frame: Frame3 = { origin: { x: o.x, y: o.y, z: zBottom }, ...IDENTITY_AXES };
  const local = (p: Vec2): Vec2 => ({ x: p.x - o.x, y: p.y - o.y });
  const solid: SolidDesc = {
    kind: "extrusion",
    frame,
    profile: { outer: outline.map(local), holes: holes.map((h) => h.map(local)) },
    depth,
  };
  return solid;
}

/** Cercle (polygone inscrit, flèche ≤ 0,1 mm), CCW. */
function circle(center: Vec2, radius: Mm): Vec2[] {
  const pts = arcPoints(center, radius, 0, 2 * Math.PI);
  pts.pop();
  return ensureCCW(pts) as Vec2[];
}

/** Ligne des nez : altitude au-dessus du rayon de progression u (hélice passant par les nez). */
function noseLine(h: HelicalLayout, stepping: Stepping): { z0: Mm; b: number } {
  const first = stepping.nosings[0]!;
  const last = stepping.nosings[stepping.nosings.length - 1]!;
  const b = h.totalAngle > 0 ? (last.z - first.z) / h.totalAngle : 0;
  return { z0: first.z, b };
}

/** Progressions u d'échantillonnage de [0 ; Θ] (pas ≤ 5°). */
function helixSamples(total: number): number[] {
  const count = Math.max(2, Math.ceil(total / HELIX_STEP));
  return Array.from({ length: count + 1 }, (_, i) => (total * i) / count);
}

/** Découpe d'un polygone convexe par le demi-plan y ≥ yMin (Sutherland–Hodgman). */
function clipBelow(poly: readonly Vec2[], yMin: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ina = a.y >= yMin;
    const inb = b.y >= yMin;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (yMin - a.y) / (b.y - a.y);
      out.push({ x: a.x + t * (b.x - a.x), y: yMin });
    }
  }
  return out;
}

/**
 * Débit d'une pièce plane : rectangle orienté minimal du contour (le secteur d'une marche ou
 * d'un palier, débord de nez compris ; l'arc R_e·Δθ surestime la corde, R_e − r ignore le débord).
 */
function plateStock(outline: Polygon2): { length: Mm; width: Mm } {
  const box = minAreaRect(outline);
  return { length: box.length, width: box.width };
}

// ------------------------------------------------------------------ limon hélicoïdal

export interface HelicalStringerInput {
  /** Rayon de la face intérieure (R_e) et épaisseur du plat. */
  readonly innerRadius: Mm;
  readonly thickness: Mm;
  /** Angle total développé Θ (rad) et montée par radian b de la ligne des nez. */
  readonly totalAngle: number;
  readonly risePerRadian: number;
  /** Altitude de la rive haute au départ (u = 0) et hauteur du plat. */
  readonly topStart: Mm;
  readonly height: Mm;
  /** Coupe basse horizontale (sol fini), `null` : aucune. */
  readonly floor: Mm | null;
}

export interface HelicalStringerDevelopment {
  /** Rayon de la fibre neutre r_n = R_e + e/2. */
  readonly neutralRadius: Mm;
  /** Longueur développée le long de σ : r_n·Θ. */
  readonly span: Mm;
  /** Pente des rives dans le développé : b / r_n. */
  readonly slope: number;
  /** Longueur d'une rive (hélice de rayon r_n) : √((r_n·Θ)² + (b·Θ)²). */
  readonly edgeLength: Mm;
  /** Contour (σ, z) CCW, parallélogramme coupé au sol. */
  readonly outline: Vec2[];
}

/**
 * Développé exact d'un limon hélicoïdal en plat roulé (B §4.3) : parallélogramme en (σ, z) sur
 * la fibre neutre, extrémités verticales (génératrices), coupé au sol s'il y a lieu.
 */
export function developHelicalStringer(input: HelicalStringerInput): HelicalStringerDevelopment {
  const rn = input.innerRadius + input.thickness / 2;
  const span = rn * input.totalAngle;
  const rise = input.risePerRadian * input.totalAngle;
  const top0 = input.topStart;
  const bottom0 = top0 - input.height;
  const raw: Vec2[] = [
    { x: 0, y: bottom0 },
    { x: span, y: bottom0 + rise },
    { x: span, y: top0 + rise },
    { x: 0, y: top0 },
  ];
  const clipped = input.floor === null ? raw : clipBelow(raw, input.floor);
  return {
    neutralRadius: rn,
    span,
    slope: span > 0 ? rise / span : 0,
    edgeLength: Math.hypot(span, rise),
    outline: ensureCCW(clipped) as Vec2[],
  };
}

// ------------------------------------------------------------------ construction

/** Résultat détaillé (tests) : sortie du plugin et développé du limon. */
export interface HelicalCoreResult {
  readonly output: StructureOutput;
  readonly stringer?: HelicalStringerDevelopment;
}

function failure(message: string): HelicalCoreResult {
  return { output: { parts: [], checks: [], notes: [], errors: [message] } };
}

function woodPart(
  base: Omit<Part, "quantities" | "material">,
  material: MaterialId,
  volumeMm3: number,
  surfaceMm2: number,
  length: Mm,
  profile: WorkshopProfile,
): Part {
  return {
    ...base,
    material,
    quantities: woodQuantities({ volumeMm3, surfaceMm2, length }, material, profile, base.stock),
  };
}

/** Construit la structure hélicoïdale (voir l'en-tête du module). */
export function buildHelicalCore(
  ctx: StructureContext,
  params: HelicalCoreParams,
): HelicalCoreResult {
  const { project, layout, stepping } = ctx;
  const h = layout.helical;
  if (!h) {
    return failure(
      "Structure « helical-core » : réservée aux escaliers hélicoïdaux (tracé « helical »).",
    );
  }
  if (h.core !== "column") {
    return failure(
      "Structure « helical-core » : un fût central est requis (hélicoïdal à jour central non pris en charge au jalon 5a).",
    );
  }
  if (stepping.nosings.length < 2) {
    return failure("Structure « helical-core » : découpage vide.");
  }
  const profile = resolveWorkshopProfile(project.workshop);
  const steel = steelMaterial(params.finish);
  const parts: Part[] = [];
  const notes: string[] = [];
  const checks = new CheckCollector(project, stepping);
  const H = project.site.floorToFloor;
  const rf = h.innerRadius;
  let usesSteel = false;

  // ---------------------------------------------------------------- fût
  {
    const height = H + params.column.topExtension;
    const outer = circle(h.center, rf);
    const areaOuter = Math.abs(signedArea(outer));
    if (params.column.material === "steel") {
      const wall = params.column.wallThickness;
      if (!(wall < rf)) {
        return failure(
          `Structure « helical-core » : paroi du fût (${fmt(wall)} mm) supérieure ou égale à son rayon (${fmt(rf)} mm).`,
        );
      }
      const inner = circle(h.center, rf - wall);
      const area = areaOuter - Math.abs(signedArea(inner));
      usesSteel = true;
      parts.push({
        id: "helical-column",
        mark: "F1",
        category: "post",
        name: "Fût central",
        material: steel,
        solid: verticalExtrusion(outer, 0, height, [[...inner].reverse()]),
        section: `tube Ø${fmt(2 * rf, 1)} × ${fmt(wall, 1)}`,
        stock: { length: height, width: 2 * rf, thickness: wall },
        quantities: steelQuantities(
          {
            volumeMm3: area * height,
            treatedSurfaceMm2: 2 * Math.PI * (2 * rf - wall) * height,
            length: height,
            cuts: 2,
          },
          profile,
        ),
        grain: { x: 0, y: 0, z: 1 },
      });
    } else {
      const stock = { length: height, width: 2 * rf, thickness: 2 * rf };
      parts.push(
        woodPart(
          {
            id: "helical-column",
            mark: "F1",
            category: "post",
            name: "Fût central",
            solid: verticalExtrusion(outer, 0, height),
            section: `rond Ø${fmt(2 * rf, 1)}`,
            stock,
            grain: { x: 0, y: 0, z: 1 },
          },
          params.column.wood,
          areaOuter * height,
          2 * Math.PI * rf * height,
          height,
          profile,
        ),
      );
    }
  }

  // ---------------------------------------------------------------- marches en tôle
  if (params.treads.material === "steel") {
    usesSteel = true;
    const t = params.treads.plateThickness;
    for (const tread of stepping.treads) {
      const outline = tread.outline;
      const o = outline[0]!;
      const flatOuter = ensureCCW(outline.map((p) => ({ x: p.x - o.x, y: p.y - o.y })));
      const shape: Shape2 = { outer: flatOuter, holes: [] };
      const m = plateMeasures(shape, t);
      const flat: FlatPattern = {
        outline: shape,
        lines: [],
        thickness: t,
        reference: {
          kind: "face",
          description: "Dessus de marche vu de dessus, repère du plan décalé au premier sommet.",
        },
      };
      parts.push({
        id: `tread-${tread.number}`,
        mark: `M${tread.number}`,
        category: "tread",
        name: `Marche ${tread.number} (tôle)`,
        material: steel,
        solid: verticalExtrusion(outline, tread.z - t, t),
        flat,
        section: `tôle ${fmt(t, 1)}`,
        stock: { ...plateStock(outline), thickness: t },
        quantities: steelQuantities(
          {
            volumeMm3: m.volumeMm3,
            treatedSurfaceMm2: m.treatedSurfaceMm2,
            length: h.outerRadius - rf,
            cuts: 1,
            laserCut: m.laserCut,
          },
          profile,
        ),
      });
    }
    if (t < project.stair.treads.thickness) {
      notes.push(
        `Marches en tôle de ${fmt(t)} mm : l'échappée est calculée avec l'épaisseur de marche du projet (${fmt(project.stair.treads.thickness)} mm), du côté de la sécurité.`,
      );
    }
  }

  // ---------------------------------------------------------------- palier d'arrivée
  if (h.landingOutline) {
    const top = stepping.nosings[stepping.nosings.length - 1]!.z;
    const outline = h.landingOutline;
    const area = Math.abs(signedArea(outline));
    // Catégorie `support` (plateau porté par le fût et le nez de dalle) : les pièces `landing`
    // sont réservées aux marches palières du découpage (`tread-N`), voir le ledger.
    const base = {
      id: "landing-arrival",
      mark: "PA",
      category: "support" as const,
      name: "Palier d'arrivée (plateau)",
    };
    if (params.treads.material === "steel") {
      const t = params.treads.plateThickness;
      const o = outline[0]!;
      const shape: Shape2 = {
        outer: ensureCCW(outline.map((p) => ({ x: p.x - o.x, y: p.y - o.y }))),
        holes: [],
      };
      const m = plateMeasures(shape, t);
      parts.push({
        ...base,
        material: steel,
        solid: verticalExtrusion(outline, top - t, t),
        flat: { outline: shape, lines: [], thickness: t },
        section: `tôle ${fmt(t, 1)}`,
        stock: { ...plateStock(outline), thickness: t },
        quantities: steelQuantities(
          {
            volumeMm3: m.volumeMm3,
            treatedSurfaceMm2: m.treatedSurfaceMm2,
            length: h.outerRadius - rf,
            cuts: 1,
            laserCut: m.laserCut,
          },
          profile,
        ),
      });
    } else {
      const t = project.stair.treads.thickness;
      const stock = { ...plateStock(outline), thickness: t };
      parts.push(
        woodPart(
          { ...base, solid: verticalExtrusion(outline, top - t, t), stock },
          DEFAULT_WOOD_MATERIAL,
          area * t,
          area,
          stock.length,
          profile,
        ),
      );
    }
  }

  const { z0, b } = noseLine(h, stepping);
  const total = h.totalAngle;
  const us = helixSamples(total);

  // ---------------------------------------------------------------- limon extérieur
  let stringer: HelicalStringerDevelopment | undefined;
  if (params.outerStringer.enabled) {
    usesSteel = true;
    const s = params.outerStringer;
    const topStart = z0 + s.topAboveNosing;
    const dev = developHelicalStringer({
      innerRadius: h.outerRadius,
      thickness: s.thickness,
      totalAngle: total,
      risePerRadian: b,
      topStart,
      height: s.height,
      floor: 0,
    });
    stringer = dev;
    const lines: FlatPattern["lines"][number][] = [];
    // Épaisseur réelle des marches reportée sur le limon : tôle ou bois du projet.
    const tt =
      params.treads.material === "steel"
        ? params.treads.plateThickness
        : project.stair.treads.thickness;
    stepping.nosings.forEach((nosing, k) => {
      const sigma = dev.neutralRadius * k * h.stepAngle;
      lines.push({
        kind: "roll",
        a: { x: sigma, y: Math.max(0, topStart + b * k * h.stepAngle - s.height) },
        b: { x: sigma, y: topStart + b * k * h.stepAngle },
      });
      if (k + 1 < stepping.nosings.length) {
        lines.push({
          kind: "mark",
          a: { x: sigma, y: nosing.z - tt },
          b: { x: sigma, y: nosing.z },
          label: `M${k + 1}`,
        });
      }
    });
    const shape: Shape2 = { outer: dev.outline, holes: [] };
    const m = plateMeasures(shape, s.thickness);
    const ys = dev.outline.map((p) => p.y);
    const zSpan = Math.max(...ys) - Math.min(...ys);
    const bottomAt = (u: number): Mm => Math.max(0, topStart + b * u - s.height);
    const a3: Vec3[] = [];
    const b3: Vec3[] = [];
    const normals: Vec2[] = [];
    for (const u of us) {
      const angle = helicalAngleAt(h, u);
      const p = helicalPoint(h, h.outerRadius, angle);
      a3.push({ x: p.x, y: p.y, z: bottomAt(u) });
      b3.push({ x: p.x, y: p.y, z: topStart + b * u });
      normals.push({ x: Math.cos(angle), y: Math.sin(angle) });
    }
    parts.push({
      id: "helical-stringer",
      mark: "LE1",
      category: "stringer",
      name: "Limon extérieur hélicoïdal",
      material: steel,
      solid: { kind: "ruled", a: a3, b: b3, thickness: s.thickness, normals },
      flat: {
        outline: shape,
        lines,
        thickness: s.thickness,
        reference: {
          kind: "neutral-fiber",
          description: `Fibre neutre (rayon ${fmt(dev.neutralRadius, 1)} mm) : σ horizontal le long de l'hélice développée depuis le nez de départ, z vertical depuis le sol fini bas ; génératrices de roulage verticales.`,
        },
      },
      section: `plat ${fmt(s.height, 0)} × ${fmt(s.thickness, 0)} roulé R ${fmt(h.outerRadius, 0)}`,
      stock: { length: dev.span, width: zSpan, thickness: s.thickness },
      quantities: steelQuantities(
        {
          volumeMm3: m.volumeMm3,
          treatedSurfaceMm2: m.treatedSurfaceMm2,
          length: dev.edgeLength,
          cuts: 1,
          laserCut: m.laserCut,
        },
        profile,
      ),
    });
    notes.push(
      `Limon hélicoïdal : développé en parallélogramme sur la fibre neutre (rayon ${fmt(dev.neutralRadius)} mm), longueur de rive ${fmt(dev.edgeLength)} mm, pente ${fmt(Math.atan(dev.slope) / DEG)}°.`,
    );
    // Rouleuse et format de tôle.
    const rolling = profile.metal.plateRolling;
    const rollRule = pluginRuleDef(HELICAL_RULES.rolling);
    const rollFindings: Finding[] = [];
    const loc = { kind: "part" as const, partId: "helical-stringer" };
    if (h.outerRadius < rolling.minInnerRadius) {
      rollFindings.push({
        status: "violation",
        measured: h.outerRadius,
        min: rolling.minInnerRadius,
        location: loc,
        message: `Rayon intérieur de roulage ${fmt(h.outerRadius)} mm < ${fmt(rolling.minInnerRadius)} mm (rouleuse).`,
      });
    }
    if (s.height > rolling.rollLength) {
      rollFindings.push({
        status: "violation",
        measured: s.height,
        max: rolling.rollLength,
        location: loc,
        message: `Hauteur du plat le long des génératrices ${fmt(s.height)} mm > ${fmt(rolling.rollLength)} mm de rouleaux.`,
      });
    }
    if (s.thickness > rolling.maxThickness) {
      rollFindings.push({
        status: "violation",
        measured: s.thickness,
        max: rolling.maxThickness,
        location: loc,
        message: `Épaisseur ${fmt(s.thickness)} mm > ${fmt(rolling.maxThickness)} mm roulables.`,
      });
    }
    if (rollFindings.length === 0) {
      rollFindings.push({
        status: "ok",
        location: loc,
        message: `Limon roulable : rayon ${fmt(h.outerRadius)} mm, hauteur ${fmt(s.height)} mm, épaisseur ${fmt(s.thickness)} mm.`,
      });
    }
    checks.add(rollRule, rollFindings);
    // Imbrication : la bande développée est rectiligne (C §2.4) ; rectangle orienté minimal.
    const box = minAreaRect(dev.outline);
    const fits = profile.metal.sheetFormats.some(
      (f) =>
        (box.length <= f.length && box.width <= f.width) ||
        (box.length <= f.width && box.width <= f.length),
    );
    const dims = `${fmt(box.length)} × ${fmt(box.width)} mm`;
    checks.add(pluginRuleDef(STEEL_RULES.sheetFormat), [
      fits
        ? {
            status: "ok",
            location: loc,
            message: `Développé ${dims} contenu dans un format de tôle.`,
          }
        : {
            status: "violation",
            measured: box.length,
            location: loc,
            message: `Développé ${dims} hors des formats de tôle du profil d'atelier : aboutage à prévoir.`,
          },
    ]);
  }

  // ---------------------------------------------------------------- main courante
  if (params.handrail.enabled) {
    const hr = params.handrail;
    const radius =
      h.outerRadius +
      (params.outerStringer.enabled ? params.outerStringer.thickness / 2 : 0) +
      hr.radiusOffset;
    if (!(radius > 0)) {
      return failure("Structure « helical-core » : rayon de main courante non positif.");
    }
    const path: Vec3[] = us.map((u) => {
      const p = helicalPoint(h, radius, helicalAngleAt(h, u));
      return { x: p.x, y: p.y, z: z0 + b * u + hr.height };
    });
    const section: Shape2 = { outer: circle({ x: 0, y: 0 }, hr.diameter / 2), holes: [] };
    const length = total * Math.hypot(radius, b);
    const rho = (radius * radius + b * b) / radius;
    const tau = b / (radius * radius + b * b);
    const area = Math.abs(signedArea(section.outer));
    const base = {
      id: "helical-handrail",
      mark: "MC1",
      category: "handrail" as const,
      name: "Main courante hélicoïdale",
      solid: { kind: "sweep" as const, path, section },
      section: `rond Ø${fmt(hr.diameter, 0)}`,
      stock: { length, width: hr.diameter, thickness: hr.diameter },
    };
    if (hr.material === "steel") {
      usesSteel = true;
      parts.push({
        ...base,
        material: steel,
        quantities: steelQuantities(
          {
            volumeMm3: area * length,
            treatedSurfaceMm2: Math.PI * hr.diameter * length,
            length,
            cuts: 2,
          },
          profile,
        ),
      });
    } else {
      parts.push(
        woodPart(
          base,
          DEFAULT_WOOD_MATERIAL,
          area * length,
          Math.PI * hr.diameter * length,
          length,
          profile,
        ),
      );
    }
    notes.push(
      `Main courante hélicoïdale : rayon ${fmt(radius)} mm, longueur développée ${fmt(length)} mm, rayon de cintrage ρ = (r² + b²)/r = ${fmt(rho)} mm, torsion τ = ${fmt(tau * 1000, 3)} rad/m (B §4.3, avant correction du retour élastique).`,
    );
  }

  // ---------------------------------------------------------------- porte-à-faux
  const justification = params.cantileverJustification.trim();
  checks.add(pluginRuleDef(HELICAL_RULES.cantilever), [
    justification === ""
      ? {
          status: "violation",
          message:
            "Justification requise : marches en porte-à-faux sur le fût, hors règles de moyens du DTU (note de calcul ou avis technique à joindre, paramètre « cantileverJustification »).",
        }
      : { status: "ok", message: `Porte-à-faux justifié : ${justification}.` },
  ]);

  const exc = usesSteel ? deduceExecutionClass({ grade: params.grade, buttWeld: 0 }) : null;
  if (exc) {
    notes.push(
      `Classe d'exécution ${exc.executionClass}${exc.reasons.length > 0 ? ` (${exc.reasons.join(", ")})` : ""}.`,
    );
  }
  const output: StructureOutput = {
    parts,
    checks: checks.results as RuleResult[],
    notes,
    ...(exc ? { executionClass: exc.executionClass } : {}),
  };
  return { output, ...(stringer ? { stringer } : {}) };
}

export const HELICAL_CORE: StructureKind<HelicalCoreParams> = {
  kind: "helical-core",
  label: "Hélicoïdal à fût central (marches en porte-à-faux, limon et main courante hélicoïdaux)",
  family: "mixte",
  paramsSchema: HelicalCoreParamsSchema,
  defaults: () => HelicalCoreParamsSchema.parse({}),
  build: (ctx, params) => buildHelicalCore(ctx, params).output,
};

/** Enregistrement (appelé au chargement de `structures/index.ts`, comme les autres plugins). */
export function registerHelicalCore(): void {
  if (!getStructure(HELICAL_CORE.kind)) registerStructure(HELICAL_CORE);
}

/** Projet dont la structure est `helical-core` (utilitaire de tests et d'exemples). */
export function withHelicalCore(project: Project, params: Record<string, unknown> = {}): Project {
  return { ...project, stair: { ...project.stair, structure: { kind: "helical-core", params } } };
}
