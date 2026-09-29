/**
 * Présentation française des paramètres des plugins de structure : libellés, unités, aides,
 * libellés des choix et regroupement par sous-objet (poteau, supports, platines, tôle pliée,
 * prédimensionnement). Présentation seulement : les valeurs par défaut, bornes et la validation
 * restent celles du plugin (`paramsSchema`). Un paramètre absent de ce dictionnaire garde le
 * libellé dérivé de sa clé (formulaire générique).
 *
 * La section d'un profilé (`steel-profile.section`) devient une liste déroulante alimentée par
 * le catalogue du cœur (`sectionsOf(family)`).
 */
import {
  LOAD_CATEGORIES,
  SECTION_FAMILIES,
  WOOD_CLASSES,
  sectionsOf,
  type SectionFamily,
} from "@blondel/core";
import { MATERIAL_LABELS } from "../three/materials.js";
import type { ParamField, ParamPath } from "./structureForm.js";

export interface FieldText {
  readonly label: string;
  readonly unit?: string;
  readonly hint?: string;
  readonly options?: Readonly<Record<string, string>>;
}

/** Groupes (premier segment d'un chemin imbriqué). */
export const GROUP_LABELS: Readonly<Record<string, string>> = {
  newel: "Poteau",
  supports: "Supports de marche",
  plates: "Platines",
  folded: "Marches en tôle pliée",
  precheck: "Prédimensionnement indicatif",
  curved: "Limon de jour débillardé",
  column: "Fût",
  treads: "Marches",
  innerStringer: "Limon intérieur (jour central)",
  outerStringer: "Limon extérieur",
  handrail: "Main courante",
};

const MM = "mm";
const TO_VALIDATE = "Valeur par défaut à valider";

const JOINTS = {
  welded: "Soudé",
  bolted: "Vissé",
  tenon: "Tenon",
  butt: "Bout à bout (boulonné)",
};

