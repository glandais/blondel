/**
 * Fiche de débit : pièces regroupées par matériau et épaisseur (ou section), avec les
 * dimensions de débit, les longueurs, volumes bruts et masses cumulés par groupe.
 *
 * Dimensions de débit : `Part.stock` (L × l × e brut) si renseigné, sinon la boîte englobante
 * du développé (`Part.flat`, L ≥ l, e = épaisseur du développé) : flan de tôle ou de plat à
 * découper. Pièce sans l'un ni l'autre : dimensions vides. Aucune surcote n'est ajoutée ici
 * (le débit brut du cœur les porte déjà) ; aucune masse n'est inventée : seule la masse du
 * cœur (`mass_kg`, à défaut clé historique `mass` : `partMassKg`, comme la liste de débit CSV)
 * est cumulée, et un total est déclaré incomplet dès qu'une pièce n'en a pas. Une masse
 * calculée avec une masse volumique non validée porte une remarque (`massNote`, défaut : bois
 * « masse volumique à valider », QUESTIONS A6).
 *
 * Pièce composée de plusieurs lames identiques (`Part.stock.count`, lamellé-collé) : la ligne
 * porte le débit d'une lame et la quantité compte les lames (masse unitaire : part égale de la
 * pièce), de sorte que volumes bruts et masses cumulés restent ceux des pièces.
 *
 * Pièce finie faite de composantes (`Part.componentOf`) : seules les composantes sont listées
 * (`cutParts`, comme la liste de débit ; planches d'une couche composée, QUESTIONS A36 (9)).
 * Débit en placage (`Part.stock.supply = "veneer"`) :
 * désignation « … (placage) » et champ `supply` de la ligne.
 *
 * Regroupement : par **épaisseur** seulement pour un débit en plaque (tôle, plat, plateau de
 * bois), c.-à-d. quand l'épaisseur de débit est une épaisseur de matière : pièce en bois, ou
 * pièce dont le développé a cette épaisseur. Les profilés et tubes (UPN, cornières, tubes,
 * ronds) portent dans `stock` leur encombrement (h × b, Ø × paroi…) : ils sont groupés par
 * **section** et n'ont pas de volume brut (L × l × e serait le volume de leur boîte).
 */
import { bbox, GEOM_EPS, REL_EPS, type MaterialId, type Part } from "@blondel/core";
import {
  cutName,
  cutParts,
  defaultMassNote,
  partMassKg,
  supplyLabel,
  type MassNote,
} from "./csv/cutlist.js";
import { groupNear, nearlyEqualRelative } from "./grouping.js";
import {
  compareMarks,
  compareText,
  materialLabel,
  translatorOf,
  trOpt,
  type LocaleOption,
} from "./i18n.js";

export interface CutSheetRow {
  readonly mark: string;
  readonly name: string;
  readonly section: string;
  /** Débit L × l × e (mm) ; absents si inconnus. */
  readonly length?: number;
  readonly width?: number;
  readonly thickness?: number;
  /** Origine des dimensions : débit brut du cœur ou emprise du développé. */
  readonly source: "stock" | "flat" | "none";
  readonly quantity: number;
  /** Masse unitaire (kg), si fournie par le cœur. */
  readonly unitMass?: number;
  /** Remarque sur la masse (ex. « masse volumique à valider ») ; absente sans masse. */
  readonly massNote?: string;
  /** Approvisionnement traduit (« placage ») ; absent : débit ordinaire. */
  readonly supply?: string;
}

export interface CutSheetOptions extends LocaleOption {
  /** Remarque de masse par matériau (défaut : `defaultMassNote`). */
  readonly massNote?: MassNote;
}

export interface CutSheetGroup {
  readonly material: MaterialId;
  /** Critère du groupe : épaisseur (débit en plaque) ou section (profilés, tubes, ronds). */
  readonly basis: "thickness" | "section";
  readonly materialLabel: string;
  /** Épaisseur commune du groupe (mm) ; absente : groupe par section. */
  readonly thickness?: number;
  /** Section commune (groupes sans épaisseur de débit). */
  readonly section?: string;
  readonly rows: readonly CutSheetRow[];
  readonly totals: {
    readonly quantity: number;
    /** Σ L × quantité (m), sur les lignes de longueur connue. */
    readonly lengthM: number;
    /** Σ L × l × e × quantité (m³) ; absent si une dimension manque ou groupe par section. */
    readonly volumeM3?: number;
    /** Σ masse (kg) ; absent si une masse manque. */
    readonly massKg?: number;
    /** Remarques de masse des lignes du groupe (sans doublon). */
    readonly massNotes: readonly string[];
  };
}

