/**
 * Girons : minima par contexte, tolérances, marches balancées, collet, giron extérieur.
 *
 * Les girons sont ceux de la **ligne de foulée de conception** (`Tread.going`). Quand la ligne de
 * conception diffère de la ligne de mesure réglementaire, les règles LF_POSITION_* le signalent.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import type { Tread } from "../../model/derived.js";
import {
  NUMERIC_EPS,
  checkItems,
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
    label: msg(t.kind === "winder" ? "compliance.item.winderTread" : "compliance.item.tread", {
      n: t.number,
    }),
  }));
}

/** « Sans objet : aucune marche balancée. » */
const noWinder = (): Message => msg("compliance.going.noWinder");

function walkingTreads(ctx: EvaluatorContext): Tread[] {
  return ctx.stepping.treads.filter((t) => t.kind !== "landing");
}

/** g ≥ min sur toutes les marches (hors paliers). */
const goingMin: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    goingItems(walkingTreads(ctx), (t) => t.going),
    msg("compliance.going.walkline"),
  );

/** |g_i − g_nom| dans [min ; max] pour un type de marche. */
function goingTolerance(kind: "straight" | "winder"): RuleEvaluator {
  return (ctx) =>
    checkItems(
      ctx,
      goingItems(treadsOfKind(ctx.stepping, kind), (t) => t.going - ctx.stepping.going),
      msg(kind === "straight" ? "rules.G_TOL_DROITE.quantity" : "rules.G_TOL_BALANCEE.quantity"),
      {
        emptyMessage: kind === "straight" ? msg("rules.G_TOL_DROITE.none") : noWinder(),
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
    msg("rules.G_BALANCE_VS_DROITE.quantity"),
    { bounds: { min, max: null }, emptyMessage: noWinder() },
  );
};

const colletMin: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    goingItems(treadsOfKind(ctx.stepping, "winder"), (t) => t.colletChord),
    msg("rules.G_COLLET_MIN.quantity"),
    {
      emptyMessage: noWinder(),
    },
  );

/**
 * Suites de marches balancées de numéros consécutifs (sans égard aux zones déclarées), dans
 * l'ordre de la montée.
 */
