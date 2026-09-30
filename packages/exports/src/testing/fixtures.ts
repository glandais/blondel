/**
 * Modèles synthétiques pour les tests des exports (réservé aux tests).
 *
 * Ils ne prétendent pas reproduire le pipeline du cœur (`buildModel`) : ils fournissent des
 * `Model` géométriquement cohérents (bords, ligne de foulée, lignes de nez, surfaces de
 * marche découpées par `cutBand`) pour vérifier les rendus et les fichiers. Le balancement
 * du quart tournant est une simple interpolation linéaire des points de collet.
 */
import {
  ProjectSchema,
  textMessage,
  bandPolygon,
  computeLayout,
  curveLength,
  curvePointAt,
  curveTangentAt,
  cutBand,
  fromPolyline,
  intersectLineCurve,
  offsetCurve,
  projectOnCurve,
  vec2,
  type ComplianceReport,
  type Curve2,
  type Layout,
  type Location,
  type Model,
  type NosingLine,
  type Part,
  type Project,
  type ProjectInput,
  type RuleResult,
  type Severity,
  type Stepping,
  type Tread,
  type TurnZone,
  type Vec2,
} from "@blondel/core";

// ------------------------------------------------------------------ conformité

export function ruleResult(
  ruleId: string,
  location: Location,
  severity: Severity = "bloquant",
  extra: Partial<RuleResult> = {},
): RuleResult {
  return {
    ruleId,
    status: "violation",
    severity,
    declaredSeverity: severity,
    location,
    nature: "normatif",
    confidence: "eleve",
    source: "test",
    secondarySource: false,
    message: textMessage(`Violation ${ruleId}`),
    ...extra,
  };
}

export function report(results: readonly RuleResult[] = []): ComplianceReport {
  const summary: Record<Severity, number> = { bloquant: 0, avertissement: 0, conseil: 0 };
  for (const r of results) if (r.status === "violation") summary[r.severity] += 1;
  return {
    rulesVersion: 1,
    contexts: ["bois_dtu", "logement_interieur"],
    profile: "strict",
    results,
    summary,
  };
}

// ------------------------------------------------------------------ découpage commun

interface SteppingBuild {
  readonly inner: Curve2;
  readonly outer: Curve2;
  readonly walkline: Curve2;
  readonly rises: readonly number[];
  /** Angle de rotation imposé (balancement) : point de collet sur le jour, par indice de nez. */
  readonly collet?: ReadonlyMap<number, number>;
  readonly kindOf?: (tread: number) => Tread["kind"];
  readonly balancedZones?: Stepping["balancedZones"];
  /** Côté du jour (défaut : gauche). */
  readonly innerSide?: "left" | "right";
}

function nearestHit(origin: Vec2, dir: Vec2, curve: Curve2, sign: 1 | -1): Vec2 {
  const hits = intersectLineCurve({ origin, dir }, curve).filter((h) => h.t * sign > -1e-9);
  if (hits.length === 0) throw new Error("fixture : ligne de nez sans intersection");
  hits.sort((a, b) => Math.abs(a.t) - Math.abs(b.t));
  return hits[0]!.point;
}

