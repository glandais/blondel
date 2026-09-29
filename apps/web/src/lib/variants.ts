/**
 * Comparateur de variantes de structure (CHALLENGE P2) côté interface : choix des variantes à
 * comparer pour le tracé courant et mise en forme du tableau côte à côte. Le calcul est celui
 * du cœur (`compareEpure` : même épure, raccord de jour adapté à chaque structure — poteau
 * d'angle pour les limons droits et les profilés, jour en arc roulable pour le débillardé
 * `steel-curved`, critère d'acceptation n° 2) ; il est lancé dans le Web Worker de comparaison
 * (`model/model.worker.ts`), jamais sur le fil principal de l'application. Les écarts d'épure
 * sont mesurés par rapport à la variante de la structure du projet (à défaut, la première).
 */
import {
  compareEpure,
  deepMerge,
  epureDeviations,
  getStructure,
  stableStringify,
  type EpureSummary,
  type InnerCorner,
  type JourAdaptation,
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
  /** Raccords de jour adaptés à la structure (appliqués avec la variante). */
  readonly adaptations: readonly JourAdaptation[];
  /** Incompatibilités de la structure avec l'épure du projet (adaptées ou non). */
  readonly signals: readonly string[];
  /** Écarts d'épure par rapport à la variante de référence (structure du projet). */
  readonly deviations: readonly string[];
  /** Variante de référence des écarts d'épure. */
  readonly reference: boolean;
  /** Épure effective de la variante ; `null` si la comparaison a échoué. */
  readonly epure: EpureSummary | null;
  /**
   * Variante en échec (comparaison levée, ou modèle sans pièce avec erreurs de génération) :
   * ses grandeurs ne sont pas mesurées et s'affichent « – », jamais 0 (QUESTIONS A21 c).
   */
  readonly failed?: boolean;
};

export interface CompareOutcome {
  readonly rows: readonly VariantRow[];
  readonly timeMs: number;
  /** Échec du calcul de la comparaison elle-même (worker et repli), message affiché. */
  readonly error?: string;
}

/**
 * Variantes proposées pour un projet à volées : limons bois à la française ; crémaillères bois
 * « à l'anglaise » si l'escalier est droit (le plugin refuse les tournants) ; limons en plat
 * découpé laser ; limon de jour débillardé soudé s'il y a un tournant (jour adapté en arc) ;
 * profilés UPN et IPE. Hélicoïdal : structure à fût, marches bois ou en tôle. Seules les
 * structures enregistrées dans le cœur sont retenues ; la structure courante est ajoutée si elle
 * n'est pas déjà couverte (ex. profilés HEA).
 */
