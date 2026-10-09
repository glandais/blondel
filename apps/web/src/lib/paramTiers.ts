/**
 * Dictionnaire des niveaux de présence des paramètres (ADR-0009, spécification de contenu
 * `docs/ux/design_handoff_parcours_guide_libre/rendus/contenu.txt` §§ 1 à 3) :
 *
 * - **Essentiel** : visible dans l'étape guidée et en tête du panneau libre ;
 * - **Conception** : visible dans le panneau libre ; dans le guidé, sous « Plus de réglages »
 *   ou absent (l'automatique s'applique) ;
 * - **Atelier** : replié sous « Réglages d'atelier » dans le panneau libre, repris à l'étape 7.
 *
 * Pour chaque chemin du projet : niveau, section du parcours libre, place dans le guidé et
 * marqueur ◆ (valeur par défaut non sourcée « à valider »). Ni texte affiché, ni valeur métier :
 * seulement des chemins et des niveaux.
 *
 * Clés : chemin du projet joint par des points, indices de tableau remplacés par `*`
 * (`stair.layout.legs.*.length`) ; paramètres des plugins de structure sous
 * `stair.structure.params.<chemin>` ; éléments d'interface sans chemin préfixés par `ui:`. Une
 * entrée peut couvrir un sous-objet (`guards.infill.section`) : la recherche remonte au préfixe
 * le plus long.
 *
 * Sources des ◆ :
 * - paramètres des plugins de structure : déduits de `lib/paramLabels.ts` (aide
 *   `ui.param.toValidate`), une seule source ;
 * - garde-corps et rotation M6 : déclarés ici (seule source de ces marqueurs dans l'interface),
 *   d'après les défauts « à valider » du cœur cités en commentaire ;
 * - visserie du profil d'atelier (`workshop.fasteners.*`, QUESTIONS A27) : déclarée ici, valeurs
 *   présentes selon les assemblages du modèle (`lib/fasteners.ts`).
 *
 * Validation des ◆ (ADR-0009 point 9) : `toValidateStates` donne, pour chaque valeur ◆ du
 * projet, sa valeur effective (défauts compris) et si elle est validée
 * (`Project.validatedValues`, `isValueValidated` du cœur). Les compteurs ne comptent que les
 * valeurs **restantes** (non validées). Lecture du projet seulement, aucun calcul métier.
 */
import {
  ROTATION_DEFAULT_REACH,
  ROTATION_DEFAULT_STEEPNESS,
  isValueValidated,
  resolveAnchorKind,
  resolveCurvedMethod,
  woodCentralCurvedLayout,
  type Model,
  type Project,
  type ValidatedScalar,
  type WoodCentralParams,
} from "@blondel/core";
import { fastenerSettingPaths, fastenerSettingValue } from "./fasteners.js";
import { availableStructures } from "./optionalApi.js";
import { fieldText } from "./paramLabels.js";
import { GUIDED_STEPS, SECTION_IDS, type GuidedStep, type SectionId } from "./sectionIds.js";
import {
  deriveParamFields,
  getParam,
  layoutTraitsOf,
  safeDefaults,
  structureContext,
  withDefaults,
  type ParamPath,
} from "./structureForm.js";

/** Niveau de présence d'un paramètre. */
export type Tier = "essential" | "design" | "workshop";

/** Place dans une étape guidée : `more` = sous « Plus de réglages » (replié). */
export interface GuidedPlacement {
  readonly step: GuidedStep;
  readonly more: boolean;
}

export interface ParamTierEntry {
  readonly tier: Tier;
  /** Section du parcours libre où le paramètre s'édite (section principale). */
  readonly section: SectionId;
  /** Places dans le parcours guidé ; vide : absent du guidé. */
  readonly guided: readonly GuidedPlacement[];
  /** Valeur par défaut non sourcée, « à valider » (◆). */
  readonly toValidate?: boolean;
  /** Autres sections où la même valeur s'édite (même chemin du projet). */
  readonly alsoIn?: readonly SectionId[];
}

/** Mode d'affichage d'une section : tout (ancienne interface), panneau libre, étape guidée. */
export type Display =
  | { readonly kind: "all" }
  | { readonly kind: "free" }
  | { readonly kind: "guided"; readonly step: GuidedStep };

/** Emplacement d'un champ dans une section affichée. */
export type Placement = "main" | "more" | "workshop" | "hidden";

/** Préfixe des clés des paramètres de plugin de structure. */
export const STRUCTURE_PARAMS_PREFIX = "stair.structure.params.";

/** Aide qui marque, dans `paramLabels`, un paramètre de plugin « à valider ». */
const TO_VALIDATE_HINT = "ui.param.toValidate";

// ------------------------------------------------------------------ Constructeurs

const at = (step: GuidedStep): GuidedPlacement => ({ step, more: false });
const more = (step: GuidedStep): GuidedPlacement => ({ step, more: true });

interface EntryExtra {
  readonly toValidate?: boolean;
  readonly alsoIn?: readonly SectionId[];
}

function entry(
  tier: Tier,
  section: SectionId,
  guided: readonly GuidedPlacement[] = [],
  extra: EntryExtra = {},
): ParamTierEntry {
  return { tier, section, guided, ...extra };
}

const essential = (s: SectionId, g: readonly GuidedPlacement[] = [], x: EntryExtra = {}) =>
  entry("essential", s, g, x);
const design = (s: SectionId, g: readonly GuidedPlacement[] = [], x: EntryExtra = {}) =>
  entry("design", s, g, x);
