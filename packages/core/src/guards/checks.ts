/**
 * Contrôles propres aux garde-corps, hors rules.yaml, ajoutés au rapport par le pipeline
 * (comme les contrôles de fabrication des structures, `mergeStructureChecks`).
 *
 * `GC_CABLES_DETENTE` (câbles qui se détendent) n'est plus un contrôle hors table : c'est une
 * règle de rules.yaml évaluée par le moteur (`rules/evaluators/guards.ts`).
 *
 * - `GC_CONFLIT_DALLE` (avertissement, toujours actif) : collision géométrique d'un garde-corps
 *   rampant avec le plancher haut. Hors de la trémie (sous la dalle), la main courante d'un
 *   rampant dont le dessus dépasse la sous-face de la dalle traverse celle-ci : cas d'un bord
 *   d'escalier au nu de la trémie avec un garde-corps décalé vers le vide. Constat géométrique
 *   sur le projet (aucun seuil métier) ; localisé sur la main courante.
 * - `GC_POTEAUX_JOUR` (avertissement, toujours actif) : collision des poteaux des garde-corps de
 *   jour (décision de l'utilisateur 2026-09-29, QUESTIONS A10). Au-dessus de la sphère T1
 *   (110 mm), les garde-corps de jour sont construits ; dans un jour étroit (jusqu'à
 *   2 × (décalage + demi-poteau), 140 mm avec les défauts de `guards/spec.ts`), les poteaux qui
 *   se font face peuvent se chevaucher. Constat géométrique (sections carrées orientées, en plan,
 *   et hauteurs qui se recouvrent) : aucun seuil métier ; localisé sur le premier poteau.
 */
import { dec, msg } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import { ceilingOf, openingPolygon } from "../headroom/headroom.js";
import type { RuleResult } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import type { Stepping } from "../model/derived.js";
import { effectiveSeverity } from "../rules/engine.js";
import { ruleDefSource, type SourcedRuleDef } from "../rules/sources.js";
import { runTitle } from "./labels.js";
import { sectionWidth } from "./parts.js";
import { cumulative, interp, pointAt, tangentAt } from "./polyline.js";
import type { GuardPostFootprint, GuardRun, GuardsAnalysis } from "./types.js";

/**
 * Contrôles hors rules.yaml : leur description est la clé `rules.<id>.description` des
 * dictionnaires (`ruleDescription(id)`, ADR-0007), pas la `RuleDef` (vide, jamais affichée).
 */
export const SLAB_CLASH_RULE: SourcedRuleDef = {
  id: "GC_CONFLIT_DALLE",
  description: "",
  formule: "",
  min: null,
  max: null,
  recommande: null,
  unite: "mm",
  contexte: ["tous"],
  nature: "metier",
  ...ruleDefSource(msg("compliance.source.guardSlabClash")),
  source_secondaire: false,
  confiance: "eleve",
  severite: "avertissement",
};

export const JOUR_POSTS_CLASH_RULE: SourcedRuleDef = {
  id: "GC_POTEAUX_JOUR",
  description: "",
  formule: "",
  min: null,
  max: null,
  recommande: null,
  unite: "mm",
  contexte: ["tous"],
  nature: "metier",
  ...ruleDefSource(msg("compliance.source.guardWellPosts")),
  source_secondaire: false,
  confiance: "eleve",
  severite: "avertissement",
};

/** Tolérance (mm) de pénétration : deux poteaux jointifs ne sont pas en collision. */
const POST_CONTACT_EPS = 1e-6;

/** Sommets (plan) de la section carrée d'un poteau. */
function postCorners(p: GuardPostFootprint): Vec2[] {
  const u = V.normalize(p.dir);
  const n = V.perpLeft(u);
  const h = p.size / 2;
  return [
    V.add(V.addScaled(p.center, u, h), V.scale(n, h)),
    V.add(V.addScaled(p.center, u, -h), V.scale(n, h)),
    V.add(V.addScaled(p.center, u, -h), V.scale(n, -h)),
    V.add(V.addScaled(p.center, u, h), V.scale(n, -h)),
  ];
}

/**
 * Pénétration (mm) de deux sections carrées orientées en plan (axes séparateurs) ; 0 si elles
 * ne se chevauchent pas (ou se touchent seulement).
 */
function postOverlap(a: GuardPostFootprint, b: GuardPostFootprint): number {
  const ca = postCorners(a);
  const cb = postCorners(b);
  const axes = [a.dir, V.perpLeft(a.dir), b.dir, V.perpLeft(b.dir)].map((x) => V.normalize(x));
  let depth = Infinity;
  for (const ax of axes) {
    const pa = ca.map((c) => V.dot(c, ax));
    const pb = cb.map((c) => V.dot(c, ax));
    const d =
      Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    if (d <= POST_CONTACT_EPS) return 0;
    depth = Math.min(depth, d);
  }
  return depth;
}

/**
 * Paires de poteaux des garde-corps de jour (rampants côté `inner`) qui se chevauchent en plan
 * et en hauteur, avec la pénétration en plan (mm).
 */