function consecutiveWinderRuns(ctx: EvaluatorContext): Tread[][] {
  const runs: Tread[][] = [];
  let cur: Tread[] = [];
  for (const t of treadsOfKind(ctx.stepping, "winder")) {
    const last = cur[cur.length - 1];
    if (last && t.number !== last.number + 1) {
      runs.push(cur);
      cur = [];
    }
    cur.push(t);
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/**
 * Numéros des marches au droit d'un poteau d'angle : marche dont les nez encadrent le milieu
 * d'un tournant balancé à poteau (`inner.kind = "newel"`). Leur collet suit le contour du
 * poteau (≈ 170 à 240 mm contre ≈ 120 mm aux marches voisines) ; faut-il les exclure de K3 ?
 * Question ouverte (QUESTIONS B1, « Collet et K3 au droit d'un poteau ») : le contrôle des
 * marches hors zone ne conclut pas sur une marche hors zone qui est, ou jouxte, une telle marche.
 */
function newelTreadNumbers(ctx: EvaluatorContext): Set<number> {
  const out = new Set<number>();
  const layout = ctx.project.stair.layout;
  if (layout.kind === "helical") return out;
  const nosings = ctx.stepping.nosings;
  for (const turn of ctx.layout.turns) {
    if (turn.mode !== "winders" || layout.turns[turn.index]?.inner.kind !== "newel") continue;
    const mid = (turn.sStart + turn.sEnd) / 2;
    for (const t of ctx.stepping.treads) {
      const a = nosings[t.number - 1];
      const b = nosings[t.number];
      if (!a || !b || !Number.isFinite(a.s) || !Number.isFinite(b.s)) continue;
      if (a.s <= mid && mid < b.s) out.add(t.number);
    }
  }
  return out;
}

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
 * des angles, une seule vallée, prise au premier minimum. Une marche balancée hors zone déclarée
 * est contrôlée localement, par rapport aux angles de la suite de marches balancées
 * consécutives qui la contient.
 */
const colletMonotone: RuleEvaluator = (ctx) => {
  const groups = winderGroups(ctx);
  if (groups.length === 0) return [notApplicable(noWinder())];
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
        message: msg("rules.G_COLLET_MONOTONE.zoneBreak", {
          zone: gi + 1,
          tread: t.number,
          collet: dec(t.colletChord),
          previous: dec(g[i]!.colletChord),
          previousTread: g[i]!.number,
        }),
      });
    }
  });
  // Marches balancées hors de toute zone déclarée (marche entre deux zones par angle, QUESTIONS
  // D1) : seules, elles ne forment jamais de rupture. Chacune est située par rapport aux angles
  // du jour de la suite de marches balancées consécutives qui la contient (zones voisines
  // comprises) et comparée à ses voisines : avant le premier angle, les collets décroissent ;
  // après le dernier, ils croissent ; au droit d'un angle, pas de crête ; entre deux angles, pas
  // de creux. Contrôle local : les ruptures internes aux zones restent celles du contrôle par
  // zone ci-dessus (aucun doublon, aucun report d'une rupture de zone sur la marche hors zone).
  // Sans angle repéré dans la suite, pas de conclusion sur ces marches.
  const zones = ctx.stepping.balancedZones;
  if (zones.length > 0) {
    const newelTreads = newelTreadNumbers(ctx);
    const outside = (t: Tread): boolean =>
      !zones.some((z) => t.number - 1 >= z.from && t.number <= z.to);
    const reported = new Set(
      out.map((f) => (f.location?.kind === "tread" ? f.location.number : -1)),
    );
    for (const run of consecutiveWinderRuns(ctx)) {
      if (run.length < 2 || !run.some(outside)) continue;
      const cs = groupCorners(ctx, run);
      if (cs === null || cs.length === 0) continue;
      const c = run.map((t) => t.colletChord);
      const push = (t: Tread, message: Message): void => {
        if (reported.has(t.number)) return;
        reported.add(t.number);
        out.push({
          status: "violation",
          measured: t.colletChord,
          location: treadLocation(t),
          message,
        });
      };
      /** Pas i₀ → i₁ contraire au sens attendu : constat sur la marche i₁. */
      const flag = (i1: number, i0: number): void => {
        const t = run[i1]!;
        const a = run[i0]!;
        push(
          t,
          msg("rules.G_COLLET_MONOTONE.outsideBreak", {
            tread: t.number,
            collet: dec(t.colletChord),
            previous: dec(a.colletChord),
            previousTread: a.number,
          }),
        );
      };
      /** Extremum local mal placé (crête au droit d'un angle, creux entre deux angles). */
      const extremum = (i: number, what: Message): void => {
        const t = run[i]!;
        push(
          t,
          msg("rules.G_COLLET_MONOTONE.outsideExtremum", {
            tread: t.number,
            what,
            collet: dec(t.colletChord),
            before: dec(run[i - 1]!.colletChord),
            beforeTread: run[i - 1]!.number,
            after: dec(run[i + 1]!.colletChord),
            afterTread: run[i + 1]!.number,
          }),
        );
      };
      run.forEach((t, i) => {
        if (!outside(t)) return;
        // Marche au droit d'un poteau (ou voisine) : collet sur le contour du poteau, à arbitrer
        // (QUESTIONS B1) : pas de conclusion.
        const near = [run[i - 1], t, run[i + 1]].filter((x): x is Tread => x !== undefined);
        if (near.some((x) => newelTreads.has(x.number))) return;
        const prev = i > 0 ? c[i - 1]! : undefined;
        const next = i + 1 < c.length ? c[i + 1]! : undefined;
        const v = c[i]!;
        const first = cs[0]!;
        const last = cs[cs.length - 1]!;
        if (i < first) {
          // Vers le premier angle : décroissant.
          if (prev !== undefined && v > prev + NUMERIC_EPS) flag(i, i - 1);
          else if (next !== undefined && next > v + NUMERIC_EPS) flag(i + 1, i);
        } else if (i > last) {
          // Au-delà du dernier angle : croissant.
          if (prev !== undefined && v < prev - NUMERIC_EPS) flag(i, i - 1);
          else if (next !== undefined && next < v - NUMERIC_EPS) flag(i + 1, i);
        } else if (cs.includes(i)) {
          // Au droit d'un angle : pas de crête.
          if (
            prev !== undefined &&
            next !== undefined &&
            v > prev + NUMERIC_EPS &&
            v > next + NUMERIC_EPS
          )
            extremum(i, msg("rules.G_COLLET_MONOTONE.crest"));
        } else if (
          prev !== undefined &&
          next !== undefined &&
          v < prev - NUMERIC_EPS &&
          v < next - NUMERIC_EPS
        ) {
          // Entre deux angles : pas de creux.
          extremum(i, msg("rules.G_COLLET_MONOTONE.dip"));
        }
      });
    }
  }
  if (out.length > 0) return out;
  return [
    {
      status: "ok",
      location: { kind: "stair" },
      message: msg("rules.G_COLLET_MONOTONE.ok", {
        count: groups.length,
        corners: msg("rules.G_COLLET_MONOTONE.corners", { count: corners }),
      }),
    },
  ];
};

/** G_EXT_MAX_ERP_TOURNANT : g_ext < 420 (inégalité stricte de la formule). */
const outerGoingMax: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    goingItems(treadsOfKind(ctx.stepping, "winder"), (t) => t.goingOuter),
    msg("rules.G_EXT_MAX_ERP_TOURNANT.quantity"),
    {
      bounds: { min: ctx.rule.min, max: ctx.rule.max, strictMax: true },
      emptyMessage: noWinder(),
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