function buildStepping(b: SteppingBuild): Stepping {
  const n = b.rises.length;
  const Lw = curveLength(b.walkline);
  const going = Lw / (n - 1);
  const zs: number[] = [];
  b.rises.reduce((z, h) => (zs.push(z + h), z + h), 0);
  const nosings: NosingLine[] = [];
  for (let k = 0; k < n; k++) {
    const s = Math.min(Lw, k * going);
    const p = curvePointAt(b.walkline, s);
    const sigma = b.collet?.get(k);
    let dir: Vec2;
    let q: Vec2;
    if (sigma !== undefined) {
      q = curvePointAt(b.inner, sigma);
      dir = vec2.normalize(vec2.sub(p, q));
    } else {
      const t = curveTangentAt(b.walkline, s);
      dir = b.innerSide === "right" ? vec2.perpLeft(t) : vec2.perpRight(t);
      q = nearestHit(p, dir, b.inner, -1);
    }
    const r = nearestHit(p, dir, b.outer, 1);
    nosings.push({
      index: k,
      s,
      p,
      dir,
      q,
      r,
      sigmaInner: projectOnCurve(q, b.inner).s,
      sigmaOuter: projectOnCurve(r, b.outer).s,
      z: zs[k]!,
      balanced: sigma !== undefined,
    });
  }
  const treads: Tread[] = [];
  for (let t = 1; t <= n - 1; t++) {
    const n0 = nosings[t - 1]!;
    const n1 = nosings[t]!;
    const cut = cutBand(
      b.inner,
      b.outer,
      { origin: n0.p, dir: n0.dir },
      { origin: n1.p, dir: n1.dir },
    );
    if (!cut) throw new Error(`fixture : marche ${t} non découpée`);
    treads.push({
      number: t,
      kind: b.kindOf?.(t) ?? "straight",
      z: n0.z,
      walkingSurface: cut.polygon,
      outline: cut.polygon,
      going,
      colletArc: curveLength(cut.curveA),
      colletChord: vec2.distance(n0.q, n1.q),
      goingOuter: curveLength(cut.curveB),
    });
  }
  const H = zs[n - 1]!;
  const rise = H / n;
  return {
    riserCount: n,
    rises: b.rises,
    rise,
    going,
    blondel: 2 * rise + going,
    run: Lw,
    nosings,
    treads,
    balancedZones: b.balancedZones ?? [],
    notes: [],
  };
}

// ------------------------------------------------------------------ droit

export interface StraightOptions {
  readonly floorToFloor?: number;
  readonly riserCount?: number;
  readonly going?: number;
  readonly width?: number;
  readonly results?: readonly RuleResult[];
  readonly headroom?: { min: number; at: { x: number; y: number; z: number } };
  readonly parts?: readonly Part[];
}

/** Escalier droit : départ (0,0)–(E,0), montée selon +Y, jour à gauche (x = 0). */
export function straightModel(o: StraightOptions = {}): Model {
  const H = o.floorToFloor ?? 2700;
  const n = o.riserCount ?? 15;
  const g = o.going ?? 250;
  const E = o.width ?? 900;
  const run = (n - 1) * g;
  const inner = fromPolyline([
    { x: 0, y: 0 },
    { x: 0, y: run },
  ]);
  const outer = fromPolyline([
    { x: E, y: 0 },
    { x: E, y: run },
  ]);
  const walkline = offsetCurve(inner, E / 2, "right");
  const layout: Layout = {
    inner,
    outer,
    walkline,
    walklineOffset: E / 2,
    footprint: bandPolygon(inner, outer),
    turns: [],
    innerSide: "left",
  };
  const stepping = buildStepping({
    inner,
    outer,
    walkline,
    rises: Array.from({ length: n }, () => H / n),
  });
  return {
    layout,
    stepping,
    parts: o.parts ?? [],
    compliance: report(o.results ?? []),
    ...(o.headroom ? { headroom: o.headroom } : {}),
    errors: [],
  };
}

// ------------------------------------------------------------------ quart tournant

export interface QuarterOptions {
  readonly width?: number;
  readonly legs?: readonly [number, number];
  readonly riserCount?: number;
  readonly floorToFloor?: number;
  /** Nombre de nez balancés de part et d'autre du milieu du tournant. */
  readonly windersPerSide?: number;
  readonly results?: readonly RuleResult[];
  readonly parts?: readonly Part[];
}

/**
 * Quart tournant à gauche (repère des préréglages) : jour à angle vif, volées mesurées sur
 * le bord extérieur, ligne de foulée à E/2 (arc de rayon E/2 autour du coin intérieur).
 */
