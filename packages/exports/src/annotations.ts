/**
 * Données annexes des dessins : localisation des violations du contrôle de conception,
 * trémie lue dans le projet, échappée réglementaire lue dans le rapport.
 */
import type { ComplianceReport, Mm, Polygon2, Project, Severity, Vec2 } from "@blondel/core";

const RANK: Record<Severity, number> = { bloquant: 3, avertissement: 2, conseil: 1 };

/** Sévérité la plus forte (undefined si aucune). */
export function worstSeverity(
  a: Severity | undefined,
  b: Severity | undefined,
): Severity | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return RANK[b] > RANK[a] ? b : a;
}

export interface LocatedViolations {
  /** Sévérité la plus forte par numéro de marche. */
  readonly treads: ReadonlyMap<number, Severity>;
  /** Sévérité la plus forte par indice de nez. */
  readonly nosings: ReadonlyMap<number, Severity>;
  /** Violations localisées en un point (projection en plan). */
  readonly points: readonly { readonly at: Vec2; readonly z: Mm; readonly severity: Severity }[];
}

/** Regroupe les violations (`status === "violation"`) du rapport par localisation. */
export function locateViolations(report: ComplianceReport): LocatedViolations {
  const treads = new Map<number, Severity>();
  const nosings = new Map<number, Severity>();
  const points: { at: Vec2; z: Mm; severity: Severity }[] = [];
  for (const r of report.results) {
    if (r.status !== "violation") continue;
    const loc = r.location;
    if (loc.kind === "tread") {
      treads.set(loc.number, worstSeverity(treads.get(loc.number), r.severity)!);
    } else if (loc.kind === "nosing") {
      nosings.set(loc.index, worstSeverity(nosings.get(loc.index), r.severity)!);
    } else if (loc.kind === "point") {
      points.push({ at: { x: loc.at.x, y: loc.at.y }, z: loc.at.z, severity: r.severity });
    }
  }
  return { treads, nosings, points };
}

/** Nombre de violations par sévérité effective (synthèse du rapport). */
export function violationSummary(report: ComplianceReport): Record<Severity, number> {
  return {
    bloquant: report.summary.bloquant ?? 0,
    avertissement: report.summary.avertissement ?? 0,
    conseil: report.summary.conseil ?? 0,
  };
}

/** Contour de la trémie du plancher haut (repère du site = repère monde), CCW ou tel que saisi. */
export function openingPolygon(project: Project | undefined): Polygon2 | undefined {
  const o = project?.site.opening;
  if (o === undefined) return undefined;
  if (o.kind === "polygon") return o.points.map((p) => ({ x: p.x, y: p.y }));
  return [
    { x: o.x, y: o.y },
    { x: o.x + o.sizeX, y: o.y },
    { x: o.x + o.sizeX, y: o.y + o.sizeY },
    { x: o.x, y: o.y + o.sizeY },
  ];
}

/**
 * Échappée minimale exigée, lue dans le rapport : plus grand `min` des règles `ECHAPPEE_*`
 * présentes (donc applicables aux contextes actifs) de sévérité effective bloquante ou
 * d'avertissement. Aucune valeur en dur : sans règle applicable, le gabarit d'échappée n'est
 * pas dessiné.
 */
export function requiredHeadroom(report: ComplianceReport): Mm | undefined {
  let best: Mm | undefined;
  for (const r of report.results) {
    if (!r.ruleId.startsWith("ECHAPPEE")) continue;
    if (r.severity === "conseil") continue;
    if (typeof r.min !== "number") continue;
    if (best === undefined || r.min > best) best = r.min;
  }
  return best;
}