const workshop = (s: SectionId, x: EntryExtra = {}) => entry("workshop", s, [], x);
const TV = { toValidate: true } as const;

// ------------------------------------------------------------------ Paramètres du projet

const TIERS: Readonly<Record<string, ParamTierEntry>> = {
  // --- Site (étape 1)
  "site.floorToFloor": essential("site", [at(1)]),
  "site.upperSlabThickness": essential("site", [at(1)]),
  // Trémie : l'entrée couvre le sous-objet (type, sommets d'une trémie tracée).
  "site.opening": essential("site", [at(1)]),
  "site.opening.x": essential("site", [at(1)]),
  "site.opening.y": essential("site", [at(1)]),
  "site.opening.sizeX": essential("site", [at(1)]),
  "site.opening.sizeY": essential("site", [at(1)]),
  "ui:site.openingPolygon": essential("site", [at(1)]),
  "ui:site.walls": essential("site", [at(1)]),
  "site.lowerFinish": design("site", [more(1)]),
  "site.upperFinish": design("site", [more(1)]),
  "ui:site.underlay": design("site", [more(1)]),

  // --- Tracé (étape 2)
  "stair.layout.kind": essential("layout", [at(2)]),
  "stair.layout.width": essential("layout", [at(2)]),
  "ui:layout.typology": essential("layout", [at(2)]),
  "stair.layout.turns.*.mode": essential("layout", [at(2)]),
  // Jour : type, rayon d'un jour arrondi, côté du poteau.
  "stair.layout.turns.*.inner": essential("layout", [at(2)]),
  "stair.layout.turns.*.inner.offset": design("layout"),
  "stair.layout.turns.*.direction": design("layout"),
  "stair.layout.legs.*.length": design("layout", [more(2)]),
  "ui:layout.realign": design("layout", [more(2)]),
  "ui:layout.addRemoveLeg": design("layout"),
  "ui:layout.turnSequence": design("layout"),
  "stair.walkline.mode": design("layout"),
  "stair.walkline.distance": design("layout"),
  "stair.walkline.side": design("layout"),
  // Hélicoïdal
  "stair.layout.direction": essential("layout", [at(2)]),
  "stair.layout.outerRadius": essential("layout", [at(2)]),
  "stair.layout.core": essential("layout", [at(2)]),
  "stair.layout.sweep": design("layout", [more(2)]),
  "stair.layout.sweep.mode": design("layout", [more(2)]),
  "stair.layout.sweep.count": essential("layout", [at(2)]),
  "stair.layout.sweep.degrees": essential("layout", [at(2)]),
  "stair.layout.startAngle": design("layout", [more(2)]),
  "stair.layout.landing": design("layout", [more(2)]),
  "stair.layout.landing.angle": design("layout", [more(2)]),

  // --- Découpage (étape 3)
  "stair.stepping.riserCount": essential("stepping", [at(3)]),
  "stair.stepping.targetRise": essential("stepping", [at(3)]),
  "stair.stepping.targetGoing": essential("stepping", [at(3)]),
  "stair.stepping.firstRiseOffset": design("stepping", [more(3)]),

  // --- Balancement (étape 2, « Plus » ; la méthode reste dans le panneau libre, ADR-0009 point 6)
  "stair.balancing.method": design("balancing"),
  "stair.balancing.variant": design("balancing"),
  "stair.balancing.herseAngle": design("balancing"),
  // Portée λ et raideur p de la rotation M6 : « [choix Blondel, à valider] » sans source
  // (packages/core/src/balancing/m6.ts, défauts de la portée et de la raideur).
  "stair.balancing.rotationReach": design("balancing", [], TV),
  "stair.balancing.rotationSteepness": design("balancing", [], TV),
  "stair.balancing.windersPerSide": design("balancing", [more(2)]),
  "stair.balancing.targetCollet": design("balancing", [more(2)]),

  // --- Marches (étape 4)
  "stair.treads.thickness": essential("treads", [at(4)]),
  "stair.treads.nosing": essential("treads", [at(4)]),
  "stair.treads.risers": essential("treads", [at(4)]),
  "stair.treads.riserThickness": design("treads", [more(4)]),
  // Essence des marches bois des pièces de base (structure « aucune », plugins à marches bois
  // sans essence propre) : rendue par la section « Marches » (`treadsMaterialApplies`).
  "stair.treads.material": essential("treads", [at(4)]),

  // --- Structure (étape 5) : le choix ; les paramètres du plugin sont plus bas.
  "stair.structure.kind": essential("structure", [at(5)]),

  // --- Garde-corps (étape 6). Les ◆ reprennent les défauts « à valider » (aucune source, choix
  // Blondel) de packages/core/src/guards/spec.ts : matériau, entraxe des balustres, épaisseurs
  // de panneaux, axe depuis le bord de l'emmarchement, recul depuis le nu de la trémie, poteaux
  // (section, entraxe maximal, angle de poteau d'angle), tolérance de détection des murs.
  guards: essential("guards", [at(6)]),
  "guards.flight.enabled": essential("guards", [at(6)]),
  "guards.opening.enabled": essential("guards", [at(6)]),
  "guards.infill.kind": essential("guards", [at(6)]),
  "guards.handrail.wallSides": essential("guards", [at(6)]),
  "guards.material": essential("guards", [at(6)], TV),
  "guards.flight.inner": design("guards", [more(6)]),
  "guards.flight.outer": design("guards", [more(6)]),
  "guards.flight.height": design("guards", [more(6)]),
  "guards.opening.height": design("guards", [more(6)]),
  "guards.infill.count": design("guards", [more(6)]),
  "guards.infill.diameter": design("guards", [more(6)]),
  "guards.infill.section": design("guards", [more(6)]),
  "guards.infill.bottomGap": design("guards", [more(6)]),
  "guards.infill.spacing": design("guards", [more(6)], TV),
  "guards.infill.thickness": design("guards", [more(6)], TV),
  "guards.handrail.section": design("guards", [more(6)]),
  "guards.handrail.height": design("guards", [more(6)]),
  "guards.handrail.extensions.bottom": design("guards", [more(6)]),
  "guards.handrail.extensions.top": design("guards", [more(6)]),
  "guards.flight.edgeOffset": workshop("guards", TV),
  "guards.opening.setback": workshop("guards", TV),
  "guards.posts.size": workshop("guards", TV),
  "guards.posts.maxSpacing": workshop("guards", TV),
  "guards.posts.cornerAngle": workshop("guards", TV),
  "guards.wallTolerance": workshop("guards", TV),
  "guards.infill.panelGap": workshop("guards"),
  "guards.infill.holeDiameter": workshop("guards"),
  "guards.handrail.wallClearance": workshop("guards"),

  // --- Visserie du profil d'atelier (QUESTIONS A27) : réglée dans « Réglages d'atelier » de la
  // section Structure (et à l'étape 7). Aucune valeur sourcée (packages/core/src/workshop/
  // fasteners.ts, DEFAULT_FASTENER_PROFILE « à valider ») : toutes ◆. L'entrée `joints` couvre
  // `workshop.fasteners.joints.<assemblage>.<champ>` (préfixe le plus long).
  "workshop.fasteners.holeClearance": workshop("structure", TV),
  "workshop.fasteners.nominalDiameters": workshop("structure", TV),
  "workshop.fasteners.bracketSpacing": workshop("structure", TV),
  "workshop.fasteners.unknownWallLoadBearing": workshop("structure", TV),
  "workshop.fasteners.joints": workshop("structure", TV),

  // --- Contexte de contrôle (pas d'étape : réglé par l'assistant, modifiable depuis le contrôle)
  "compliance.contexts": design("compliance"),
  "ui:compliance.usage": design("compliance"),
  "compliance.profile": design("compliance"),
  "compliance.referenceDate": design("compliance"),
  "compliance.overrides": design("compliance"),
};

