/**
 * Comparateur de variantes de structure (CHALLENGE P2, base du jalon 3c).
 *
 * Même **épure** (site, tracé, ligne de foulée, découpage) : seule `stair.structure.kind`
 * change ; raccords et balancement sont recalculés par le pipeline pour chaque variante (la
 * variante M3 automatique dépend de la structure). Grandeurs physiques d'abord : masse,
 * surface, nombre de pièces, pièces uniques, cordons, plis, coupes, perçages, classe
 * d'exécution, violations du contrôle de conception et du prédimensionnement indicatif. Les
 * **euros** ne sont calculés que si le profil d'atelier porte un barème complet (taux horaire et
 * temps unitaires, prix matière des matériaux présents, prix de finition si de l'acier peint ou
 * galvanisé est présent) ; sinon `cost` vaut `null` et `costMissing` liste les champs manquants.
 * La finition des pièces bois n'est pas chiffrée (non modélisée).
 *
 * **Même épure, jour adapté** (jalon 5b, critère d'acceptation n° 2, CHALLENGE P2) :
 * `compareEpure` garde le site, la ligne de foulée et le nombre de marches, mais adapte le
 * raccord de jour de chaque variante à ce que sa structure sait construire (poteau d'angle pour
 * les limons droits et les profilés — un UPN ne se cintre pas à petit rayon, C §2.3 ; poteau
 * élargi pour les profilés, décision A13 —, jour en arc pour un débillardé, G7) ; le tracé et le balancement sont recalculés par variante (variante
 * M3 comprise) et les **écarts d'épure** sont listés.
 *
 * Module non réexporté par `structures/index.ts` (il dépend du pipeline, qui dépend des
 * structures) : il est exporté par l'index du paquet.
 */
import {
  dec,
  messageEquals,
  msg,
  textMessage,
  translatorFor,
  type Message,
  type MessageParam,
} from "@blondel/i18n";
import {
  findSection,
  sectionsOf,
  SECTION_FAMILIES,
  type SectionFamily,
} from "../catalog/sections.js";
import type { Model, Part, Severity, Stepping } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { InnerCorner, Project } from "../model/project.js";
import { fabricatedParts } from "../parts/components.js";
import { buildModel } from "../pipeline/build.js";
import { layoutAccepts, newelLabel, newelSatisfies, withNewels } from "../project/newel.js";
import { resolveProfileNewel } from "../project/structureChoice.js";
import { isDebillardeStructure } from "../stepping/stepping.js";
import { minProfileBendRadius } from "../workshop/metal.js";
import { PRECHECK_RULE_IDS, precheckResults } from "../precheck/checks.js";
import { precheckModel } from "../precheck/stringers.js";
import type { PrecheckSettings } from "../precheck/settings.js";
import { COST_TIME_FIELDS, type CostRates } from "../workshop/costs.js";
import { isWoodMaterial, resolveWorkshopProfile } from "../workshop/profile.js";
import {
  QUANTITY_MASS_KG,
  QUANTITY_STOCK_VOLUME_M3,
  QUANTITY_SURFACE_M2,
  QUANTITY_VOLUME_M3,
} from "./quantities.js";
import { getStructure } from "./registry.js";
import {
  IDENTICAL_TOLERANCE,
  QUANTITY_BENDS,
  QUANTITY_BUTT_WELD_MM,
  QUANTITY_CUTS,
  QUANTITY_HOLES,
  QUANTITY_TREATED_SURFACE_M2,
  QUANTITY_WELD_MM,
  groupIdenticalFlats,
} from "./steelCommon.js";

export interface VariantCost {
  /** Total € HT (matière + main-d'œuvre + finition). */
  readonly total: number;
  readonly material: number;
  readonly labour: number;
  readonly finish: number;
  /** Heures d'atelier estimées. */
  readonly hours: number;
}

