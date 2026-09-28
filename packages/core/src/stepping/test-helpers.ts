/** Aides partagées par les tests du découpage (non exportées par le paquet). */
import fc from "fast-check";
import type { InnerCorner, Project, ProjectInput } from "../model/project.js";
import { ProjectSchema, PROJECT_SCHEMA_VERSION } from "../model/project.js";

export interface SteppingShape {
  readonly width: number;
  readonly legs: readonly (number | "auto")[];
  readonly direction?: "left" | "right";
  readonly mode?: "winders" | "landing" | readonly ("winders" | "landing")[];
  readonly inner?: InnerCorner | readonly InnerCorner[];
  readonly floorToFloor?: number;
  readonly origin?: { x: number; y: number };
  readonly rotation?: number;
  readonly stepping?: ProjectInput["stair"]["stepping"];
  readonly balancing?: ProjectInput["stair"]["balancing"];
  readonly treads?: ProjectInput["stair"]["treads"];
  readonly structure?: ProjectInput["stair"]["structure"];
  readonly nosingOverrides?: ProjectInput["stair"]["nosingOverrides"];
}

/** Projet valide pour un tracé et des réglages de découpage donnés. */
export function makeSteppingProject(shape: SteppingShape): Project {
  const turnCount = shape.legs.length - 1;
  const pick = <T>(v: T | readonly T[] | undefined, j: number, dflt: T): T =>
    v === undefined ? dflt : Array.isArray(v) ? ((v as readonly T[])[j] ?? dflt) : (v as T);
  const input: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: shape.floorToFloor ?? 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: shape.origin ?? { x: 0, y: 0 }, rotation: shape.rotation ?? 0 },
      layout: {
        width: shape.width,
        legs: shape.legs.map((length) => ({ length })),
        turns: Array.from({ length: turnCount }, (_, j) => ({
          direction: shape.direction ?? "left",
          mode: pick(shape.mode, j, "winders" as const),
          inner: pick<InnerCorner>(shape.inner, j, { kind: "sharp" }),
        })),
      },
      ...(shape.stepping ? { stepping: shape.stepping } : {}),
      ...(shape.balancing ? { balancing: shape.balancing } : {}),
      ...(shape.treads ? { treads: shape.treads } : {}),
      ...(shape.structure ? { structure: shape.structure } : {}),
      ...(shape.nosingOverrides ? { nosingOverrides: shape.nosingOverrides } : {}),
    },
  };
  return ProjectSchema.parse(input);
}

/** Retrait de C_i (poteau : a/2) diminué du retrait de Γ (arc : r) — longueur droite minimale. */
function straightMin(inner: InnerCorner): number {
  return inner.kind === "newel" ? inner.size / 2 : 0;
}
function walkSetback(inner: InnerCorner): number {
  return inner.kind === "arc" ? inner.radius : 0;
}

export type Typology = "quarter-low" | "quarter-mid" | "quarter-high" | "u" | "half-turn";

export interface GeneratedStair {
  readonly typology: Typology;
  readonly project: Project;
  /** Longueur droite de Γ entre les deux tournants (U / demi-tournant). */
  readonly central?: number;
}

/**
 * Générateur CONTRAINT d'escaliers tournants réalistes (CHALLENGE A7) : H ∈ [2 200 ; 3 500],
 * E ∈ [700 ; 1 200] (ligne de foulée DTU au milieu), n = arrondi(H / 175), giron visé
 * 630 − 2h ± 15 mm ; quart tournant bas / médian / haut, U (volée centrale ≥ 1 giron) et
 * demi-tournant (volée centrale < 1 giron) ; jour vif, poteau (90 à 150 mm) ou arc (50 à
 * 400 mm) ; sens gauche ou droit ; longueurs de volées entières calculées pour que |Γ| ≈ (n − 1)·g.
 */
export function stairArb(
  methods: readonly ("M1" | "M3")[] = ["M1", "M3"],
): fc.Arbitrary<GeneratedStair> {
  const corner = fc.oneof(
    fc.constant<InnerCorner>({ kind: "sharp" }),
    fc.integer({ min: 45, max: 75 }).map<InnerCorner>((k) => ({ kind: "newel", size: 2 * k })),
    fc.integer({ min: 50, max: 400 }).map<InnerCorner>((radius) => ({ kind: "arc", radius })),
  );
  return fc
    .record({
      H: fc.integer({ min: 2200, max: 3500 }),
      E: fc.integer({ min: 700, max: 1200 }),
      goingDelta: fc.integer({ min: -15, max: 15 }),
      typology: fc.constantFrom<Typology>(
        "quarter-low",
        "quarter-mid",
        "quarter-high",
        "u",
        "half-turn",
      ),
      position: fc.double({ min: 0, max: 1, noNaN: true }),
      centralRatio: fc.double({ min: 0, max: 1, noNaN: true }),
      corners: fc.array(corner, { minLength: 2, maxLength: 2 }),
      direction: fc.constantFrom("left" as const, "right" as const),
      method: fc.constantFrom(...methods),
      variant: fc.constantFrom("cubic" as const, "quintic" as const),
      firstRiseOffset: fc.integer({ min: -30, max: 10 }),
    })
    .map((r) => {
      const n = Math.round(r.H / 175);
      const g = 630 - (2 * r.H) / n + r.goingDelta;
      const df = r.E / 2;
      const quarter = r.typology.startsWith("quarter");
      const corners = quarter ? r.corners.slice(0, 1) : r.corners;
      const arcs = corners.reduce((acc, c) => acc + (Math.PI / 2) * (walkSetback(c) + df), 0);
      const total = Math.max(0, (n - 1) * g - arcs);
      let straights: number[];
      let central: number | undefined;
      if (quarter) {
        const p =
          r.typology === "quarter-low"
            ? 0.2 * r.position
            : r.typology === "quarter-high"
              ? 0.8 + 0.2 * r.position
              : 0.3 + 0.4 * r.position;
        straights = [p * total, (1 - p) * total];
      } else {
        // Demi-tournant : partie droite centrale (jour, pour des angles vifs) de 50 mm à 0,95 g
        // (jour quasi nul exclu : voir le ledger).
        central =
          r.typology === "u"
            ? g * (1 + 1.5 * r.centralRatio)
            : 50 + (0.95 * g - 50) * r.centralRatio;
        central = Math.min(central, total);
        const rest = total - central;
        const p = 0.2 + 0.6 * r.position;
        straights = [p * rest, central, (1 - p) * rest];
      }
      // Longueurs de volées (bord extérieur) : L_i = partie droite de Γ + Σ (E + retrait de Γ).
      const legs = straights.map((st, i) => {
        const before = i > 0 ? corners[i - 1]! : undefined;
        const after = i < corners.length ? corners[i]! : undefined;
        const minStraight = (before ? straightMin(before) : 0) + (after ? straightMin(after) : 0);
        const extra =
          (before ? r.E + walkSetback(before) : 0) + (after ? r.E + walkSetback(after) : 0);
        return Math.ceil(Math.max(st, minStraight) + extra);
      });
      const project = makeSteppingProject({
        width: r.E,
        legs,
        direction: r.direction,
        inner: corners,
        floorToFloor: r.H,
        stepping: { firstRiseOffset: r.firstRiseOffset },
        balancing: { method: r.method, variant: r.variant },
      });
      return { typology: r.typology, project, ...(central !== undefined ? { central } : {}) };
    });
}