export function quarterTurnModel(o: QuarterOptions = {}): Model {
  const E = o.width ?? 800;
  const [L1, L2] = o.legs ?? [1400, 3000];
  const corner = { x: 0, y: L1 - E };
  const inner = fromPolyline([{ x: 0, y: 0 }, corner, { x: E - L2, y: L1 - E }]);
  const outer = fromPolyline([
    { x: E, y: 0 },
    { x: E, y: L1 },
    { x: E - L2, y: L1 },
  ]);
  const walkline = offsetCurve(inner, E / 2, "right");
  const Lw = curveLength(walkline);
  const n = o.riserCount ?? Math.max(4, Math.round(Lw / 240) + 1);
  const H = o.floorToFloor ?? n * 175;
  const g = Lw / (n - 1);
  // Arc de la ligne de foulée : [L1 − E, L1 − E + π E / 4].
  const sA = L1 - E;
  const sB = sA + (Math.PI * E) / 4;
  const mid = (sA + sB) / 2;
  const m = o.windersPerSide ?? 3;
  const kMid = Math.round(mid / g);
  const from = Math.max(0, kMid - m - 1);
  const to = Math.min(n - 1, kMid + m + 1);
  const sigmaOf = (k: number): number => {
    const p = curvePointAt(walkline, k * g);
    return projectOnCurve(p, inner).s;
  };
  const s0 = sigmaOf(from);
  const s1 = sigmaOf(to);
  const collet = new Map<number, number>();
  for (let k = from + 1; k < to; k++) collet.set(k, s0 + ((s1 - s0) * (k - from)) / (to - from));
  const turn: TurnZone = {
    index: 0,
    direction: "left",
    mode: "winders",
    innerCorner: corner,
    outerCorner: { x: E, y: L1 },
    sStart: sA,
    sEnd: sB,
  };
  const layout: Layout = {
    inner,
    outer,
    walkline,
    walklineOffset: E / 2,
    footprint: bandPolygon(inner, outer),
    turns: [turn],
    innerSide: "left",
  };
  const stepping = buildStepping({
    inner,
    outer,
    walkline,
    rises: Array.from({ length: n }, () => H / n),
    collet,
    kindOf: (t) => (t > from && t <= to ? "winder" : "straight"),
    balancedZones: [{ turn: 0, from, to, method: "M1" }],
  });
  return {
    layout,
    stepping,
    parts: o.parts ?? [],
    compliance: report(o.results ?? []),
    errors: [],
  };
}

// ------------------------------------------------------------------ tracé réel du cœur

export interface LayoutModelOptions {
  readonly riserCount?: number;
  /** Nez balancés de part et d'autre du milieu de chaque tournant (défaut 2). */
  readonly windersPerSide?: number;
  readonly results?: readonly RuleResult[];
  readonly headroom?: { min: number; at: { x: number; y: number; z: number } };
}

/**
 * Modèle dont le tracé vient de `computeLayout` (bords réels : jour à arc, poteau, tournants à
 * droite, placement tourné) ; le découpage reste synthétique (équipartition sur la ligne de
 * foulée, balancement par interpolation linéaire des points de collet dans chaque tournant).
 */
export function layoutModel(project: Project, o: LayoutModelOptions = {}): Model {
  const layout = computeLayout(project);
  const { inner, outer, walkline } = layout;
  const Lw = curveLength(walkline);
  const n = o.riserCount ?? Math.max(4, Math.round(Lw / 250) + 1);
  const g = Lw / (n - 1);
  const H = project.site.floorToFloor;
  const m = o.windersPerSide ?? 2;
  const collet = new Map<number, number>();
  const zones: { turn: number; from: number; to: number; method: string }[] = [];
  const winder = new Set<number>();
  const sigmaOf = (k: number): number => projectOnCurve(curvePointAt(walkline, k * g), inner).s;
  for (const turn of layout.turns) {
    const kMid = Math.round((turn.sStart + turn.sEnd) / 2 / g);
    const from = Math.max(0, kMid - m - 1);
    const to = Math.min(n - 1, kMid + m + 1);
    const s0 = sigmaOf(from);
    const s1 = sigmaOf(to);
    for (let k = from + 1; k < to; k++) {
      collet.set(k, s0 + ((s1 - s0) * (k - from)) / (to - from));
    }
    for (let t = from + 1; t <= to; t++) winder.add(t);
    zones.push({ turn: turn.index, from, to, method: "M1" });
  }
  const stepping = buildStepping({
    inner,
    outer,
    walkline,
    rises: Array.from({ length: n }, () => H / n),
    collet,
    kindOf: (t) => (winder.has(t) ? "winder" : "straight"),
    balancedZones: zones,
    innerSide: layout.innerSide,
  });
  return {
    layout,
    stepping,
    parts: [],
    compliance: report(o.results ?? []),
    ...(o.headroom ? { headroom: o.headroom } : {}),
    errors: [],
  };
}