function cutDims(p: Part): Pick<CutSheetRow, "length" | "width" | "thickness" | "source"> {
  if (p.stock) {
    return {
      length: p.stock.length,
      width: p.stock.width,
      thickness: p.stock.thickness,
      source: "stock",
    };
  }
  if (p.flat && p.flat.outline.outer.length >= 3) {
    const b = bbox(p.flat.outline.outer);
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    return {
      length: Math.max(w, h),
      width: Math.min(w, h),
      thickness: p.flat.thickness,
      source: "flat",
    };
  }
  return { source: "none" };
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

/** Débit en plaque : l'épaisseur de débit est une épaisseur de matière (voir l'en-tête). */
function isSheetStock(p: Part, d: Pick<CutSheetRow, "thickness" | "source">): boolean {
  if (!finite(d.thickness)) return false;
  if (p.material.startsWith("wood-")) return true;
  if (d.source === "flat") return true;
  return p.flat !== undefined && Math.abs(p.flat.thickness - d.thickness) < 1e-6;
}

/** Fiche de débit des pièces : groupes triés par matériau puis épaisseur. */
export function cutSheet(parts: readonly Part[], options: CutSheetOptions = {}): CutSheetGroup[] {
  const tx = translatorOf(options);
  const noteOf = options.massNote ?? defaultMassNote;
  // Lignes : pièces identiques (même repère et même débit) regroupées, débits comparés au bruit
  // d'arrondi près (`groupNear`, chantier `stable-tiebreaks`) : dimensions de débit à
  // `GEOM_EPS` (mm), masse unitaire à `REL_EPS` en relatif ; la ligne porte les valeurs de la
  // première pièce du groupe.
  const entries = cutParts(parts).map((p) => {
    const d = cutDims(p);
    // Lames identiques d'une pièce composée (lamellé-collé) : une ligne de débit par lame.
    const pieces =
      d.source === "stock" && p.stock?.count !== undefined && p.stock.count > 1 ? p.stock.count : 1;
    const partMass = partMassKg(p);
    const mass = partMass !== undefined ? partMass / pieces : undefined;
    return { p, d, pieces, mass };
  });
  const sameDim = (a: number | undefined, b: number | undefined): boolean =>
    a === undefined || b === undefined ? a === b : Math.abs(a - b) <= GEOM_EPS;
  const lines = groupNear(
    entries,
    (e) =>
      JSON.stringify([
        e.p.mark,
        e.p.material,
        trOpt(tx, e.p.section) ?? null,
        e.pieces,
        e.p.stock?.supply ?? null,
      ]),
    (a, b) =>
      sameDim(a.d.length, b.d.length) &&
      sameDim(a.d.width, b.d.width) &&
      sameDim(a.d.thickness, b.d.thickness) &&
      nearlyEqualRelative(a.mass, b.mass, REL_EPS),
  ).map((group) => {
    const { p, d, mass } = group[0]!;
    const note = mass !== undefined ? noteOf(p.material, tx) : undefined;
    const supply = supplyLabel(tx, p);
    const row: Omit<CutSheetRow, "quantity"> = {
      mark: p.mark,
      name: cutName(tx, p),
      section: trOpt(tx, p.section) ?? "",
      ...d,
      ...(finite(mass) ? { unitMass: mass } : {}),
      ...(note !== undefined && note !== "" ? { massNote: note } : {}),
      ...(supply !== undefined ? { supply } : {}),
    };
    return {
      part: p,
      sheet: isSheetStock(p, d),
      count: group.reduce((n, e) => n + e.pieces, 0),
      row,
    };
  });
  const groups = new Map<
    string,
    { material: MaterialId; thickness?: number; section?: string; rows: CutSheetRow[] }
  >();
  for (const { part, row, sheet, count } of lines) {
    const t = sheet && finite(row.thickness) ? Math.round(row.thickness * 1000) / 1000 : undefined;
    const gk = JSON.stringify([part.material, t ?? null, t === undefined ? row.section : null]);
    let g = groups.get(gk);
    if (!g) {
      g = {
        material: part.material,
        ...(t !== undefined ? { thickness: t } : { section: row.section }),
        rows: [],
      };
      groups.set(gk, g);
    }
    g.rows.push({ ...row, quantity: count });
  }
  const out: CutSheetGroup[] = [];
  for (const g of groups.values()) {
    g.rows.sort((a, b) => compareMarks(tx, a.mark, b.mark));
    let quantity = 0;
    let lengthM = 0;
    let volume: number | undefined = 0;
    let mass: number | undefined = 0;
    const notes = new Set<string>();
    for (const r of g.rows) {
      if (r.massNote !== undefined) notes.add(r.massNote);
      quantity += r.quantity;
      if (finite(r.length)) lengthM += (r.length * r.quantity) / 1000;
      if (
        g.thickness !== undefined &&
        finite(r.length) &&
        finite(r.width) &&
        finite(r.thickness) &&
        volume !== undefined
      ) {
        volume += (r.length * r.width * r.thickness * r.quantity) / 1e9;
      } else volume = undefined;
      if (finite(r.unitMass) && mass !== undefined) mass += r.unitMass * r.quantity;
      else mass = undefined;
    }
    out.push({
      material: g.material,
      materialLabel: materialLabel(tx, g.material),
      basis: g.thickness !== undefined ? "thickness" : "section",
      ...(g.thickness !== undefined ? { thickness: g.thickness } : {}),
      ...(g.section !== undefined ? { section: g.section } : {}),
      rows: g.rows,
      totals: {
        quantity,
        lengthM,
        ...(volume !== undefined ? { volumeM3: volume } : {}),
        ...(mass !== undefined ? { massKg: mass } : {}),
        massNotes: [...notes],
      },
    });
  }
  return out.sort(
    (a, b) =>
      compareText(tx, a.materialLabel, b.materialLabel) ||
      (a.thickness ?? Infinity) - (b.thickness ?? Infinity) ||
      compareText(tx, a.section ?? "", b.section ?? ""),
  );
}