export interface VariantSummary {
  readonly kind: string;
  /** Libellé de la structure (`structure.<kind>.label`), identifiant brut pour un plugin inconnu. */
  readonly label: Message;
  readonly family: "bois" | "metal" | "mixte" | null;
  /** Masse totale (kg) ; pièces sans masse connue ignorées (`massUnknown`). */
  readonly massKg: number;
  readonly massUnknown: number;
  /** Surface à traiter (acier) ou de référence (bois), m². */
  readonly surfaceM2: number;
  readonly partCount: number;
  /** Nombre de pièces différentes (développés identiques à 0,5 mm, sinon section et débit). */
  readonly uniqueParts: number;
  readonly weldMm: number;
  readonly buttWeldMm: number;
  readonly bends: number;
  readonly cuts: number;
  readonly holes: number;
  /** Classe d'exécution EN 1090-2 (structures métal), `null` sinon. */
  readonly executionClass: "EXC1" | "EXC2" | null;
  /** Violations du contrôle de conception (hors prédimensionnement), par sévérité effective. */
  readonly violations: Readonly<Record<Severity, number>>;
  /** Prédimensionnement indicatif des limons (toutes structures) : limons évalués, violations. */
  readonly precheck: {
    readonly beams: number;
    readonly violations: Readonly<Record<Severity, number>>;
  };
  readonly errors: readonly Message[];
  /** Coût en € HT si le barème de l'atelier est complet, sinon `null`. */
  readonly cost: VariantCost | null;
  /** Champs du barème manquants pour chiffrer cette variante. */
  readonly costMissing: readonly string[];
  readonly model: Model;
}

export interface CompareOptions {
  /** Paramètres par structure ; défaut : ceux du projet pour sa structure, `{}` sinon. */
  readonly params?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Réglages du prédimensionnement appliqué à toutes les variantes. */
  readonly precheck?: Partial<PrecheckSettings>;
}

const sum = (parts: readonly Part[], key: string): number =>
  parts.reduce((s, p) => s + (p.quantities[key] ?? 0), 0);

const zeroes = (): Record<Severity, number> => ({ bloquant: 0, avertissement: 0, conseil: 0 });

/** Nombre de pièces différentes. */
export function countUniqueParts(parts: readonly Part[]): number {
  const withFlat = parts.filter((p) => p.flat);
  const flatGroups = groupIdenticalFlats(withFlat).length;
  const keys = new Set<string>();
  const r = (x: number | undefined): number => Math.round((x ?? 0) / IDENTICAL_TOLERANCE);
  for (const p of parts) {
    if (p.flat) continue;
    // Section : `Message` sérialisé (mêmes clé et paramètres arrondis ⇒ même désignation).
    keys.add(
      `${p.category}|${p.material}|${p.section ? JSON.stringify(p.section) : ""}|${r(p.stock?.length)}|${r(p.stock?.width)}|${r(p.stock?.thickness)}|${p.quantities[QUANTITY_HOLES] ?? 0}`,
    );
  }
  return flatGroups + keys.size;
}

/** Coût d'une variante : `null` si le barème est incomplet (champs manquants listés). */
export function variantCost(
  rates: CostRates,
  m: {
    readonly steelKg: number;
    readonly woodM3: number;
    /** Surface à finir (acier peint ou galvanisé), m² : tarifée `finishPricePerM2`. */
    readonly surfaceM2: number;
    readonly cuts: number;
    readonly weldMm: number;
    readonly bends: number;
    readonly holes: number;
    readonly uniqueParts: number;
  },
): { cost: VariantCost | null; missing: string[] } {
  const missing: string[] = [];
  if (rates.hourlyRate === undefined) missing.push("hourlyRate");
  for (const f of COST_TIME_FIELDS) if (rates[f] === undefined) missing.push(f);
  if (m.steelKg > 0 && rates.steelPricePerKg === undefined) missing.push("steelPricePerKg");
  if (m.woodM3 > 0 && rates.woodPricePerM3 === undefined) missing.push("woodPricePerM3");
  if (m.surfaceM2 > 0 && rates.finishPricePerM2 === undefined) missing.push("finishPricePerM2");
  if (missing.length > 0) return { cost: null, missing };
  const minutes =
    m.cuts * rates.minutesPerCut! +
    (m.weldMm / 1000) * rates.minutesPerWeldMeter! +
    m.bends * rates.minutesPerBend! +
    m.holes * rates.minutesPerHole! +
    m.uniqueParts * rates.minutesPerUniquePart!;
  const hours = minutes / 60;
  const labour = hours * rates.hourlyRate!;
  const material =
    m.steelKg * (rates.steelPricePerKg ?? 0) + m.woodM3 * (rates.woodPricePerM3 ?? 0);
  const finish = m.surfaceM2 * (rates.finishPricePerM2 ?? 0);
  return { cost: { total: material + labour + finish, material, labour, finish, hours }, missing };
}

