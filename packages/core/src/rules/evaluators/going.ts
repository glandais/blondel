/**
 * Girons : minima par contexte, tolérances, marches balancées, collet, giron extérieur.
 *
 * Les girons sont ceux de la **ligne de foulée de conception** (`Tread.going`). Quand la ligne de
 * conception diffère de la ligne de mesure réglementaire, les règles LF_POSITION_* le signalent.
 */
import type { Tread } from "../../model/derived.js";
import {
  NUMERIC_EPS,
  checkItems,
  fmt,
  notApplicable,
  treadLocation,
  treadsOfKind,
  type Item,
} from "../check.js";
import { cornerMonotonyBreaks, cornerPositions } from "../../balancing/postprocess.js";
import { getRule } from "../table.js";
import type { EvaluatorContext, Finding, RuleEvaluator } from "../types.js";

function goingItems(treads: readonly Tread[], value: (t: Tread) => number): Item[] {
  return treads.map((t) => ({
    value: value(t),
    location: treadLocation(t),
    label: `marche ${t.number}${t.kind === "winder" ? " (balancée)" : ""}`,
  }));
}

function walkingTreads(ctx: EvaluatorContext): Tread[] {
  return ctx.stepping.treads.filter((t) => t.kind !== "landing");
}

/** g ≥ min sur toutes les marches (hors paliers). */
const goingMin: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    goingItems(walkingTreads(ctx), (t) => t.going),
    "Giron sur la ligne de foulée",
  );

/** |g_i − g_nom| dans [min ; max] pour un type de marche. */
function goingTolerance(kind: "straight" | "winder"): RuleEvaluator {
  return (ctx) =>
    checkItems(
      ctx,
      goingItems(treadsOfKind(ctx.stepping, kind), (t) => t.going - ctx.stepping.going),
      kind === "straight" ? "Écart de giron (marche droite)" : "Écart de giron (marche balancée)",
      {
        emptyMessage: `Sans objet : aucune marche ${kind === "straight" ? "droite" : "balancée"}.`,
      },
    );
}

/**
 * G_BALANCE_VS_DROITE : g_i(balancée) ≥ g_nom − 10. La table n'a pas de `min` pour cette règle ;
 * sa formule renvoie à la tolérance DTU ±10 mm, lue dans `G_TOL_BALANCEE.min` (−10).
 */
const winderVsStraight: RuleEvaluator = (ctx) => {
  const tol = getRule("G_TOL_BALANCEE").min ?? 0;
  const min = ctx.stepping.going + tol;
  return checkItems(
    ctx,
    goingItems(treadsOfKind(ctx.stepping, "winder"), (t) => t.going),
    "Giron balancé comparé au giron droit",
    { bounds: { min, max: null }, emptyMessage: "Sans objet : aucune marche balancée." },
  );
};

const colletMin: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    goingItems(treadsOfKind(ctx.stepping, "winder"), (t) => t.colletChord),
    "Giron au collet (corde)",
    {
      emptyMessage: "Sans objet : aucune marche balancée.",
    },
  );

