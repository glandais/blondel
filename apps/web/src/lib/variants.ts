/**
 * Comparateur de variantes de structure (CHALLENGE P2) côté interface : choix des variantes à
 * comparer pour le tracé courant et mise en forme du tableau côte à côte. Le calcul est celui
 * du cœur (`compareVariants`) ; il est lancé dans le Web Worker de comparaison
 * (`model/model.worker.ts`), jamais sur le fil principal de l'application.
 */
import {
  compareVariants,
  type Project,
  type Severity,
  type StructureKind,
  type VariantSummary,
} from "@blondel/core";

/** Variante à comparer : une structure et, éventuellement, des paramètres imposés. */
export interface Variant {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  /** Paramètres imposés (fusionnés sur ceux du projet quand la structure est la même). */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** Résultat d'une variante sans son `Model` (inutile à l'affichage, coûteux à transmettre). */
export type VariantRow = Omit<VariantSummary, "model"> & {
  readonly id: string;
  /** Variante identique à la structure du projet (paramètres compris). */
  readonly current: boolean;
  /** Paramètres effectivement comparés (pour « appliquer cette variante »). */
  readonly params: Readonly<Record<string, unknown>>;
};

export interface CompareOutcome {
  readonly rows: readonly VariantRow[];
  readonly timeMs: number;
  /** Échec du calcul de la comparaison elle-même (worker et repli), message affiché. */
  readonly error?: string;
}

/**
 * Variantes proposées pour un projet : limons bois à la française ; crémaillères bois « à
 * l'anglaise » si l'escalier est droit (le plugin refuse les tournants) ; limons en plat découpé
 * laser ; profilés UPN et IPE. Seules les structures enregistrées dans le cœur sont retenues ; la
 * structure courante est ajoutée si elle n'est pas déjà couverte (ex. profilés HEA).
 */
