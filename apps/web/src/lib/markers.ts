/**
 * Marqueurs du contrôle de conception dans la vue 3D : chaque violation localisée sur une pièce
 * (garde-corps, main courante, limon, marche…) teinte cette pièce selon sa sévérité la plus
 * grave ; une violation localisée en un point (ex. hauteur de chute d'un côté vide) donne un
 * repère ponctuel. Présentation seulement : les résultats sont ceux du cœur.
 *
 * Filtre par famille de règles (QUESTIONS A23) : géométrie, fabrication, garde-corps ; la
 * famille d'une règle vient du cœur (`ruleFamily`).
 */
import {
  RULE_FAMILIES,
  ruleDescription,
  ruleFamily,
  type Location,
  type Model,
  type Part,
  type RuleFamily,
  type RuleResult,
  type Severity,
  type Vec3,
} from "@blondel/core";
import { tr, trOpt } from "../i18n/fr.js";
import { SEVERITY_ORDER } from "./compliance.js";

export interface PointMarker {
  readonly at: Vec3;
  readonly severity: Severity;
  readonly ruleId: string;
  readonly message: string;
  readonly location: Location;
}

export interface ControlMarkers {
  /** Sévérité la plus grave par pièce en violation. */
  readonly parts: ReadonlyMap<string, Severity>;
  /** Règles en violation par pièce (info-bulle). */
  readonly rulesByPart: ReadonlyMap<string, readonly string[]>;
  readonly points: readonly PointMarker[];
  /**
   * Violations localisées par famille de règles, **avant** filtrage (libellés du filtre) : une
   * famille masquée garde son compte.
   */
  readonly byFamily: Readonly<Record<RuleFamily, number>>;
}

const rank = (s: Severity): number => SEVERITY_ORDER.indexOf(s);

/** La sévérité `a` est-elle plus grave que `b` ? */
export function worse(a: Severity, b: Severity | undefined): boolean {
  return b === undefined || rank(a) < rank(b);
}

/** Index des pièces d'un modèle : identifiants et pièce de chaque marche (`Part.treadNumber`). */
export interface PartLookup {
  readonly ids: ReadonlySet<string>;
  readonly byTread: ReadonlyMap<number, string>;
}

export function partLookup(parts: readonly Pick<Part, "id" | "treadNumber">[]): PartLookup {
  const byTread = new Map<number, string>();
  for (const p of parts)
    if (p.treadNumber !== undefined && !byTread.has(p.treadNumber))
      byTread.set(p.treadNumber, p.id);
  return { ids: new Set(parts.map((p) => p.id)), byTread };
}

/** Pièce désignée par une localisation (`part`, ou pièce de la marche si elle existe). */
export function locatedPartId(loc: Location, lookup: PartLookup): string | undefined {
  if (loc.kind === "part") return lookup.ids.has(loc.partId) ? loc.partId : undefined;
  if (loc.kind === "tread") return lookup.byTread.get(loc.number);
  return undefined;
}

/**
 * Marqueurs des violations d'un modèle (résultats `violation` seulement) ; `hidden` : familles
 * de règles masquées (filtre de la vue 3D).
 */
export function controlMarkers(
  model: Pick<Model, "parts" | "compliance"> | null | undefined,
  hidden: ReadonlySet<RuleFamily> = new Set(),
): ControlMarkers {
  const parts = new Map<string, Severity>();
  const rulesByPart = new Map<string, string[]>();
  const points: PointMarker[] = [];
  const byFamily = Object.fromEntries(RULE_FAMILIES.map((f) => [f, 0])) as Record<
    RuleFamily,
    number
  >;
  if (!model) return { parts, rulesByPart, points, byFamily };
  const lookup = partLookup(model.parts);
  const results: readonly RuleResult[] = model.compliance.results;
  for (const r of results) {
    if (r.status !== "violation") continue;
    const partId = locatedPartId(r.location, lookup);
    const located =
      partId !== undefined ||
      (r.location.kind === "point" &&
        [r.location.at.x, r.location.at.y, r.location.at.z].every(Number.isFinite));
    if (!located) continue;
    const family = ruleFamily(r.ruleId);
    byFamily[family]++;
    if (hidden.has(family)) continue;
    if (partId !== undefined) {
      if (worse(r.severity, parts.get(partId))) parts.set(partId, r.severity);
      const list = rulesByPart.get(partId) ?? [];
      if (!list.includes(r.ruleId)) list.push(r.ruleId);
      rulesByPart.set(partId, list);
    } else if (r.location.kind === "point") {
      const { x, y, z } = r.location.at;
      if (![x, y, z].every(Number.isFinite)) continue;
      points.push({
        at: r.location.at,
        severity: r.severity,
        ruleId: r.ruleId,
        message: trOpt(r.message) || tr(ruleDescription(r.ruleId)),
        location: r.location,
      });
    }
  }
  return { parts, rulesByPart, points, byFamily };
}