/** Groupes de marches balancées consécutives (par zone balancée si connue). */
function winderGroups(ctx: EvaluatorContext): Tread[][] {
  const winders = treadsOfKind(ctx.stepping, "winder");
  const zones = ctx.stepping.balancedZones;
  const groups: Tread[][] = [];
  // La marche t est comprise entre le nez t−1 et le nez t.
  const inZone = (t: Tread, z: (typeof zones)[number]): boolean =>
    t.number - 1 >= z.from && t.number <= z.to;
  for (const z of zones) {
    const g = winders.filter((t) => inZone(t, z));
    if (g.length > 0) groups.push(g);
  }
  // Marches balancées hors de toute zone déclarée : regroupées par suites consécutives.
  const rest = winders.filter((t) => !zones.some((z) => inZone(t, z)));
  let cur: Tread[] = [];
  for (const t of rest) {
    const last = cur[cur.length - 1];
    if (last && t.number !== last.number + 1) {
      groups.push(cur);
      cur = [];
    }
    cur.push(t);
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

/**
 * Angles du jour contournés par un groupe de marches : positions (indices dans le groupe) des
 * marches au droit du milieu de chaque tournant balancé du tracé compris entre le nez bas de la
 * première marche et le nez haut de la dernière (vide : aucun angle, par exemple des marches
 * balancées entre deux zones). `null` si les nez manquent (découpage partiel) ou si la suite est
 * interrompue : le groupe est alors traité comme une seule vallée.
 */
function groupCorners(ctx: EvaluatorContext, g: readonly Tread[]): number[] | null {
  const nosings = ctx.stepping.nosings;
  const first = g[0]!.number - 1;
  const last = g[g.length - 1]!.number;
  const s: number[] = [];
  for (let k = first; k <= last; k++) {
    const nl = nosings[k];
    if (!nl || nl.index !== k || !Number.isFinite(nl.s)) return null;
    s.push(nl.s);
  }
  // Marches non consécutives (suite interrompue) : pas de repérage des angles.
  if (g.some((t, i) => t.number !== g[0]!.number + i)) return null;
  const cornerS = ctx.layout.turns
    .filter((t) => t.mode === "winders")
    .map((t) => (t.sStart + t.sEnd) / 2);
  return cornerPositions(s, cornerS);
}

/**
 * G_COLLET_MONOTONE : dans chaque zone balancée, les collets décroissent (ou restent constants)
 * jusqu'à l'angle puis croissent : la suite est « en vallée » **autour de chaque angle du jour**.
 * Une zone unique de 180° (demi-tournant, U serré) contourne deux angles : deux vallées
 * séparées par une crête entre les deux angles (`cornerMonotonyBreaks`). Sans repérage possible
 * des angles, une seule vallée, prise au premier minimum.
 */
const colletMonotone: RuleEvaluator = (ctx) => {
  const groups = winderGroups(ctx);
  if (groups.length === 0) return [notApplicable("Sans objet : aucune marche balancée.")];
  const out: Finding[] = [];
  let corners = 0;
  groups.forEach((g, gi) => {
    const c = g.map((t) => t.colletChord);
    const located = groupCorners(ctx, g);
    // Angles repérés ; repérage impossible : une vallée supposée (un angle).
    corners += located === null ? 1 : located.length;
    const at = located ?? [];
    for (const i of cornerMonotonyBreaks(c, at, NUMERIC_EPS)) {
      const t = g[i + 1]!;
      out.push({
        status: "violation",
        measured: t.colletChord,
        location: treadLocation(t),
        message: `Collet non monotone vers l'angle, zone ${gi + 1}, marche ${t.number} : ${fmt(t.colletChord)} mm après ${fmt(g[i]!.colletChord)} mm (marche ${g[i]!.number}).`,
      });
    }
  });
  if (out.length > 0) return out;
  return [
    {
      status: "ok",
      location: { kind: "stair" },
      message: `Collets monotones vers l'angle dans ${groups.length} zone(s) balancée(s) (${corners} angle(s) du jour).`,
    },
  ];
};

/** G_EXT_MAX_ERP_TOURNANT : g_ext < 420 (inégalité stricte de la formule). */
const outerGoingMax: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    goingItems(treadsOfKind(ctx.stepping, "winder"), (t) => t.goingOuter),
    "Giron extérieur",
    {
      bounds: { min: ctx.rule.min, max: ctx.rule.max, strictMax: true },
      emptyMessage: "Sans objet : aucune marche balancée.",
    },
  );

export const GOING_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  G_MIN_DTU: goingMin,
  G_MIN_LOGEMENT: goingMin,
  G_MIN_BHC_PC: goingMin,
  G_MIN_ERP_NEUF: goingMin,
  G_MIN_ERP_EXISTANT: goingMin,
  G_PROFONDEUR_ECHELLE: goingMin,
  G_TOL_DROITE: goingTolerance("straight"),
  G_TOL_BALANCEE: goingTolerance("winder"),
  G_BALANCE_VS_DROITE: winderVsStraight,
  G_COLLET_MIN: colletMin,
  G_COLLET_MONOTONE: colletMonotone,
  G_EXT_MAX_ERP_TOURNANT: outerGoingMax,
};
