/**
 * Étape 3 du pipeline : le **découpage** (`computeStepping(project, layout) → Stepping`).
 *
 * 1. Hauteurs (`rises.ts`) : n, h₁ = h + firstRiseOffset, autres (H − h₁)/(n − 1), Σ = H.
 * 2. Nez sur Γ (`positions.ts`) : n nez, n − 1 girons égaux (paliers : nez aux bords).
 * 3. Nez initiaux perpendiculaires à Γ en P_k ; Q_k, R_k = premières intersections avec C_i
 *    et C_e de part et d'autre de P_k (`balancing/postprocess.ts`).
 * 4. Zones de balancement par tournant `winders` (`zones.ts`), stratégie M0, M1, M2 (herse),
 *    M3 ou M6 (rotation paramétrée) (`balancing/`), variante M3 `auto` = cubique sauf structure
 *    débillardée (décision Q7). M2 : borne de α par zone et saut de collet en entrée de zone
 *    signalés (décision Q9).
 * 5. Surcharges `angle` (φ imposé en degrés, écart à la perpendiculaire à Γ, positif dans le
 *    sens du tournant — trigonométrique si le jour est à gauche, horaire s'il est à droite :
 *    le bout côté mur avance vers l'arrivée, le collet recule) appliquées avant le
 *    post-traitement ; surcharges orphelines signalées.
 * 6. Contrôles communs K5 (croisements) et K3 (monotonie des collets vers **chaque** angle du
 *    jour : deux vallées dans une zone unique de 180°) → `notes`.
 * 7. Marches (`treads.ts`).
 *
 * Côté du collet : celui du jour de chaque tournant (`TurnZone.collarSide`). Escalier en S ou
 * en Z : les zones d'un tournant dont le jour est sur `layout.outer` sont calculées sur la vue
 * retournée du tracé (`sides.ts`) ; la volée intermédiaire doit offrir au moins un giron de
 * partie droite (marche virtuelle fixe entre les deux balancements, CHALLENGE G3), sinon
 * `SteppingError`. Transition de la ligne de foulée (d_f ≠ E/2) : nez perpendiculaires à la
 * volée (et non à l'oblique de Γ), signalée dans les notes.
 *
 * Tracé hélicoïdal (`layout.helical`, jalon 5a) : découpage propre, `stepping/helical.ts`.
 */
import { curvePointAt, curveTangentAt } from "../geom2d/curve.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { getBalancingStrategy } from "../balancing/registry.js";
import { HERSE_DEFAULT_ANGLE, herseAlphaMax } from "../balancing/m2.js";
import { ROTATION_DEFAULT_REACH, ROTATION_DEFAULT_STEEPNESS } from "../balancing/m6.js";
import {
  colletBetween,
  cornerMonotonyBreaks,
  cornerPositions,
  realizeNosing,
  type NosingSeed,
} from "../balancing/postprocess.js";
import type { M3Variant } from "../balancing/profile.js";
import type { Layout, NosingLine, Stepping } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { dec, msg, type Message, type MessageKey, type MessageParam } from "@blondel/i18n";
import { SteppingError } from "./errors.js";
import { placeNosings } from "./positions.js";
import { computeRises } from "./rises.js";
import { developmentInner } from "./development.js";
import { computeHelicalStepping } from "./helical.js";
import { buildTreads } from "./treads.js";
import {
  collarSideAt,
  colletOnSide,
  findCrossingsOnSides,
  flipLayout,
  flipNosing,
  flipSeed,
  turnCollarSide,
  type Side,
} from "./sides.js";
import {
  balancingInput,
  COLLET_TIE_TOLERANCE,
  evaluateZone,
  extentLimits,
  groupWinderTurns,
  MAX_BALANCED_EXTENT,
  pickZone,
  settlesChoice,
  WINDERS_PER_SIDE_MAX,
  zoneBounds,
  type ZoneContext,
  type ZoneEvaluation,
} from "./zones.js";

