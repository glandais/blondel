/**
 * Mode expert du plan 2D (SPEC §2.3, CHALLENGE A4) : surcharges typées des lignes de nez
 * (`stair.nosingOverrides`), persistées dans le projet et appliquées par le découpage du cœur.
 *
 * - **angle imposé** : la ligne de nez k pivote autour de son point P_k sur la ligne de foulée ;
 *   l'angle est l'écart à la perpendiculaire à la ligne de foulée, compté positivement dans le
 *   sens du tournant (convention du cœur, `stepping/stepping.ts`) ;
 * - **nez fixe** : nez non balancé (borne de zone) ;
 * - surcharge **orpheline** : son nez n'existe plus après régénération (moins de nez) ; le cœur
 *   ne l'applique pas et le signale, l'interface l'affiche et propose de la retirer.
 *
 * Fonctions pures (testées sous Node). Aucune règle métier : l'effet d'une surcharge (zones,
 * collets, K3 / K5) est calculé par le cœur et lu dans le `Model`.
 */
import {
  MessageRangeError,
  curveTangentAt,
  vec2,
  type Model,
  type NosingOverride,
  type Project,
  type Vec2,
} from "@blondel/core";
import { createTranslator, msg, type Locale, type Message, type MessageKey } from "@blondel/i18n";
import { formatNumber } from "../i18n/locale.js";

/**
 * Écart maximal accepté par la poignée (degrés) : borne d'interface seulement (une ligne de nez
 * presque tangente à la ligne de foulée n'a pas de sens pratique) ; le cœur signale de toute
 * façon un angle inapplicable. Choix de présentation, sans source métier.
 */
export const EXPERT_ANGLE_LIMIT_DEG = 80;

/** Pas d'arrondi des angles saisis à la poignée (degrés). */
export const EXPERT_ANGLE_STEP_DEG = 0.1;

const DEG = Math.PI / 180;

/** Signe du sens positif des angles imposés : +1 si le jour est à gauche, −1 à droite. */
export function turnSign(model: Pick<Model, "layout">): 1 | -1 {
  return model.layout.innerSide === "left" ? 1 : -1;
}

/** Le mode expert s'applique-t-il (tracé à volées, au moins un nez) ? Motif sinon. */
export function expertAvailability(
  model: Pick<Model, "layout" | "stepping">,
): { readonly ok: true } | { readonly ok: false; readonly reason: Message } {
  if (model.layout.helical || model.stepping.helical) {
    return { ok: false, reason: msg("ui.lib.expert.helical") };
  }
  if (model.stepping.nosings.length === 0) {
    return { ok: false, reason: msg("ui.lib.expert.noNosing") };
  }
  return { ok: true };
}

/**
 * Perpendiculaire unitaire à la ligne de foulée au nez k, orientée du jour vers le mur (même
 * construction que le découpage du cœur).
 */
export function perpendicularAt(model: Pick<Model, "layout" | "stepping">, k: number): Vec2 {
  const nosing = model.stepping.nosings[k];
  if (!nosing)
    throw new MessageRangeError(msg("ui.lib.expert.missingNosing", { index: String(k) }));
  const t = curveTangentAt(model.layout.walkline, nosing.s);
  return model.layout.innerSide === "left" ? vec2.perpRight(t) : vec2.perpLeft(t);
}

/** Angle signé (radians, ]−π ; π]) qui amène `from` sur `to`. */
function signedAngle(from: Vec2, to: Vec2): number {
  return Math.atan2(vec2.cross(from, to), vec2.dot(from, to));
}

/**
 * Angle courant de la ligne de nez k (degrés) : écart à la perpendiculaire, positif dans le sens
 * du tournant. 0 pour un nez droit, non nul pour un nez balancé ou surchargé.
 */
export function nosingAngleDeg(model: Pick<Model, "layout" | "stepping">, k: number): number {
  const nosing = model.stepping.nosings[k];
  if (!nosing)
    throw new MessageRangeError(msg("ui.lib.expert.missingNosing", { index: String(k) }));
  return (turnSign(model) * signedAngle(perpendicularAt(model, k), nosing.dir)) / DEG;
}

/** Arrondi au pas `step` (degrés), sans « −0 ». */
export function roundAngle(angle: number, step = EXPERT_ANGLE_STEP_DEG): number {
  const r = Math.round(angle / step) * step;
  const clean = Number(r.toFixed(6));
  return clean === 0 ? 0 : clean;
}

/**
 * Angle imposé correspondant à la poignée placée en `pointer` (repère du site) : direction
 * P_k → pointeur, ramenée du côté du mur (une ligne n'a pas de sens), bornée à
 * ± `EXPERT_ANGLE_LIMIT_DEG` et arrondie au pas. `null` si le pointeur est sur P_k.
 */