export function variantsFor(
  project: Project,
  available: readonly Pick<StructureKind, "kind">[],
): Variant[] {
  const has = (k: string) => available.some((a) => a.kind === k);
  const straight = project.stair.layout.turns.length === 0;
  const out: Variant[] = [];
  if (has("wood-housed")) {
    out.push({ id: "wood-housed", kind: "wood-housed", label: "Bois — limons à la française" });
  }
  if (has("wood-cut") && straight) {
    out.push({ id: "wood-cut", kind: "wood-cut", label: "Bois — crémaillères à l'anglaise" });
  }
  if (has("steel-flat")) {
    out.push({ id: "steel-flat", kind: "steel-flat", label: "Acier — plat découpé laser" });
  }
  if (has("steel-profile")) {
    for (const family of ["UPN", "IPE"] as const) {
      out.push({
        id: `steel-profile-${family}`,
        kind: "steel-profile",
        label: `Acier — profilés ${family}`,
        params: { family, section: "auto" },
      });
    }
  }
  const cur = project.stair.structure;
  if (cur.kind !== "none" && has(cur.kind)) {
    const family = cur.params["family"];
    const covered = out.some(
      (v) =>
        v.kind === cur.kind &&
        (v.params === undefined || family === undefined || v.params["family"] === family),
    );
    if (!covered) {
      out.push({ id: `current-${cur.kind}`, kind: cur.kind, label: "Structure du projet" });
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Paramètres d'une variante : ceux du projet si même structure, complétés des paramètres imposés. */
export function variantParams(project: Project, v: Variant): Record<string, unknown> {
  const own = project.stair.structure.kind === v.kind ? project.stair.structure.params : {};
  const base: Record<string, unknown> = isPlainObject(own) ? { ...own } : {};
  if (!v.params) return base;
  // Section du catalogue gardée seulement si la famille ne change pas.
  const out = { ...base, ...v.params };
  if (v.params["family"] !== undefined && base["family"] === v.params["family"]) {
    if (base["section"] !== undefined) out["section"] = base["section"];
  }
  return out;
}

/** La variante correspond-elle à la structure du projet (mêmes paramètres) ? */
function isCurrent(project: Project, v: Variant, params: Record<string, unknown>): boolean {
  const cur = project.stair.structure;
  if (cur.kind !== v.kind) return false;
  const fam = (p: unknown) => (isPlainObject(p) ? (p["family"] ?? "UPN") : undefined);
  return v.params === undefined || fam(cur.params) === fam(params);
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/** Calcule les variantes (une par appel du comparateur du cœur) ; ne lève jamais. */
export function runVariants(project: Project, variants: readonly Variant[]): CompareOutcome {
  const t0 = now();
  const rows: VariantRow[] = [];
  for (const v of variants) {
    const params = variantParams(project, v);
    try {
      const [summary] = compareVariants(project, [v.kind], { params: { [v.kind]: params } });
      if (!summary) continue;
      const { model: _model, ...rest } = summary;
      rows.push({
        ...rest,
        id: v.id,
        label: v.label,
        current: isCurrent(project, v, params),
        params,
      });
    } catch (e) {
      rows.push(failedRow(v, params, e));
    }
  }
  return { rows, timeMs: now() - t0 };
}

const ZERO: Readonly<Record<Severity, number>> = { bloquant: 0, avertissement: 0, conseil: 0 };

function failedRow(v: Variant, params: Record<string, unknown>, e: unknown): VariantRow {
  return {
    id: v.id,
    kind: v.kind,
    label: v.label,
    current: false,
    params,
    family: null,
    massKg: 0,
    massUnknown: 0,
    surfaceM2: 0,
    partCount: 0,
    uniqueParts: 0,
    weldMm: 0,
    buttWeldMm: 0,
    bends: 0,
    cuts: 0,
    holes: 0,
    executionClass: null,
    violations: ZERO,
    precheck: { beams: 0, violations: ZERO },
    errors: [`Comparaison impossible : ${e instanceof Error ? e.message : String(e)}`],
    cost: null,
    costMissing: [],
  };
}

// ------------------------------------------------------------------ Mise en forme

const nf = (digits: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const kg = nf(1);
const m2 = nf(2);
const int = nf(0);
const m = nf(2);
const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Libellés français des champs du barème (profil d'atelier, `costs`). */
export const COST_FIELD_LABELS: Readonly<Record<string, string>> = {
  hourlyRate: "taux horaire",
  minutesPerCut: "temps par coupe",
  minutesPerWeldMeter: "temps par mètre de cordon",
  minutesPerBend: "temps par pli",
  minutesPerHole: "temps par perçage",
  minutesPerUniquePart: "temps par pièce unique",
  steelPricePerKg: "prix de l'acier",
  woodPricePerM3: "prix du bois",
  finishPricePerM2: "prix de finition",
};

function severities(v: Readonly<Record<Severity, number>>): string {
  const total = v.bloquant + v.avertissement + v.conseil;
  if (total === 0) return "aucune";
  const parts: string[] = [];
  if (v.bloquant > 0) parts.push(`${v.bloquant} bloquante${v.bloquant > 1 ? "s" : ""}`);
  if (v.avertissement > 0) {
    parts.push(`${v.avertissement} avertissement${v.avertissement > 1 ? "s" : ""}`);
  }
  if (v.conseil > 0) parts.push(`${v.conseil} conseil${v.conseil > 1 ? "s" : ""}`);
  return parts.join(", ");
}

export interface CompareLine {
  readonly key: string;
  readonly label: string;
  /** Une cellule par variante. */
  readonly cells: readonly {
    readonly text: string;
    readonly title?: string;
    readonly tone?: "bad" | "warn" | "muted";
  }[];
}

/** Lignes du tableau côte à côte (une colonne par variante). */
export function compareLines(rows: readonly VariantRow[]): CompareLine[] {
  const line = (
    key: string,
    label: string,
    cell: (r: VariantRow) => CompareLine["cells"][number],
  ): CompareLine => ({ key, label, cells: rows.map(cell) });
  return [
    line("mass", "Masse", (r) =>
      r.massUnknown > 0
        ? {
            text: `${kg.format(r.massKg)} kg`,
            title: `${r.massUnknown} pièce(s) sans masse connue, non comptée(s)`,
            tone: "warn",
          }
        : { text: `${kg.format(r.massKg)} kg` },
    ),
    line("surface", "Surface (traitée ou de référence)", (r) => ({
      text: `${m2.format(r.surfaceM2)} m²`,
    })),
    line("parts", "Pièces", (r) => ({ text: int.format(r.partCount) })),
    line("unique", "Pièces uniques", (r) => ({ text: int.format(r.uniqueParts) })),
    line("weld", "Cordons de soudure", (r) =>
      r.weldMm > 0
        ? {
            text: `${m.format(r.weldMm / 1000)} m`,
            ...(r.buttWeldMm > 0
              ? { title: `dont ${m.format(r.buttWeldMm / 1000)} m bout à bout` }
              : {}),
          }
        : { text: "–", tone: "muted" },
    ),
    line("bends", "Plis", (r) =>
      r.bends > 0 ? { text: int.format(r.bends) } : { text: "–", tone: "muted" },
    ),
    line("cuts", "Coupes", (r) => ({ text: int.format(r.cuts) })),
    line("holes", "Perçages", (r) =>
      r.holes > 0 ? { text: int.format(r.holes) } : { text: "–", tone: "muted" },
    ),
    line("exc", "Classe d'exécution", (r) =>
      r.executionClass
        ? { text: r.executionClass, ...(r.executionClass === "EXC2" ? { tone: "warn" } : {}) }
        : { text: r.family === "metal" ? "non déterminée" : "sans objet", tone: "muted" },
    ),
    line("violations", "Violations (contrôle de conception)", (r) => ({
      text: severities(r.violations),
      ...(r.violations.bloquant > 0
        ? { tone: "bad" }
        : r.violations.avertissement > 0
          ? { tone: "warn" }
          : {}),
    })),
    line("precheck", "Prédimensionnement indicatif", (r) =>
      r.precheck.beams === 0
        ? { text: "aucun limon évalué", tone: "muted" }
        : {
            text: `${r.precheck.beams} limon(s) : ${severities(r.precheck.violations)}`,
            ...(r.precheck.violations.bloquant > 0 ? { tone: "bad" } : {}),
          },
    ),
    line("cost", "Coût estimé (€ HT)", (r) =>
      r.cost
        ? {
            text: eur.format(r.cost.total),
            title: `matière ${eur.format(r.cost.material)}, main-d'œuvre ${eur.format(r.cost.labour)} (${m.format(r.cost.hours)} h), finition ${eur.format(r.cost.finish)}`,
          }
        : {
            text: "profil d'atelier requis",
            tone: "muted",
            ...(r.costMissing.length > 0
              ? {
                  title: `Barème incomplet : ${r.costMissing.map((f) => COST_FIELD_LABELS[f] ?? f).join(", ")}`,
                }
              : {}),
          },
    ),
    line("errors", "Erreurs de génération", (r) =>
      r.errors.length > 0
        ? { text: `${r.errors.length}`, title: r.errors.join("\n"), tone: "bad" }
        : { text: "aucune", tone: "muted" },
    ),
  ];
}
