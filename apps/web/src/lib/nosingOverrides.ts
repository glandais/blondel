/**
 * Retouches des lignes de nez (SPEC §2.3, CHALLENGE A4), éditées par l'inspecteur Marche
 * (maquette 2a, ADR-0009 point 4, qui remplace le mode expert du plan) : surcharges typées
 * `stair.nosingOverrides`, persistées dans le projet et appliquées par le découpage du cœur.
 *
 * - **angle imposé** : la ligne de nez k pivote autour de son point P_k sur la ligne de foulée ;
 *   l'angle est l'écart à la perpendiculaire à la ligne de foulée, compté positivement dans le
 *   sens du tournant (convention du cœur, `stepping/stepping.ts`) ;
 * - **nez fixe** : nez non balancé (borne de zone) ;
 * - retouche **orpheline** : son nez n'existe plus après régénération (moins de nez) ; le cœur
 *   ne l'applique pas et le signale, l'interface l'affiche et propose de la retirer.
 *
 * Fonctions pures (testées sous Node). Aucune règle ni géométrie métier : l'angle affiché
 * (`NosingLine.angle`, `computedAngle`) et l'effet d'une retouche (zones, collets, K3 / K5)
 * sont calculés par le cœur et lus dans le `Model`.
 */
import { MessageRangeError, type Model, type NosingOverride, type Project } from "@blondel/core";
import { createTranslator, msg, type Locale, type Message, type MessageKey } from "@blondel/i18n";
import { formatNumber } from "../i18n/locale.js";

/**
 * Écart maximal accepté à la saisie (degrés) : borne d'interface seulement (une ligne de nez
 * presque tangente à la ligne de foulée n'a pas de sens pratique) ; le cœur signale de toute
 * façon un angle inapplicable. Choix de présentation, sans source métier.
 */
export const EXPERT_ANGLE_LIMIT_DEG = 80;

/** Pas d'arrondi des angles saisis (degrés). */
export const EXPERT_ANGLE_STEP_DEG = 0.1;