export function jourPostClashes(
  analysis: GuardsAnalysis,
): { a: GuardPostFootprint; b: GuardPostFootprint; depth: number }[] {
  const posts = analysis.runs
    .filter((r) => r.kind === "rake" && r.side === "inner")
    .flatMap((r) => r.posts ?? []);
  const out: { a: GuardPostFootprint; b: GuardPostFootprint; depth: number }[] = [];
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      const a = posts[i]!;
      const b = posts[j]!;
      if (Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= POST_CONTACT_EPS) continue;
      const depth = postOverlap(a, b);
      if (depth > 0) out.push({ a, b, depth });
    }
  }
  return out;
}

/** Pas d'échantillonnage (mm) du contrôle de collision avec la dalle (précision géométrique). */
const CLASH_STEP = 10;

/**
 * Longueur (en plan) du garde-corps rampant `run` qui traverse la dalle haute : points de l'axe
 * (± demi-largeur de la main courante) strictement hors de la trémie, dont le niveau de
 * référence est sous le sol haut et le dessus du garde-corps au-dessus de la sous-face.
 */
export function slabClash(
  project: Project,
  analysis: GuardsAnalysis,
  run: GuardRun,
): { length: number; at: { x: number; y: number; z: number } } | null {
  const poly = openingPolygon(project.site.opening);
  if (!poly || run.kind !== "rake" || run.path.length < 2) return null;
  const ceiling = ceilingOf(project.site);
  const floor = project.site.floorToFloor;
  const half = sectionWidth(analysis.spec.handrail.section) / 2;
  const w = cumulative(run.path);
  const total = w[w.length - 1]!;
  const steps = Math.max(1, Math.ceil(total / CLASH_STEP));
  let length = 0;
  let at: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const s = (total * i) / steps;
    const ref = interp(w, run.ref, s);
    if (ref >= floor - 1e-6 || ref + run.height <= ceiling + 1e-6) continue;
    const p = pointAt(run.path, w, s);
    const n = V.perpLeft(tangentAt(run.path, w, s));
    const under = [p, V.addScaled(p, n, half), V.addScaled(p, n, -half)].some(
      (q) => pointInPolygon(q, poly) === "outside",
    );
    if (!under) continue;
    length += i === 0 || i === steps ? total / steps / 2 : total / steps;
    at ??= { x: p.x, y: p.y, z: ceiling };
  }
  return at ? { length, at } : null;
}

/** Contrôles hors table des garde-corps (vide si rien à signaler). */
export function guardChecks(
  project: Project,
  _stepping: Stepping,
  analysis: GuardsAnalysis,
): RuleResult[] {
  return [...slabClashChecks(project, analysis), ...jourPostChecks(project, analysis)];
}

function jourPostChecks(project: Project, analysis: GuardsAnalysis): RuleResult[] {
  const rule = JOUR_POSTS_CLASH_RULE;
  const clashes = jourPostClashes(analysis);
  if (clashes.length === 0) return [];
  const eff = effectiveSeverity(rule, project.compliance);
  return clashes.map(({ a, b, depth }) => ({
    ruleId: rule.id,
    status: eff.ignored ? "non-evaluee" : "violation",
    severity: eff.severity,
    declaredSeverity: rule.severite,
    measured: depth,
    max: 0,
    unit: "mm",
    location: { kind: "part", partId: a.partId },
    nature: rule.nature,
    confidence: rule.confiance,
    source: rule.source,
    ...(rule.sourceMessage !== undefined ? { sourceMessage: rule.sourceMessage } : {}),
    secondarySource: rule.source_secondaire,
    ...(eff.downgradeReason !== undefined ? { downgradeReason: eff.downgradeReason } : {}),
    message: msg("guard.check.jourPostsClash", { a: a.partId, b: b.partId, depth: dec(depth, 0) }),
  }));
}

function slabClashChecks(project: Project, analysis: GuardsAnalysis): RuleResult[] {
  const rule = SLAB_CLASH_RULE;
  const eff = effectiveSeverity(rule, project.compliance);
  const out: RuleResult[] = [];
  for (const run of analysis.runs) {
    const clash = slabClash(project, analysis, run);
    if (!clash) continue;
    out.push({
      ruleId: rule.id,
      status: eff.ignored ? "non-evaluee" : "violation",
      severity: eff.severity,
      declaredSeverity: rule.severite,
      measured: clash.length,
      max: 0,
      unit: "mm",
      location: { kind: "part", partId: run.handrailPartId ?? run.primaryPartId },
      nature: rule.nature,
      confidence: rule.confiance,
      source: rule.source,
      ...(rule.sourceMessage !== undefined ? { sourceMessage: rule.sourceMessage } : {}),
      secondarySource: rule.source_secondaire,
      ...(eff.downgradeReason !== undefined ? { downgradeReason: eff.downgradeReason } : {}),
      message: msg("guard.check.slabClash", {
        run: runTitle(run.label),
        length: dec(clash.length, 0),
      }),
    });
  }
  return out;
}