/** Projet minimal pour `layoutModel`. */
export function layoutProject(shape: {
  readonly width: number;
  readonly legs: readonly number[];
  readonly direction?: "left" | "right";
  readonly inner?:
    { kind: "sharp" } | { kind: "arc"; radius: number } | { kind: "newel"; size: number };
  readonly origin?: { x: number; y: number };
  readonly rotation?: number;
  readonly floorToFloor?: number;
  readonly opening?: ProjectInput["site"]["opening"];
}): Project {
  return ProjectSchema.parse({
    schemaVersion: 1,
    site: {
      floorToFloor: shape.floorToFloor ?? 2700,
      upperSlabThickness: 200,
      ...(shape.opening ? { opening: shape.opening } : {}),
    },
    stair: {
      placement: { origin: shape.origin ?? { x: 0, y: 0 }, rotation: shape.rotation ?? 0 },
      layout: {
        width: shape.width,
        legs: shape.legs.map((length) => ({ length })),
        turns: shape.legs.slice(1).map(() => ({
          direction: shape.direction ?? "left",
          mode: "winders",
          inner: shape.inner ?? { kind: "sharp" },
        })),
      },
    },
  } satisfies ProjectInput);
}

// ------------------------------------------------------------------ pièces

const FRAME = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
};

function rect(x0: number, y0: number, w: number, h: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
}

/** Marche bois : planche avec deux mortaises, débit et quantités. */
export function treadPart(number: number, mark = `M${number}`): Part {
  const outline = { outer: rect(0, 0, 900, 280), holes: [rect(40, 100, 60, 25).reverse()] };
  return {
    id: `tread-${number}`,
    mark,
    category: "tread",
    name: textMessage(`Marche ${number}`),
    material: "wood-oak",
    solid: { kind: "extrusion", frame: FRAME, profile: outline, depth: 40 },
    flat: {
      outline,
      lines: [
        { kind: "mark", a: { x: 0, y: 30 }, b: { x: 900, y: 30 }, label: textMessage("nez") },
        {
          kind: "text",
          a: { x: 450, y: 200 },
          b: { x: 550, y: 200 },
          label: textMessage("Dessus"),
        },
      ],
      thickness: 40,
    },
    section: textMessage("40×300"),
    stock: { length: 950, width: 300, thickness: 45 },
    quantities: { volume: 0.9 * 0.28 * 0.04, mass: 7.06 },
    grain: { x: 1, y: 0, z: 0 },
  };
}

/** Limon en tôle pliée : contour polygonal, deux plis, traçage et joint. */
export function sheetStringerPart(): Part {
  const outer: Vec2[] = [
    { x: 0, y: 0 },
    { x: 3250.5, y: 0 },
    { x: 3250.5, y: 180.25 },
    { x: 1625.125, y: 260 },
    { x: 0, y: 180.25 },
  ];
  return {
    id: "stringer-inner-1",
    mark: "LI1",
    category: "stringer",
    name: textMessage('Limon intérieur "jour"; tôle'),
    material: "steel-painted",
    solid: { kind: "extrusion", frame: FRAME, profile: { outer, holes: [] }, depth: 5 },
    flat: {
      outline: { outer, holes: [] },
      lines: [
        { kind: "bend", a: { x: 0, y: 40 }, b: { x: 3250.5, y: 40 }, bendAngle: 90, bendUp: true },
        {
          kind: "bend",
          a: { x: 0, y: 140.25 },
          b: { x: 3250.5, y: 140.25 },
          bendAngle: 90,
          bendUp: false,
          label: textMessage("P2"),
        },
        { kind: "mark", a: { x: 500, y: 40 }, b: { x: 500, y: 140.25 } },
        { kind: "roll", a: { x: 1000, y: 0 }, b: { x: 1000, y: 180.25 } },
        { kind: "joint", a: { x: 3000, y: 0 }, b: { x: 3000, y: 180.25 } },
      ],
      thickness: 5,
    },
    section: textMessage("tôle 5 mm"),
    quantities: { mass: 18.4 },
  };
}

