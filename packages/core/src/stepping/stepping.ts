/**
 * Étape 3 du pipeline : le **découpage** (`computeStepping(project, layout) → Stepping`).
 *
 * 1. Hauteurs (`rises.ts`) : n, h₁ = h + firstRiseOffset, autres (H − h₁)/(n − 1), Σ = H.
 * 2. Nez sur Γ (`positions.ts`) : n nez, n − 1 girons égaux (paliers : nez aux bords).
 * 3. Nez initiaux perpendiculaires à Γ en P_k ; Q_k, R_k = premières intersections avec C_i
 *    et C_e de part et d'autre de P_k (`balancing/postprocess.ts`).
 * 4. Zones de balancement par tournant `winders` (`zones.ts`), stratégie M0, M1 ou M3
 *    (`balancing/`), variante M3 `auto` = cubique sauf structure débillardée (décision Q7).
 * 5. Surcharges `angle` (φ imposé en degrés, écart à la perpendiculaire à Γ, positif dans le
 *    sens du tournant — trigonométrique si le jour est à gauche, horaire s'il est à droite :
 *    le bout côté mur avance vers l'arrivée, le collet recule) appliquées avant le
 *    post-traitement ; surcharges orphelines signalées.
 * 6. Contrôles communs K5 (croisements) et K3 (monotonie des collets) → `notes`.
 * 7. Marches (`treads.ts`).
 *
 * Le côté du collet est `layout.innerSide` (tournants de même sens au MVP).
 */