/** Clés du dictionnaire des paramètres du projet et des éléments `ui:` (hors plugins). */
export const TIER_KEYS: readonly string[] = Object.keys(TIERS);

// ------------------------------------------------------------------ Paramètres des plugins

/**
 * Paramètres communs aux plugins de structure (chemin du paramètre joint par des points).
 * Choix non dictés mot pour mot par la spécification :
 * - `strengthClass` (classe de résistance du bois découpé, `wood-cut`) : Conception, absent du
 *   guidé (choix de matériau, non d'atelier) ;
 * - `newel.bottomExtension` / `newel.topExtension` (prolongements du poteau) : Atelier, comme
 *   les prolongements des limons ;
 * - `precheck.extraPermanent` : Atelier (« les autres réglages du prédimensionnement »).
 */
const S = "structure" as const;
const STRUCTURE_COMMON: Readonly<Record<string, ParamTierEntry>> = {
  grade: essential(S, [at(5)]),
  finish: essential(S, [at(5)]),
  family: essential(S, [at(5)]),
  // Essence et matériau des marches : aussi dans « Marches » (ADR-0009 point 5).
  material: essential(S, [at(4), at(5)], { alsoIn: ["treads"] }),
  treadKind: essential(S, [at(4)], { alsoIn: ["treads"] }),
  noseRadius: design(S, [more(4)], { alsoIn: ["treads"] }),
  section: design(S, [more(5)]),
  thickness: design(S, [more(5)]),
  upperOffset: design(S, [more(5)]),
  lowerOffset: design(S, [more(5)]),
  strengthClass: design(S),
  cantileverJustification: design(S),
  startExtension: workshop(S),
  endExtension: workshop(S),
  splice: workshop(S),
  housingDepth: workshop(S),
  residual: workshop(S),
  residualFallback: workshop(S),
  inset: workshop(S),
  miterTolerance: workshop(S),
  // Poteau : section, côté, assemblage, pied en Conception ; le reste en Atelier.
  newel: workshop(S),
  "newel.section": design(S, [more(5)]),
  "newel.size": design(S, [more(5)]),
  "newel.joint": design(S, [more(5)]),
  "newel.foot": design(S, [more(5)]),
  // Supports de marche : type, fixation et longueur d'appui minimale (`minLength`, celle que
  // contrôle FAB_SUPPORT_LONGUEUR_MIN, ADR-0009 point 7) visibles ; aile, épaisseur, perçage,
  // pince, marges et appui au-delà des ailes des profilés en I (`minBearing`) en Atelier.
  supports: workshop(S),
  "supports.kind": design(S),
  "supports.fixing": design(S),
  "supports.minLength": design(S),
  // Marche en tôle pliée sur son support (QUESTIONS A31) : vissée ou soudée en Conception, le
  // perçage des vis en Atelier ; seulement avec des marches en tôle pliée.
  "supports.treadFixing": design(S),
  "supports.treadHoleDiameter": workshop(S),
  // Platines : cases pied / tête visibles, dimensions en Atelier.
  plates: workshop(S),
  "plates.foot": design(S),
  "plates.head": design(S),
  // Tôle pliée : profil et épaisseur visibles.
  folded: workshop(S),
  "folded.profile": design(S, [more(5)]),
  "folded.thickness": design(S, [more(5)]),
  // Limon débillardé : tous ses réglages en Atelier.
  curved: workshop(S),
  // Prédimensionnement : jeu de charges et catégorie visibles (ADR-0009 point 8).
  precheck: workshop(S),
  "precheck.loadSet": design(S),
  "precheck.category": design(S),
};