/**
 * Classe d'exécution EN 1090-2 d'un modèle (fonction unique du cœur, reprise par l'interface) :
 * `Model.executionClass` ; repli (modèle produit sans `executionClass`, ex. structure en
 * erreur ou modèle antérieur) : ligne EXC_CLASSE_EXECUTION du contrôle de conception. `null`
 * pour une structure sans acier.
 */
export function executionClassOf(
  model: Pick<Model, "executionClass" | "compliance">,
): "EXC1" | "EXC2" | null {
  if (model.executionClass) return model.executionClass;
  const line = model.compliance.results.find((r) => r.ruleId === "EXC_CLASSE_EXECUTION");
  // La classe (identifiant « EXC1 » / « EXC2 ») figure dans le texte du constat, quelle que soit
  // la langue : lecture sur sa traduction de référence.
  const m = line ? /EXC[12]/.exec(translatorFor("fr").t(line.message)) : null;
  return m ? (m[0] as "EXC1" | "EXC2") : null;
}

/**
 * Compare des variantes de structure (`kinds`, ex. `["wood-housed", "steel-flat",
 * "steel-profile"]`) sur la même épure que `project`.
 */
export function compareVariants(
  project: Project,
  kinds: readonly string[],
  options: CompareOptions = {},
): VariantSummary[] {
  return kinds.map((kind) => {
    const params =
      options.params?.[kind] ??
      (kind === project.stair.structure.kind ? project.stair.structure.params : {});
    const variant: Project = {
      ...project,
      stair: { ...project.stair, structure: { kind, params: { ...params } } },
    };
    return summarizeVariant(variant, options);
  });
}

/**
 * Grandeurs d'une variante déjà construite (`variant.stair.structure` = structure comparée) :
 * modèle, masses, surfaces, pièces, cordons, EXC, violations, prédimensionnement, coût.
 */
export function summarizeVariant(
  variant: Project,
  options: Pick<CompareOptions, "precheck"> = {},
): VariantSummary {
  const rates = resolveWorkshopProfile(variant.workshop).costs;
  const { kind } = variant.stair.structure;
  const plugin = kind === "none" ? undefined : getStructure(kind);
  const model = buildModel(variant);
  // Pièces fabriquées : une pièce finie faite de composantes (couches empilées, `componentOf`)
  // n'a ni masse ni matière propres, ses composantes les portent (aucun double compte).
  const parts = fabricatedParts(model.parts);
  let massKg = 0;
  let massUnknown = 0;
  let steelKg = 0;
  let woodM3 = 0;
  let surfaceM2 = 0;
  let finishedM2 = 0;
  for (const p of parts) {
    const mass = p.quantities[QUANTITY_MASS_KG];
    if (mass === undefined) massUnknown++;
    else massKg += mass;
    if (isWoodMaterial(p.material)) {
      woodM3 += p.quantities[QUANTITY_STOCK_VOLUME_M3] ?? p.quantities[QUANTITY_VOLUME_M3] ?? 0;
      surfaceM2 += p.quantities[QUANTITY_SURFACE_M2] ?? 0;
    } else if (p.material.startsWith("steel") || p.material.startsWith("stainless")) {
      steelKg += mass ?? 0;
      const treated = p.quantities[QUANTITY_TREATED_SURFACE_M2] ?? 0;
      surfaceM2 += treated;
      // Seul l'acier peint ou galvanisé est fini (acier brut, inox : pas de finition tarifée).
      if (p.material === "steel-painted" || p.material === "steel-galvanized") {
        finishedM2 += treated;
      }
    }
  }
  const violations = zeroes();
  const pre = zeroes();
  for (const r of model.compliance.results) {
    if (r.status !== "violation" || PRECHECK_RULE_IDS.has(r.ruleId)) continue;
    violations[r.severity]++;
  }
  // Prédimensionnement du modèle (`Model.precheck`, même calcul que le panneau et, pour un
  // plugin qui en fait un, que les lignes PRECHECK_*) ; recalculé seulement si des réglages
  // sont imposés.
  const beams = options.precheck
    ? precheckModel(variant, model, options.precheck).beams
    : (model.precheck?.beams ?? []);
  for (const r of precheckResults(variant, model.stepping, beams)) {
    if (r.status === "violation") pre[r.severity]++;
  }
  const uniqueParts = countUniqueParts(parts);
  const cuts = sum(parts, QUANTITY_CUTS);
  const weldMm = sum(parts, QUANTITY_WELD_MM);
  const bends = sum(parts, QUANTITY_BENDS);
  const holes = sum(parts, QUANTITY_HOLES);
  const { cost, missing } = variantCost(rates, {
    steelKg,
    woodM3,
    surfaceM2: finishedM2,
    cuts,
    weldMm,
    bends,
    holes,
    uniqueParts,
  });
  return {
    kind,
    label: plugin
      ? msg(plugin.labelKey)
      : kind === "none"
        ? msg("structure.common.compare.noneLabel")
        : textMessage(kind),
    family: plugin?.family ?? null,
    massKg,
    massUnknown,
    surfaceM2,
    partCount: parts.length,
    uniqueParts,
    weldMm,
    buttWeldMm: sum(parts, QUANTITY_BUTT_WELD_MM),
    bends,
    cuts,
    holes,
    executionClass: executionClassOf(model),
    violations,
    precheck: { beams: beams.length, violations: pre },
    errors: model.errors,
    cost,
    costMissing: missing,
    model,
  };
}

