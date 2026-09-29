/**
 * Marqueurs du contrôle de conception dans la vue 3D : chaque violation localisée sur une pièce
 * (garde-corps, main courante, limon, marche…) teinte cette pièce selon sa sévérité la plus
 * grave ; une violation localisée en un point (ex. hauteur de chute d'un côté vide) donne un
 * repère ponctuel. Présentation seulement : les résultats sont ceux du cœur.
 */
import type { Location, Model, RuleResult, Severity, Vec3 } from "@blondel/core";
import { SEVERITY_ORDER, treadPartId } from "./compliance.js";

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
}

const rank = (s: Severity): number => SEVERITY_ORDER.indexOf(s);

/** La sévérité `a` est-elle plus grave que `b` ? */
export function worse(a: Severity, b: Severity | undefined): boolean {
  return b === undefined || rank(a) < rank(b);
}

/** Pièce désignée par une localisation (`part`, ou marche `tread-N` si elle existe). */
export function locatedPartId(loc: Location, partIds: ReadonlySet<string>): string | undefined {
  if (loc.kind === "part") return partIds.has(loc.partId) ? loc.partId : undefined;
  if (loc.kind === "tread") {
    const id = treadPartId(loc.number);
    return partIds.has(id) ? id : undefined;
  }
  return undefined;
}

/** Marqueurs des violations d'un modèle (résultats `violation` seulement). */
export function controlMarkers(
  model: Pick<Model, "parts" | "compliance"> | null | undefined,
): ControlMarkers {
  const parts = new Map<string, Severity>();
  const rulesByPart = new Map<string, string[]>();
  const points: PointMarker[] = [];
  if (!model) return { parts, rulesByPart, points };
  const ids = new Set(model.parts.map((p) => p.id));
  const results: readonly RuleResult[] = model.compliance.results;
  for (const r of results) {
    if (r.status !== "violation") continue;
    const partId = locatedPartId(r.location, ids);
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
        message: r.message || r.description,
        location: r.location,
      });
    }
  }
  return { parts, rulesByPart, points };
}
