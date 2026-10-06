/**
 * Catalogue des profilés du commerce (jalon 3c, C §2.3, §4.3) : UPN, IPN, IPE, HEA usuels.
 *
 * Grandeurs par section : hauteur h, largeur d'aile b, épaisseurs d'âme t_w et d'aile t_f (mm),
 * aire A, masse linéique G, moments d'inertie I_y (axe fort) et I_z (axe faible), module
 * élastique W_el,y (axe fort).
 *
 * **Sources** (tables publiques de profilés européens, consultées le 2026-09-29) :
 * - UPN (DIN 1026-1) : CivilAxis, « UPN — Section Properties »,
 *   https://civilaxis.com/steel-catalogue/reference/upn ; valeurs de C §2.3 [24] (UPN 120 à 180)
 *   identiques ;
 * - IPE et HEA (EN 10365) : CivilAxis, https://civilaxis.com/steel-catalogue/reference/ipe et
 *   https://civilaxis.com/steel-catalogue/reference/he ;
 * - IPN (DIN 1025-1:1995) : Metala Konstrukcijas, « IPN (INP) beams… DIN 1025-1: 1995 »,
 *   https://metalakonstrukcijas.lv/en/metal-trading/ipn-inp-beams.-european-standard-universal-steel-i-beams-ipn-section-flange-slope-14-properties-dimensions,-specifications-din-1025-1-1995/
 *   (h, b, t_w, t_f, A, G, I_y, I_z) ; la source ne donne que le module de l'axe faible :
 *   **W_el,y des IPN recalculé** par 2·I_y / h (section symétrique).
 *
 * Toutes les valeurs ont été recoupées sur la source citée (`verified: true`) ; une valeur non
 * recoupée serait marquée `verified: false` (« à vérifier »). Les rayons de congé et la pente
 * des ailes (IPN, UPN) ne sont pas modélisés : les solides 3D sont dessinés à ailes parallèles.
 */
import { isMessage, msg, translatorFor, type Message } from "@blondel/i18n";
import type { Mm } from "../model/primitives.js";

export const SECTION_FAMILIES = ["UPN", "IPN", "IPE", "HEA"] as const;
export type SectionFamily = (typeof SECTION_FAMILIES)[number];

/** Section du catalogue, unités du cœur : mm, mm², mm³, mm⁴, kg/m. */
export interface SteelSection {
  /** Désignation commerciale (ex. `UPN 160`). */
  readonly name: string;
  readonly family: SectionFamily;
  /** `U` (UPN : âme sur une rive, ailes d'un seul côté) ou `I` (âme centrée). */
  readonly shape: "U" | "I";
  readonly h: Mm;
  readonly b: Mm;
  readonly tw: Mm;
  readonly tf: Mm;
  /** Aire (mm²). */
  readonly area: number;
  /** Masse linéique du catalogue (kg/m). */
  readonly massPerMeter: number;
  /** Inertie axe fort (mm⁴), âme verticale. */
  readonly iy: number;
  /** Module élastique axe fort (mm³). */
  readonly wy: number;
  /** Inertie axe faible (mm⁴). */
  readonly iz: number;
  /** Valeurs recoupées sur la source ; `false` : « à vérifier ». */
  readonly verified: boolean;
  /** Source citée, en français (traduction française de `sourceMessage`). */
  readonly source: string;
  /**
   * Source citée traduisible (QUESTIONS A26 (b)) : « consulté le … » / « accessed … », date ISO
   * dans les deux langues ; désignations et normes (DIN 1026-1, EN 10365) non traduites.
   */
  readonly sourceMessage: Message;
}

/** Date de consultation des tables de profilés (ISO, identique dans les deux langues). */
const CONSULTED = "2026-09-29";

/** Source « éditeur, désignation, consulté le … ». */
const consulted = (publisher: string, designation: string): Message =>
  msg("catalog.source.consulted", { publisher, designation, date: CONSULTED });

const SRC_UPN = msg("catalog.source.withReference", {
  source: consulted("CivilAxis", "UPN (DIN 1026-1)"),
  reference: "C §2.3 [24]",
});
const SRC_IPE = consulted("CivilAxis", "IPE (EN 10365)");
const SRC_HEA = consulted("CivilAxis", "HE A (EN 10365)");
const SRC_IPN = msg("catalog.source.recomputed", {
  source: consulted("Metala Konstrukcijas", "IPN (DIN 1025-1:1995)"),
  formula: "W_el,y = 2·I_y / h",
});

