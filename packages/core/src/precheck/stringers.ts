/**
 * Prédimensionnement des limons d'un modèle, quelle que soit la structure (CHALLENGE P5) :
 * profilés du catalogue (`steel-profile`), plats découpés (`steel-flat` : épaisseur × hauteur
 * du plat), limons bois (`wood-housed`, classe de bois des réglages, « à valider »).
 *
 * Hypothèses [CALCUL Blondel, à valider] :
 * - chaque limon (`category: "stringer"`, avec développé) est une poutre inclinée sur deux
 *   appuis (ses extrémités), de pente nominale h / g du découpage ;
 * - portée horizontale : étendue du développé selon x (abscisse horizontale le long du limon
 *   pour les plats et le bois ; abscisse le long de l'axe de la barre pour un profilé, projetée
 *   par cos α) ;
 * - section d'un plat ou d'un limon bois : rectangle épaisseur × largeur du rectangle
 *   englobant minimal du développé (mortaises et perçages négligés : **section brute**) ;
 * - largeur reprise : la moitié de l'emmarchement E (deux limons) ;
 * - charge permanente en plan : masse des marches, contremarches, paliers et supports du modèle
 *   rapportée à l'aire en plan des marches, plus `extraPermanent`.
 * Les crémaillères (`carriage`) ne sont pas prédimensionnées (section entaillée : table FCBA).
 */
import { DEFAULT_LOCALE, dec, msg, translatorFor, type Message } from "@blondel/i18n";
import { signedArea } from "../geom2d/polygon.js";
import type { Part, RuleResult, Stepping } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { resolveContexts } from "../rules/contexts.js";
import { findSection, sectionInLabel } from "../catalog/sections.js";
import { minAreaRect } from "../structures/geom.js";
import { QUANTITY_MASS_KG, normalizeWoodQuantities } from "../structures/quantities.js";
import type { SteelGrade } from "../workshop/metal.js";
import {
  isWoodMaterial,
  resolveWorkshopProfile,
  type WorkshopProfile,
} from "../workshop/profile.js";
import { GRAVITY, analyzeInclinedBeam, type BeamSection } from "./beam.js";
import { precheckResults, type PrecheckedBeam } from "./checks.js";
import { stairLoads, type StairLoads } from "./loads.js";
import {
  DEFAULT_PRECHECK_SETTINGS,
  PrecheckSettingsSchema,
  steelMaterialOf,
  woodMaterialOf,
  type BeamMaterial,
  type PrecheckSettings,
} from "./settings.js";

const FR = translatorFor(DEFAULT_LOCALE);

const PERMANENT_CATEGORIES = new Set<Part["category"]>(["tread", "riser", "landing", "support"]);

/**
 * Charge permanente répartie en plan (kN/m²) : masse (`mass_kg`, bois normalisé par le profil
 * d'atelier) des marches, contremarches, paliers et supports / aire en plan des marches.
 */
export function permanentAreaLoad(
  parts: readonly Part[],
  stepping: Stepping,
  profile: WorkshopProfile,
): number {
  let area = 0;
  for (const t of stepping.treads) area += Math.abs(signedArea(t.outline));
  if (area <= 0) return 0;
  let mass = 0;
  for (const p of parts) {
    if (!PERMANENT_CATEGORIES.has(p.category)) continue;
    const q = normalizeWoodQuantities(p, profile).quantities;
    mass += q[QUANTITY_MASS_KG] ?? 0;
  }
  return (mass * GRAVITY) / 1000 / (area / 1e6);
}

/** Nuance repérée dans un libellé de section (`… (S355) …`), S235 par défaut. */
export function gradeInLabel(label: string | undefined): SteelGrade {
  return label && /S\s?355/.test(label) ? "S355" : "S235";
}

/** Contextes actifs du projet (catégorie de charge `auto`). */
export function activeContexts(project: Project, stepping: Stepping): string[] {
  return [...resolveContexts(project.compliance, stepping).active];
}

export interface StringerPrecheck {
  readonly beams: readonly PrecheckedBeam[];
  readonly results: readonly RuleResult[];
  readonly loads: StairLoads;
  readonly permanentArea: number;
  readonly notes: readonly Message[];
}

function xExtent(part: Part): number {
  const pts = part.flat!.outline.outer;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.x);
    hi = Math.max(hi, p.x);
  }
  return hi - lo;
}

/**
 * Portée horizontale d'un limon en profilé : le développé est la vue de l'âme dans le repère de
 * la barre (x le long de l'axe, y de 0 à h). Ses extrémités sont des coupes d'aplomb : l'étendue
 * totale en x vaut Δu / cos α + h·tan α (et la coupe de niveau au sol la rogne), mais la rive
 * haute (y = h) mesure exactement Δu / cos α. Repli : étendue totale × cos α.
 */
