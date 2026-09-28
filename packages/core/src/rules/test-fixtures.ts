/**
 * Données synthétiques pour les tests du moteur de conformité (Project, Layout, Stepping minimaux).
 * Fichier réservé aux tests.
 */
import type { Layout, NosingLine, Stepping, Tread, TreadKind } from "../model/derived.js";
import type { Polygon2 } from "../model/primitives.js";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import type { ComplianceInput } from "./types.js";

export interface ProjectOptions {
  width?: number;
  floorToFloor?: number;
  contexts?: string[];
  profile?: "strict" | "souple";
  referenceDate?: string;
  overrides?: {
    ruleId: string;
    severity: "bloquant" | "avertissement" | "conseil" | "ignore";
    justification: string;
  }[];
  nosing?: number;
  risers?: "full" | "open" | "none";
  withOpening?: boolean;
  rulesVersion?: number;
}

export function makeProject(o: ProjectOptions = {}): Project {
  const input: ProjectInput = {
    schemaVersion: 1,
    ...(o.rulesVersion !== undefined ? { rulesVersion: o.rulesVersion } : {}),
    site: {
      floorToFloor: o.floorToFloor ?? 2720,
      upperSlabThickness: 200,
      ...(o.withOpening === false
        ? {}
        : { opening: { kind: "rect", x: 0, y: 0, sizeX: 900, sizeY: 3000 } }),
    },
    stair: {
      placement: { origin: { x: 0, y: 0 } },
      layout: { width: o.width ?? 900, legs: [{ length: "auto" }], turns: [] },
      treads: { nosing: o.nosing ?? 30, risers: o.risers ?? "full" },
    },
    compliance: {
      contexts: o.contexts ?? ["bois_dtu", "logement_interieur"],
      profile: o.profile ?? "strict",
      ...(o.referenceDate !== undefined ? { referenceDate: o.referenceDate } : {}),
      overrides: o.overrides ?? [],
    },
  };
  return ProjectSchema.parse(input);
}

export interface TreadOptions {
  kind?: TreadKind;
  going?: number;
  colletChord?: number;
  goingOuter?: number;
  walkingSurface?: Polygon2;
}

export interface SteppingOptions {
  /** Hauteurs individuelles (défaut : n hauteurs égales de H / n). */
  rises?: number[];
  floorToFloor?: number;
  riserCount?: number;
  going?: number;
  width?: number;
  /** Surcharges par numéro de marche (1 … n−1). */
  treads?: Record<number, TreadOptions>;
  balancedZones?: Stepping["balancedZones"];
}

function rect(x0: number, y0: number, w: number, d: number): Polygon2 {
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + d },
    { x: x0, y: y0 + d },
  ];
}

export function makeStepping(o: SteppingOptions = {}): Stepping {
  const H = o.floorToFloor ?? 2720;
  const n = o.rises?.length ?? o.riserCount ?? 16;
  const rises = o.rises ?? Array.from({ length: n }, () => H / n);
  const total = rises.reduce((a, b) => a + b, 0);
  const rise = total / n;
  const going = o.going ?? 250;
  const width = o.width ?? 900;
  const zs: number[] = [];
  rises.reduce((z, h) => {
    zs.push(z + h);
    return z + h;
  }, 0);
  const nosings: NosingLine[] = zs.map((z, k) => ({
    index: k,
    s: k * going,
    p: { x: width / 2, y: k * going },
    dir: { x: 1, y: 0 },
    q: { x: 0, y: k * going },
    r: { x: width, y: k * going },
    sigmaInner: k * going,
    sigmaOuter: k * going,
    z,
    balanced: false,
  }));
  const treads: Tread[] = [];
  for (let num = 1; num <= n - 1; num++) {
    const t = o.treads?.[num] ?? {};
    const g = t.going ?? going;
    const surface = t.walkingSurface ?? rect(0, (num - 1) * going, width, g);
    treads.push({
      number: num,
      kind: t.kind ?? "straight",
      z: zs[num - 1]!,
      walkingSurface: surface,
      outline: surface,
      going: g,
      colletArc: t.colletChord ?? g,
      colletChord: t.colletChord ?? g,
      goingOuter: t.goingOuter ?? g,
    });
  }
  return {
    riserCount: n,
    rises,
    rise,
    going,
    blondel: 2 * rise + going,
    run: (n - 1) * going,
    nosings,
    treads,
    balancedZones: o.balancedZones ?? [],
    notes: [],
  };
}

export function makeLayout(o: { width?: number; walklineOffset?: number } = {}): Layout {
  const w = o.width ?? 900;
  const line = (x: number) => ({
    segments: [{ kind: "line" as const, a: { x, y: 0 }, b: { x, y: 4000 } }],
  });
  return {
    inner: line(0),
    outer: line(w),
    walkline: line(o.walklineOffset ?? w / 2),
    walklineOffset: o.walklineOffset ?? w / 2,
    footprint: rect(0, 0, w, 4000),
    turns: [],
    innerSide: "left",
  };
}

export function makeInput(
  o: {
    project?: ProjectOptions;
    stepping?: SteppingOptions;
    walklineOffset?: number;
    headroom?: number | null;
  } = {},
): ComplianceInput {
  const project = makeProject(o.project);
  const width = project.stair.layout.width;
  const stepping = makeStepping({ width, floorToFloor: project.site.floorToFloor, ...o.stepping });
  const layout = makeLayout({
    width,
    ...(o.walklineOffset !== undefined ? { walklineOffset: o.walklineOffset } : {}),
  });
  const hr = o.headroom === undefined ? 2200 : o.headroom;
  return {
    project,
    layout,
    stepping,
    ...(hr !== null ? { headroom: { min: hr, at: { x: width / 2, y: 1000, z: 500 } } } : {}),
  };
}