/** Ligne de table dans les unités de la source : h, b, t_w, t_f (mm), A (cm²), G (kg/m), I_y (cm⁴), W_y (cm³), I_z (cm⁴). */
type Row = readonly [number, number, number, number, number, number, number, number | null, number];

function build(
  family: SectionFamily,
  sourceMessage: Message,
  rows: Readonly<Record<string, Row>>,
): SteelSection[] {
  const source = translatorFor("fr").t(sourceMessage);
  return Object.entries(rows).map(([size, [h, b, tw, tf, A, G, Iy, Wy, Iz]]) => ({
    name: `${family} ${size}`,
    family,
    shape: family === "UPN" ? "U" : "I",
    h,
    b,
    tw,
    tf,
    area: A * 100,
    massPerMeter: G,
    iy: Iy * 1e4,
    wy: Wy !== null ? Wy * 1e3 : (2 * Iy * 1e4) / h,
    iz: Iz * 1e4,
    verified: true,
    source,
    sourceMessage,
  }));
}

const UPN = build("UPN", SRC_UPN, {
  "80": [80, 45, 6.0, 8.0, 11.0, 8.64, 106, 26.5, 19.4],
  "100": [100, 50, 6.0, 8.5, 13.5, 10.6, 206, 41.2, 29.3],
  "120": [120, 55, 7.0, 9.0, 17.0, 13.4, 364, 60.7, 43.2],
  "140": [140, 60, 7.0, 10.0, 20.4, 16.0, 605, 86.4, 62.7],
  "160": [160, 65, 7.5, 10.5, 24.0, 18.8, 925, 116, 85.3],
  "180": [180, 70, 8.0, 11.0, 28.0, 22.0, 1350, 150, 114],
  "200": [200, 75, 8.5, 11.5, 32.2, 25.3, 1910, 191, 148],
  "220": [220, 80, 9.0, 12.5, 37.4, 29.4, 2690, 245, 197],
  "240": [240, 85, 9.5, 13.0, 42.3, 33.2, 3600, 300, 248],
  "260": [260, 90, 10.0, 14.0, 48.3, 37.9, 4820, 371, 317],
});

const IPN = build("IPN", SRC_IPN, {
  "80": [80, 42, 3.9, 5.9, 7.57, 5.94, 77.8, null, 6.29],
  "100": [100, 50, 4.5, 6.8, 10.6, 8.34, 171, null, 12.2],
  "120": [120, 58, 5.1, 7.7, 14.2, 11.1, 328, null, 21.5],
  "140": [140, 66, 5.7, 8.6, 18.2, 14.3, 573, null, 35.2],
  "160": [160, 74, 6.3, 9.5, 22.8, 17.9, 935, null, 54.7],
  "180": [180, 82, 6.9, 10.4, 27.9, 21.9, 1450, null, 81.3],
  "200": [200, 90, 7.5, 11.3, 33.4, 26.2, 2140, null, 117],
  "220": [220, 98, 8.1, 12.2, 39.5, 31.1, 3060, null, 162],
  "240": [240, 106, 8.7, 13.1, 46.1, 36.2, 4250, null, 221],
  "260": [260, 113, 9.4, 14.1, 53.3, 41.9, 5740, null, 288],
});

const IPE = build("IPE", SRC_IPE, {
  "80": [80, 46, 3.8, 5.2, 7.6, 6.0, 80.1, 20.0, 8.49],
  "100": [100, 55, 4.1, 5.7, 10.3, 8.1, 171, 34.2, 15.9],
  "120": [120, 64, 4.4, 6.3, 13.2, 10.4, 318, 53.0, 27.7],
  "140": [140, 73, 4.7, 6.9, 16.4, 12.9, 541, 77.3, 44.9],
  "160": [160, 82, 5.0, 7.4, 20.1, 15.8, 869, 109, 68.3],
  "180": [180, 91, 5.3, 8.0, 23.9, 18.8, 1320, 146, 101],
  "200": [200, 100, 5.6, 8.5, 28.5, 22.4, 1940, 194, 142],
  "220": [220, 110, 5.9, 9.2, 33.4, 26.2, 2770, 252, 205],
  "240": [240, 120, 6.2, 9.8, 39.1, 30.7, 3890, 324, 284],
  "270": [270, 135, 6.6, 10.2, 45.9, 36.1, 5790, 429, 420],
  "300": [300, 150, 7.1, 10.7, 53.8, 42.2, 8360, 557, 604],
});