/**
 * Variantes propres à un plugin. Hélicoïdal à fût (`helical-core`) : matériaux, dimensions
 * visibles (hauteur des limons, main courante) en Conception sous « Plus » de l'étape 5 ;
 * épaisseurs, prolongement du fût, hauteur au-dessus des nez et décalage radial de la main
 * courante (réglages ◆ ou d'ajustement) en Atelier ; matériau des marches à l'étape 4.
 */
const STRUCTURE_BY_KIND: Readonly<Record<string, Readonly<Record<string, ParamTierEntry>>>> = {
  // Limon central métal (QUESTIONS A29) : section (tube ou caisson) en Essentiel à l'étape 5,
  // avec la nuance, la finition et le matériau des marches (entrées communes) ; dimensions
  // hors tout, type de support, décalage de l'axe, dessus de poutre et justification du double
  // porte-à-faux en Conception sous « Plus » ; le reste (épaisseurs, entretoises, évents,
  // tronçons, consoles, perçages, palier) en Atelier. Les préfixes `trace`, `section` et `beam`
  // l'emportent sur l'entrée commune `section` (section du catalogue des profilés).
  "steel-central": {
    trace: workshop(S),
    "trace.lateralOffset": design(S, [more(5)]),
    section: workshop(S),
    "section.kind": essential(S, [at(5)]),
    "section.height": design(S, [more(5)]),
    "section.width": design(S, [more(5)]),
    beam: workshop(S),
    "beam.topOffset": design(S, [more(5)]),
    "supports.kind": design(S, [more(5)]),
    cantileverJustification: design(S, [more(5)]),
    // Borne basse de l'entraxe des entretoises du caisson (QUESTIONS A32 (a)) : Atelier ◆.
    "section.diaphragmMinSpacing": workshop(S),
  },
  // Limon central bois (QUESTIONS A29, vague 2) : section (lamellé-collé ou massif), largeur et
  // essence en Essentiel à l'étape 5 ; classe, décalage de l'axe, épaisseur des lamelles, reste
  // sous entaille, entaille arrière, boulons par marche, présence des sabots et justifications
  // en Conception sous « Plus » ; le reste (repli FCBA, seuil des plis minces, perçages, pinces,
  // pas d'arrondi, tôle et dimensions des sabots) en Atelier. Chaque chemin a son entrée ;
  // l'essence (`material`, Essentiel, aussi dans « Marches ») garde l'entrée commune, comme
  // `wood-cut`.
  "wood-central": {
    strengthClass: design(S, [more(5)]),
    trace: workshop(S),
    "trace.lateralOffset": design(S, [more(5)]),
    section: workshop(S),
    "section.kind": essential(S, [at(5)]),
    "section.width": essential(S, [at(5)]),
    "section.residual": design(S, [more(5)]),
    "section.residualFallback": workshop(S),
    "section.lamellaThickness": design(S, [more(5)]),
    "section.thinPlyMax": workshop(S),
    // Filière d'une poutre cintrée (QUESTIONS A33 (e)) : choix en Conception sous « Plus »,
    // épaisseur des couches empilées à côté des lamelles ; seuil du moule et surcote en Atelier.
    "section.curvedMethod": design(S, [more(5)]),
    "section.mouldMaxWidth": workshop(S),
    "section.layerThickness": design(S, [more(5)]),
    "section.dressingAllowance": workshop(S),
    // Pente de fil maximale des planches d'une couche empilée (QUESTIONS A35 (h)) : Atelier ◆.
    "section.maxGrainSlope": workshop(S),
    notch: workshop(S),
    "notch.rearDepth": design(S, [more(5)]),
    bolts: workshop(S),
    "bolts.perTread": design(S, [more(5)]),
    "bolts.holeDiameter": workshop(S),
    "bolts.edgeDistance": workshop(S),
    "bolts.minSpacing": workshop(S),
    "bolts.protrusion": workshop(S),
    "bolts.lengthStep": workshop(S),
    // Tire-fonds des marches basses (QUESTIONS A34 (a)) : réglages d'atelier ◆.
    lagScrews: workshop(S),
    "lagScrews.pilotDiameter": workshop(S),
    "lagScrews.minAnchorage": workshop(S),
    "lagScrews.tipCover": workshop(S),
    "lagScrews.maxLength": workshop(S),
    // Entraxe et pince avant des tire-fonds au plus sévère des règles de l'EC5 (A35 (l)).
    "lagScrews.minSpacing": workshop(S),
    "lagScrews.endDistance": workshop(S),
    anchors: workshop(S),
    "anchors.foot": design(S, [more(5)]),
    "anchors.head": design(S, [more(5)]),
    // Type d'ancrage (sabot en U ou platine à âme noyée, QUESTIONS A33 (f), A34 (c)) : choix
    // en Conception ; dimensions de la platine en Atelier ◆.
    "anchors.kind": design(S, [more(5)]),
    "anchors.grade": workshop(S),
    "anchors.finish": workshop(S),
    "anchors.thickness": workshop(S),
    "anchors.cheekDepth": workshop(S),
    "anchors.length": workshop(S),
    "anchors.anchors": workshop(S),
    "anchors.anchorHoleDiameter": workshop(S),
    "anchors.bolts": workshop(S),
    "anchors.boltHoleDiameter": workshop(S),
    "anchors.holeEdgeDistance": workshop(S),
    "anchors.plate": workshop(S),
    "anchors.plate.thickness": workshop(S),
    "anchors.plate.width": workshop(S),
    "anchors.plate.webThickness": workshop(S),
    "anchors.plate.webDepth": workshop(S),
    "anchors.plate.webLength": workshop(S),
    "anchors.plate.pins": workshop(S),
    "anchors.plate.pinDiameter": workshop(S),
    "anchors.plate.pinHoleDiameter": workshop(S),
    // Âme de pied prolongée sous les marches 2 et 3 (QUESTIONS A35 (a)) : Atelier ◆.
    "anchors.plate.footWebLength": workshop(S),
    // Réduction de Hankinson du prédimensionnement des couches empilées (A35 (j)) : Atelier ◆.
    grainAngle: workshop(S),
    "grainAngle.strengthRatio": workshop(S),
    "grainAngle.strengthExponent": workshop(S),
    "grainAngle.modulusRatio": workshop(S),
    "grainAngle.modulusExponent": workshop(S),
    cantileverJustification: design(S, [more(5)]),
    laminationJustification: design(S, [more(5)]),
  },
  "helical-core": {
    column: workshop(S),
    "column.material": design(S, [more(5)]),
    "column.wood": design(S, [more(5)]),
    treads: workshop(S),
    "treads.material": essential(S, [at(4)], { alsoIn: ["treads"] }),
    innerStringer: workshop(S),
    "innerStringer.height": design(S, [more(5)]),
    outerStringer: workshop(S),
    "outerStringer.enabled": design(S, [more(5)]),
    "outerStringer.height": design(S, [more(5)]),
    handrail: workshop(S),
    "handrail.enabled": design(S, [more(5)]),
    "handrail.material": design(S, [more(5)]),
    "handrail.height": design(S, [more(5)]),
    "handrail.diameter": design(S, [more(5)]),
  },
};

