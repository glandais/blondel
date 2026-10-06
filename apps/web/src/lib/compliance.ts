/**
 * Présentation du contrôle de conception (CHALLENGE P3) : regroupement des résultats rendus
 * par le cœur. Aucune règle n'est évaluée ici.
 */
import type { ComplianceReport, Location, Model, Part, RuleResult, Severity } from "@blondel/core";
import { messageEquals, msg, textMessage, type Message, type MessageKey } from "@blondel/i18n";

export const SEVERITY_ORDER: readonly Severity[] = ["bloquant", "avertissement", "conseil"];

/** Clés des libellés des sévérités. */
export const SEVERITY_LABELS: Readonly<Record<Severity, MessageKey>> = {
  bloquant: "ui.label.severity.bloquant",
  avertissement: "ui.label.severity.avertissement",
  conseil: "ui.label.severity.conseil",
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

/** Libellé court d'une localisation (traduit à l'affichage : `t.t(locationLabel(loc))`). */
export function locationLabel(loc: Location): Message {
  switch (loc.kind) {
    case "stair":
      return msg("ui.lib.location.stair");
    case "tread":
      return msg("ui.lib.location.tread", { number: String(loc.number) });
    case "nosing":
      return msg("ui.lib.location.nosing", { index: String(loc.index) });
    case "part":
      return msg("ui.lib.location.part", { id: loc.partId });
    case "point":
      return msg("ui.lib.location.point");
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
    case "part": {
      const o = b as typeof a;
      return a.partId === o.partId && a.treadNumber === o.treadNumber;
    }
    case "point": {
      const p = (b as typeof a).at;
      return a.at.x === p.x && a.at.y === p.y && a.at.z === p.z;
    }
  }
}

/** Pièce vue par la sélection : identifiant et numéro de marche (`Part.treadNumber` du cœur). */
export interface SelectablePart {
  readonly partId: string;
  readonly treadNumber?: number | undefined;
}

/**
 * Identifiant de la pièce qui matérialise la marche `number` : champ explicite
 * `Part.treadNumber` du cœur (QUESTIONS D6), sans convention d'identifiant.
 */
export function treadPartId(
  parts: readonly Pick<Part, "id" | "treadNumber">[],
  number: number,
): string | undefined {
  return parts.find((p) => p.treadNumber === number)?.id;
}

/** Une pièce est-elle désignée par la localisation sélectionnée ? */
export function isPartSelected(part: SelectablePart, loc: Location | undefined | null): boolean {
  if (!loc) return false;
  if (loc.kind === "part") return loc.partId === part.partId;
  if (loc.kind === "tread") return part.treadNumber === loc.number;
  return false;
}

/**
 * Numéro de marche désigné par la localisation : marche, nez k (marche k + 1, comme
 * l'inspecteur Marche), marche visée sur une pièce (appui « LE1 · M6 »), ou pièce qui
 * matérialise une marche.
 */
export function selectedTreadNumber(
  loc: Location | undefined | null,
  parts: readonly Pick<Part, "id" | "treadNumber">[],
): number | undefined {
  if (!loc) return undefined;
  if (loc.kind === "tread") return loc.number;
  if (loc.kind === "nosing") return loc.index + 1;
  if (loc.kind === "part") {
    return loc.treadNumber ?? parts.find((p) => p.id === loc.partId)?.treadNumber;
  }
  return undefined;
}

/**
 * Sélection d'une pièce cliquée en 3D : la pièce qui matérialise une marche (`Part.treadNumber`)
 * sélectionne la marche (inspecteur Marche, bloc « Ligne de nez ») ; toute autre pièce, la pièce
 * (inspecteur Pièce) ; `null` (clic dans le vide) efface la sélection.
 */
export function partSelection(
  partId: string | null,
  parts: readonly Pick<Part, "id" | "treadNumber">[],
): { readonly location: Location } | null {
  if (partId === null) return null;
  const n = parts.find((p) => p.id === partId)?.treadNumber;
  return { location: n === undefined ? { kind: "part", partId } : { kind: "tread", number: n } };
}

/**
 * La sélection désigne-t-elle exactement la marche `n` (sans règle) ? Un second clic sur cette
 * marche efface alors la sélection ; sinon (pièce, nez, règle liés à la marche) il ouvre la
 * marche.
 */
export function isExactTreadSelection(
  selection: { readonly location: Location; readonly ruleId?: string | undefined } | null,
  n: number,
): boolean {
  return (
    selection !== null &&
    selection.ruleId === undefined &&
    selection.location.kind === "tread" &&
    selection.location.number === n
  );
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
 * Indice de nez porté par l'attribut `data-nosing-target` (cible de clic du nez d'arrivée posée
 * par l'interface) : entier ≥ 0 écrit en chiffres, sinon `undefined`.
 */
export function nosingIndexFromAttribute(attr: string | null | undefined): number | undefined {
  if (attr === null || attr === undefined || !/^\d+$/.test(attr.trim())) return undefined;
  const n = Number(attr.trim());
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Indice du nez désigné par la localisation sélectionnée (nez seulement), sinon `undefined`. */
export function selectedNosingIndex(loc: Location | undefined | null): number | undefined {
  return loc?.kind === "nosing" ? loc.index : undefined;
}

/** La sélection est-elle exactement le nez k (sans règle) ? */
export function isExactNosingSelection(
  selection: { readonly location: Location; readonly ruleId?: string | undefined } | null,
  k: number,
): boolean {
  return (
    selection !== null &&
    selection.ruleId === undefined &&
    selection.location.kind === "nosing" &&
    selection.location.index === k
  );
}

/**
 * Remarques non bloquantes rendues par le cœur, dans l'ordre découpage → pipeline → contrôle,
 * sans doublon : `stepping.notes`, `Model.notes` (pièces non générées, modèle partiel) et
 * `ComplianceReport.notes` (contextes déduits, hypothèses de règles).
 */
export function modelNotes(model: Model | null | undefined): readonly Message[] {
  if (!model) return [];
  const all = [...model.stepping.notes, ...(model.notes ?? []), ...(model.compliance.notes ?? [])];
  return all.filter((m, i) => all.findIndex((o) => messageEquals(o, m)) === i);
}

/** Comptes du contrôle par statut (cellules de l'inspecteur, badge « Contrôle »). */
export interface ControlCounts {
  readonly bloquant: number;
  readonly avertissement: number;
  readonly conseil: number;
  /** Règles respectées. */
  readonly ok: number;
  readonly notEvaluated: number;
}

/** Comptes des groupes de `groupResults` (dénombrement des résultats du cœur, sans évaluation). */
export function controlCounts(groups: ComplianceGroups): ControlCounts {
  const of = (s: Severity): number =>
    groups.violations.find((v) => v.severity === s)?.results.length ?? 0;
  return {
    bloquant: of("bloquant"),
    avertissement: of("avertissement"),
    conseil: of("conseil"),
    ok: groups.passed.length,
    notEvaluated: groups.notEvaluated.length,
  };
}

/** Sévérité effective la plus haute parmi les violations ; `null` sans violation. */
export function highestSeverity(groups: ComplianceGroups): Severity | null {
  return groups.violations.find((v) => v.results.length > 0)?.severity ?? null;
}

/** Violations dans l'ordre bloquant → avertissement → conseil (une carte par résultat). */
export function orderedViolations(groups: ComplianceGroups): readonly RuleResult[] {
  return groups.violations.flatMap((v) => v.results);
}

// ------------------------------------------------------------ Inspecteurs (ADR-0009, vague 3)

/** Pièce vue par la localisation courte : repère, marche portée, pièces assemblées. */
export type ShortLocationPart = Pick<Part, "id" | "mark" | "treadNumber" | "assembledWith">;

/**
 * Numéro de la marche liée à une pièce : celle qu'elle matérialise (`Part.treadNumber`), sinon
 * la première marche portée par une pièce assemblée (`Part.assembledWith`, contrat du cœur).
 */
export function linkedTreadNumber(
  part: ShortLocationPart,
  parts: readonly ShortLocationPart[],
): number | undefined {
  if (part.treadNumber !== undefined) return part.treadNumber;
  for (const id of part.assembledWith ?? []) {
    const n = parts.find((p) => p.id === id)?.treadNumber;
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * Localisation courte des cartes de règle (maquette 2d) : « LE1 · M6 » pour une pièce liée à
 * une marche (marche de la localisation, sinon marche liée à la pièce), « LE1 » sinon, « M6 »
 * pour une marche, « Nez 3 » pour un nez ou un point rattaché à un nez ; libellés existants pour
 * l'escalier et un point. Lecture des champs du modèle, sans calcul.
 */
export function locationShort(loc: Location, parts: readonly ShortLocationPart[]): Message {
  switch (loc.kind) {
    case "tread":
      return msg("ui.control.loc.tread", { number: String(loc.number) });
    case "nosing":
      return msg("ui.lib.location.nosing", { index: String(loc.index) });
    case "part": {
      const part = parts.find((p) => p.id === loc.partId);
      if (!part) return textMessage(loc.partId);
      const n = loc.treadNumber ?? linkedTreadNumber(part, parts);
      return n === undefined
        ? textMessage(part.mark)
        : msg("ui.control.loc.partTread", { mark: part.mark, number: String(n) });
    }
    case "point":
      return loc.nosingIndex === undefined
        ? locationLabel(loc)
        : msg("ui.lib.location.nosing", { index: String(loc.nosingIndex) });
    case "stair":
      return locationLabel(loc);
  }
}

/** Sélection qui désigne un résultat : règle et localisation. */
export interface ResultSelection {
  readonly location: Location;
  readonly ruleId?: string | undefined;
}

/**
 * Résultat désigné par la sélection d'une règle : même règle et même localisation, sinon le
 * premier résultat de la même règle (la localisation a changé après un recalcul), sinon
 * `undefined` (règle disparue, ou sélection sans règle).
 */
export function findSelectedResult(
  report: ComplianceReport | null | undefined,
  selection: ResultSelection | null | undefined,
): RuleResult | undefined {
  if (!report || !selection || selection.ruleId === undefined) return undefined;
  const same = report.results.filter((r) => r.ruleId === selection.ruleId);
  return same.find((r) => sameLocation(r.location, selection.location)) ?? same[0];
}

/** Élément d'un inspecteur Marche (2a) ou Pièce (2b) dont on liste les règles. */
export type RuleTarget =
  | { readonly kind: "tread"; readonly number: number }
  | { readonly kind: "part"; readonly partId: string };

/** Résultats rattachés à un élément, par statut ; violations dans l'ordre des sévérités. */
export interface ElementResults {
  readonly violations: readonly RuleResult[];
  readonly passed: readonly RuleResult[];
  readonly notEvaluated: readonly RuleResult[];
}

/**
 * Résultats du contrôle qui portent sur un élément :
 * - marche n : localisations « marche n », « nez n − 1 » (la marche n est portée par le nez
 *   n − 1) et pièce qui matérialise la marche n (`Part.treadNumber`) ;
 * - pièce p : localisation « pièce p », et la marche qu'elle matérialise le cas échéant.
 */
export function resultsForElement(
  report: ComplianceReport | null | undefined,
  target: RuleTarget,
  parts: readonly Pick<Part, "id" | "treadNumber">[],
): ElementResults {
  const partTread = (id: string): number | undefined => parts.find((p) => p.id === id)?.treadNumber;
  const concerns = (loc: Location): boolean => {
    if (target.kind === "tread") {
      const n = target.number;
      if (loc.kind === "tread") return loc.number === n;
      if (loc.kind === "nosing") return loc.index === n - 1;
      if (loc.kind === "point") return loc.nosingIndex === n - 1;
      if (loc.kind === "part") return (loc.treadNumber ?? partTread(loc.partId)) === n;
      return false;
    }
    if (loc.kind === "part") return loc.partId === target.partId;
    if (loc.kind === "tread") {
      const n = partTread(target.partId);
      return n !== undefined && loc.number === n;
    }
    return false;
  };
  const mine = (report?.results ?? []).filter((r) => concerns(r.location));
  return {
    violations: SEVERITY_ORDER.flatMap((s) =>
      mine.filter((r) => r.status === "violation" && r.severity === s),
    ),
    passed: mine.filter((r) => r.status === "ok"),
    notEvaluated: mine.filter((r) => r.status === "non-evaluee"),
  };
}

/** Étiquette « Où » de l'inspecteur Règle : élément sélectionnable, ou libellé seul. */
export type WhereTarget<P extends ShortLocationPart = ShortLocationPart> =
  | { readonly kind: "tread"; readonly number: number; readonly location: Location }
  | { readonly kind: "nosing"; readonly index: number; readonly location: Location }
  | { readonly kind: "part"; readonly part: P; readonly location: Location }
  | { readonly kind: "static"; readonly label: Message };

/**
 * Éléments concernés par un résultat (« Où », maquette 2c), dans l'ordre de lecture :
 * - pièce : la pièce, la marche liée (marche de la localisation, sinon `linkedTreadNumber`),
 *   puis les pièces assemblées (`Part.assembledWith`), hors pièce qui matérialise cette même
 *   marche ; quand la localisation désigne une marche sur la pièce (appui de M6 sur LE1), seules
 *   les pièces assemblées liées à cette marche (le support de M6) ;
 * - marche, nez, point rattaché à un nez : l'élément (le nez) ;
 * - escalier, point, pièce absente du modèle : libellé seul (non sélectionnable).
 */
export function whereTargets<P extends ShortLocationPart>(
  loc: Location,
  parts: readonly P[],
): readonly WhereTarget<P>[] {
  const tread = (number: number): WhereTarget<P> => ({
    kind: "tread",
    number,
    location: { kind: "tread", number },
  });
  switch (loc.kind) {
    case "tread":
      return [tread(loc.number)];
    case "nosing":
      return [{ kind: "nosing", index: loc.index, location: loc }];
    case "part": {
      const part = parts.find((p) => p.id === loc.partId);
      if (!part) return [{ kind: "static", label: textMessage(loc.partId) }];
      const n = loc.treadNumber ?? linkedTreadNumber(part, parts);
      const assembled = (part.assembledWith ?? [])
        .map((id) => parts.find((p) => p.id === id))
        .filter((p): p is P => p !== undefined && p.id !== part.id)
        .filter((p) => n === undefined || p.treadNumber !== n)
        .filter(
          (p) => loc.treadNumber === undefined || linkedTreadNumber(p, parts) === loc.treadNumber,
        );
      return [
        { kind: "part", part, location: loc },
        ...(n === undefined ? [] : [tread(n)]),
        ...assembled.map((p): WhereTarget<P> => ({
          kind: "part",
          part: p,
          location: { kind: "part", partId: p.id },
        })),
      ];
    }
    case "point":
      return loc.nosingIndex === undefined
        ? [{ kind: "static", label: locationLabel(loc) }]
        : [
            {
              kind: "nosing",
              index: loc.nosingIndex,
              location: { kind: "nosing", index: loc.nosingIndex },
            },
          ];
    case "stair":
      return [{ kind: "static", label: locationLabel(loc) }];
  }
}

/** Jauge mesuré / attendu de l'inspecteur Règle (positions relatives, de 0 à 1). */
export interface RuleGauge {
  readonly measured: number;
  readonly min: number | null;
  readonly max: number | null;
  /** Longueur de la barre du mesuré. */
  readonly fill: number;
  /** Position du repère : borne franchie, sinon la borne haute, sinon la basse. */
  readonly marker: number;
}

/**
 * Mise à l'échelle d'affichage du mesuré et de la borne attendue : échelle de 0 à 1,2 fois la
 * plus grande borne (en valeur absolue), positions bornées à [0, 1]. Aucune règle n'est évaluée
 * ici : le statut reste celui du cœur. `null` sans mesure, sans borne ou sur une échelle nulle.
 */
export function ruleGauge(r: Pick<RuleResult, "measured" | "min" | "max">): RuleGauge | null {
  const measured = r.measured;
  const min = r.min ?? null;
  const max = r.max ?? null;
  if (measured === undefined || !Number.isFinite(measured)) return null;
  const bounds = [min, max].filter((b): b is number => b !== null && Number.isFinite(b));
  if (bounds.length === 0) return null;
  const scale = 1.2 * Math.max(...bounds.map(Math.abs));
  if (!(scale > 0)) return null;
  const at = (v: number): number => Math.min(1, Math.max(0, v / scale));
  const bound =
    min !== null && measured < min ? min : max !== null && measured > max ? max : (max ?? min)!;
  return { measured, min, max, fill: at(measured), marker: at(bound) };
}
