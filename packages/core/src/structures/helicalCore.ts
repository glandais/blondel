/**
 * Plugin de structure **`helical-core`** (jalon 5a) : escalier hélicoïdal à fût central ou, depuis
 * le 2026-09-30, à **jour central** (`core.kind = "well"`).
 *
 * - **Jour central** : pas de fût ; **limon intérieur hélicoïdal** (`helical-stringer-inner`,
 *   LI1) en plat roulé, face côté marches au rayon du jour r_j, épaisseur vers l'axe (fibre
 *   neutre r_j − e/2, rayon de roulage r_j − e), et limon extérieur activé par défaut : les
 *   marches sont portées des deux côtés (pas de contrôle de porte-à-faux, sauf limon extérieur
 *   désactivé). Les deux limons se développent **en bande** (parallélogramme exact, B §4.3).
 * - **Fût** (`helical-column`, repère F1, fût central seulement) : tube acier (paroi `column.wallThickness`) ou rond
 *   bois plein, de rayon r_f du tracé, du sol fini bas au plancher haut (+ `topExtension`).
 * - **Marches en porte-à-faux sur le fût** : bois (pièces de base conservées) ou tôle plane
 *   (`treads.material = "steel"` : les pièces `tread-N` sont remplacées par des tôles de même
 *   contour, développé = contour 1:1). Le détail de fixation au fût (bague, platine) n'est pas
 *   modélisé. Sous des marches en tôle, **pas de contremarche** (décision A11) : les
 *   contremarches bois de base sont retirées et les règles de nez / contremarches
 *   (`VIDE_ENTRE_MARCHES`…) réévaluées sans contremarche, à l'épaisseur de la tôle. Le
 *   porte-à-faux sort des règles de moyens du DTU (C §1.8) : contrôle
 *   `HELICOIDAL_PORTE_A_FAUX` en avertissement : « justification requise » tant que
 *   `cantileverJustification` (référence de note de calcul ou d'avis technique) est vide ;
 *   saisie, l'avertissement **reste** (une justification n'est pas une vérification) et la
 *   justification est portée par le résultat (`RuleResult.justification`) et reprise dans le
 *   dossier PDF (décision A12, 2026-09-30).
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
 * Valeurs par défaut non sourcées marquées « à valider » (ledger §2). Escalier à volées : erreur
 * explicite, aucune pièce.
 */
import { dec, msg, textMessage, type Message } from "@blondel/i18n";
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
import type {
  PartAssembly,
  StructureContext,
  StructureKind,
  StructureOutput,
} from "../model/plugins.js";
import type { Frame3, Mm, Polygon2, Shape2, Vec2, Vec3 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { DEFAULT_WOOD_MATERIAL } from "../parts/basic.js";
import { NOSING_EVALUATORS } from "../rules/evaluators/nosing.js";
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
  joinMessages,
  plateMeasures,
  STEEL_RULES,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";

/** Cote en mm entiers (ADR-0003) : le formulaire générique la saisit en entier (QUESTIONS D6). */
const mmPos = z.number().int().positive();
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
      topExtension: z.number().int().nonnegative().default(0),
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
  /**
   * Limon intérieur hélicoïdal d'un hélicoïdal **à jour central** (`core.kind = "well"`) : plat
   * roulé, face côté marches au rayon du jour r_j, épaisseur vers l'axe. Ignoré sur un fût.
   * Mêmes valeurs par défaut que le limon extérieur (exemples relevés, à valider).
   */
  innerStringer: z
    .object({
      /** Hauteur du plat (mm) : exemple relevé de 250 mm (C §2.2 [50], confiance faible). */
      height: mmPos.default(250),
      /** Épaisseur (mm) : limons en tôle de 8 mm relevés (C §2.2 [20], exemple à valider). */
      thickness: mmPos.default(8),
      /** Rive haute au-dessus de la ligne des nez (mm) — à valider. */
      topAboveNosing: z.number().int().default(50),
    })
    .prefault({}),
  outerStringer: z
    .object({
      /** Défaut : non (fût) ; oui sur un jour central (`defaults(ctx)`). */
      enabled: z.boolean().default(false),
      /** Hauteur du plat (mm) : exemple relevé de 250 mm (C §2.2 [50], confiance faible). */
      height: mmPos.default(250),
      /** Épaisseur (mm) : limons en tôle de 8 mm relevés (C §2.2 [20], exemple à valider). */
      thickness: mmPos.default(8),
      /** Rive haute au-dessus de la ligne des nez (mm) — à valider. */
      topAboveNosing: z.number().int().default(50),
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
      radiusOffset: z.number().int().default(0),
    })
    .prefault({}),
  /**
   * Référence de la justification du porte-à-faux (note de calcul, avis technique) ; vide :
   * avertissement « justification requise » (C §1.8) ; saisie : l'avertissement reste, la
   * justification lui est jointe (décision A12).
   */
  cantileverJustification: z.string().default(""),
});
export type HelicalCoreParams = z.output<typeof HelicalCoreParamsSchema>;