// ------------------------------------------------------------------ Même épure, jour adapté

/** Structures dont le limon de jour exige un poteau d'angle (jour en arc ou vif non construit). */
export const NEWEL_JOUR_STRUCTURES: ReadonlySet<string> = new Set([
  "wood-housed",
  "steel-flat",
  "steel-profile",
]);

/**
 * Côté du poteau d'angle substitué par défaut à un jour en arc : 100 mm, **à valider** (C §1.9 :
 * poteau bois fini de 90 à 100 mm, confiance faible ; aucune valeur métal sourcée).
 */
export const DEFAULT_ADAPTED_NEWEL_SIZE: Mm = 100;

/** Adaptation du raccord de jour d'un tournant pour rendre une structure constructible. */
export interface JourAdaptation {
  readonly turn: number;
  readonly from: InnerCorner;
  readonly to: InnerCorner;
  readonly reason: Message;
}

/** Épure effective d'une variante (après adaptation du jour et recalcul). */
export interface EpureSummary {
  readonly jours: readonly InnerCorner[];
  readonly riserCount: number;
  readonly rise: Mm;
  readonly going: Mm;
  readonly run: Mm;
  /** Méthode de chaque zone balancée (ex. `M3-quintic`). */
  readonly balancing: readonly string[];
  readonly balancedZones: Stepping["balancedZones"];
  /** Collet minimal des marches balancées (corde, arc), mm ; `null` sans marche balancée. */
  readonly minColletChord: Mm | null;
  readonly minColletArc: Mm | null;
}

export interface EpureVariantSpec {
  readonly kind: string;
  /** Paramètres du plugin ; défaut : ceux du projet pour sa structure, `{}` sinon. */
  readonly params?: Readonly<Record<string, unknown>>;
  /**
   * `adapt` (défaut) : raccord de jour adapté à la structure ; `keep` : épure inchangée, les
   * incompatibilités sont seulement signalées (la variante sort alors partielle).
   */
  readonly jour?: "adapt" | "keep";
}

export interface EpureCompareOptions extends Pick<CompareOptions, "precheck"> {
  /**
   * Côté du poteau d'angle (centré) substitué à un jour en arc ou vif (mm). Défaut :
   * `DEFAULT_ADAPTED_NEWEL_SIZE`, et pour `steel-profile` le **poteau élargi des profilés**
   * (décision A13, `resolveProfileNewel`), qui remplace aussi un poteau trop étroit.
   */
  readonly newelSize?: Mm;
  /**
   * Rayon du jour en arc substitué pour un débillardé (mm) ; défaut : rayon intérieur mini de
   * roulage du profil d'atelier + épaisseur du limon, arrondi aux 10 mm supérieurs (à valider).
   */
  readonly arcRadius?: Mm;
}

