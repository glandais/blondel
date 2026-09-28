/**
 * Présentation du contrôle de conception (CHALLENGE P3) : regroupement des résultats rendus
 * par le cœur. Aucune règle n'est évaluée ici.
 */
import type { ComplianceReport, Location, Model, RuleResult, Severity } from "@blondel/core";

export const SEVERITY_ORDER: readonly Severity[] = ["bloquant", "avertissement", "conseil"];

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  bloquant: "Bloquant",
  avertissement: "Avertissement",
  conseil: "Conseil",
};

export interface ComplianceGroups {
  /** Violations par sévérité effective, dans l'ordre bloquant → conseil. */
  readonly violations: readonly {
    readonly severity: Severity;
    readonly results: readonly RuleResult[];
  }[];
  readonly notEvaluated: readonly RuleResult[];
  readonly passed: readonly RuleResult[];
}

export function groupResults(report: ComplianceReport | undefined): ComplianceGroups {
  const results = report?.results ?? [];
  const by = new Map<Severity, RuleResult[]>(SEVERITY_ORDER.map((s) => [s, []]));
  const notEvaluated: RuleResult[] = [];
  const passed: RuleResult[] = [];
  for (const r of results) {
    if (r.status === "violation") by.get(r.severity)?.push(r);
    else if (r.status === "non-evaluee") notEvaluated.push(r);
    else passed.push(r);
  }
  return {
    violations: SEVERITY_ORDER.map((severity) => ({ severity, results: by.get(severity) ?? [] })),
    notEvaluated,
    passed,
  };
}

/** Libellé court d'une localisation. */
export function locationLabel(loc: Location): string {
  switch (loc.kind) {
    case "stair":
      return "Escalier";
    case "tread":
      return `Marche ${loc.number}`;
    case "nosing":
      return `Nez ${loc.index}`;
    case "part":
      return `Pièce ${loc.partId}`;
    case "point":
      return "Point";
  }
}

/** Deux localisations désignent-elles le même élément ? */
export function sameLocation(a: Location, b: Location): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "stair":
      return true;
    case "tread":
      return a.number === (b as typeof a).number;
    case "nosing":
      return a.index === (b as typeof a).index;
    case "part":
      return a.partId === (b as typeof a).partId;
    case "point": {
      const p = (b as typeof a).at;
      return a.at.x === p.x && a.at.y === p.y && a.at.z === p.z;
    }
  }
}

/**
 * Identifiant de pièce correspondant à une marche. Convention de `Part.id` (derived.ts :
 * « ex. `tread-5` ») ; à remplacer par un champ explicite si le cœur en ajoute un.
 */
export function treadPartId(number: number): string {
  return `tread-${number}`;
}

/** Une pièce est-elle désignée par la localisation sélectionnée ? */
export function isPartSelected(partId: string, loc: Location | undefined | null): boolean {
  if (!loc) return false;
  if (loc.kind === "part") return loc.partId === partId;
  if (loc.kind === "tread") return partId === treadPartId(loc.number);
  return false;
}

/** Numéro de marche désigné par la localisation (marche, ou pièce `tread-N`). */
export function selectedTreadNumber(loc: Location | undefined | null): number | undefined {
  if (!loc) return undefined;
  if (loc.kind === "tread") return loc.number;
  if (loc.kind === "part") {
    const m = /^tread-(\d+)$/.exec(loc.partId);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/**
 * Numéro de marche porté par l'attribut `data-tread` d'un SVG exporté : entier ≥ 1 écrit en
 * chiffres, sinon `undefined` (attribut absent ou vide : `Number("")` vaudrait 0).
 */
export function treadNumberFromAttribute(attr: string | null | undefined): number | undefined {
  if (attr === null || attr === undefined || !/^\d+$/.test(attr.trim())) return undefined;
  const n = Number(attr.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

/**
 * Remarques non bloquantes rendues par le cœur, dans l'ordre découpage → pipeline → contrôle,
 * sans doublon : `stepping.notes`, `Model.notes` (pièces non générées, modèle partiel) et
 * `ComplianceReport.notes` (contextes déduits, hypothèses de règles).
 */
export function modelNotes(model: Model | null | undefined): readonly string[] {
  if (!model) return [];
  const all = [...model.stepping.notes, ...(model.notes ?? []), ...(model.compliance.notes ?? [])];
  return [...new Set(all)];
}