export function angleFromPointer(
  model: Pick<Model, "layout" | "stepping">,
  k: number,
  pointer: Vec2,
  step = EXPERT_ANGLE_STEP_DEG,
): number | null {
  const nosing = model.stepping.nosings[k];
  if (!nosing) return null;
  const v = vec2.sub(pointer, nosing.p);
  if (vec2.norm(v) < 1e-9) return null;
  const perp = perpendicularAt(model, k);
  const toward = vec2.dot(v, perp) < 0 ? vec2.scale(v, -1) : v;
  const angle = (turnSign(model) * signedAngle(perp, toward)) / DEG;
  const bounded = Math.max(-EXPERT_ANGLE_LIMIT_DEG, Math.min(EXPERT_ANGLE_LIMIT_DEG, angle));
  return roundAngle(bounded, step);
}

/**
 * Direction de la ligne de nez k pour un angle imposé (degrés) : rotation de la perpendiculaire
 * dans le sens du tournant (aperçu pendant le glissement de la poignée).
 */
export function directionForAngle(
  model: Pick<Model, "layout" | "stepping">,
  k: number,
  angleDeg: number,
): Vec2 {
  return vec2.rotate(perpendicularAt(model, k), turnSign(model) * angleDeg * DEG);
}

/** Surcharges portant sur le nez k. */
export function overridesAt(
  project: Project,
  k: number,
): { readonly fixed: boolean; readonly angle: number | null } {
  let fixed = false;
  let angle: number | null = null;
  for (const o of project.stair.nosingOverrides) {
    if (o.index !== k) continue;
    if (o.kind === "fixed") fixed = true;
    else angle = o.angle; // le dernier angle est appliqué (comme le cœur)
  }
  return { fixed, angle };
}

function withOverrides(project: Project, overrides: NosingOverride[]): Project {
  return { ...project, stair: { ...project.stair, nosingOverrides: overrides } };
}

/** Impose l'angle du nez k (remplace un angle déjà imposé, garde un éventuel « nez fixe »). */
export function withAngleOverride(project: Project, k: number, angle: number): Project {
  if (!Number.isFinite(angle)) throw new MessageRangeError(msg("ui.lib.expert.angleNotFinite"));
  const rest = project.stair.nosingOverrides.filter((o) => !(o.index === k && o.kind === "angle"));
  return withOverrides(project, [...rest, { kind: "angle", index: k, angle }]);
}

/** Ajoute ou retire la surcharge « nez fixe » du nez k. */
export function withFixedOverride(project: Project, k: number, fixed: boolean): Project {
  const rest = project.stair.nosingOverrides.filter((o) => !(o.index === k && o.kind === "fixed"));
  return withOverrides(project, fixed ? [...rest, { kind: "fixed", index: k }] : rest);
}

/** Retire les surcharges des nez donnés (tous si `indices` est absent). */
export function withoutNosingOverrides(project: Project, indices?: Iterable<number>): Project {
  if (indices === undefined) return withOverrides(project, []);
  const drop = new Set(indices);
  return withOverrides(
    project,
    project.stair.nosingOverrides.filter((o) => !drop.has(o.index)),
  );
}

/**
 * Surcharges orphelines : leur nez n'existe plus dans le modèle (même critère que le cœur :
 * indice ≥ nombre de nez). Liste vide sans nez calculé (modèle partiel : rien n'est affirmé).
 */
export function orphanOverrides(
  project: Project,
  model: Pick<Model, "stepping">,
): readonly NosingOverride[] {
  const n = model.stepping.nosings.length;
  if (n === 0) return [];
  return project.stair.nosingOverrides.filter((o) => o.index >= n);
}

/**
 * Remarques du découpage utiles au mode expert : surcharges (orphelines, inapplicables…) et
 * contrôles des lignes de nez qu'un angle imposé peut rompre (K5 croisements, K3 monotonie des
 * collets, collet nul), pour que l'effet d'une rotation soit visible à côté du plan.
 */
export function overrideNotes(model: Pick<Model, "stepping">): readonly Message[] {
  return model.stepping.notes.filter((m) => OVERRIDE_NOTE_KEYS.has(m.key));
}

/**
 * Remarques du découpage retenues par `overrideNotes` (par clé, indépendamment de la langue) :
 * surcharges orphelines ou ignorées, angles imposés inapplicables ou multiples, K3, K5, collet
 * nul.
 */
const OVERRIDE_NOTE_KEYS: ReadonlySet<MessageKey> = new Set<MessageKey>([
  "stepping.override.orphan",
  "stepping.helical.overrideIgnored",
  "stepping.override.angleInapplicable",
  "stepping.override.angleOnFixed",
  "stepping.override.multipleAngles",
  "stepping.k3NotMonotone",
  "stepping.k5Crossing",
  "stepping.zeroCollet",
]);

/** Libellé court d'une surcharge. */
export function overrideLabel(o: NosingOverride, locale: Locale): string {
  const t = createTranslator(locale);
  return o.kind === "fixed"
    ? t.t("ui.lib.expert.override.fixed", { index: String(o.index) })
    : t.t("ui.lib.expert.override.angle", {
        index: String(o.index),
        angle: formatNumber(locale, o.angle),
      });
}