export interface EpureVariantSummary extends VariantSummary {
  readonly epure: EpureSummary;
  readonly adaptations: readonly JourAdaptation[];
  /** Incompatibilités de la structure avec l'épure (adaptées ou non). */
  readonly signals: readonly Message[];
  /** Écarts d'épure par rapport à la première variante (vide pour la première). */
  readonly deviations: readonly Message[];
}

const jourLabel = (c: InnerCorner): Message =>
  c.kind === "arc"
    ? msg("structure.common.compare.jour.arc", { radius: dec(c.radius, 0) })
    : c.kind === "newel"
      ? (c.offset ?? 0) > 0
        ? msg("structure.common.compare.jour.newelOffset", {
            size: dec(c.size, 0),
            offset: dec(c.offset ?? 0, 0),
          })
        : msg("structure.common.compare.jour.newel", { size: dec(c.size, 0) })
      : msg("structure.common.compare.jour.sharp");

/** Raison pour laquelle un limon de jour profilé ne suit pas un jour en arc (C §2.3). */
function profileArcReason(
  project: Project,
  params: Readonly<Record<string, unknown>>,
  radius: Mm,
): Message {
  const family: SectionFamily = (SECTION_FAMILIES as readonly string[]).includes(
    params["family"] as string,
  )
    ? (params["family"] as SectionFamily)
    : "UPN";
  const named = typeof params["section"] === "string" ? findSection(params["section"]) : undefined;
  const height = named?.h ?? Math.min(...sectionsOf(family).map((x) => x.h));
  const direction = family === "UPN" ? "flangeIn" : "flat";
  const dirLabel =
    direction === "flangeIn"
      ? msg("structure.common.compare.bendDirection.flangeIn")
      : msg("structure.common.compare.bendDirection.flat");
  const metal = resolveWorkshopProfile(project.workshop).metal;
  const cap = minProfileBendRadius(metal, family, direction, height);
  if (cap === null) {
    return msg("structure.common.compare.profileArc.noCapacity", { family, direction: dirLabel });
  }
  if ("outOfRange" in cap) {
    return msg("structure.common.compare.profileArc.outOfRange", {
      family,
      height: dec(cap.outOfRange, 0),
    });
  }
  if (radius < cap.radius) {
    return msg("structure.common.compare.profileArc.tooTight", {
      family,
      radius: dec(radius, 0),
      min: dec(cap.radius, 0),
      direction: dirLabel,
    });
  }
  return msg("structure.common.compare.profileArc.helical", {
    family,
    radius: dec(radius, 0),
    min: dec(cap.radius, 0),
  });
}

/**
 * Rayon de jour minimal roulable d'un limon débillardé : rayon intérieur mini de la rouleuse du
 * profil d'atelier + épaisseur du limon (paramètres `params` du plugin `kind` complétés par ses
 * défauts ; 0 si le plugin n'a pas d'épaisseur). Aucune valeur codée en dur ici.
 */
export function minRollableJourRadius(
  workshop: Project["workshop"],
  kind: string,
  params: Readonly<Record<string, unknown>>,
): Mm {
  const metal = resolveWorkshopProfile(workshop).metal;
  const parsed = getStructure(kind)?.paramsSchema.safeParse(params);
  const t = parsed?.success ? (parsed.data as Record<string, unknown>)["thickness"] : undefined;
  return metal.plateRolling.minInnerRadius + (typeof t === "number" ? t : 0);
}

/**
 * Rayon de jour en arc proposé pour un débillardé : `minRollableJourRadius` arrondi aux 10 mm
 * supérieurs (jour adapté du comparateur, jours en arc de l'assistant, décision A17).
 */
export function rollableJourRadius(
  workshop: Project["workshop"],
  kind: string,
  params: Readonly<Record<string, unknown>>,
): Mm {
  return Math.ceil(minRollableJourRadius(workshop, kind, params) / 10) * 10;
}

/**
 * Adapte le raccord de jour de l'épure à la structure `spec.kind` : poteau d'angle pour les
 * structures `NEWEL_JOUR_STRUCTURES` (jour en arc ou vif), jour en arc pour un débillardé (G7),
 * agrandi si son rayon est sous le rayon roulable (rayon intérieur mini de la rouleuse + e).
 * Le reste de l'épure (site, volées, ligne de foulée, découpage demandé) est inchangé.
 */