/** Paramètres communs aux plugins (chemin joint par des points). */
const COMMON: Readonly<Record<string, FieldText>> = {
  grade: { label: "Nuance d'acier", hint: "S355 ⇒ EXC2", options: { S235: "S235", S355: "S355" } },
  finish: {
    label: "Finition",
    options: { raw: "Acier brut", painted: "Peint", galvanized: "Galvanisé" },
  },
  material: { label: "Essence", options: MATERIAL_LABELS },
  thickness: { label: "Épaisseur des limons", unit: MM },
  upperOffset: { label: "Dépassement haut d_h (au-dessus des nez)", unit: MM },
  lowerOffset: { label: "Dépassement bas d_b (sous les nez)", unit: MM },
  startExtension: { label: "Prolongement avant le nez de départ", unit: MM },
  endExtension: { label: "Prolongement après le nez d'arrivée", unit: MM },
  splice: {
    label: "Aboutage d'un limon trop long",
    options: { welded: "Soudé bout à bout (EXC2)", bolted: "Éclissé (boulonné)" },
  },
  housingDepth: { label: "Profondeur d'encastrement", unit: MM },
  noseRadius: { label: "Rayon d'arrondi du nez", unit: MM },
  treadKind: { label: "Marches", options: { wood: "Bois", "folded-steel": "Tôle pliée" } },
  family: {
    label: "Famille de profilé",
    options: Object.fromEntries(SECTION_FAMILIES.map((f) => [f, f])),
  },
  section: {
    label: "Section du catalogue",
    hint: "Automatique : la plus légère de la famille qui passe le prédimensionnement",
  },
  miterTolerance: {
    label: "Tolérance d'onglet à l'angle mural",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Poteau
  "newel.section": { label: "Section", options: { tube: "Tube carré", flat: "Carré plein" } },
  "newel.size": {
    label: "Côté du poteau pour profilés",
    unit: MM,
    hint: "Automatique : largeur d'aile + 2 × jeu, poteau décalé vers le jour (à valider) ; posé au choix de la structure ou par la correction proposée",
  },
  "newel.clearance": {
    label: "Jeu entre l'aile et le bord du poteau",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "newel.tubeThickness": { label: "Épaisseur de paroi du tube", unit: MM, hint: TO_VALIDATE },
  "newel.joint": { label: "Assemblage limon / poteau", options: JOINTS },
  "newel.bolts": { label: "Boulons par assemblage", hint: TO_VALIDATE },
  "newel.foot": { label: "Pied", options: { floor: "Au sol", hanging: "Pendant" } },
  "newel.bottomExtension": { label: "Dépassement sous le limon le plus bas", unit: MM },
  "newel.topExtension": { label: "Dépassement au-dessus du plus haut élément", unit: MM },
  "newel.tenonLength": { label: "Longueur du tenon", unit: MM },
  "newel.tenonThickness": { label: "Épaisseur du tenon", unit: MM },
  "newel.tenonShoulder": { label: "Épaulements du tenon", unit: MM },
  // Supports de marche
  "supports.kind": { label: "Type", options: { angle: "Cornière", plate: "Plat" } },
  "supports.fixing": { label: "Fixation", options: { welded: "Soudés", bolted: "Vissés" } },
  "supports.angleLeg": { label: "Aile de la cornière", unit: MM, hint: TO_VALIDATE },
  "supports.angleThickness": { label: "Épaisseur de la cornière", unit: MM, hint: TO_VALIDATE },
  "supports.plateWidth": { label: "Largeur du plat", unit: MM },
  "supports.plateThickness": { label: "Épaisseur du plat", unit: MM },
  "supports.bolts": { label: "Boulons par support" },
  "supports.holeDiameter": { label: "Diamètre de perçage", unit: MM },
  "supports.slotLength": { label: "Longueur de lumière (0 : trou rond)", unit: MM },
  "supports.holeEdgeDistance": { label: "Pince (axe du trou – bord)", unit: MM },
  "supports.treadScrews": { label: "Vis de marche par support" },
  "supports.endMargin": { label: "Marge aux extrémités", unit: MM },
  "supports.edgeMargin": { label: "Marge à la rive basse", unit: MM },
  "supports.minLength": { label: "Longueur d'appui minimale", unit: MM },
  "supports.minBearing": {
    label: "Appui minimal au-delà des ailes (profilés en I)",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Platines
  "plates.foot": { label: "Platine de pied" },
  "plates.head": { label: "Platine de tête" },
  "plates.thickness": { label: "Épaisseur", unit: MM },
  "plates.width": { label: "Largeur (en travers du limon)", unit: MM },
  "plates.length": { label: "Longueur de la platine de pied", unit: MM },
  "plates.margin": { label: "Débord autour du poteau", unit: MM },
  "plates.holeDiameter": { label: "Diamètre de perçage", unit: MM },
  "plates.holeEdgeDistance": { label: "Pince (axe du trou – bord)", unit: MM },
  // Tôle pliée
  "folded.profile": { label: "Profil", options: { Z: "Z", U: "U" } },
  "folded.thickness": { label: "Épaisseur de tôle", unit: MM, hint: TO_VALIDATE },
  "folded.noseHeight": { label: "Hauteur de l'aile de nez (U)", unit: MM },
  "folded.rearHeight": { label: "Hauteur de l'aile arrière (U)", unit: MM },
  "folded.returnLength": { label: "Retour depuis la ligne de nez (Z)", unit: MM },
  "folded.clearance": { label: "Jeu latéral marche / limon", unit: MM },
  "folded.arrivalRiser.topOffset": {
    label: "Contremarche d'arrivée (Z) : arête haute sous le sol fini",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "folded.arrivalRiser.fixings": {
    label: "Contremarche d'arrivée (Z) : perçages de fixation au chevêtre",
    hint: TO_VALIDATE,
  },
  "folded.arrivalRiser.holeDiameter": {
    label: "Contremarche d'arrivée (Z) : diamètre de perçage",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "folded.arrivalRiser.holeEdgeDistance": {
    label: "Contremarche d'arrivée (Z) : distance des perçages aux bords",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Prédimensionnement
  "precheck.loadSet": {
    label: "Jeu de charges",
    options: { AN: "Annexe nationale française", EN16481: "NF EN 16481 (défauts)" },
  },
  "precheck.category": {
    label: "Catégorie d'usage",
    options: {
      auto: "Automatique (A en logement, D1 sinon)",
      ...Object.fromEntries(LOAD_CATEGORIES.map((c) => [c, `Catégorie ${c}`])),
    },
  },
  "precheck.extraPermanent": { label: "Charge permanente supplémentaire", unit: "kN/m²" },
  "precheck.pointLoadShare": {
    label: "Part de Q_k reprise par un limon",
    hint: "De 0 à 1 ; à valider",
  },
  "precheck.gammaG": { label: "γ_G (charges permanentes)", hint: TO_VALIDATE },
  "precheck.gammaQ": { label: "γ_Q (charges d'exploitation)", hint: TO_VALIDATE },
  "precheck.gammaM0": { label: "γ_M0 (acier)", hint: TO_VALIDATE },
  "precheck.gammaMWood": { label: "γ_M (bois)", hint: TO_VALIDATE },
  "precheck.kmod": { label: "k_mod (bois)", hint: TO_VALIDATE },
  "precheck.woodClass": {
    label: "Classe de résistance du bois",
    hint: TO_VALIDATE,
    options: Object.fromEntries(WOOD_CLASSES.map((c) => [c, c])),
  },
};

/** Variantes propres à un plugin. */
const BY_KIND: Readonly<Record<string, Readonly<Record<string, FieldText>>>> = {
  "wood-cut": {
    thickness: { label: "Épaisseur des crémaillères", unit: MM },
    residual: { label: "Reste sous entaille", unit: MM },
    residualFallback: {
      label: "Reste sous entaille de repli",
      unit: MM,
      hint: "Si le tableau FCBA n'est pas exploitable ; à valider",
    },
    strengthClass: {
      label: "Classe de résistance",
      options: {
        auto: "Automatique (selon l'essence)",
        unknown: "Inconnue",
        C30: "C30",
        D40: "D40",
      },
    },
    inset: { label: "Retrait sous le bout des marches", unit: MM },
  },
  "steel-flat": {
    thickness: { label: "Épaisseur des limons (plat)", unit: MM, hint: TO_VALIDATE },
  },
  "steel-curved": {
    thickness: {
      label: "Épaisseur des limons (plat et tôle roulée)",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.jointOffset": {
      label: "Décalage joint / naissance δ (partie droite)",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.jointSupportMargin": {
      label: "Marge joint / support de marche",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.minSegmentLength": {
      label: "Longueur minimale d'un tronçon",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.sampleStep": {
      label: "Pas d'échantillonnage des rives Δσ",
      unit: MM,
      hint: "B §5.2 : par exemple 5 mm",
    },
    "curved.rollLineSpacing": {
      label: "Espacement des lignes de roulage (développé)",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.minPerpendicularWidth": {
      label: "Largeur perpendiculaire minimale du limon",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.maxSlopeBreak": {
      label: "Cassure de pente maximale aux naissances",
      unit: "°",
      hint: "Aucune valeur sourcée : sans seuil, la cassure est mesurée et affichée",
    },
  },
  "helical-core": {
    "column.material": { label: "Matériau", options: { steel: "Acier (tube)", wood: "Bois" } },
    "column.wallThickness": { label: "Paroi du tube acier", unit: MM, hint: TO_VALIDATE },
    "column.wood": { label: "Essence du fût bois", options: MATERIAL_LABELS },
    "column.topExtension": {
      label: "Dépassement au-dessus du plancher haut",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "treads.material": { label: "Matériau", options: { wood: "Bois", steel: "Tôle plane" } },
    "treads.plateThickness": { label: "Épaisseur de la tôle", unit: MM, hint: TO_VALIDATE },
    "innerStringer.height": {
      label: "Hauteur du plat",
      unit: MM,
      hint: "Exemple relevé (C §2.2), à valider",
    },
    "innerStringer.thickness": { label: "Épaisseur", unit: MM, hint: TO_VALIDATE },
    "innerStringer.topAboveNosing": {
      label: "Rive haute au-dessus de la ligne des nez",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "outerStringer.enabled": { label: "Limon extérieur hélicoïdal" },
    "outerStringer.height": {
      label: "Hauteur du plat",
      unit: MM,
      hint: "Exemple relevé (C §2.2), à valider",
    },
    "outerStringer.thickness": { label: "Épaisseur", unit: MM, hint: TO_VALIDATE },
    "outerStringer.topAboveNosing": {
      label: "Rive haute au-dessus de la ligne des nez",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "handrail.enabled": { label: "Main courante hélicoïdale" },
    "handrail.material": { label: "Matériau", options: { steel: "Acier", wood: "Bois" } },
    "handrail.height": {
      label: "Hauteur au-dessus de la ligne des nez",
      unit: MM,
      hint: "Défaut : minimum de GC_HAUTEUR_RAMPANT_2024",
    },
    "handrail.diameter": {
      label: "Diamètre",
      unit: MM,
      hint: "Exemple relevé (C §2.2), à valider",
    },
    "handrail.radiusOffset": {
      label: "Décalage radial de l'axe",
      unit: MM,
      hint: "Par rapport au bout des marches (ou à l'axe du limon extérieur)",
    },
    cantileverJustification: {
      label: "Justification du porte-à-faux",
      hint: "Référence de la note de calcul ou de l'avis technique, reprise dans le dossier PDF ; vide : avertissement",
    },
  },
};

/** Texte d'un paramètre (`undefined` : libellé dérivé de la clé). */
export function fieldText(kind: string, path: ParamPath): FieldText | undefined {
  const key = path.join(".");
  return BY_KIND[kind]?.[key] ?? COMMON[key];
}

export type PresentedField = ParamField & {
  readonly unit: string;
  readonly hint?: string;
  /** Groupe (fieldset) du champ, `undefined` : paramètres principaux. */
  readonly group?: string;
  /** Libellés des choix d'une liste. */
  readonly optionLabels?: Readonly<Record<string, string>>;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Sections du catalogue proposées pour une famille (plus légère d'abord). */
export function catalogSectionOptions(family: unknown): string[] {
  const fam = (SECTION_FAMILIES as readonly string[]).includes(String(family))
    ? (family as SectionFamily)
    : "UPN";
  return ["auto", ...sectionsOf(fam).map((s) => s.name)];
}

/**
 * Champs présentés : libellés français, unités, groupes ; `section` d'un profilé en liste du
 * catalogue de la famille choisie.
 */
export function presentFields(
  kind: string,
  fields: readonly ParamField[],
  params: unknown,
): PresentedField[] {
  return fields.map((f): PresentedField => {
    const text = fieldText(kind, f.path);
    const group = f.path.length > 1 ? f.path[0] : undefined;
    const base = {
      ...f,
      unit: text?.unit ?? "",
      ...(text ? { label: text.label } : group ? { label: stripGroup(f.label) } : {}),
      ...(text?.hint ? { hint: text.hint } : {}),
      ...(group ? { group } : {}),
      ...(text?.options ? { optionLabels: text.options } : {}),
    };
    if (kind === "steel-profile" && f.path.length === 1 && f.path[0] === "section") {
      const family = isPlainObject(params) ? params["family"] : undefined;
      const current = isPlainObject(params) ? params["section"] : undefined;
      const options = catalogSectionOptions(family);
      const labels: Record<string, string> = { auto: "Automatique" };
      // Section d'une autre famille (projet importé) : le plugin l'utilise telle quelle, la
      // liste doit donc la montrer (sinon elle afficherait « Automatique »).
      if (typeof current === "string" && !options.includes(current)) {
        options.push(current);
        labels[current] = `${current} (autre famille)`;
      }
      return {
        ...base,
        kind: "enum",
        options,
        optionLabels: labels,
      } as PresentedField;
    }
    return base as PresentedField;
  });
}

/** Libellé dérivé sans le préfixe de groupe (« Newel › joint » → « Joint »). */
function stripGroup(label: string): string {
  const i = label.lastIndexOf("›");
  const rest = i >= 0 ? label.slice(i + 1).trim() : label;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Libellé d'un groupe de paramètres. */
export function groupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group;
}

/**
 * Paramètres après modification d'un champ : un changement de famille de profilé remet la
 * section en `auto` si la section choisie n'appartient pas à la nouvelle famille (le plugin
 * retiendrait sinon une section d'une autre famille).
 */
export function afterParamChange(
  kind: string,
  path: ParamPath,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (kind !== "steel-profile" || path.length !== 1 || path[0] !== "family") return params;
  const section = params["section"];
  if (section === undefined || section === "auto") return params;
  return catalogSectionOptions(params["family"]).includes(String(section))
    ? params
    : { ...params, section: "auto" };
}