export function variantsFor(
  project: Project,
  available: readonly Pick<StructureKind, "kind">[],
): Variant[] {
  const has = (k: string) => available.some((a) => a.kind === k);
  const out: Variant[] = [];
  if (project.stair.layout.kind === "helical") {
    if (has("helical-core")) {
      out.push(
        {
          id: "helical-core-wood",
          kind: "helical-core",
          label: "Fût acier — marches bois",
          params: { treads: { material: "wood" } },
        },
        {
          id: "helical-core-steel",
          kind: "helical-core",
          label: "Fût acier — marches en tôle",
          params: { treads: { material: "steel" } },
        },
      );
    }
    return withCurrent(project, out, has);
  }
  const straight = project.stair.layout.turns.length === 0;
  if (has("wood-housed")) {
    out.push({ id: "wood-housed", kind: "wood-housed", label: "Bois — limons à la française" });
  }
  if (has("wood-cut") && straight) {
    out.push({ id: "wood-cut", kind: "wood-cut", label: "Bois — crémaillères à l'anglaise" });
  }
  if (has("steel-flat")) {
    out.push({ id: "steel-flat", kind: "steel-flat", label: "Acier — plat découpé laser" });
  }
  if (has("steel-curved") && !straight) {
    out.push({
      id: "steel-curved",
      kind: "steel-curved",
      label: "Acier — limon de jour débillardé soudé",
    });
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
  return withCurrent(project, out, has);
}

/** Ajoute la structure du projet si aucune variante ne la couvre déjà. */
function withCurrent(project: Project, out: Variant[], has: (k: string) => boolean): Variant[] {
  const cur = project.stair.structure;
  if (cur.kind !== "none" && has(cur.kind)) {
    const covered = out.some((v) => isCurrent(project, v, variantParams(project, v)));
    if (!covered) {
      out.push({ id: `current-${cur.kind}`, kind: cur.kind, label: "Structure du projet" });
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Paramètres d'une variante : ceux du projet si même structure, complétés des paramètres imposés
 * (fusion profonde : un sous-objet imposé ne remplace que ses propres champs).
 */
export function variantParams(project: Project, v: Variant): Record<string, unknown> {
  const own = project.stair.structure.kind === v.kind ? project.stair.structure.params : {};
  const base: Record<string, unknown> = isPlainObject(own) ? { ...own } : {};
  if (!v.params) return base;
  // Section du catalogue gardée seulement si la famille ne change pas.
  const out = deepMerge(base, v.params);
  if (v.params["family"] !== undefined && base["family"] === v.params["family"]) {
    if (base["section"] !== undefined) out["section"] = base["section"];
  }
  return out;
}

/** Paramètres complets (défauts du plugin) ; tels quels si le plugin est absent ou les refuse. */
function fullParams(kind: string, params: unknown): Record<string, unknown> {
  const parsed = getStructure(kind)?.paramsSchema.safeParse(params);
  const out = parsed?.success ? parsed.data : params;
  return isPlainObject(out) ? out : {};
}

/**
 * La variante correspond-elle à la structure du projet ? Même structure et mêmes valeurs (défauts
 * du plugin compris) pour chaque paramètre que la variante impose — la section d'un profilé
 * exceptée (`auto` ou choisie, c'est la même famille).
 */
function isCurrent(project: Project, v: Variant, params: Record<string, unknown>): boolean {
  const cur = project.stair.structure;
  if (cur.kind !== v.kind) return false;
  if (v.params === undefined) return true;
  const mine = fullParams(v.kind, cur.params);
  const theirs = fullParams(v.kind, params);
  return Object.keys(v.params).every(
    (k) => k === "section" || stableStringify(mine[k]) === stableStringify(theirs[k]),
  );
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * Calcule les variantes sur la même épure (un appel de `compareEpure` par variante, pour qu'un
 * échec reste local) puis les écarts d'épure par rapport à la variante de la structure du projet
 * (à défaut, la première calculée) ; ne lève jamais.
 */
export function runVariants(project: Project, variants: readonly Variant[]): CompareOutcome {
  const t0 = now();
  const rows: VariantRow[] = [];
  for (const v of variants) {
    const params = variantParams(project, v);
    try {
      const [summary] = compareEpure(project, [{ kind: v.kind, params, jour: "adapt" }]);
      if (!summary) continue;
      const { model: _model, deviations: _deviations, ...rest } = summary;
      rows.push({
        ...rest,
        id: v.id,
        label: v.label,
        current: isCurrent(project, v, params),
        params,
        deviations: [],
        reference: false,
      });
    } catch (e) {
      rows.push(failedRow(v, params, e));
    }
  }
  const marked = markFailedVariants(rows);
  const ref = marked.find((r) => r.current && r.epure) ?? marked.find((r) => r.epure);
  const out = marked.map((r) =>
    r === ref
      ? { ...r, reference: true }
      : ref?.epure && r.epure
        ? { ...r, deviations: epureDeviations(ref.epure, r.epure) }
        : r,
  );
  return { rows: out, timeMs: now() - t0 };
}

/**
 * Variantes en échec (QUESTIONS A21 c) : comparaison levée (déjà marquée), modèle sans pièce
 * avec erreurs, ou erreur de génération **propre à la variante** (absente d'au moins une autre
 * variante). Quand le plugin de structure lève, le cœur garde les pièces de base (marches,
 * contremarches) : la variante aurait une masse et un coût non nuls mais partiels, et paraîtrait
 * plus légère ou moins chère que les autres. Une erreur commune à toutes les variantes (niveau
 * projet : tracé, garde-corps…) ne rend aucune variante en échec : leurs grandeurs restent
 * comparables entre elles.
 */
export function markFailedVariants(rows: readonly VariantRow[]): VariantRow[] {
  const common =
    rows.length === 0
      ? new Set<string>()
      : rows
          .slice(1)
          .reduce(
            (acc, r) => new Set([...acc].filter((e) => r.errors.includes(e))),
            new Set(rows[0]!.errors),
          );
  return rows.map((r) =>
    r.failed === true ||
    (r.errors.length > 0 && r.partCount === 0) ||
    r.errors.some((e) => !common.has(e))
      ? { ...r, failed: true }
      : r,
  );
}

/**
 * Projet après application d'une variante : sa structure et ses paramètres, et les raccords de
 * jour adaptés par le comparateur (même épure que celle qui a été comparée).
 */
export function applyVariant(
  project: Project,
  row: Pick<VariantRow, "kind" | "params" | "adaptations">,
): Project {
  const turns = project.stair.layout.turns;
  const adapted = row.adaptations.filter((a) => a.turn < turns.length);
  const layout =
    adapted.length === 0 || project.stair.layout.kind === "helical"
      ? project.stair.layout
      : {
          ...project.stair.layout,
          turns: turns.map((t, i) => {
            const a = adapted.find((x) => x.turn === i);
            return a ? { ...t, inner: a.to } : t;
          }),
        };
  return {
    ...project,
    stair: {
      ...project.stair,
      layout,
      structure: { kind: row.kind, params: { ...row.params } },
    },
  };
}

/** Raccord de jour lisible (« poteau 100 mm », « arc R 250 mm », « vif »). */
export function jourText(c: InnerCorner): string {
  return c.kind === "arc"
    ? `arc R ${int.format(c.radius)} mm`
    : c.kind === "newel"
      ? `poteau ${int.format(c.size)} mm`
      : "vif";
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
    adaptations: [],
    signals: [],
    deviations: [],
    reference: false,
    epure: null,
    failed: true,
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

/** Lignes des grandeurs mesurées sur le modèle de la variante (« – » si elle est en échec). */
const MEASURED_LINES: ReadonlySet<string> = new Set([
  "mass",
  "surface",
  "parts",
  "unique",
  "weld",
  "bends",
  "cuts",
  "holes",
  "exc",
  "violations",
  "precheck",
  "cost",
  "jour",
]);

const FAILED_CELL: CompareLine["cells"][number] = {
  text: "–",
  title: "Variante en échec : grandeur non calculée",
  tone: "muted",
};

/** Lignes du tableau côte à côte (une colonne par variante). */
export function compareLines(rows: readonly VariantRow[]): CompareLine[] {
  const line = (
    key: string,
    label: string,
    cell: (r: VariantRow) => CompareLine["cells"][number],
  ): CompareLine => ({
    key,
    label,
    // Variante en échec : grandeur non mesurée, « – » (un 0 laisserait croire à une variante
    // plus légère ou moins chère) ; seules les lignes d'erreurs et d'écarts restent lisibles.
    cells: rows.map((r) => (r.failed === true && MEASURED_LINES.has(key) ? FAILED_CELL : cell(r))),
  });
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
    line("jour", "Raccord de jour (épure adaptée)", (r) =>
      r.adaptations.length > 0
        ? {
            text: r.adaptations.map((a) => `T${a.turn + 1} : ${jourText(a.to)}`).join(", "),
            title: r.signals.join("\n"),
            tone: "warn",
          }
        : r.signals.length > 0
          ? { text: "non adapté", title: r.signals.join("\n"), tone: "bad" }
          : { text: "inchangé", tone: "muted" },
    ),
    line("deviations", "Écarts d'épure", (r) =>
      r.reference
        ? { text: "référence", tone: "muted" }
        : r.deviations.length > 0
          ? { text: `${r.deviations.length} écart(s)`, title: r.deviations.join("\n") }
          : { text: r.epure ? "aucun" : "–", tone: "muted" },
    ),
    line("errors", "Erreurs de génération", (r) =>
      r.errors.length > 0
        ? { text: `${r.errors.length}`, title: r.errors.join("\n"), tone: "bad" }
        : { text: "aucune", tone: "muted" },
    ),
  ];
}