/** Paramètre de plugin hors dictionnaire : Atelier, dans la section Structure. */
const STRUCTURE_FALLBACK: ParamTierEntry = workshop(S);

/** Entrée de la table par le préfixe le plus long (`undefined` si aucun). */
function lookup(
  table: Readonly<Record<string, ParamTierEntry>>,
  key: string,
): { key: string; entry: ParamTierEntry } | undefined {
  let k = key;
  for (;;) {
    const e = table[k];
    if (e !== undefined) return { key: k, entry: e };
    const i = k.lastIndexOf(".");
    if (i < 0) return undefined;
    k = k.slice(0, i);
  }
}

/**
 * Entrée d'un paramètre de plugin de structure : variantes du plugin d'abord, puis entrées
 * communes (préfixe le plus long, exemple `newel.bolts` → `newel`), sinon Atelier. Le ◆ est
 * déduit de `paramLabels` (aide `ui.param.toValidate` du plugin).
 */
export function structureParamEntry(kind: string, paramPath: readonly string[]): ParamTierEntry {
  const key = paramPath.join(".");
  const variant = STRUCTURE_BY_KIND[kind];
  const exact = variant?.[key] ?? STRUCTURE_COMMON[key];
  const base =
    exact ??
    (variant ? lookup(variant, key)?.entry : undefined) ??
    lookup(STRUCTURE_COMMON, key)?.entry ??
    STRUCTURE_FALLBACK;
  const tv = fieldText(kind, paramPath)?.hint === TO_VALIDATE_HINT;
  if (tv) return { ...base, toValidate: true };
  if (base.toValidate === undefined) return base;
  const { toValidate: _tv, ...rest } = base;
  return rest;
}

/**
 * Le paramètre de plugin a-t-il une entrée dans le dictionnaire (exacte ou par un préfixe
 * déclaré), et non le repli « Atelier » ?
 */
export function hasStructureParamEntry(kind: string, paramPath: readonly string[]): boolean {
  const key = paramPath.join(".");
  const variant = STRUCTURE_BY_KIND[kind];
  return (
    (variant !== undefined && lookup(variant, key) !== undefined) ||
    lookup(STRUCTURE_COMMON, key) !== undefined
  );
}

/**
 * Clé de l'entrée retenue pour une clé (préfixe le plus long), `undefined` si aucune. Les
 * paramètres de plugin ne passent pas par ici (voir `structureParamEntry`).
 */
export function tierEntryKey(key: string): string | undefined {
  return lookup(TIERS, key)?.key;
}

/** Clé du dictionnaire d'un chemin du projet (indices remplacés par `*`). */
export function paramKey(path: readonly (string | number)[]): string {
  return path.map((p) => (typeof p === "number" ? "*" : p)).join(".");
}

/**
 * Entrée d'une clé : préfixe le plus long du dictionnaire. Une clé de paramètre de plugin
 * (`stair.structure.params.…`) donne l'entrée commune aux plugins (sans variante : pour un
 * plugin donné, préférer `structureParamEntry`).
 */
export function tierEntry(key: string): ParamTierEntry | undefined {
  if (key.startsWith(STRUCTURE_PARAMS_PREFIX)) {
    return structureParamEntry("", key.slice(STRUCTURE_PARAMS_PREFIX.length).split("."));
  }
  return lookup(TIERS, key)?.entry;
}

