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
import { fmt } from "../rules/check.js";
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

const variantLabel = (method: string, variant: M3Variant): string =>
  method === "M3" ? `M3 ${variant === "cubic" ? "cubique" : "quintique"}` : method;

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
  const notes: string[] = [];
  const { riserCount: n, rise, rises, z } = computeRises(project);
  const positions = placeNosings(project, layout, n);
  notes.push(...positions.notes);
  const { going } = positions;

  checkOppositeTurns(layout, going);
  const transitions = layout.walklineTransitions ?? [];
  for (const tr of transitions) {
    notes.push(
      `Volée ${tr.leg + 1} : tournants de sens opposés, la ligne de foulée passe de ${fmt(tr.fromOffset)} à ${fmt(tr.toOffset)} mm du bord ${layout.innerSide === "left" ? "gauche" : "droit"} par un raccord linéaire (Γ oblique de ${fmt((tr.angle * 180) / Math.PI)}° sur ${fmt(tr.sEnd - tr.sStart)} mm, nez perpendiculaires à la volée : le giron de ${fmt(going)} mm mesuré sur Γ n'y donne que ${fmt(going * Math.cos(tr.angle))} mm entre deux nez, g·cos θ) ; transition non normalisée (DTU muet), défaut à valider.`,
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
        throw new SteppingError(`Ligne de nez perpendiculaire impossible : ${res.reason}.`);
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
        `Surcharge orpheline (${o.kind === "fixed" ? "nez fixe" : "angle imposé"}) : le nez ${o.index} n'existe pas (${n} nez), surcharge non appliquée.`,
      );
      continue;
    }
    if (o.kind === "fixed") baseFixed.add(o.index);
    else {
      if (angleOverrides.has(o.index)) {
        notes.push(`Nez ${o.index} : plusieurs angles imposés, le dernier est appliqué.`);
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
    const notes: string[] = [];
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
      const turnName =
        (group.first === group.last
          ? `Tournant ${group.first + 1}`
          : `Tournants ${group.first + 1} et ${group.last + 1} (zone unique)`) +
        (group.posts ? ` (${group.posts.map((k) => `nez ${k}`).join(" et ")} au poteau)` : "");
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
            `${turnName} : ${windersPerSide} marches balancées demandées de chaque côté, ${nb} avant et ${na} après possibles (nez fixes).`,
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
        notes.push(`${turnName} : aucune marche à balancer (nez fixes encadrant le tournant).`);
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
            `${turnName} : aucune zone de balancement admissible de ce côté du poteau${reason ? ` (${reason})` : ""} ; nez rayonnants vers le poteau.`,
          );
          continue;
        }
        notes.push(
          `${turnName} : aucun balancement admissible (collets positifs, lignes de nez sans croisement)${reason ? ` ; ${reason}` : ""} ; nez laissés perpendiculaires à la ligne de foulée.`,
        );
        continue;
      }
      for (const nl of chosen.nosings) nosings[nl.index] = view.flipped ? flipNosing(nl) : nl;
      for (const k of chosen.corrected) {
        notes.push(
          `Nez ${k} : la ligne recoupe le jour avant le collet calculé, collet ramené au jour.`,
        );
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
        `${turnName} : ${bounds.kL - from} + ${to - bounds.kR} nez balancés (nez fixes ${from} et ${to}, extrémités ${chosen.zone.ends.map((e) => (e === "tangent" ? "tangente" : "libre")).join("/")}), ${variantLabel(method, variant)}, collet minimal ${fmt(chosen.minChord)} mm en corde (${fmt(chosen.minArc)} mm en arc).`,
      );
      if (beyond) {
        notes.push(
          `${turnName} : aucune zone admissible dans l'étendue de balancement de ${fmt(extent)} ${extent < 2 ? "giron" : "girons"} depuis l'angle ; étendue dépassée (nez fixes ${from} et ${to}).`,
        );
      }
      if (auto && chosen.minChord < targetCollet - 1e-6) {
        notes.push(
          `${turnName} : collet cible de ${fmt(targetCollet)} mm non atteint (${beyondExtent.length > 0 && !beyond ? `étendue de balancement limitée à ${fmt(extent)} ${extent < 2 ? "giron" : "girons"} depuis l'angle` : "aucune zone possible ne l'atteint"}) ; zone de collet maximal retenue.`,
        );
      }
      if (method === "M2") {
        notes.push(
          `${turnName} : herse (M2), α = ${fmt(herseAngle ?? HERSE_DEFAULT_ANGLE)}° dans ]0 ; ${fmt(alphaMax ?? 0)}°[ (au-delà, collets croissants vers l'angle).`,
        );
      }
      if (method === "M6") {
        notes.push(
          `${turnName} : rotation paramétrée (M6), portée λ = ${fmt(rotationReach ?? ROTATION_DEFAULT_REACH)} giron(s), raideur p = ${fmt(rotationSteepness ?? ROTATION_DEFAULT_STEEPNESS)}${rotationReach === undefined || rotationSteepness === undefined ? " (réglages par défaut à valider)" : ""}.`,
        );
      }
      if (method === "M1" || method === "M2") {
        const [endA, endB] = chosen.zone.ends;
        const parts: string[] = [];
        if (endA === "tangent") {
          parts.push(
            `${fmt(going - colletOnSide(layout, nosings[from]!, nosings[from + 1]!, group.side).arc)} mm en bas`,
          );
        }
        if (endB === "tangent") {
          parts.push(
            `${fmt(going - colletOnSide(layout, nosings[to - 1]!, nosings[to]!, group.side).arc)} mm en haut`,
          );
        }
        if (parts.length > 0) {
          notes.push(
            method === "M1"
              ? `${turnName} : jarret d'entrée de zone M1 (g − c) de ${parts.join(" et ")}.`
              : `${turnName} : avertissement — saut de collet en entrée de zone M2 (g − c) de ${parts.join(" et ")} : la herse ne raccorde jamais la partie droite (B §3.4).`,
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
        `Poteau(x) d'angle : collets irréguliers (K3) avec le balancement d'un seul tenant (${classicBreaks} rupture(s)) ; zones par angle retenues (nez du poteau fixe, une zone de chaque côté du poteau, B §3.1${perAngleBreaks > 0 ? `, ${perAngleBreaks} rupture(s) restante(s)` : ""}).`,
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
      notes.push(`Nez ${k} : angle imposé de ${fmt(angle)}° inapplicable (${res.reason}).`);
      continue;
    }
    nosings[k] = res.nosing;
    if (fixed.has(k) && Math.abs(angle) > 0) {
      notes.push(`Nez ${k} : angle imposé de ${fmt(angle)}° sur un nez fixe (borne de zone).`);
    }
  }

  // ------------------------------------------------------------ contrôles K5 / K3 / collets
  for (const c of findCrossingsOnSides(layout, nosings)) {
    notes.push(`K5 : les lignes de nez ${c.i} et ${c.j} se croisent entre le jour et le mur.`);
  }
  for (let k = 0; k + 1 < n; k++) {
    const side = collarSideAt(layout, (positions.s[k]! + positions.s[k + 1]!) / 2);
    const c = colletOnSide(layout, nosings[k]!, nosings[k + 1]!, side);
    if (!(c.chord > GEOM_EPS) && !positions.landingTreads.has(k)) {
      notes.push(`Marche ${k + 1} : collet nul (${fmt(c.chord)} mm en corde).`);
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
        `K3 : collet non monotone vers l'angle, marche ${zr.from + i + 2} (${fmt(chords[i + 1]!)} mm après ${fmt(chords[i]!)} mm).`,
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
        `Tournants ${j + 1} et ${j + 2} de sens opposés (escalier en S ou en Z) : la volée intermédiaire n'offre que ${fmt(straight)} mm de ligne de foulée droite, il faut au moins un giron (${fmt(going)} mm) entre les deux balancements. Allongez la volée ${j + 2} ou remplacez un tournant par un palier.`,
      );
    }
  }
}