export function adaptJour(
  project: Project,
  spec: EpureVariantSpec,
  options: EpureCompareOptions = {},
): {
  readonly project: Project;
  readonly adaptations: readonly JourAdaptation[];
  readonly signals: readonly Message[];
} {
  const kind = spec.kind;
  const params =
    spec.params ?? (kind === project.stair.structure.kind ? project.stair.structure.params : {});
  const adapt = spec.jour !== "keep";
  const adaptations: JourAdaptation[] = [];
  const signals: Message[] = [];
  let newel: InnerCorner = {
    kind: "newel",
    size: options.newelSize ?? DEFAULT_ADAPTED_NEWEL_SIZE,
  };
  // Profilés : poteau élargi (décision A13) résolu sur la variante, section comprise ; il
  // remplace aussi un poteau existant qui ne reçoit pas l'aile.
  let unfitNewel: ((c: InnerCorner) => boolean) | null = null;
  if (kind === "steel-profile" && options.newelSize === undefined && adapt) {
    const variant: Project = {
      ...project,
      stair: { ...project.stair, structure: { kind, params: { ...params } } },
    };
    const resolved = resolveProfileNewel(variant, () => true);
    // Poteau élargi refusé par le tracé (volée centrale trop courte…) : poteau par défaut.
    if (resolved && !layoutAccepts(withNewels(variant, resolved.newel, () => true))) {
      signals.push(
        msg("structure.common.compare.wideNewelRefused", {
          newel: newelLabel(resolved.newel),
          size: dec(newel.size, 0),
        }),
      );
    } else if (resolved) {
      newel = resolved.newel;
      unfitNewel = (c) =>
        c.kind === "newel" && !newelSatisfies(c, kind, params, resolved.flangeWidth);
    }
  }
  const minRollableRadius = (): Mm => minRollableJourRadius(project.workshop, kind, params);
  const arcRadius = (): Mm =>
    options.arcRadius ?? rollableJourRadius(project.workshop, kind, params);
  const turns = project.stair.layout.turns.map((t, j) => {
    let target: InnerCorner | null = null;
    let reason: Message | null = null;
    if (unfitNewel?.(t.inner)) {
      target = newel;
      reason = msg("structure.common.compare.reason.newelTooNarrow", { jour: jourLabel(t.inner) });
    } else if (NEWEL_JOUR_STRUCTURES.has(kind) && t.inner.kind !== "newel") {
      target = newel;
      reason =
        t.inner.kind === "arc"
          ? kind === "steel-profile"
            ? profileArcReason(project, params, t.inner.radius)
            : msg("structure.common.compare.reason.arcUnsupported", { kind })
          : msg("structure.common.compare.reason.sharp");
    } else if (isDebillardeStructure(kind) && t.inner.kind !== "arc") {
      target = { kind: "arc", radius: arcRadius() };
      reason = msg("structure.common.compare.reason.wreathedNeedsArc", {
        jour: jourLabel(t.inner),
      });
    } else if (
      isDebillardeStructure(kind) &&
      t.inner.kind === "arc" &&
      t.inner.radius < minRollableRadius() - 1e-9
    ) {
      // Jour en arc trop serré pour la rouleuse (r_j − e < rayon mini) : arc agrandi.
      target = { kind: "arc", radius: arcRadius() };
      reason = msg("structure.common.compare.reason.belowRollingRadius", {
        radius: dec(t.inner.radius, 0),
      });
    }
    if (!target || !reason) return t;
    signals.push(
      adapt
        ? msg("structure.common.compare.signal.adapted", {
            turn: j + 1,
            reason,
            jour: jourLabel(target),
          })
        : msg("structure.common.compare.signal.kept", { turn: j + 1, reason }),
    );
    if (!adapt) return t;
    adaptations.push({ turn: j, from: t.inner, to: target, reason });
    return { ...t, inner: target };
  });
  const adapted: Project =
    adaptations.length === 0
      ? project
      : {
          ...project,
          stair: { ...project.stair, layout: { ...project.stair.layout, turns } },
        };
  return { project: adapted, adaptations, signals };
}