/**
 * Plugins de structure débillardés qui ne suivent pas la convention de nommage `debillard*`
 * (jalon 5b : `steel-curved`, limon porteur débillardé soudé métal).
 */
export const DEBILLARDE_STRUCTURE_KINDS: ReadonlySet<string> = new Set(["steel-curved"]);

/**
 * Une structure est « débillardée » si son `kind` commence par `debillard` (convention de
 * nommage des plugins de structure, à respecter par les agents structures) ou figure dans
 * `DEBILLARDE_STRUCTURE_KINDS`.
 */
export function isDebillardeStructure(kind: string): boolean {
  return kind.startsWith("debillard") || DEBILLARDE_STRUCTURE_KINDS.has(kind);
}

/** Variante M3 effective (décision Q7 : cubique, quintique pour un limon débillardé). */
export function resolveM3Variant(project: Project): M3Variant {
  const v = project.stair.balancing.variant;
  if (v !== "auto") return v;
  return isDebillardeStructure(project.stair.structure.kind) ? "quintic" : "cubic";
}

const methodLabel = (method: string, variant: M3Variant): string =>
  method === "M3" ? `M3-${variant}` : method;

const variantLabel = (method: string, variant: M3Variant): MessageParam =>
  method === "M3"
    ? msg(variant === "cubic" ? "stepping.method.m3Cubic" : "stepping.method.m3Quintic")
    : method;

/** « a et b et c » : liste de fragments de phrase (au moins un). */
const andList = (items: readonly MessageParam[]): MessageParam =>
  items.slice(1).reduce((acc, x) => msg("stepping.list.and", { a: acc, b: x }), items[0]!);

/** Libellé d'une surcharge de nez (« nez fixe », « angle imposé »). */
const overrideKind = (kind: "fixed" | "angle"): Message =>
  msg(kind === "fixed" ? "stepping.override.fixed" : "stepping.override.angle");

/** Clé du libellé d'une extrémité de zone (« tangente », « libre »). */
const zoneEndKey = (end: "tangent" | "free"): MessageKey =>
  end === "tangent" ? "stepping.zoneEnd.tangent" : "stepping.zoneEnd.free";

/** Options de calcul du découpage (vérification ; sans effet sur le résultat). */
export interface SteppingOptions {
  /**
   * Choix automatique de zone : évaluer **tous** les candidats de l'énumération au lieu de
   * s'arrêter au premier nombre de nez balancés qui fixe le choix (optimisation ADR-0006).
   * Le résultat doit être identique : option réservée aux tests de non-régression.
   */
  readonly exhaustiveZoneSearch?: boolean;
}

/**
 * Évalue les zones [kL − nb ; kR + na] des couples `pairs` (zones d'au moins une marche
 * balancée) par nombre croissant de nez balancés (b − a − 1). Si `stopTarget` est donné (choix
 * automatique), arrêt dès qu'un nombre fournit un candidat régulier atteignant la cible :
 * `pickZone` ne peut plus retenir un nombre supérieur (ADR-0006). Candidats rendus dans l'ordre
 * d'énumération (nb, na), dernier départage de `pickZone`.
 */
function enumerateZones(
  pairs: readonly (readonly [number, number])[],
  evaluate: (a: number, b: number) => ZoneEvaluation,
  bounds: { readonly kL: number; readonly kR: number },
  stopTarget: Mm | null,
): ZoneEvaluation[] {
  const pending = pairs
    .map(([nb, na], order) => ({ a: bounds.kL - nb, b: bounds.kR + na, order }))
    .filter(({ a, b }) => b - a >= 2)
    .sort((x, y) => x.b - x.a - (y.b - y.a) || x.order - y.order);
  const evaluated: { e: ZoneEvaluation; order: number }[] = [];
  for (let i = 0; i < pending.length;) {
    const count = pending[i]!.b - pending[i]!.a;
    let settled = false;
    for (; i < pending.length && pending[i]!.b - pending[i]!.a === count; i++) {
      const { a, b, order } = pending[i]!;
      const e = evaluate(a, b);
      evaluated.push({ e, order });
      if (stopTarget !== null && settlesChoice(e, stopTarget)) settled = true;
    }
    if (settled) break;
  }
  return evaluated.sort((x, y) => x.order - y.order).map((x) => x.e);
}