/** Contrôles propres au plugin (hors rules.yaml). */
export const HELICAL_RULES = {
  cantilever: {
    id: "HELICOIDAL_PORTE_A_FAUX",
    source:
      "docs/research/C-structures.md §1.8 [48] (porte-à-faux et escaliers suspendus hors règles de moyens)",
    confidence: "moyen",
    nature: "metier",
    severity: "avertissement",
    unit: null,
  },
  rolling: {
    id: "FAB_ROULAGE_LIMON",
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
  /**
   * Rayon de la face côté marches (R_e pour le limon extérieur, r_j pour le limon intérieur
   * d'un hélicoïdal à jour) et épaisseur du plat.
   */
  readonly innerRadius: Mm;
  readonly thickness: Mm;
  /**
   * Côté de l'épaisseur : `outward` (défaut, limon extérieur : plat au-delà de R_e, fibre neutre
   * R_e + e/2) ou `inward` (limon intérieur : plat vers l'axe, fibre neutre r_j − e/2).
   */
  readonly side?: "outward" | "inward";
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
  /** Rayon de la fibre neutre r_n = R_e + e/2 (limon intérieur : r_j − e/2). */
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
  const rn = input.innerRadius + ((input.side === "inward" ? -1 : 1) * input.thickness) / 2;
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

// ------------------------------------------------------------------ marches en tôle

/**
 * Règles de rules.yaml qui dépendent des contremarches et de l'épaisseur de marche
 * (`rules/evaluators/nosing.ts`) réévaluées pour des marches en tôle sans contremarche
 * (décision A11) : projet effectif `risers = "none"`, épaisseur = tôle. Les résultats du plugin
 * remplacent ceux du moteur (`mergeStructureChecks`).
 */
function reevaluateWithoutRisers(
  checks: CheckCollector,
  project: Project,
  layout: StructureContext["layout"],
  stepping: Stepping,
  plateThickness: Mm,
): void {
  const effective: Project = {
    ...project,
    stair: {
      ...project.stair,
      treads: { ...project.stair.treads, risers: "none", thickness: plateThickness },
    },
  };
  for (const [id, evaluate] of Object.entries(NOSING_EVALUATORS)) {
    const rule = checks.yamlRule(id);
    if (!rule) continue;
    const findings = evaluate({
      project: effective,
      layout,
      stepping,
      rule,
      contexts: checks.activeContexts,
    });
    checks.add(
      rule,
      findings.map((f) => ({
        ...f,
        message: msg("structure.helicalCore.check.withoutRisers", {
          thickness: dec(plateThickness),
          detail: f.message,
        }),
      })),
    );
  }
}

// ------------------------------------------------------------------ construction

/** Résultat détaillé (tests) : sortie du plugin et développé du limon. */
export interface HelicalCoreResult {
  readonly output: StructureOutput;
  /** Développé du limon extérieur (s'il est généré). */
  readonly stringer?: HelicalStringerDevelopment;
  /** Développé du limon intérieur (hélicoïdal à jour central). */
  readonly innerStringer?: HelicalStringerDevelopment;
}

function failure(message: Message): HelicalCoreResult {
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
    return failure(msg("structure.helicalCore.error.helicalOnly"));
  }
  // Jour central : pas de fût ; limon intérieur hélicoïdal (et limon extérieur) porteurs.
  const well = h.core === "well";
  if (stepping.nosings.length < 2) {
    return failure(msg("structure.helicalCore.error.emptyStepping"));
  }
  const profile = resolveWorkshopProfile(project.workshop);
  const steel = steelMaterial(params.finish);
  const parts: Part[] = [];
  const notes: Message[] = [];
  const checks = new CheckCollector(project, stepping);
  const H = project.site.floorToFloor;
  const rf = h.innerRadius;
  let usesSteel = false;
  const removedBaseParts: string[] = [];

  // ---------------------------------------------------------------- fût
  if (!well) {
    const height = H + params.column.topExtension;
    const outer = circle(h.center, rf);
    const areaOuter = Math.abs(signedArea(outer));
    if (params.column.material === "steel") {
      const wall = params.column.wallThickness;
      if (!(wall < rf)) {
        return failure(
          msg("structure.helicalCore.error.columnWall", { wall: dec(wall), radius: dec(rf) }),
        );
      }
      const inner = circle(h.center, rf - wall);
      const area = areaOuter - Math.abs(signedArea(inner));
      usesSteel = true;
      parts.push({
        id: "helical-column",
        mark: "F1",
        category: "post",
        name: msg("structure.helicalCore.part.column"),
        material: steel,
        solid: verticalExtrusion(outer, 0, height, [[...inner].reverse()]),
        section: msg("structure.helicalCore.section.tube", {
          diameter: dec(2 * rf, 1),
          wall: dec(wall, 1),
        }),
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
            name: msg("structure.helicalCore.part.column"),
            solid: verticalExtrusion(outer, 0, height),
            section: msg("structure.helicalCore.section.round", { diameter: dec(2 * rf, 1) }),
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
          description: msg("structure.helicalCore.reference.tread"),
        },
      };
      parts.push({
        id: `tread-${tread.number}`,
        mark: `M${tread.number}`,
        category: "tread",
        name: msg("structure.helicalCore.part.tread", { n: tread.number }),
        material: steel,
        solid: verticalExtrusion(outline, tread.z - t, t),
        flat,
        section: msg("structure.steel.section.plate", { thickness: dec(t, 1) }),
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
        msg("structure.helicalCore.note.headroomThickness", {
          thickness: dec(t),
          projectThickness: dec(project.stair.treads.thickness),
        }),
      );
    }
    // Décision A11 (QUESTIONS, 2026-09-29) : pas de contremarche bois sous des marches en tôle
    // en porte-à-faux. Les contremarches de base sont retirées et les règles de nez, de
    // recouvrement et de contremarche (dont `VIDE_ENTRE_MARCHES`) sont réévaluées sans
    // contremarche, avec l'épaisseur de la tôle.
    if (project.stair.treads.risers === "full") {
      removedBaseParts.push(...stepping.nosings.map((_, k) => `riser-${k + 1}`));
      notes.push(
        msg("structure.helicalCore.note.removedRisers", {
          count: removedBaseParts.length,
        }),
      );
    }
    reevaluateWithoutRisers(checks, project, layout, stepping, t);
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
      name: msg("structure.helicalCore.part.landing"),
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
        section: msg("structure.steel.section.plate", { thickness: dec(t, 1) }),
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
          project.stair.treads.material ?? DEFAULT_WOOD_MATERIAL,
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

  // ---------------------------------------------------------------- limons hélicoïdaux
  // Épaisseur réelle des marches reportée sur les limons : tôle ou bois du projet.
  const treadThickness =
    params.treads.material === "steel"
      ? params.treads.plateThickness
      : project.stair.treads.thickness;
  const rolling = profile.metal.plateRolling;
  /**
   * Limon hélicoïdal en plat roulé (B §4.3), face côté marches au rayon `faceRadius`, épaisseur
   * vers l'extérieur (limon extérieur) ou vers l'axe (limon intérieur d'un jour central) ;
   * développé en bande (parallélogramme sur la fibre neutre), contrôles de roulage et de format.
   */
  const addStringer = (spec: {
    readonly id: string;
    readonly mark: string;
    readonly name: Message;
    readonly faceRadius: Mm;
    readonly side: "outward" | "inward";
    readonly height: Mm;
    readonly thickness: Mm;
    readonly topAboveNosing: Mm;
  }): HelicalStringerDevelopment => {
    usesSteel = true;
    const topStart = z0 + spec.topAboveNosing;
    const dev = developHelicalStringer({
      innerRadius: spec.faceRadius,
      thickness: spec.thickness,
      side: spec.side,
      totalAngle: total,
      risePerRadian: b,
      topStart,
      height: spec.height,
      floor: 0,
    });
    const lines: FlatPattern["lines"][number][] = [];
    stepping.nosings.forEach((nosing, k) => {
      const sigma = dev.neutralRadius * k * h.stepAngle;
      lines.push({
        kind: "roll",
        a: { x: sigma, y: Math.max(0, topStart + b * k * h.stepAngle - spec.height) },
        b: { x: sigma, y: topStart + b * k * h.stepAngle },
      });
      if (k + 1 < stepping.nosings.length) {
        lines.push({
          kind: "mark",
          a: { x: sigma, y: nosing.z - treadThickness },
          b: { x: sigma, y: nosing.z },
          label: textMessage(`M${k + 1}`),
        });
      }
    });
    const shape: Shape2 = { outer: dev.outline, holes: [] };
    const m = plateMeasures(shape, spec.thickness);
    const ys = dev.outline.map((p) => p.y);
    const zSpan = Math.max(...ys) - Math.min(...ys);
    const bottomAt = (u: number): Mm => Math.max(0, topStart + b * u - spec.height);
    const sign = spec.side === "inward" ? -1 : 1;
    const a3: Vec3[] = [];
    const b3: Vec3[] = [];
    const normals: Vec2[] = [];
    // Coin de la coupe de niveau au sol (rive basse = 0) : génératrice ajoutée, sans quoi la
    // surface réglée passe en ligne droite par-dessus le coin et s'écarte du développé.
    const uFloor = (spec.height - topStart) / b;
    const rows =
      uFloor > 1e-9 && uFloor < total - 1e-9 && !us.some((u) => Math.abs(u - uFloor) < 1e-9)
        ? [...us, uFloor].sort((x, y) => x - y)
        : us;
    for (const u of rows) {
      const angle = helicalAngleAt(h, u);
      const p = helicalPoint(h, spec.faceRadius, angle);
      a3.push({ x: p.x, y: p.y, z: bottomAt(u) });
      b3.push({ x: p.x, y: p.y, z: topStart + b * u });
      normals.push({ x: sign * Math.cos(angle), y: sign * Math.sin(angle) });
    }
    // Rayon intérieur de roulage : face côté marches (extérieur) ou face côté axe (intérieur).
    const rollRadius = spec.side === "inward" ? spec.faceRadius - spec.thickness : spec.faceRadius;
    parts.push({
      id: spec.id,
      mark: spec.mark,
      category: "stringer",
      name: spec.name,
      material: steel,
      solid: { kind: "ruled", a: a3, b: b3, thickness: spec.thickness, normals },
      flat: {
        outline: shape,
        lines,
        thickness: spec.thickness,
        reference: {
          kind: "neutral-fiber",
          description: msg("structure.helicalCore.reference.stringer", {
            radius: dec(dev.neutralRadius, 1),
          }),
        },
      },
      section: msg("structure.helicalCore.section.rolledFlat", {
        height: dec(spec.height, 0),
        thickness: dec(spec.thickness, 0),
        radius: dec(rollRadius, 0),
      }),
      stock: { length: dev.span, width: zSpan, thickness: spec.thickness },
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
      msg("structure.helicalCore.note.stringerDevelopment", {
        name: spec.name,
        radius: dec(dev.neutralRadius),
        edge: dec(dev.edgeLength),
        pitch: dec(Math.atan(dev.slope) / DEG),
      }),
    );
    // Rouleuse et format de tôle.
    const rollRule = pluginRuleDef(HELICAL_RULES.rolling);
    const rollFindings: Finding[] = [];
    const loc = { kind: "part" as const, partId: spec.id };
    if (rollRadius < rolling.minInnerRadius) {
      rollFindings.push({
        status: "violation",
        measured: rollRadius,
        min: rolling.minInnerRadius,
        location: loc,
        message: msg("structure.helicalCore.check.rollRadius", {
          mark: spec.mark,
          radius: dec(rollRadius),
          min: dec(rolling.minInnerRadius),
        }),
      });
    }
    if (spec.height > rolling.rollLength) {
      rollFindings.push({
        status: "violation",
        measured: spec.height,
        max: rolling.rollLength,
        location: loc,
        message: msg("structure.helicalCore.check.rollLength", {
          mark: spec.mark,
          height: dec(spec.height),
          max: dec(rolling.rollLength),
        }),
      });
    }
    if (spec.thickness > rolling.maxThickness) {
      rollFindings.push({
        status: "violation",
        measured: spec.thickness,
        max: rolling.maxThickness,
        location: loc,
        message: msg("structure.helicalCore.check.rollThickness", {
          mark: spec.mark,
          thickness: dec(spec.thickness),
          max: dec(rolling.maxThickness),
        }),
      });
    }
    if (rollFindings.length === 0) {
      rollFindings.push({
        status: "ok",
        location: loc,
        message: msg("structure.helicalCore.check.rollable", {
          mark: spec.mark,
          radius: dec(rollRadius),
          height: dec(spec.height),
          thickness: dec(spec.thickness),
        }),
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
    const dims = { mark: spec.mark, length: dec(box.length), width: dec(box.width) };
    checks.add(pluginRuleDef(STEEL_RULES.sheetFormat), [
      fits
        ? {
            status: "ok",
            location: loc,
            message: msg("structure.helicalCore.check.inSheetFormat", dims),
          }
        : {
            status: "violation",
            measured: box.length,
            location: loc,
            message: msg("structure.helicalCore.check.outOfSheetFormats", dims),
          },
    ]);
    return dev;
  };

  let stringer: HelicalStringerDevelopment | undefined;
  let innerStringer: HelicalStringerDevelopment | undefined;
  if (well) {
    const s = params.innerStringer;
    if (!(s.thickness < rf)) {
      return failure(
        msg("structure.helicalCore.error.innerStringerThickness", {
          thickness: dec(s.thickness),
          radius: dec(rf),
        }),
      );
    }
    innerStringer = addStringer({
      id: "helical-stringer-inner",
      mark: "LI1",
      name: msg("structure.helicalCore.part.innerStringer"),
      faceRadius: rf,
      side: "inward",
      height: s.height,
      thickness: s.thickness,
      topAboveNosing: s.topAboveNosing,
    });
  }
  if (params.outerStringer.enabled) {
    const s = params.outerStringer;
    stringer = addStringer({
      id: "helical-stringer",
      mark: "LE1",
      name: msg("structure.helicalCore.part.outerStringer"),
      faceRadius: h.outerRadius,
      side: "outward",
      height: s.height,
      thickness: s.thickness,
      topAboveNosing: s.topAboveNosing,
    });
  }

  // ---------------------------------------------------------------- main courante
  if (params.handrail.enabled) {
    const hr = params.handrail;
    const radius =
      h.outerRadius +
      (params.outerStringer.enabled ? params.outerStringer.thickness / 2 : 0) +
      hr.radiusOffset;
    if (!(radius > 0)) {
      return failure(msg("structure.helicalCore.error.handrailRadius"));
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
      name: msg("structure.helicalCore.part.handrail"),
      solid: { kind: "sweep" as const, path, section },
      section: msg("structure.helicalCore.section.round", { diameter: dec(hr.diameter, 0) }),
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
      msg("structure.helicalCore.note.handrail", {
        radius: dec(radius),
        length: dec(length),
        rho: dec(rho),
        tau: dec(tau * 1000, 3),
      }),
    );
  }

  // ---------------------------------------------------------------- porte-à-faux
  // Fût : marches en porte-à-faux. Jour central : marches portées par les deux limons, sauf si
  // le limon extérieur est désactivé (porte-à-faux sur le limon intérieur).
  const cantileverOn = !well
    ? msg("structure.helicalCore.cantilever.onColumn")
    : params.outerStringer.enabled
      ? null
      : msg("structure.helicalCore.cantilever.onInnerStringer");
  if (cantileverOn !== null) {
    const justification = params.cantileverJustification.trim();
    checks.add(pluginRuleDef(HELICAL_RULES.cantilever), [
      justification === ""
        ? {
            status: "violation",
            message: msg("structure.helicalCore.check.cantileverRequired", { on: cantileverOn }),
          }
        : {
            // Décision A12 (2026-09-30) : une justification n'est pas une vérification ;
            // l'avertissement reste affiché, justification jointe au résultat et au dossier.
            status: "violation",
            message: msg("structure.helicalCore.check.cantileverJustified", {
              on: cantileverOn,
              justification,
            }),
            justification,
          },
    ]);
  } else {
    notes.push(msg("structure.helicalCore.note.wellCarried"));
  }

  const exc = usesSteel ? deduceExecutionClass({ grade: params.grade, buttWeld: 0 }) : null;
  if (exc) {
    const reasons = joinMessages(exc.reasons);
    notes.push(
      reasons
        ? msg("structure.helicalCore.exc.note", { executionClass: exc.executionClass, reasons })
        : msg("structure.helicalCore.exc.noteBare", { executionClass: exc.executionClass }),
    );
  }
  // Assemblages : marches (et palier d'arrivée) sur le fût, ou portées par les limons.
  const carriers = [
    ...(!well ? ["helical-column"] : []),
    ...(innerStringer ? ["helical-stringer-inner"] : []),
    ...(stringer ? ["helical-stringer"] : []),
  ];
  const assemblies: PartAssembly[] = carriers.flatMap((id) => [
    ...stepping.treads.map((t) => ({ a: { partId: id }, b: { treadNumber: t.number } })),
    ...(h.landingOutline ? [{ a: { partId: id }, b: { partId: "landing-arrival" } }] : []),
  ]);
  const output: StructureOutput = {
    parts,
    checks: checks.results as RuleResult[],
    notes,
    ...(exc ? { executionClass: exc.executionClass } : {}),
    ...(removedBaseParts.length > 0 ? { removedBaseParts } : {}),
    ...(assemblies.length > 0 ? { assemblies } : {}),
  };
  return {
    output,
    ...(stringer ? { stringer } : {}),
    ...(innerStringer ? { innerStringer } : {}),
  };
}

export const HELICAL_CORE: StructureKind<HelicalCoreParams> = {
  kind: "helical-core",
  labelKey: "structure.helicalCore.label",
  family: "mixte",
  paramsSchema: HelicalCoreParamsSchema,
  // Jour central : limon extérieur activé par défaut (marches portées des deux côtés).
  defaults: (ctx) =>
    HelicalCoreParamsSchema.parse(
      ctx?.layout?.helical?.core === "well" ? { outerStringer: { enabled: true } } : {},
    ),
  build: (ctx, params) => buildHelicalCore(ctx, params).output,
  // Capacités (dette D4) : tracé hélicoïdal seulement ; limon extérieur facultatif au-delà de
  // R_e (hors emprise), limon intérieur dans le jour.
  capabilities: {
    layouts: ["helical"],
    lateralThickness: (p) => ({
      inner: 0,
      outer: p.outerStringer.enabled ? p.outerStringer.thickness : 0,
    }),
  },
};

/** Enregistrement (appelé au chargement de `structures/index.ts`, comme les autres plugins). */
export function registerHelicalCore(): void {
  if (!getStructure(HELICAL_CORE.kind)) registerStructure(HELICAL_CORE);
}

/** Projet dont la structure est `helical-core` (utilitaire de tests et d'exemples). */
export function withHelicalCore(project: Project, params: Record<string, unknown> = {}): Project {
  return { ...project, stair: { ...project.stair, structure: { kind: "helical-core", params } } };
}
