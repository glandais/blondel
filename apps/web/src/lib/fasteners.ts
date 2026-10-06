/**
 * Visserie dans l'interface (QUESTIONS A27, décision du 2026-10-06) : lecture de
 * `Model.fasteners` et du profil d'atelier, sans calcul métier.
 *
 * - lignes affichées (nomenclature, groupe « Visserie » du mode Fabrication) : celles de la liste
 *   de visserie (`fastenerScheduleRows` de `@blondel/exports`, regroupement `fastenerLines` du
 *   cœur), filtre texte ;
 * - réglages ◆ du profil d'atelier : assemblages présents dans le modèle et chemins du projet
 *   (`workshop.fasteners.*`) qui s'y appliquent, valeur effective lue dans
 *   `resolveFastenerProfile` (défauts « à valider » du cœur compris).
 *
 * Un réglage ne s'applique que si le modèle a un assemblage de ce type : rien n'est proposé sans
 * visserie. Le diamètre d'un assemblage dont tous les éléments ont un diamètre lu sur les
 * perçages (`deduced`) ne s'applique pas (le jeu de perçage et la série des diamètres
 * nominaux, si) ; l'entraxe des supports ne s'applique qu'aux mains courantes murales, le mur
 * supposé porteur qu'à celles qui longent un mur non décrit par le site (`unknownWall`).
 *
 * La série des diamètres nominaux se saisit en texte (`formatNominalDiameters`,
 * `parseNominalDiameters` : mise en forme et lecture d'une liste, sans calcul métier).
 */
import {
  FASTENER_JOINTS,
  FASTENER_SETTING_FIELDS,
  resolveFastenerProfile,
  type FastenerJointKind,
  type FastenerSettingField,
  type Model,
  type Project,
} from "@blondel/core";
import { fastenerScheduleRows, type FastenerScheduleRow } from "@blondel/exports";
import { msg, type Message, type Translator } from "@blondel/i18n";
import { foldText } from "./partGroups.js";

/** Lignes de visserie du modèle dans la langue du traducteur (vide sans visserie). */
export function fastenerRows(
  model: Pick<Model, "parts" | "fasteners">,
  t: Translator,
): readonly FastenerScheduleRow[] {
  return fastenerScheduleRows(model, { locale: t.locale });
}

/**
 * La ligne répond-elle au filtre ? Recherche dans le repère, la désignation, la nature et la
 * classe, sans tenir compte de la casse ni des accents. Filtre vide : oui.
 */
export function matchesFastenerFilter(row: FastenerScheduleRow, query: string): boolean {
  const q = foldText(query.trim());
  if (q === "") return true;
  return [row.mark, row.name, row.kind, row.grade].some((s) => foldText(s).includes(q));
}

/** Préfixe des chemins de la visserie du profil d'atelier. */
export const FASTENERS_PATH = ["workshop", "fasteners"] as const;

/** Chemin du projet d'un champ du réglage d'un assemblage. */
export function fastenerSettingPath(
  joint: FastenerJointKind,
  field: FastenerSettingField,
): readonly string[] {
  return [...FASTENERS_PATH, "joints", joint, field];
}

/** Chemin du jeu de perçage. */
export const HOLE_CLEARANCE_PATH: readonly string[] = [...FASTENERS_PATH, "holeClearance"];
/** Chemin de la série des diamètres nominaux. */
export const NOMINAL_DIAMETERS_PATH: readonly string[] = [...FASTENERS_PATH, "nominalDiameters"];
/** Chemin de l'entraxe des supports de main courante murale. */
export const BRACKET_SPACING_PATH: readonly string[] = [...FASTENERS_PATH, "bracketSpacing"];
/** Chemin du mur non décrit supposé porteur. */
export const UNKNOWN_WALL_PATH: readonly string[] = [...FASTENERS_PATH, "unknownWallLoadBearing"];

/** Séparateur de la série des diamètres (le point-virgule évite la virgule décimale). */
const SERIES_SEPARATOR = " ; ";

/** Série des diamètres nominaux en texte (« 6 ; 8 ; 10 »), indépendant de la langue. */
export function formatNominalDiameters(series: readonly number[]): string {
  return series.map(String).join(SERIES_SEPARATOR);
}

/**
 * Lecture d'une série saisie : nombres positifs (virgule ou point décimal) séparés par des
 * points-virgules ; `null` si la saisie est vide ou contient autre chose.
 */
export function parseNominalDiameters(text: string): number[] | null {
  const items = text
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (items.length === 0) return null;
  const out: number[] = [];
  for (const item of items) {
    if (!/^\d+(?:[.,]\d+)?$/.test(item)) return null;
    const v = Number(item.replace(",", "."));
    if (!(v > 0)) return null;
    out.push(v);
  }
  return out;
}

/** Motif d'une série refusée. */
export const NOMINAL_DIAMETERS_INVALID: Message = msg("ui.fasteners.nominalDiameters.invalid");