/**
 * Emplacement d'un champ selon le mode d'affichage. Guidé, étape 7 : les réglages d'atelier
 * sont à plat (`main`), car l'étape 7 les range déjà tous sous son propre repli « Plus de
 * réglages » (`FabricationStep`) : pas de second repli imbriqué.
 */
export function placementOf(e: ParamTierEntry, display: Display): Placement {
  switch (display.kind) {
    case "all":
      return "main";
    case "free":
      return e.tier === "workshop" ? "workshop" : "main";
    case "guided": {
      const g = e.guided.find((x) => x.step === display.step);
      if (g !== undefined) return g.more ? "more" : "main";
      return display.step === 7 && e.tier === "workshop" ? "main" : "hidden";
    }
  }
}

/** La valeur de cette clé est-elle une valeur par défaut « à valider » (◆) ? */
export function isToValidate(key: string): boolean {
  return tierEntry(key)?.toValidate === true;
}

// ------------------------------------------------------------------ Valeurs ◆ d'un projet

export interface ToValidateItem {
  readonly key: string;
  readonly path: readonly (string | number)[];
  readonly section: SectionId;
  readonly steps: readonly GuidedStep[];
}

function item(key: string, path: readonly (string | number)[], e: ParamTierEntry): ToValidateItem {
  return {
    key,
    path,
    section: e.section,
    steps: [...new Set(e.guided.map((g) => g.step))],
  };
}

/** Chemins des garde-corps présents dans ce projet (champs affichés par `GuardsSection`). */
function guardPaths(project: Project): (readonly string[])[] {
  const g = project.guards;
  if (g === undefined) return [];
  const infill = g.infill.kind;
  return [
    ["guards", "material"],
    ["guards", "flight", "edgeOffset"],
    ["guards", "opening", "setback"],
    ...(infill === "balusters" ? [["guards", "infill", "spacing"]] : []),
    ...(infill === "glass" || infill === "perforated" || infill === "panel"
      ? [["guards", "infill", "thickness"]]
      : []),
    ["guards", "posts", "size"],
    ["guards", "posts", "maxSpacing"],
    ["guards", "posts", "cornerAngle"],
    ["guards", "wallTolerance"],
  ];
}

/**
 * Le paramètre de plugin `path` s'applique-t-il à ce projet ? Un champ conditionnel n'apparaît
 * que lorsqu'il s'applique (spécification de contenu § 1) : réglages de la tôle pliée
 * (`folded.*`) seulement si les marches sont en tôle pliée (`treadKind`), réglages du poteau
 * (`newel.*`) seulement si un tournant du tracé a un poteau (jour `newel`), dimensions du plat
 * ou de la cornière selon le type de support (`supports.kind`), fixation d'une marche en tôle
 * sur son support (A31) seulement avec des marches en tôle pliée, réglages du limon central
 * selon la section (tube, caisson), le type de support (console, support plié) et la finition
 * (évents d'un galvanisé), réglages du limon central bois selon la section (lamelles d'un
 * lamellé-collé), le tracé (plis minces et leur justification seulement sur une trace courbe), la
 * filière retenue sur une trace courbe (`resolveCurvedMethod` du cœur : lamelles et plis minces
 * pour le moule, couches pour les couches empilées, QUESTIONS A33 (e)), la présence des ancrages
 * (`anchors.*`) et leur type retenu (`resolveAnchorKind` : réglages du sabot ou de la platine à
 * âme noyée, A33 (f), A34 (c)). Les autres paramètres s'appliquent toujours. `params` : paramètres du plugin complétés par ses défauts.
 * Lecture du projet seulement, aucun calcul.
 */