function profileSpanH(part: Part, h: Mm, cos: number): Mm {
  const pts = part.flat!.outline.outer;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (Math.abs(p.y - h) > 1e-6) continue;
    lo = Math.min(lo, p.x);
    hi = Math.max(hi, p.x);
  }
  return hi > lo ? (hi - lo) * cos : xExtent(part) * cos;
}

/**
 * Prédimensionnement indicatif des limons de `parts` (pièces d'un modèle). `settings` partiels
 * acceptés (défauts `DEFAULT_PRECHECK_SETTINGS`).
 */
export function precheckStringers(
  project: Project,
  stepping: Stepping,
  parts: readonly Part[],
  settingsInput: Partial<PrecheckSettings> = {},
): StringerPrecheck {
  const settings = PrecheckSettingsSchema.parse({ ...DEFAULT_PRECHECK_SETTINGS, ...settingsInput });
  const profile = resolveWorkshopProfile(project.workshop);
  const loads = stairLoads(settings, activeContexts(project, stepping));
  const permanentArea = permanentAreaLoad(parts, stepping, profile) + settings.extraPermanent;
  const slope = stepping.going > 0 ? stepping.rise / stepping.going : 0;
  const cos = Math.cos(Math.atan(slope));
  const tributaryWidth = project.stair.layout.width / 2;
  const beams: PrecheckedBeam[] = [];
  const notes: Message[] = [];
  let steelPlates = false;
  for (const p of parts) {
    if (p.category !== "stringer" || !p.flat) continue;
    // Désignation de la section lue dans son texte français (« UPN 200 (S355) … »), stable.
    const sectionText = p.section ? FR.t(p.section) : undefined;
    const catalog =
      sectionInLabel(sectionText) ?? (sectionText ? findSection(sectionText) : undefined);
    let section: BeamSection;
    let spanH: number;
    let material: BeamMaterial;
    let label: Message;
    if (catalog) {
      section = { area: catalog.area, i: catalog.iy, w: catalog.wy };
      spanH = profileSpanH(p, catalog.h, cos);
      const grade = gradeInLabel(sectionText);
      material = steelMaterialOf(grade, settings, profile.metal.density);
      label = msg("precheck.beam.profile", { mark: p.mark, section: catalog.name, grade });
    } else {
      const b = p.flat.thickness;
      const h = minAreaRect(p.flat.outline.outer).width;
      section = { area: b * h, i: (b * h ** 3) / 12, w: (b * h * h) / 6 };
      spanH = xExtent(p);
      if (isWoodMaterial(p.material)) {
        material = woodMaterialOf(settings, profile.wood.densities[p.material]);
      } else {
        const grade = gradeInLabel(sectionText);
        material = steelMaterialOf(grade, settings, profile.metal.density);
        steelPlates = true;
      }
      label = msg("precheck.beam.rough", {
        mark: p.mark,
        b: dec(b, 0),
        h: dec(h, 0),
        material: material.label,
      });
    }
    if (!(spanH > 1)) continue;
    const result = analyzeInclinedBeam({
      spanH,
      slope,
      section,
      material,
      tributaryWidth,
      permanentArea,
      loads,
      settings,
    });
    beams.push({ partId: p.id, label, result });
  }
  if (beams.length > 0) {
    notes.push(
      msg("precheck.note.loads", {
        qk: dec(loads.qk, 1),
        Qk: dec(loads.Qk, 1),
        source: loads.source,
        permanent: dec(permanentArea, 2),
      }),
    );
  }
  if (steelPlates && beams.length > 0) {
    notes.push(msg("precheck.note.plates"));
  }
  return {
    beams,
    results: precheckResults(project, stepping, beams),
    loads,
    permanentArea,
    notes,
  };
}

/**
 * Réglages du prédimensionnement portés par les paramètres d'une structure (`params.precheck`,
 * ex. `steel-profile`) ; `{}` s'ils sont absents ou invalides (défauts du cœur).
 */
export function structurePrecheckSettings(params: unknown): Partial<PrecheckSettings> {
  const raw =
    typeof params === "object" && params !== null
      ? (params as Readonly<Record<string, unknown>>)["precheck"]
      : undefined;
  if (raw === undefined) return {};
  const parsed = PrecheckSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/**
 * Raccourci : prédimensionnement des limons d'un modèle construit, **recalculé** par
 * `precheckStringers` (réglages imposés, ex. comparateur). Pour afficher le prédimensionnement
 * d'un modèle, lire `Model.precheck` (calculé par le pipeline, éventuellement par le plugin).
 */
export function precheckModel(
  project: Project,
  model: { readonly stepping: Stepping; readonly parts: readonly Part[] },
  settings: Partial<PrecheckSettings> = {},
): StringerPrecheck {
  return precheckStringers(project, model.stepping, model.parts, settings);
}