/** Assemblages de main courante murale (entraxe des supports). */
const HANDRAIL_JOINTS: ReadonlySet<FastenerJointKind> = new Set([
  "handrailWall",
  "handrailPartition",
]);

/** Réglages de visserie qui s'appliquent au modèle. */
export interface FastenerSettingsInModel {
  /** Assemblages présents, dans l'ordre `FASTENER_JOINTS`. */
  readonly joints: readonly {
    readonly joint: FastenerJointKind;
    /** Champs du réglage qui s'appliquent (ordre `FASTENER_SETTING_FIELDS`). */
    readonly fields: readonly FastenerSettingField[];
  }[];
  /**
   * Le jeu de perçage et la série des diamètres nominaux servent-ils (un diamètre au moins lu
   * sur un perçage) ?
   */
  readonly holeClearance: boolean;
  /** L'entraxe des supports sert-il (main courante murale) ? */
  readonly bracketSpacing: boolean;
  /** Le mur supposé porteur sert-il (main courante le long d'un mur non décrit) ? */
  readonly unknownWall: boolean;
}

/** Réglages de visserie qui s'appliquent au modèle (aucun sans visserie). */
export function fastenerSettingsInModel(
  model: Pick<Model, "fasteners"> | null | undefined,
): FastenerSettingsInModel {
  const fasteners = model?.fasteners ?? [];
  const joints = FASTENER_JOINTS.flatMap((joint) => {
    const own = fasteners.filter((f) => f.joint === joint);
    if (own.length === 0) return [];
    const holes = own.every((f) => f.deduced.includes("diameter"));
    return [
      {
        joint,
        fields: FASTENER_SETTING_FIELDS.filter((field) => field !== "diameter" || !holes),
      },
    ];
  });
  return {
    joints,
    holeClearance: fasteners.some((f) => f.deduced.includes("diameter")),
    bracketSpacing: fasteners.some((f) => HANDRAIL_JOINTS.has(f.joint)),
    unknownWall: fasteners.some((f) => f.unknownWall === true),
  };
}

/** Chemins du projet des réglages de visserie qui s'appliquent au modèle (valeurs ◆). */
export function fastenerSettingPaths(
  model: Pick<Model, "fasteners"> | null | undefined,
): (readonly string[])[] {
  const s = fastenerSettingsInModel(model);
  return [
    ...(s.holeClearance ? [HOLE_CLEARANCE_PATH, NOMINAL_DIAMETERS_PATH] : []),
    ...(s.bracketSpacing ? [BRACKET_SPACING_PATH] : []),
    ...(s.unknownWall ? [UNKNOWN_WALL_PATH] : []),
    ...s.joints.flatMap(({ joint, fields }) => fields.map((f) => fastenerSettingPath(joint, f))),
  ];
}

/**
 * Valeur effective d'un chemin `workshop.fasteners.*` (réglage du projet, sinon défaut « à
 * valider » du cœur) ; `undefined` pour un autre chemin.
 */
export function fastenerSettingValue(
  project: Pick<Project, "workshop">,
  path: readonly (string | number)[],
): string | number | boolean | undefined {
  if (path[0] !== FASTENERS_PATH[0] || path[1] !== FASTENERS_PATH[1]) return undefined;
  const profile = resolveFastenerProfile(project.workshop?.fasteners);
  if (path.length === 3 && path[2] === "holeClearance") return profile.holeClearance;
  if (path.length === 3 && path[2] === "nominalDiameters") {
    return formatNominalDiameters(profile.nominalDiameters);
  }
  if (path.length === 3 && path[2] === "bracketSpacing") return profile.bracketSpacing;
  if (path.length === 3 && path[2] === "unknownWallLoadBearing") {
    return profile.unknownWallLoadBearing;
  }
  if (path.length !== 5 || path[2] !== "joints") return undefined;
  const joint = path[3] as FastenerJointKind;
  const field = path[4] as FastenerSettingField;
  if (!FASTENER_JOINTS.includes(joint) || !FASTENER_SETTING_FIELDS.includes(field)) {
    return undefined;
  }
  return profile.joints[joint][field];
}

/** Assemblage et champ d'un chemin `workshop.fasteners.joints.<assemblage>.<champ>`. */
export function fastenerSettingOf(
  path: readonly (string | number)[],
): { readonly joint: FastenerJointKind; readonly field: FastenerSettingField } | undefined {
  if (path.length !== 5 || path[0] !== "workshop" || path[1] !== "fasteners") return undefined;
  if (path[2] !== "joints") return undefined;
  const joint = path[3] as FastenerJointKind;
  const field = path[4] as FastenerSettingField;
  return FASTENER_JOINTS.includes(joint) && FASTENER_SETTING_FIELDS.includes(field)
    ? { joint, field }
    : undefined;
}