/** La retouche des nez s'applique-t-elle (tracé à volées, au moins un nez) ? Motif sinon. */
export function nosingEditAvailability(
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
 * Indice du nez d'arrivée (QUESTIONS A28) : dernier nez du découpage (k = nombre de nez − 1),
 * au palier haut, quand aucune marche ne le porte (pas de marche k + 1). `null` sans nez, ou si
 * une marche k + 1 existe (découpage incohérent : le nez est alors celui d'une marche). Lecture
 * du modèle seulement : il se sélectionne seul (bloc « Ligne de nez » sans fiche de marche).
 */
export function arrivalNosingIndex(
  stepping: Pick<Model["stepping"], "nosings" | "treads">,
): number | null {
  const k = stepping.nosings.length - 1;
  if (k < 0) return null;
  return stepping.treads.some((t) => t.number === k + 1) ? null : k;
}

/** Arrondi au pas `step` (degrés), sans « −0 ». */
export function roundAngle(angle: number, step = EXPERT_ANGLE_STEP_DEG): number {
  const r = Math.round(angle / step) * step;
  const clean = Number(r.toFixed(6));
  return clean === 0 ? 0 : clean;
}

/** Angle borné à ± `EXPERT_ANGLE_LIMIT_DEG` et arrondi au pas. */
export function clampAngle(angle: number): number {
  return roundAngle(Math.max(-EXPERT_ANGLE_LIMIT_DEG, Math.min(EXPERT_ANGLE_LIMIT_DEG, angle)));
}

/** Retouches portant sur le nez k. */
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

/** Ajoute ou retire la retouche « nez fixe » du nez k. */
export function withFixedOverride(project: Project, k: number, fixed: boolean): Project {
  const rest = project.stair.nosingOverrides.filter((o) => !(o.index === k && o.kind === "fixed"));
  return withOverrides(project, fixed ? [...rest, { kind: "fixed", index: k }] : rest);
}

/** Retire les retouches des nez donnés (toutes si `indices` est absent). */
export function withoutNosingOverrides(project: Project, indices?: Iterable<number>): Project {
  if (indices === undefined) return withOverrides(project, []);
  const drop = new Set(indices);
  return withOverrides(
    project,
    project.stair.nosingOverrides.filter((o) => !drop.has(o.index)),
  );
}

/**
 * Retouches orphelines : leur nez n'existe plus dans le modèle (même critère que le cœur :
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
 * Remarques du découpage utiles à la retouche des nez : retouches (orphelines, inapplicables…)
 * et contrôles des lignes de nez qu'un angle imposé peut rompre (K5 croisements, K3 monotonie
 * des collets, collet nul), pour que l'effet d'une rotation soit visible à côté de la saisie.
 */
export function overrideNotes(model: Pick<Model, "stepping">): readonly Message[] {
  return model.stepping.notes.filter((m) => OVERRIDE_NOTE_KEYS.has(m.key));
}

/**
 * Remarques du découpage retenues par `overrideNotes` (par clé, indépendamment de la langue) :
 * retouches orphelines ou ignorées, angles imposés inapplicables ou multiples, K3, K5, collet
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

/** Retouches d'un même nez (liste des retouches du bloc « Ligne de nez »). */
export interface NosingOverrideGroup {
  readonly index: number;
  readonly overrides: readonly NosingOverride[];
}

/** Retouches du projet regroupées par nez, par indice croissant. */
export function overridesByNosing(project: Project): readonly NosingOverrideGroup[] {
  const by = new Map<number, NosingOverride[]>();
  for (const o of project.stair.nosingOverrides) {
    const list = by.get(o.index);
    if (list) list.push(o);
    else by.set(o.index, [o]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, overrides]) => ({ index, overrides }));
}

/** Libellé court d'une retouche. */
export function overrideLabel(o: NosingOverride, locale: Locale): string {
  const t = createTranslator(locale);
  return o.kind === "fixed"
    ? t.t("ui.lib.expert.override.fixed", { index: String(o.index) })
    : t.t("ui.lib.expert.override.angle", {
        index: String(o.index),
        angle: formatNumber(locale, o.angle),
      });
}

/**
 * Zone balancée qui contient le nez k (bornes comprises), lue dans `stepping.balancedZones` ;
 * `undefined` hors zone. Lecture seule : les zones sont celles retenues par le cœur.
 */
export function zoneOfNosing(
  stepping: Pick<Model["stepping"], "balancedZones">,
  k: number,
): Model["stepping"]["balancedZones"][number] | undefined {
  return stepping.balancedZones.find((z) => z.from <= k && k <= z.to);
}

/**
 * Zone balancée qui contient la marche n (entre les nez n − 1 et n, tous deux dans la zone) ;
 * `undefined` hors zone.
 */
export function zoneOfTread(
  stepping: Pick<Model["stepping"], "balancedZones">,
  n: number,
): Model["stepping"]["balancedZones"][number] | undefined {
  return stepping.balancedZones.find((z) => z.from <= n - 1 && n <= z.to);
}

/** Libellés des méthodes de zone du cœur (`M3-cubic`…) qui ont une variante propre. */
const ZONE_METHOD_KEYS: Readonly<Record<string, MessageKey>> = {
  "M3-cubic": "stepping.method.m3Cubic",
  "M3-quintic": "stepping.method.m3Quintic",
};

/**
 * Libellé de la méthode d'une zone balancée : variante de M3 (« M3 quintique »), sinon le
 * libellé de la méthode (`labels`, par identifiant M0…M6), sinon l'identifiant tel quel
 * (notation technique invariante).
 */
export function zoneMethodLabel(
  method: string,
  labels: Readonly<Record<string, MessageKey>>,
): Message | string {
  const variant = ZONE_METHOD_KEYS[method];
  if (variant !== undefined) return msg(variant);
  const key = labels[method.split("-")[0] ?? method];
  return key === undefined ? method : msg(key);
}
