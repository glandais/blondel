/**
 * Fiche de débit : pièces regroupées par matériau et épaisseur (ou section), avec les
 * dimensions de débit, les longueurs, volumes bruts et masses cumulés par groupe.
 *
 * Dimensions de débit : `Part.stock` (L × l × e brut) si renseigné, sinon la boîte englobante
 * du développé (`Part.flat`, L ≥ l, e = épaisseur du développé) : flan de tôle ou de plat à
 * découper. Pièce sans l'un ni l'autre : dimensions vides. Aucune surcote n'est ajoutée ici
 * (le débit brut du cœur les porte déjà) ; aucune masse n'est inventée : seule la grandeur
 * `mass` (kg, clé historique lue aussi par la liste de débit CSV) est cumulée, et un total
 * est déclaré incomplet dès qu'une pièce n'en a pas.
 *
 * Regroupement : par **épaisseur** seulement pour un débit en plaque (tôle, plat, plateau de
 * bois), c.-à-d. quand l'épaisseur de débit est une épaisseur de matière : pièce en bois, ou
 * pièce dont le développé a cette épaisseur. Les profilés et tubes (UPN, cornières, tubes,
 * ronds) portent dans `stock` leur encombrement (h × b, Ø × paroi…) : ils sont groupés par
 * **section** et n'ont pas de volume brut (L × l × e serait le volume de leur boîte).
 */
import { bbox, type MaterialId, type Part } from "@blondel/core";
import { MATERIAL_LABELS, QUANTITY_MASS } from "./csv/cutlist.js";

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
  };
}

function compareMarks(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
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
export function cutSheet(parts: readonly Part[]): CutSheetGroup[] {
  // Lignes : pièces identiques (même repère et même débit) regroupées.
  const lines = new Map<
    string,
    { part: Part; row: Omit<CutSheetRow, "quantity">; sheet: boolean; count: number }
  >();
  for (const p of parts) {
    const d = cutDims(p);
    const mass = p.quantities[QUANTITY_MASS];
    const key = JSON.stringify([
      p.mark,
      p.material,
      p.section ?? null,
      d.length ?? null,
      d.width ?? null,
      d.thickness ?? null,
      mass ?? null,
    ]);
    const l = lines.get(key);
    if (l) l.count += 1;
    else
      lines.set(key, {
        part: p,
        sheet: isSheetStock(p, d),
        count: 1,
        row: {
          mark: p.mark,
          name: p.name,
          section: p.section ?? "",
          ...d,
          ...(finite(mass) ? { unitMass: mass } : {}),
        },
      });
  }
  const groups = new Map<
    string,
    { material: MaterialId; thickness?: number; section?: string; rows: CutSheetRow[] }
  >();
  for (const { part, row, sheet, count } of lines.values()) {
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
    g.rows.sort((a, b) => compareMarks(a.mark, b.mark));
    let quantity = 0;
    let lengthM = 0;
    let volume: number | undefined = 0;
    let mass: number | undefined = 0;
    for (const r of g.rows) {
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
      materialLabel: MATERIAL_LABELS[g.material] ?? g.material,
      basis: g.thickness !== undefined ? "thickness" : "section",
      ...(g.thickness !== undefined ? { thickness: g.thickness } : {}),
      ...(g.section !== undefined ? { section: g.section } : {}),
      rows: g.rows,
      totals: {
        quantity,
        lengthM,
        ...(volume !== undefined ? { volumeM3: volume } : {}),
        ...(mass !== undefined ? { massKg: mass } : {}),
      },
    });
  }
  return out.sort(
    (a, b) =>
      a.materialLabel.localeCompare(b.materialLabel, "fr") ||
      (a.thickness ?? Infinity) - (b.thickness ?? Infinity) ||
      (a.section ?? "").localeCompare(b.section ?? "", "fr"),
  );
}