function epureOf(project: Project, model: Model): EpureSummary {
  const st = model.stepping;
  const winders = st.treads.filter((t) => t.kind === "winder");
  return {
    jours: project.stair.layout.turns.map((t) => t.inner),
    riserCount: st.riserCount,
    rise: st.rise,
    going: st.going,
    run: st.run,
    balancing: st.balancedZones.map((z) => z.method),
    balancedZones: st.balancedZones,
    minColletChord: winders.length > 0 ? Math.min(...winders.map((t) => t.colletChord)) : null,
    minColletArc: winders.length > 0 ? Math.min(...winders.map((t) => t.colletArc)) : null,
  };
}

/** Écarts d'épure de `e` par rapport à la référence `ref`. */
export function epureDeviations(ref: EpureSummary, e: EpureSummary): Message[] {
  const out: Message[] = [];
  // Écart signé : « +3,5 », « -2 », « 0 ».
  const signed = (x: number): MessageParam =>
    x > 0 ? msg("structure.common.compare.positive", { value: dec(x, 1) }) : dec(x, 1);
  e.jours.forEach((j, i) => {
    const r = ref.jours[i];
    if (r && !messageEquals(jourLabel(r), jourLabel(j))) {
      out.push(
        msg("structure.common.compare.deviation.jour", {
          turn: i + 1,
          jour: jourLabel(j),
          ref: jourLabel(r),
        }),
      );
    }
  });
  if (e.riserCount !== ref.riserCount) {
    out.push(
      msg("structure.common.compare.deviation.riserCount", {
        value: String(e.riserCount),
        ref: String(ref.riserCount),
      }),
    );
  }
  if (Math.abs(e.going - ref.going) > 0.05) {
    out.push(
      msg("structure.common.compare.deviation.going", {
        value: dec(e.going, 1),
        delta: signed(e.going - ref.going),
      }),
    );
  }
  if (Math.abs(e.run - ref.run) > 0.05) {
    out.push(
      msg("structure.common.compare.deviation.run", {
        value: dec(e.run, 0),
        delta: signed(e.run - ref.run),
      }),
    );
  }
  // Zones balancées en notation technique (« [3 ; 6] M3-quintic »), non traduite.
  const zoneText = (s: EpureSummary): string =>
    s.balancedZones.map((z) => `[${z.from} ; ${z.to}] ${z.method}`).join(", ");
  const zones = (s: EpureSummary): Message =>
    zoneText(s) === "" ? msg("structure.common.compare.zonesNone") : textMessage(zoneText(s));
  if (zoneText(e) !== zoneText(ref)) {
    out.push(
      msg("structure.common.compare.deviation.balancing", { zones: zones(e), ref: zones(ref) }),
    );
  }
  if (
    e.minColletChord !== null &&
    ref.minColletChord !== null &&
    Math.abs(e.minColletChord - ref.minColletChord) > 0.05
  ) {
    out.push(
      msg("structure.common.compare.deviation.minCollet", {
        value: dec(e.minColletChord, 1),
        delta: signed(e.minColletChord - ref.minColletChord),
      }),
    );
  }
  return out;
}

/**
 * Compare des variantes de structure sur la **même épure** (critère d'acceptation n° 2,
 * CHALLENGE P2) : même site, même ligne de foulée, même réglage du découpage ; le raccord de
 * jour est adapté à chaque structure (`adaptJour`), tracé et balancement recalculés, écarts
 * d'épure par rapport à la première variante listés.
 */
export function compareEpure(
  project: Project,
  specs: readonly EpureVariantSpec[],
  options: EpureCompareOptions = {},
): EpureVariantSummary[] {
  let ref: EpureSummary | null = null;
  return specs.map((spec) => {
    const params =
      spec.params ??
      (spec.kind === project.stair.structure.kind ? project.stair.structure.params : {});
    const adapted = adaptJour(project, spec, options);
    const variant: Project = {
      ...adapted.project,
      stair: {
        ...adapted.project.stair,
        structure: { kind: spec.kind, params: { ...params } },
      },
    };
    const summary = summarizeVariant(
      variant,
      options.precheck !== undefined ? { precheck: options.precheck } : {},
    );
    const epure = epureOf(variant, summary.model);
    const deviations = ref ? epureDeviations(ref, epure) : [];
    ref ??= epure;
    return {
      ...summary,
      epure,
      adaptations: adapted.adaptations,
      signals: adapted.signals,
      deviations,
    };
  });
}