/**
 * Calcule le découpage d'un projet sur un tracé donné (`computeLayout`).
 *
 * @throws LayoutError si n sort du domaine ; SteppingError si les hauteurs ou les paliers
 *   sont impossibles, ou si une ligne de nez perpendiculaire ne rencontre pas les bords.
 */
export function computeStepping(
  project: Project,
  layout: Layout,
  options: SteppingOptions = {},
): Stepping {
  // Tracé hélicoïdal (jalon 5a) : nez rayonnants, sans balancement (`stepping/helical.ts`).
  if (layout.helical) return computeHelicalStepping(project, layout);
  const notes: Message[] = [];
  const { riserCount: n, rise, rises, z } = computeRises(project);
  const positions = placeNosings(project, layout, n);
  notes.push(...positions.notes);
  const { going } = positions;

  checkOppositeTurns(layout, going);
  const transitions = layout.walklineTransitions ?? [];
  for (const tr of transitions) {
    notes.push(
      msg(
        layout.innerSide === "left"
          ? "stepping.walklineTransition.fromLeft"
          : "stepping.walklineTransition.fromRight",
        {
          flight: tr.leg + 1,
          from: dec(tr.fromOffset),
          to: dec(tr.toOffset),
          angle: dec((tr.angle * 180) / Math.PI),
          length: dec(tr.sEnd - tr.sStart),
          going: dec(going),
          effective: dec(going * Math.cos(tr.angle)),
        },
      ),
    );
  }

  // ------------------------------------------------------------ nez initiaux perpendiculaires
  const outward = (t: ReturnType<typeof curveTangentAt>) =>
    layout.innerSide === "left" ? V.perpRight(t) : V.perpLeft(t);
  const seeds: NosingSeed[] = positions.s.map((s, k) => {
    // Transition S / Z : nez perpendiculaires à la volée, pas à l'oblique de Γ.
    const tr = transitions.find((t) => s >= t.sStart - GEOM_EPS && s <= t.sEnd + GEOM_EPS);
    const tangent = tr ? tr.direction : curveTangentAt(layout.walkline, s);
    return {
      index: k,
      s,
      p: curvePointAt(layout.walkline, s),
      z: z[k]!,
      tangent,
      perpendicular: outward(tangent),
    };
  });
  const perpendicularOn = (lay: Layout, from: readonly NosingSeed[] = seeds): NosingLine[] =>
    from.map((seed) => {
      const res = realizeNosing(lay, seed, { kind: "dir", dir: seed.perpendicular }, false);
      if (!res.ok) {
        throw new SteppingError(
          msg("stepping.perpendicularNosingImpossible", { reason: res.reason }),
        );
      }
      return res.nosing;
    });
  const nosings = perpendicularOn(layout);
  const devInner = developmentInner(layout, project);
  const devLayout: Layout = devInner === layout.inner ? layout : { ...layout, inner: devInner };
  const devNosings = devLayout === layout ? nosings.slice() : perpendicularOn(devLayout);

  /**
   * Tracé vu par les stratégies pour un côté du jour : le tracé lui-même, ou (S / Z, jour sur
   * `layout.outer`) sa vue retournée, avec germes et nez initiaux retournés.
   */
  interface SideView {
    readonly flipped: boolean;
    readonly layout: Layout;
    readonly devLayout: Layout;
    readonly devNosings: readonly NosingLine[];
    readonly seeds: readonly NosingSeed[];
  }
  const mainView: SideView = { flipped: false, layout, devLayout, devNosings, seeds };
  let flippedView: SideView | null = null;
  const viewFor = (side: Side): SideView => {
    if (side === layout.innerSide) return mainView;
    if (!flippedView) {
      const fl = flipLayout(layout);
      const fSeeds = seeds.map(flipSeed);
      const fDev = developmentInner(fl, project);
      const fDevLayout: Layout = fDev === fl.inner ? fl : { ...fl, inner: fDev };
      flippedView = {
        flipped: true,
        layout: fl,
        devLayout: fDevLayout,
        devNosings: perpendicularOn(fDevLayout, fSeeds),
        seeds: fSeeds,
      };
    }
    return flippedView;
  };

  // ------------------------------------------------------------ nez fixes et surcharges
  const baseFixed = new Set<number>([0, n - 1]);
  const baseFree = new Set<number>([0, n - 1]);
  for (const k of positions.landingTreads) {
    baseFixed.add(k).add(k + 1);
    baseFree.add(k).add(k + 1);
  }
  const angleOverrides = new Map<number, number>();
  for (const o of project.stair.nosingOverrides) {
    if (o.index >= n) {
      notes.push(
        msg("stepping.override.orphan", { kind: overrideKind(o.kind), nosing: o.index, total: n }),
      );
      continue;
    }
    if (o.kind === "fixed") baseFixed.add(o.index);
    else {
      if (angleOverrides.has(o.index)) {
        notes.push(msg("stepping.override.multipleAngles", { nosing: o.index }));
      }
      angleOverrides.set(o.index, o.angle);
    }
  }

  // ------------------------------------------------------------ zones de balancement
  const {
    method,
    windersPerSide,
    colletTieTolerance,
    targetCollet,
    maxBalancedExtent,
    herseAngle,
    rotationReach,
    rotationSteepness,
  } = project.stair.balancing;
  const extent = maxBalancedExtent ?? MAX_BALANCED_EXTENT;
  const variant = resolveM3Variant(project);
  const strategy = getBalancingStrategy(method);
  // Zones par angle au droit des poteaux d'angle (`groupWinderTurns`, nez de poteau fixe et libre).
  const posts = new Set<number>();
  project.stair.layout.turns.forEach((t, j) => {
    if (t.mode === "winders" && t.inner.kind === "newel") posts.add(j);
  });
  const baseNosings = nosings.slice();
  /**
   * Zones de balancement pour un regroupement des tournants : classique, ou **par angle** au
   * droit des poteaux (`usePosts`, voir `groupWinderTurns`). Travaille sur des copies des nez,
   * des nez fixes / libres et des remarques.
   */
  const runZones = (usePosts: boolean) => {
    const nosings = baseNosings.slice();
    const fixed = new Set(baseFixed);
    const free = new Set(baseFree);
    const notes: Message[] = [];
    const balancedZones: Stepping["balancedZones"][number][] = [];
    const zoneRanges: { from: number; to: number; corners: readonly Mm[]; side: Side }[] = [];
    const groups = groupWinderTurns(layout, positions.s, going, fixed, {
      posts,
      free,
      perAngle: usePosts,
    });
    const params: Record<string, unknown> =
      method === "M3"
        ? { variant }
        : method === "M2"
          ? { alpha: herseAngle ?? HERSE_DEFAULT_ANGLE }
          : method === "M6"
            ? {
                reach: rotationReach ?? ROTATION_DEFAULT_REACH,
                steepness: rotationSteepness ?? ROTATION_DEFAULT_STEEPNESS,
              }
            : {};

    for (const group of groups) {
      const turnLabel =
        group.first === group.last
          ? msg("stepping.turnName.single", { turn: group.first + 1 })
          : msg("stepping.turnName.group", { first: group.first + 1, last: group.last + 1 });
      const turnName = group.posts
        ? msg("stepping.turnName.atPost", {
            turn: turnLabel,
            nosings: andList(group.posts.map((k) => msg("stepping.nosingRef", { nosing: k }))),
          })
        : turnLabel;
      const bounds = zoneBounds(group, positions.s, fixed);
      const maxBefore = Math.min(WINDERS_PER_SIDE_MAX, bounds.kL - bounds.lo);
      const maxAfter = Math.min(WINDERS_PER_SIDE_MAX, bounds.hi - bounds.kR);
      const view = viewFor(group.side);
      const ctx: ZoneContext = {
        layout: view.layout,
        devLayout: view.devLayout,
        devNosings: view.devNosings,
        seeds: view.seeds,
        nosings: view.flipped ? nosings.map(flipNosing) : nosings,
        z,
        rise,
        going,
        strategy,
        params,
        freeNosings: free,
        collarSide: group.side,
      };
      const auto = windersPerSide === "auto" && method !== "M0";
      const pairs: [number, number][] = [];
      // Choix automatique : couples hors de l'étendue K7, évalués seulement en repli.
      const beyondExtent: [number, number][] = [];
      if (windersPerSide !== "auto") {
        const nb = Math.min(windersPerSide, bounds.kL - bounds.lo);
        const na = Math.min(windersPerSide, bounds.hi - bounds.kR);
        if (nb !== windersPerSide || na !== windersPerSide) {
          notes.push(
            msg("stepping.windersPerSideLimited", {
              turn: turnName,
              count: windersPerSide,
              before: nb,
              after: na,
            }),
          );
        }
        pairs.push([nb, na]);
      } else if (method === "M0") {
        // Rayonnant : zone réduite aux nez situés sur l'arc de Γ.
        const inArc = (k: number): boolean =>
          positions.s[k]! > group.sStart + GEOM_EPS && positions.s[k]! < group.sEnd - GEOM_EPS;
        let nb = 0;
        while (nb < maxBefore && inArc(bounds.kL - nb)) nb++;
        let na = 0;
        while (na < maxAfter && inArc(bounds.kR + na)) na++;
        pairs.push([nb, na]);
      } else {
        // Choix automatique : étendue K7 (`maxBalancedExtent` girons depuis l'angle).
        const lim = extentLimits(group, positions.s, bounds, going, extent);
        for (let nb = 0; nb <= maxBefore; nb++) {
          for (let na = 0; na <= maxAfter; na++) {
            (nb <= lim.before && na <= lim.after ? pairs : beyondExtent).push([nb, na]);
          }
        }
      }
      const cands = enumerateZones(
        pairs,
        (a, b) => evaluateZone(ctx, group, a, b, bounds),
        bounds,
        auto && !options.exhaustiveZoneSearch ? targetCollet : null,
      );
      let beyond = false;
      if (
        auto &&
        beyondExtent.length > 0 &&
        pickZone(cands, targetCollet, colletTieTolerance ?? COLLET_TIE_TOLERANCE) === null
      ) {
        // Aucune zone admissible dans l'étendue K7 (étendue trop courte, jour étroit) : plutôt
        // que des nez perpendiculaires (collet nul, lignes croisées au tournant), repli sur les
        // zones plus étendues, signalé.
        const more = enumerateZones(
          beyondExtent,
          (a, b) => evaluateZone(ctx, group, a, b, bounds),
          bounds,
          options.exhaustiveZoneSearch ? null : targetCollet,
        );
        if (pickZone(more, targetCollet, colletTieTolerance ?? COLLET_TIE_TOLERANCE) !== null) {
          cands.splice(0, cands.length, ...more);
          beyond = true;
        }
      }
      if (cands.length === 0) {
        notes.push(msg("stepping.noWinders", { turn: turnName }));
        continue;
      }
      const chosen = auto
        ? pickZone(cands, targetCollet, colletTieTolerance ?? COLLET_TIE_TOLERANCE)
        : cands[0]!;
      if (chosen === null || !chosen.ok) {
        const reason = chosen?.reason ?? cands.find((c) => !c.ok)?.reason;
        if (group.posts) {
          // Côté d'un poteau : les lignes perpendiculaires à Γ (arc centré sur le poteau) sont
          // rayonnantes vers le poteau et y aboutissent (collets > 0, sans croisement).
          notes.push(
            reason
              ? msg("stepping.noZoneAtPostWithReason", { turn: turnName, reason })
              : msg("stepping.noZoneAtPost", { turn: turnName }),
          );
          continue;
        }
        notes.push(
          reason
            ? msg("stepping.noBalancingWithReason", { turn: turnName, reason })
            : msg("stepping.noBalancing", { turn: turnName }),
        );
        continue;
      }
      for (const nl of chosen.nosings) nosings[nl.index] = view.flipped ? flipNosing(nl) : nl;
      for (const k of chosen.corrected) {
        notes.push(msg("stepping.colletClampedToWell", { nosing: k }));
      }
      const { from, to } = chosen.zone;
      const alphaMax = method === "M2" ? herseAlphaMax(balancingInput(ctx, chosen.zone)) : null;
      balancedZones.push({
        turn: group.first,
        from,
        to,
        method: methodLabel(method, variant),
        ends: chosen.zone.ends,
        ...(chosen.zone.continuation && method === "M3"
          ? { continuation: chosen.zone.continuation }
          : {}),
        ...(alphaMax !== null ? { herseAlphaMax: alphaMax } : {}),
      });
      zoneRanges.push({ from, to, corners: group.corners, side: group.side });
      notes.push(
        msg("stepping.zoneSummary", {
          turn: turnName,
          before: bounds.kL - from,
          after: to - bounds.kR,
          from,
          to,
          endA: msg(zoneEndKey(chosen.zone.ends[0])),
          endB: msg(zoneEndKey(chosen.zone.ends[1])),
          method: variantLabel(method, variant),
          minChord: dec(chosen.minChord),
          minArc: dec(chosen.minArc),
        }),
      );
      if (beyond) {
        notes.push(
          msg("stepping.extentExceeded", { turn: turnName, count: dec(extent), from, to }),
        );
      }
      if (auto && chosen.minChord < targetCollet - 1e-6) {
        notes.push(
          msg("stepping.targetColletMissed", {
            turn: turnName,
            target: dec(targetCollet),
            cause:
              beyondExtent.length > 0 && !beyond
                ? msg("stepping.colletMissedCause.extentLimited", { count: dec(extent) })
                : msg("stepping.colletMissedCause.unreachable"),
          }),
        );
      }
      if (method === "M2") {
        notes.push(
          msg("stepping.herseNote", {
            turn: turnName,
            alpha: dec(herseAngle ?? HERSE_DEFAULT_ANGLE),
            alphaMax: dec(alphaMax ?? 0),
          }),
        );
      }
      if (method === "M6") {
        notes.push(
          msg(
            rotationReach === undefined || rotationSteepness === undefined
              ? "stepping.rotationNoteDefaults"
              : "stepping.rotationNote",
            {
              turn: turnName,
              count: dec(rotationReach ?? ROTATION_DEFAULT_REACH),
              steepness: dec(rotationSteepness ?? ROTATION_DEFAULT_STEEPNESS),
            },
          ),
        );
      }
      if (method === "M1" || method === "M2") {
        const [endA, endB] = chosen.zone.ends;
        const parts: Message[] = [];
        if (endA === "tangent") {
          parts.push(
            msg("stepping.jumpBottom", {
              value: dec(
                going - colletOnSide(layout, nosings[from]!, nosings[from + 1]!, group.side).arc,
              ),
            }),
          );
        }
        if (endB === "tangent") {
          parts.push(
            msg("stepping.jumpTop", {
              value: dec(
                going - colletOnSide(layout, nosings[to - 1]!, nosings[to]!, group.side).arc,
              ),
            }),
          );
        }
        if (parts.length > 0) {
          notes.push(
            msg(method === "M1" ? "stepping.m1EntryKnee" : "stepping.m2EntryJump", {
              turn: turnName,
              values: andList(parts),
            }),
          );
        }
      }
    }
    return { nosings, fixed, notes, balancedZones, zoneRanges };
  };
  /**
   * Ruptures K3 (par angle, en corde) sur chaque **tournant entier** : zones retenues réunies
   * avec les nez de la partie tournante des tournants balancés (marche du poteau entre deux
   * zones par angle, côté de poteau sans zone admissible), plages contiguës fusionnées — comme
   * le contrôle de conception `G_COLLET_MONOTONE`, qui suit les marches balancées consécutives.
   * Mesurer zone par zone laisserait hors contrôle la marche du poteau (collet effondré entre
   * deux zones régulières).
   */
  const k3BreakCount = (r: ReturnType<typeof runZones>): number => {
    const ranges: { from: number; to: number; corners: Mm[]; side: Side }[] = r.zoneRanges.map(
      (zr) => ({ from: zr.from, to: zr.to, corners: [...zr.corners], side: zr.side }),
    );
    for (const t of layout.turns) {
      if (t.mode !== "winders") continue;
      let from = 0;
      let to = n - 1;
      positions.s.forEach((sk, k) => {
        if (sk <= t.sStart + GEOM_EPS) from = k;
      });
      for (let k = n - 1; k >= 0; k--) if (positions.s[k]! >= t.sEnd - GEOM_EPS) to = k;
      if (to > from) {
        ranges.push({
          from,
          to,
          corners: [(t.sStart + t.sEnd) / 2],
          side: turnCollarSide(layout, t.index),
        });
      }
    }
    ranges.sort((x, y) => x.from - y.from);
    const merged: { from: number; to: number; corners: Mm[]; side: Side }[] = [];
    for (const rg of ranges) {
      const prev = merged[merged.length - 1];
      if (prev && rg.from <= prev.to && rg.side === prev.side) {
        prev.to = Math.max(prev.to, rg.to);
        for (const c of rg.corners) if (!prev.corners.includes(c)) prev.corners.push(c);
      } else merged.push({ ...rg, corners: [...rg.corners] });
    }
    return merged.reduce((acc, zr) => {
      const chords: Mm[] = [];
      for (let k = zr.from; k < zr.to; k++)
        chords.push(colletOnSide(layout, r.nosings[k]!, r.nosings[k + 1]!, zr.side).chord);
      const corners = cornerPositions(
        positions.s.slice(zr.from, zr.to + 1),
        zr.corners.sort((x, y) => x - y),
      );
      return acc + cornerMonotonyBreaks(chords, corners).length;
    }, 0);
  };
  // Poteaux d'angle : le balancement classique (jour de développement virtuel) peut laisser des
  // collets irréguliers autour du poteau (K3) ; les zones par angle (nez du poteau fixe, une
  // zone de chaque côté) sont alors retenues si elles en laissent **moins** sur les tournants
  // entiers (marche du poteau comprise).
  let zoneRun = runZones(false);
  const classicBreaks = posts.size > 0 ? k3BreakCount(zoneRun) : 0;
  if (classicBreaks > 0) {
    const perAngle = runZones(true);
    const perAngleBreaks = k3BreakCount(perAngle);
    if (perAngleBreaks < classicBreaks) {
      zoneRun = perAngle;
      zoneRun.notes.push(
        perAngleBreaks > 0
          ? msg("stepping.perAngleZonesWithBreaks", {
              breaks: msg("stepping.breakCount", { count: classicBreaks }),
              remaining: msg("stepping.remainingBreakCount", { count: perAngleBreaks }),
            })
          : msg("stepping.perAngleZones", {
              breaks: msg("stepping.breakCount", { count: classicBreaks }),
            }),
      );
    }
  }
  nosings.splice(0, nosings.length, ...zoneRun.nosings);
  notes.push(...zoneRun.notes);
  const fixed = zoneRun.fixed;
  const { balancedZones, zoneRanges } = zoneRun;

  // ------------------------------------------------------------ angles imposés
  for (const [k, angle] of angleOverrides) {
    const seed = seeds[k]!;
    // Sens positif = sens du tournant voisin (trigonométrique si son jour est à gauche, horaire
    // s'il est à droite) : la surcharge donne des escaliers miroirs pour des tracés miroirs.
    const turnSign = collarSideAt(layout, seed.s) === "left" ? 1 : -1;
    const dir = V.rotate(seed.perpendicular, (turnSign * angle * Math.PI) / 180);
    const res = realizeNosing(layout, seed, { kind: "dir", dir }, Math.abs(angle) > 0);
    if (!res.ok) {
      notes.push(
        msg("stepping.override.angleInapplicable", {
          nosing: k,
          angle: dec(angle),
          reason: res.reason,
        }),
      );
      continue;
    }
    nosings[k] = res.nosing;
    if (fixed.has(k) && Math.abs(angle) > 0) {
      notes.push(msg("stepping.override.angleOnFixed", { nosing: k, angle: dec(angle) }));
    }
  }

  // ------------------------------------------------------------ contrôles K5 / K3 / collets
  for (const c of findCrossingsOnSides(layout, nosings)) {
    notes.push(msg("stepping.k5Crossing", { a: c.i, b: c.j }));
  }
  for (let k = 0; k + 1 < n; k++) {
    const side = collarSideAt(layout, (positions.s[k]! + positions.s[k + 1]!) / 2);
    const c = colletOnSide(layout, nosings[k]!, nosings[k + 1]!, side);
    if (!(c.chord > GEOM_EPS) && !positions.landingTreads.has(k)) {
      notes.push(msg("stepping.zeroCollet", { tread: k + 1, chord: dec(c.chord) }));
    }
  }
  // K3 par angle : une vallée de collets autour de chaque angle du jour de la zone.
  for (const zr of zoneRanges) {
    const chords: Mm[] = [];
    for (let k = zr.from; k < zr.to; k++)
      chords.push(colletOnSide(layout, nosings[k]!, nosings[k + 1]!, zr.side).chord);
    const corners = cornerPositions(positions.s.slice(zr.from, zr.to + 1), zr.corners);
    for (const i of cornerMonotonyBreaks(chords, corners)) {
      notes.push(
        msg("stepping.k3NotMonotone", {
          tread: zr.from + i + 2,
          collet: dec(chords[i + 1]!),
          previous: dec(chords[i]!),
        }),
      );
    }
  }

  // ------------------------------------------------------------ marches
  const treads = buildTreads({
    layout,
    nosings,
    landingTreads: positions.landingTreads,
    zones: zoneRanges,
    winderArcs: layout.turns.filter((t) => t.mode === "winders"),
    nosingDepth: project.stair.treads.nosing,
  });
  const run = positions.s[n - 1]! - positions.s[0]!;

  return {
    riserCount: n,
    rises,
    rise,
    going,
    blondel: 2 * rise + going,
    run,
    nosings,
    treads,
    balancedZones,
    notes,
  };
}

/**
 * S / Z (CHALLENGE G3) : entre deux tournants balancés de sens opposés, la partie droite de Γ
 * de la volée intermédiaire doit mesurer au moins un giron, pour y placer la marche virtuelle
 * fixe qui sépare les deux balancements (une zone unique de 180° n'a pas de sens quand les
 * jours sont de part et d'autre).
 * @throws SteppingError sinon.
 */
function checkOppositeTurns(layout: Layout, going: Mm): void {
  for (let j = 0; j + 1 < layout.turns.length; j++) {
    const a = layout.turns[j]!;
    const b = layout.turns[j + 1]!;
    if (a.mode !== "winders" || b.mode !== "winders") continue;
    if (turnCollarSide(layout, j) === turnCollarSide(layout, j + 1)) continue;
    const straight = b.sStart - a.sEnd;
    if (straight < going - GEOM_EPS) {
      throw new SteppingError(
        msg("stepping.oppositeTurnsTooClose", {
          turnA: j + 1,
          turnB: j + 2,
          straight: dec(straight),
          going: dec(going),
          flight: j + 2,
        }),
      );
    }
  }
}