const HEA = build("HEA", SRC_HEA, {
  "100": [96, 100, 5.0, 8.0, 21.2, 16.7, 349, 72.8, 134],
  "120": [114, 120, 5.0, 8.0, 25.3, 19.9, 606, 106, 231],
  "140": [133, 140, 5.5, 8.5, 31.4, 24.7, 1030, 155, 389],
  "160": [152, 160, 6.0, 9.0, 38.8, 30.4, 1670, 220, 616],
  "180": [171, 180, 6.0, 9.5, 45.3, 35.5, 2510, 294, 925],
  "200": [190, 200, 6.5, 10.0, 53.8, 42.3, 3690, 389, 1340],
  "220": [210, 220, 7.0, 11.0, 64.3, 50.5, 5410, 515, 1960],
  "240": [230, 240, 7.5, 12.0, 76.8, 60.3, 7760, 675, 2770],
  "260": [250, 260, 7.5, 12.5, 86.8, 68.2, 10400, 836, 3670],
});

/** Toutes les sections, par famille puis par taille croissante. */
export const STEEL_SECTIONS: readonly SteelSection[] = [...UPN, ...IPN, ...IPE, ...HEA];

const byName = new Map(STEEL_SECTIONS.map((s) => [s.name, s]));

/** Section par désignation (`UPN 160`, espaces multiples tolérés), ou `undefined`. */
export function findSection(name: string): SteelSection | undefined {
  return byName.get(name.trim().replace(/\s+/g, " ").toUpperCase());
}

/** Sections d'une famille, de la plus légère à la plus lourde. */
export function sectionsOf(family: SectionFamily): SteelSection[] {
  return STEEL_SECTIONS.filter((s) => s.family === family).sort(
    (a, b) => a.massPerMeter - b.massPerMeter,
  );
}

/**
 * Désignation d'une section repérée dans un libellé de pièce (ex. `UPN 160 (S235)`), ou
 * `undefined`. Un `Message` (`Part.section`) est lu dans sa traduction française : les
 * désignations commerciales ne sont pas traduites.
 */
export function sectionInLabel(label: string | Message | undefined): SteelSection | undefined {
  const text = isMessage(label) ? translatorFor("fr").t(label) : label;
  if (!text) return undefined;
  const m = /\b(UPN|IPN|IPE|HEA)\s*(\d{2,3})\b/i.exec(text);
  return m ? findSection(`${m[1]} ${m[2]}`) : undefined;
}

/** Profil plan de la section (x : travers, depuis la face côté marches ; y : hauteur), CCW. */
export function sectionOutline(s: SteelSection): { x: Mm; y: Mm }[] {
  const { h, b, tw, tf } = s;
  if (s.shape === "U") {
    return [
      { x: 0, y: 0 },
      { x: b, y: 0 },
      { x: b, y: tf },
      { x: tw, y: tf },
      { x: tw, y: h - tf },
      { x: b, y: h - tf },
      { x: b, y: h },
      { x: 0, y: h },
    ];
  }
  const w0 = (b - tw) / 2;
  const w1 = (b + tw) / 2;
  return [
    { x: 0, y: 0 },
    { x: b, y: 0 },
    { x: b, y: tf },
    { x: w1, y: tf },
    { x: w1, y: h - tf },
    { x: b, y: h - tf },
    { x: b, y: h },
    { x: 0, y: h },
    { x: 0, y: h - tf },
    { x: w0, y: h - tf },
    { x: w0, y: tf },
    { x: 0, y: tf },
  ];
}

/** Périmètre de la section (surface à traiter par mètre = périmètre), mm. */
export function sectionPerimeter(s: SteelSection): Mm {
  const pts = sectionOutline(s);
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const c = pts[(i + 1) % pts.length]!;
    p += Math.hypot(c.x - a.x, c.y - a.y);
  }
  return p;
}