export interface WoodStringerOptions {
  readonly riserCount?: number;
  readonly rise?: number;
  readonly going?: number;
  /** Dépassement au-dessus des nez et sous les nez (mesurés verticalement), mm. */
  readonly above?: number;
  readonly below?: number;
  readonly treadThickness?: number;
  readonly mortiseDepth?: number;
  readonly mark?: string;
}

/**
 * Limon à la française **synthétique** (développé = élévation, B §4.1) : bande parallélogramme
 * de pente h/g, une mortaise par marche (dessus, dessous, contremarche, nez : contour fermé de
 * 4 segments `feature: "mortise"`), reports de nez en traçage générique, un texte. Valeurs de
 * test seulement, sans valeur métier : le plugin bois (J3a) fournira les vrais développés.
 */
export function woodStringerPart(o: WoodStringerOptions = {}): Part {
  const n = o.riserCount ?? 6;
  const h = o.rise ?? 175;
  const g = o.going ?? 250;
  const above = o.above ?? 50;
  const below = o.below ?? 250;
  const em = o.treadThickness ?? 40;
  const L = (n - 1) * g;
  // Rive haute v = m·u + above, rive basse v = m·u − below, coupes d'aplomb aux extrémités.
  const m = h / g;
  const outer: Vec2[] = [
    { x: 0, y: -below },
    { x: L, y: L * m - below },
    { x: L, y: L * m + above },
    { x: 0, y: above },
  ];
  const lines: NonNullable<Part["flat"]>["lines"][number][] = [];
  for (let k = 1; k < n - 1; k++) {
    // Nez de la marche k en (k·g, k·h) sur la ligne des nez v = m·u.
    const u0 = k * g - 30; // débord de nez (valeur de test)
    const u1 = (k + 1) * g - 20;
    const top = k * h;
    const bottom = top - em;
    const pts: Vec2[] = [
      { x: u0, y: bottom },
      { x: u1, y: bottom },
      { x: u1, y: top },
      { x: u0, y: top },
    ];
    for (let i = 0; i < 4; i++) {
      lines.push({
        kind: "mark",
        feature: "mortise",
        a: pts[i]!,
        b: pts[(i + 1) % 4]!,
        ...(i === 0 ? { label: textMessage(`mortaise ${k}`), depth: o.mortiseDepth ?? 15 } : {}),
      });
    }
    lines.push({ kind: "mark", a: { x: k * g, y: k * h - 5 }, b: { x: k * g, y: k * h + 5 } });
  }
  lines.push({
    kind: "text",
    a: { x: 20, y: above - 20 },
    b: { x: 120, y: above - 20 + 10 * m },
    label: textMessage("Face jour"),
  });
  const mark = o.mark ?? "LI1";
  return {
    id: `stringer-${mark.toLowerCase()}`,
    mark,
    category: "stringer",
    name: textMessage("Limon intérieur à la française"),
    material: "wood-oak",
    solid: { kind: "extrusion", frame: FRAME, profile: { outer, holes: [] }, depth: 40 },
    flat: { outline: { outer, holes: [] }, lines, thickness: 40 },
    section: textMessage("40×300"),
    stock: { length: L + 100, width: 350, thickness: 45 },
    quantities: {},
  };
}

export function sampleParts(): Part[] {
  return [
    sheetStringerPart(),
    treadPart(2),
    treadPart(1),
    treadPart(10),
    { ...treadPart(3, "M2"), id: "tread-3" },
  ];
}

// ------------------------------------------------------------------ projet

export function sampleProject(o: { opening?: ProjectInput["site"]["opening"] } = {}): Project {
  const input: ProjectInput = {
    schemaVersion: 1,
    name: "Essai exports",
    site: {
      floorToFloor: 2700,
      upperSlabThickness: 200,
      ...(o.opening === undefined
        ? { opening: { kind: "rect", x: 0, y: 1000, sizeX: 900, sizeY: 2600 } }
        : { opening: o.opening }),
    },
    stair: {
      placement: { origin: { x: 0, y: 0 } },
      layout: { width: 900, legs: [{ length: 3500 }], turns: [] },
    },
  };
  return ProjectSchema.parse(input);
}