import { curvePointAt, curveTangentAt } from "../geom2d/curve.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { getBalancingStrategy } from "../balancing/registry.js";
import {
  colletBetween,
  findCrossings,
  monotonyBreaks,
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
import { buildTreads } from "./treads.js";
import {
  COLLET_TIE_TOLERANCE,
  evaluateZone,
  groupWinderTurns,
  pickZone,
  WINDERS_PER_SIDE_MAX,
  zoneBounds,
  type ZoneContext,
  type ZoneEvaluation,
} from "./zones.js";

/**
 * Une structure est « débillardée » si son `kind` commence par `debillard` (convention de
 * nommage des plugins de structure, à respecter par les agents structures).
 */
export function isDebillardeStructure(kind: string): boolean {
  return kind.startsWith("debillard");
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

/**
 * Calcule le découpage d'un projet sur un tracé donné (`computeLayout`).
 *
 * @throws LayoutError si n sort du domaine ; SteppingError si les hauteurs ou les paliers
 *   sont impossibles, ou si une ligne de nez perpendiculaire ne rencontre pas les bords.
 */
export function computeStepping(project: Project, layout: Layout): Stepping {
  const notes: string[] = [];
  const { riserCount: n, rise, rises, z } = computeRises(project);
  const positions = placeNosings(project, layout, n);
  notes.push(...positions.notes);
  const { going } = positions;

  // ------------------------------------------------------------ nez initiaux perpendiculaires
  const outward = (t: ReturnType<typeof curveTangentAt>) =>
    layout.innerSide === "left" ? V.perpRight(t) : V.perpLeft(t);
  const seeds: NosingSeed[] = positions.s.map((s, k) => {
    const tangent = curveTangentAt(layout.walkline, s);
    return {
      index: k,
      s,
      p: curvePointAt(layout.walkline, s),
      z: z[k]!,
      tangent,
      perpendicular: outward(tangent),
    };
  });
  const perpendicularOn = (lay: Layout): NosingLine[] =>
    seeds.map((seed) => {
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

  // ------------------------------------------------------------ nez fixes et surcharges
  const fixed = new Set<number>([0, n - 1]);
  const free = new Set<number>([0, n - 1]);
  for (const k of positions.landingTreads) {
    fixed.add(k).add(k + 1);
    free.add(k).add(k + 1);
  }
  const angleOverrides = new Map<number, number>();
  for (const o of project.stair.nosingOverrides) {
    if (o.index >= n) {
      notes.push(
        `Surcharge orpheline (${o.kind === "fixed" ? "nez fixe" : "angle imposé"}) : le nez ${o.index} n'existe pas (${n} nez), surcharge non appliquée.`,
      );
      continue;
    }
    if (o.kind === "fixed") fixed.add(o.index);
    else {
      if (angleOverrides.has(o.index)) {
        notes.push(`Nez ${o.index} : plusieurs angles imposés, le dernier est appliqué.`);
      }
      angleOverrides.set(o.index, o.angle);
    }
  }

  // ------------------------------------------------------------ zones de balancement
  const { method, windersPerSide, colletTieTolerance } = project.stair.balancing;
  const variant = resolveM3Variant(project);
  const strategy = getBalancingStrategy(method);
  const groups = groupWinderTurns(layout, positions.s, going, fixed);
  const balancedZones: { turn: number; from: number; to: number; method: string }[] = [];
  const zoneRanges: { from: number; to: number }[] = [];
  const params: Record<string, unknown> = method === "M3" ? { variant } : {};

  for (const group of groups) {
    const turnName =
      group.first === group.last
        ? `Tournant ${group.first + 1}`
        : `Tournants ${group.first + 1} et ${group.last + 1} (zone unique)`;
    const bounds = zoneBounds(group, positions.s, fixed);
    const maxBefore = Math.min(WINDERS_PER_SIDE_MAX, bounds.kL - bounds.lo);
    const maxAfter = Math.min(WINDERS_PER_SIDE_MAX, bounds.hi - bounds.kR);
    const ctx: ZoneContext = {
      layout,
      devLayout,
      devNosings,
      seeds,
      nosings,
      z,
      rise,
      going,
      strategy,
      params,
      freeNosings: free,
      collarSide: layout.innerSide,
    };
    const pairs: [number, number][] = [];
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
      for (let nb = 0; nb <= maxBefore; nb++) {
        for (let na = 0; na <= maxAfter; na++) pairs.push([nb, na]);
      }
    }
    const cands: ZoneEvaluation[] = [];
    for (const [nb, na] of pairs) {
      const a = bounds.kL - nb;
      const b = bounds.kR + na;
      if (b - a < 2) continue;
      cands.push(evaluateZone(ctx, group, a, b, bounds));
    }
    if (cands.length === 0) {
      notes.push(`${turnName} : aucune marche à balancer (nez fixes encadrant le tournant).`);
      continue;
    }
    const chosen =
      windersPerSide !== "auto" || method === "M0"
        ? cands[0]!
        : pickZone(cands, colletTieTolerance ?? COLLET_TIE_TOLERANCE);
    if (chosen === null || !chosen.ok) {
      const reason = chosen?.reason ?? cands.find((c) => !c.ok)?.reason;
      notes.push(
        `${turnName} : aucun balancement admissible (collets positifs, lignes de nez sans croisement)${reason ? ` ; ${reason}` : ""} ; nez laissés perpendiculaires à la ligne de foulée.`,
      );
      continue;
    }
    for (const nl of chosen.nosings) nosings[nl.index] = nl;
    for (const k of chosen.corrected) {
      notes.push(
        `Nez ${k} : la ligne recoupe le jour avant le collet calculé, collet ramené au jour.`,
      );
    }
    const { from, to } = chosen.zone;
    balancedZones.push({ turn: group.first, from, to, method: methodLabel(method, variant) });
    zoneRanges.push({ from, to });
    notes.push(
      `${turnName} : ${bounds.kL - from} + ${to - bounds.kR} nez balancés (nez fixes ${from} et ${to}, extrémités ${chosen.zone.ends.map((e) => (e === "tangent" ? "tangente" : "libre")).join("/")}), ${variantLabel(method, variant)}, collet minimal ${fmt(chosen.minChord)} mm en corde (${fmt(chosen.minArc)} mm en arc).`,
    );
    if (method === "M1") {
      const [endA, endB] = chosen.zone.ends;
      const parts: string[] = [];
      if (endA === "tangent") {
        parts.push(
          `${fmt(going - colletBetween(nosings[from]!, nosings[from + 1]!).arc)} mm en bas`,
        );
      }
      if (endB === "tangent") {
        parts.push(`${fmt(going - colletBetween(nosings[to - 1]!, nosings[to]!).arc)} mm en haut`);
      }
      if (parts.length > 0) {
        notes.push(`${turnName} : jarret d'entrée de zone M1 (g − c) de ${parts.join(" et ")}.`);
      }
    }
  }

  // ------------------------------------------------------------ angles imposés
  for (const [k, angle] of angleOverrides) {
    const seed = seeds[k]!;
    // Sens positif = sens du tournant (trigonométrique si le jour est à gauche, horaire s'il est
    // à droite) : la surcharge donne des escaliers miroirs pour des tracés miroirs.
    const turnSign = layout.innerSide === "left" ? 1 : -1;
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
  for (const c of findCrossings(nosings)) {
    notes.push(`K5 : les lignes de nez ${c.i} et ${c.j} se croisent entre le jour et le mur.`);
  }
  for (let k = 0; k + 1 < n; k++) {
    const c = colletBetween(nosings[k]!, nosings[k + 1]!);
    if (!(c.chord > GEOM_EPS) && !positions.landingTreads.has(k)) {
      notes.push(`Marche ${k + 1} : collet nul (${fmt(c.chord)} mm en corde).`);
    }
  }
  for (const zr of zoneRanges) {
    const chords: Mm[] = [];
    for (let k = zr.from; k < zr.to; k++)
      chords.push(colletBetween(nosings[k]!, nosings[k + 1]!).chord);
    const breaks = monotonyBreaks(chords);
    for (const i of breaks) {
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