export function structureParamApplies(
  project: Project,
  params: unknown,
  path: readonly string[],
): boolean {
  const head = path[0];
  if (head === "folded") {
    const treadKind =
      typeof params === "object" && params !== null
        ? (params as Readonly<Record<string, unknown>>)["treadKind"]
        : undefined;
    return treadKind === "folded-steel";
  }
  if (head === "newel") {
    const turns = project.stair.layout.turns ?? [];
    return turns.some((t) => t.inner.kind === "newel");
  }
  if (head === "supports") {
    // Dimensions du plat pour des supports en plat, de la cornière pour des cornières.
    const supports = field(params, "supports");
    const kind = field(supports, "kind");
    const leaf = path[1];
    if (kind === "angle" && (leaf === "plateWidth" || leaf === "plateThickness")) return false;
    if (kind === "plate" && (leaf === "angleLeg" || leaf === "angleThickness")) return false;
    // Limon central : âme et plat d'appui d'une console, tôle d'un support plié.
    if (kind === "console" && leaf === "foldedThickness") return false;
    if (
      typeof kind === "string" &&
      kind.startsWith("folded-") &&
      (leaf === "consoleThickness" || leaf === "bearingThickness" || leaf === "tipHeight")
    ) {
      return false;
    }
    // Marche en tôle pliée sur son support (A31) : seulement avec des marches en tôle pliée ;
    // perçage des vis seulement si elle est vissée.
    if (leaf === "treadFixing" || leaf === "treadHoleDiameter") {
      if (field(params, "treadKind") !== "folded-steel") return false;
      if (leaf === "treadHoleDiameter" && field(supports, "treadFixing") === "welded") return false;
    }
  }
  if (head === "section" && path.length > 1) {
    // Limon central : paroi d'un tube, tôles d'un caisson ; évents d'un corps creux galvanisé.
    const kind = field(field(params, "section"), "kind");
    const leaf = path[1];
    if (kind === "box" && leaf === "wallThickness") return false;
    if (kind === "tube" && BOX_ONLY.has(leaf ?? "")) return false;
    if (leaf === "ventDiameter" && field(params, "finish") !== "galvanized") return false;
    // Limon central bois : lamelles d'un lamellé-collé seulement ; plis minces seulement pour
    // des lamelles cintrées sur moule (trace courbe : tournant ou hélicoïdal) ; filière et seuil
    // du moule sur une trace courbe ; couches seulement pour la filière des couches empilées.
    if (WOOD_GLULAM_ONLY.has(leaf ?? "") && kind === "solid") return false;
    if (leaf === "curvedMethod" || leaf === "mouldMaxWidth") return curvedLayout(project);
    if (leaf === "thinPlyMax") return curvedMethodOf(project, params) === "mould";
    if (leaf === "lamellaThickness") return curvedMethodOf(project, params) !== "stacked";
    if (leaf === "layerThickness" || leaf === "dressingAllowance" || leaf === "maxGrainSlope") {
      return curvedMethodOf(project, params) === "stacked";
    }
  }
  // Réduction selon l'angle du fil (A35 (j)) : poutre en couches empilées seulement.
  if (head === "grainAngle") return curvedMethodOf(project, params) === "stacked";
  // Justification des plis minces du lamellé-collé cintré : sans objet sans cintrage sur moule.
  if (head === "laminationJustification") {
    return (
      field(field(params, "section"), "kind") !== "solid" &&
      curvedMethodOf(project, params) === "mould"
    );
  }
  // Ancrages du limon central bois : présence toujours, réglages s'il y en a au moins un ;
  // réglages du sabot ou de la platine selon le type retenu.
  if (head === "anchors" && path[1] !== "foot" && path[1] !== "head") {
    const anchors = field(params, "anchors");
    if (field(anchors, "foot") === false && field(anchors, "head") === false) return false;
    const leaf = path[1] ?? "";
    if (leaf === "plate") return anchorKindOf(project, params) === "embeddedPlate";
    if (SHOE_ONLY.has(leaf)) return anchorKindOf(project, params) === "shoe";
  }
  return true;
}

/** Réglages de la section du limon central bois réservés au lamellé-collé. */
const WOOD_GLULAM_ONLY: ReadonlySet<string> = new Set([
  "lamellaThickness",
  "thinPlyMax",
  "curvedMethod",
  "mouldMaxWidth",
  "layerThickness",
  "dressingAllowance",
  "maxGrainSlope",
]);

/** Réglages propres au sabot en U du limon central bois (sans objet pour la platine). */
const SHOE_ONLY: ReadonlySet<string> = new Set([
  "thickness",
  "cheekDepth",
  "bolts",
  "boltHoleDiameter",
]);

/**
 * Filière de la poutre lamellé-collé du limon central bois (contrat du cœur
 * `resolveCurvedMethod`) : `null` sur une trace droite ou une section massive. Paramètres sans
 * `section.curvedMethod` (autre plugin, paramètres partiels) : cintrage sur moule sur une trace
 * courbe (comportement antérieur à la filière des couches empilées).
 */
function curvedMethodOf(project: Project, params: unknown): "mould" | "stacked" | null {
  const section = field(params, "section");
  const curved = curvedLayout(project);
  if (field(section, "curvedMethod") === undefined) {
    return curved && field(section, "kind") !== "solid" ? "mould" : null;
  }
  return resolveCurvedMethod(params as WoodCentralParams, curved);
}

/**
 * Ancrage retenu du limon central bois (contrat du cœur `resolveAnchorKind`, trace courbe =
 * poutre cintrée). Paramètres sans `anchors.kind` : sabot en U (comportement antérieur).
 */
function anchorKindOf(project: Project, params: unknown): "shoe" | "embeddedPlate" {
  if (field(field(params, "anchors"), "kind") === undefined) return "shoe";
  return resolveAnchorKind(params as WoodCentralParams, curvedLayout(project));
}

/**
 * Le tracé du projet porte-t-il une trace courbe (tournant ou hélicoïdal) ? Lecture des traits
 * du tracé (`layoutTraitsOf`, ceux que lisent les capacités des plugins) et critère du cœur
 * (`woodCentralCurvedLayout`, sans copie), aucun calcul.
 */
function curvedLayout(project: Project): boolean {
  return woodCentralCurvedLayout(layoutTraitsOf(project));
}

/** Réglages du caisson du limon central (tôles soudées), sans objet pour un tube. */
const BOX_ONLY: ReadonlySet<string> = new Set([
  "webThickness",
  "flangeThickness",
  "diaphragmThickness",
  "diaphragmSpacing",
  "diaphragmMinSpacing",
]);

/** Champ `key` d'un objet de paramètres, `undefined` sinon. */
function field(v: unknown, key: string): unknown {
  return typeof v === "object" && v !== null
    ? (v as Readonly<Record<string, unknown>>)[key]
    : undefined;
}

/**
 * L'essence des marches du projet (`stair.treads.material`) s'applique-t-elle ? Oui quand les
 * marches sont en bois et que le plugin de structure n'a pas sa propre essence : structure
 * « aucune » ou plugin absent (pièces de base), plugins acier à marches bois (`treadKind` autre
 * que la tôle pliée), hélicoïdal à fût à marches bois (`treads.material`). Non pour un plugin
 * qui porte l'essence dans ses paramètres (`material`, limons bois). `params` : paramètres du
 * plugin complétés par ses défauts (`undefined` : aucun plugin).
 */
export function treadsMaterialApplies(params: unknown): boolean {
  if (typeof params !== "object" || params === null) return true;
  const p = params as Readonly<Record<string, unknown>>;
  if ("material" in p) return false;
  if (p["treadKind"] === "folded-steel") return false;
  const treads = p["treads"];
  if (typeof treads === "object" && treads !== null) {
    if ((treads as Readonly<Record<string, unknown>>)["material"] === "steel") return false;
  }
  return true;
}

/** Paramètres du plugin de structure courant complétés par ses défauts, et leurs chemins. */
function structureFields(
  project: Project,
  model: Model | null | undefined,
): { readonly values: Record<string, unknown>; readonly paths: ParamPath[] } {
  const kind = project.stair.structure.kind;
  const plugin = availableStructures().find((k) => k.kind === kind);
  if (!plugin) return { values: {}, paths: [] };
  const defaults = safeDefaults(plugin, structureContext(project, model));
  // Sans modèle (défauts non calculables), paramètres enregistrés dans le projet.
  const values = withDefaults(defaults, project.stair.structure.params);
  const paths = deriveParamFields(values, plugin.paramsSchema)
    .map((f) => f.path)
    .filter((p) => structureParamApplies(project, values, p));
  return { values, paths };
}

/** Valeur scalaire (nombre fini, texte, booléen), sinon `undefined`. */
function scalar(v: unknown): ValidatedScalar | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  return typeof v === "string" || typeof v === "boolean" ? v : undefined;
}

/** Valeur ◆ d'un projet avec sa valeur effective et son état de validation. */
export interface ToValidateState extends ToValidateItem {
  /** Valeur effective (défauts compris) ; `undefined` : non calculable ou non scalaire. */
  readonly value: ValidatedScalar | undefined;
  /** Plugin de structure, pour les paramètres `stair.structure.params.*`. */
  readonly structureKind?: string;
  /** Validée : une entrée de `validatedValues` porte cette valeur effective (sinon caduque). */
  readonly validated: boolean;
}

/**
 * Valeurs ◆ présentes dans ce projet, avec leur valeur effective et leur état de validation :
 * portée et raideur de la rotation M6 (défauts du cœur si absentes), paramètres du plugin de
 * structure courant (défauts du plugin compris), garde-corps présents (type de remplissage
 * courant), visserie des assemblages présents dans le modèle (profil d'atelier, défauts compris).
 * Une valeur non calculable n'est jamais validée.
 */
export function toValidateStates(
  project: Project,
  model?: Model | null,
): readonly ToValidateState[] {
  const out: ToValidateState[] = [];
  const state = (base: ToValidateItem, raw: unknown, structureKind?: string): ToValidateState => {
    const value = scalar(raw);
    const validated =
      value !== undefined && isValueValidated(project, base.key, value, structureKind);
    return {
      ...base,
      value,
      ...(structureKind === undefined ? {} : { structureKind }),
      validated,
    };
  };
  const push = (path: readonly string[], raw: unknown): void => {
    const key = paramKey(path);
    const e = tierEntry(key);
    if (e?.toValidate === true) out.push(state(item(key, path, e), raw));
  };
  const b = project.stair.balancing;
  if (b.method === "M6") {
    push(["stair", "balancing", "rotationReach"], b.rotationReach ?? ROTATION_DEFAULT_REACH);
    push(
      ["stair", "balancing", "rotationSteepness"],
      b.rotationSteepness ?? ROTATION_DEFAULT_STEEPNESS,
    );
  }
  const kind = project.stair.structure.kind;
  const { values, paths } = structureFields(project, model);
  for (const p of paths) {
    const e = structureParamEntry(kind, p);
    if (e.toValidate !== true) continue;
    const path = ["stair", "structure", "params", ...p];
    out.push(state(item(paramKey(path), path, e), getParam(values, p), kind));
  }
  for (const p of guardPaths(project)) push(p, getParam(project.guards, p.slice(1)));
  // Visserie : seulement les assemblages présents dans le modèle (aucune sans modèle).
  for (const p of fastenerSettingPaths(model)) push(p, fastenerSettingValue(project, p));
  return out;
}

/**
 * Valeurs ◆ présentes dans ce projet (validées ou non) : garde-corps présents (type de
 * remplissage courant), paramètres du plugin de structure courant, portée et raideur de la
 * rotation M6.
 */
export function toValidateItems(project: Project, model?: Model | null): readonly ToValidateItem[] {
  return toValidateStates(project, model).map(({ key, path, section, steps }) => ({
    key,
    path,
    section,
    steps,
  }));
}

/** Nombre de valeurs ◆ **restantes** (non validées) par section principale. */
export function toValidateCountBySection(
  project: Project,
  model?: Model | null,
): Record<SectionId, number> {
  const out = Object.fromEntries(SECTION_IDS.map((s) => [s, 0])) as Record<SectionId, number>;
  for (const i of toValidateStates(project, model)) if (!i.validated) out[i.section] += 1;
  return out;
}

/** Nombre de valeurs ◆ **restantes** par étape guidée (l'étape 7 les compte toutes). */
export function toValidateCountByStep(
  project: Project,
  model?: Model | null,
): Record<GuidedStep, number> {
  const out = Object.fromEntries(GUIDED_STEPS.map((s) => [s, 0])) as Record<GuidedStep, number>;
  for (const i of toValidateStates(project, model)) {
    if (i.validated) continue;
    for (const s of i.steps) if (s !== 7) out[s] += 1;
    out[7] += 1;
  }
  return out;
}
