/**
 * Hélicoïdal calculé par le moteur de cage (F10, sous-lots P1 à P3, ADR-0010) : depuis P2, un
 * projet `kind: "helical"` est converti par `helicalToCage` et calculé par le moteur de cage
 * d'origine `helical` (`computeLayout`, `computeStepping`, puis l'étape d'échappée, seule source
 * des sous-faces depuis P3, décision (10a)). L'ancien moteur hélicoïdal et sa copie figée
 * (`legacyHelical.ts`) sont retirés en P3 ; ce fichier remplace le test de parité
 * (`helicalParity.test.ts`).
 *
 * - **Catalogue figé** (`__snapshots__/helicalCage.test.ts.snap`) : pour chaque cas du catalogue
 *   (`helical-parity-cases-helpers.ts` : exemples avec et sans palier, préréglage, démos, formes
 *   synthétiques), cotes lisibles (`n5Projection`) et empreintes à 1e-9 du tracé, du découpage
 *   (hors sous-faces), des sous-faces (où qu'elles soient rangées) et de l'échappée (hors
 *   sous-faces reprises) ; pour chaque cas d'erreur, l'étage, le nom, la clé et les paramètres.
 *   Instantanés enregistrés pendant que la parité stricte avec la copie figée tenait encore,
 *   au même passage (seuls écarts : CUT, voulu, décision (2)), voir le journal du chantier.
 *   **Un `-u` de ce test exige une justification au journal**, ligne à ligne : une empreinte
 *   seule modifiée signale un écart géométrique.
 * - **Invariants du seul chemin de cage** (propriété sur `helicalParityProjectArb`) : aucune
 *   exception hors `LayoutError` / `SteppingError` ; contour de marche jamais au-delà de la ligne
 *   du nez k + 2 (coupure CUT devenue invariant, décision (2)) ; sous-faces : une par marche,
 *   plus le palier d'arrivée, aux altitudes des marches. Le départage du minimum d'échappée
 *   (premier en montant, décision (3)) est vérifié par `headroom/selfcover.test.ts`.
 * - Contrôles de l'hélicoïdal dans le moteur, cas inverse `cage-arc`, aiguillage vers la cage,
 *   borne dérivée de l'échappée (`helicalHeadroomBound`).
 */
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageError } from "@blondel/i18n";
import * as V from "../../geom2d/vec.js";
import { helicalHeadroomBound } from "../../headroom/helical.js";
import type { HelicalLayout, NosingLine, Stepping } from "../../model/derived.js";
import type { Vec2 } from "../../model/primitives.js";
import { ProjectSchema } from "../../model/project.js";
import { computeStepping } from "../../stepping/stepping.js";
import { buildModel } from "../../pipeline/build.js";
import { computeLayout } from "../layout.js";
import {
  compareValues,
  gapPaths,
  helicalParityProjectArb,
  n5Projection,
  runCage,
  type EngineRun,
  type Gaps,
} from "./helical-parity-helpers.js";
import {
  HELICAL_PARITY_CASES as CASES,
  HELICAL_PARITY_ERROR_CASES as ERROR_CASES,
  j5a,
  loadExample,
  shape,
} from "./helical-parity-cases-helpers.js";
import { computeCageLayout } from "./cage.js";
import { helicalToCage } from "./fromHelical.js";

/** Nombre arrondi à 1e-9 (insensible au bruit de sérialisation), −0 confondu avec 0. */
const r9 = (v: unknown): unknown =>
  typeof v === "number"
    ? Number.isFinite(v)
      ? Math.round(v * 1e9) / 1e9 + 0
      : String(v)
    : Array.isArray(v)
      ? v.map(r9)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .map(([k, x]) => [k, r9(x)]),
          )
        : v;

const sha = (v: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(r9(v)))
    .digest("hex")
    .slice(0, 16);

/**
 * Résumé figé d'un calcul : cotes lisibles (`n5Projection`) et empreintes du tracé, du
 * découpage (hors sous-faces), des sous-faces (où qu'elles soient rangées) et de l'échappée
 * (hors sous-faces reprises).
 */
function cageSummary(r: EngineRun): unknown {
  if (r.error) return { level: r.error.level, error: r.error.error };
  const { soffits: _s, ...stepping } = r.stepping as Stepping & { soffits?: unknown };
  const headroom =
    r.headroom === null || r.headroom === undefined
      ? null
      : (({ selfCover: _c, ...rest }) => rest)(r.headroom);
  return {
    cotes: n5Projection(r.stepping!, r.headroom),
    walkline: r.headroom?.walkline
      ? { min: r9(r.headroom.walkline.min), s: r9(r.headroom.walkline.s) }
      : null,
    layout: sha(r.layout),
    stepping: sha(stepping),
    soffits: { count: r.soffits?.length ?? 0, sha: sha(r.soffits ?? []) },
    headroom: sha(headroom),
  };
}

/** Profondeur (mm) du point le plus avancé de `poly` au-delà de la ligne de nez `n`, en montant. */
function beyond(poly: readonly Vec2[], n: NosingLine, ahead: Vec2): number {
  return Math.max(...poly.map((p) => V.dot(V.sub(p, n.q), ahead)));
}

// ------------------------------------------------------------------ tests

describe("comparateur (helical-parity-helpers.ts)", () => {
  it("détecte un écart de sommet, de longueur, de clé et de champ manquant", () => {
    const out: Gaps = new Map();
    compareValues(
      { a: [{ x: 0, y: 0 }], k: "x", m: { key: "k", params: { v: 1 } }, startAngle: Math.PI },
      {
        a: [{ x: 2e-6, y: 0 }],
        k: "y",
        m: { key: "k", params: { v: 1 } },
        extra: 1,
        startAngle: -Math.PI,
      },
      "",
      out,
    );
    compareValues([1, 2], [1], "t", out);
    expect(gapPaths(out)).toEqual(["a[*].x", "extra:extra", "k", "t.length"]);
    // Tolérances : 1e-6 mm, 1e-9 rad ; angle de départ modulo 2π ; altitude d'un nez exacte.
    const ok: Gaps = new Map();
    compareValues(
      { x: 1, sweep: 1, nosings: [{ z: 1 }] },
      { x: 1 + 9e-7, sweep: 1 + 9e-10, nosings: [{ z: 1 }] },
      "",
      ok,
    );
    expect(gapPaths(ok)).toEqual([]);
    const z: Gaps = new Map();
    compareValues({ nosings: [{ z: 1 }] }, { nosings: [{ z: 1 + 1e-12 }] }, "", z);
    expect(gapPaths(z)).toEqual(["nosings[*].z"]);
  });
});

describe("hélicoïdal par la cage (F10) — catalogue figé", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = runCage(c.project());
    expect(r.error).toBeUndefined();
    expect(cageSummary(r)).toMatchSnapshot();
  });

  it.each(ERROR_CASES.map((c) => [c.name, c] as const))("erreur : %s", (_name, c) => {
    const r = runCage(c.project());
    expect(r.error).toBeDefined();
    const msg = r.error!.error.msg;
    expect(typeof msg === "string" ? msg : msg.key).toBe(c.key);
    // Contrôles de spécification à l'étage du tracé (moteur de cage, `helicalChecks.ts`, avant
    // les contrôles de cage) ; débord de nez à l'étage du découpage.
    expect(r.error!.level).toBe(c.key.startsWith("stepping.") ? "N2" : "N1");
    expect(r.error!.error.name).toBe(
      c.key.startsWith("stepping.") ? "SteppingError" : "LayoutError",
    );
    expect(cageSummary(r)).toMatchSnapshot();
  });
});

describe("hélicoïdal par la cage (F10) — contrôles dans le moteur", () => {
  it("la cage seule refuse Δθ ≥ 180° comme l'hélicoïdal (P2)", () => {
    // Conversion d'un cas valide (400°, n = 16), puis n = 3 sur le projet converti : Δθ = 200°.
    // En P1, le moteur de cage appelé sans les contrôles de `helicalToCage` acceptait ce cas
    // (lacune « contrôles ») ; depuis P2, il le refuse lui-même (`helicalChecks.ts`), avec la
    // même erreur (nom, clé, paramètres) que l'hélicoïdal saisi.
    const conv = helicalToCage(shape({ totalAngle: 400, riserCount: 16 }));
    const p = {
      ...conv.project,
      stair: { ...conv.project.stair, stepping: { ...conv.project.stair.stepping, riserCount: 3 } },
    };
    const ref = runCage(shape({ totalAngle: 400, riserCount: 3 }));
    expect(ref.error?.level).toBe("N1");
    let error: unknown;
    try {
      computeCageLayout(p, conv.spec, conv.options);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MessageError);
    const e = error as MessageError;
    expect({ name: e.name, msg: e.msg }).toEqual(ref.error!.error);
    expect(e.name).toBe("LayoutError");
    expect(e.msg).toMatchObject({
      key: "layout.helical.invalidStepAngle",
      params: { angle: "200.0" },
    });
  });
});

describe("hélicoïdal par la cage (F10) — cas inverse `cage-arc`", () => {
  // L'exemple `cage-arc` (axe en arc de 100°, rayon d'axe 2 150 mm au milieu, E = 900, n = 15)
  // écrit à la main en hélicoïdal (r_i = 1 700, R_e = 2 600, angle 100°, axe au centre de
  // l'arc) : mêmes cotes, nature des marches et collets compris (décision F10 (1) : toute
  // marche sur un axe en arc est dansante, cage saisie comprise).
  it("mêmes cotes, nature des marches et collets compris (décision F10 (1))", () => {
    const cageArc = loadExample("cage-arc");
    const helical = ProjectSchema.parse({
      ...cageArc,
      stair: {
        ...cageArc.stair,
        placement: { origin: { x: -1700, y: 0 }, rotation: 0 },
        layout: {
          kind: "helical",
          direction: "left",
          outerRadius: 2600,
          core: { kind: "well", radius: 1700 },
          sweep: { mode: "angle", degrees: 100 },
          startAngle: 0,
        },
      },
    });
    const ref = runCage(helical);
    const m = buildModel(cageArc, { memo: false });
    const a = n5Projection(ref.stepping!, ref.headroom);
    const b = {
      ...n5Projection(m.stepping, null),
      headroom: m.headroom ? Math.round(m.headroom.min * 10) / 10 : null,
      headroomWidth: m.headroomWidth
        ? { min: Math.round(m.headroomWidth.min * 10) / 10, nosing: m.headroomWidth.nosing }
        : null,
    };
    const differing = (Object.keys(a) as (keyof typeof a)[]).filter(
      (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
    );
    expect(differing).toEqual([]);
    expect(a.treads).toBe("w".repeat(14));
    expect(b.treads).toBe("w".repeat(14));
  });
});

describe("hélicoïdal par la cage (F10) — aiguillage et sous-faces", () => {
  it("computeLayout et computeStepping passent par la cage d'origine helical", () => {
    const p = j5a();
    const layout = computeLayout(p);
    expect(layout.helicalOrigin).toEqual(expect.objectContaining({ core: "column" }));
    expect(layout.sections?.length).toBe(1);
    expect(layout.sections?.[0]?.kind).toBe("arc");
    expect(layout.cage).toBeUndefined();
    // Résumé dérivé (`helicalLayoutOf`), contrat gardé en P3.
    expect(layout.helical).toBeDefined();
    const stepping = computeStepping(p, layout);
    expect(stepping.helical).toBe(true);
    expect(stepping.nosings.every((nl) => nl.angle === undefined)).toBe(true);
    // Décision F10 (10a) : le découpage ne porte pas de sous-faces ; l'étape d'échappée les
    // déduit (marches, puis palier d'arrivée) et le modèle les reprend.
    expect("soffits" in stepping).toBe(false);
    const m = buildModel(p, { memo: false });
    expect(m.layout.helicalOrigin).toBeDefined();
    expect(m.soffits?.length).toBe(m.stepping.treads.length + 1);
    expect(m.soffits?.[m.soffits.length - 1]?.tread).toBeUndefined();
    expect(m.soffits).toEqual(runCage(p).soffits);
  });
});

describe("hélicoïdal par la cage (F10) — échappée et règle dérivée", () => {
  // Sous les hypothèses de `helicalHeadroomBound` (hauteurs régulières, aucune trémie, N
  // entier), l'échappée de la cage retrouve la borne dérivée à 1e-6 près
  // (`headroom/helical.test.ts`), sous-faces passées par l'étape d'échappée.
  it("borne dérivée retrouvée par la cage", () => {
    fc.assert(
      fc.property(
        fc.record({
          treadsPerTurn: fc.integer({ min: 8, max: 16 }),
          riserCount: fc.integer({ min: 18, max: 24 }),
          nosing: fc.integer({ min: 0, max: 25 }),
          landing: fc.integer({ min: 0, max: 180 }),
          direction: fc.constantFrom("left" as const, "right" as const),
        }),
        (s) => {
          const project = shape({
            treadsPerTurn: s.treadsPerTurn,
            riserCount: s.riserCount,
            nosing: s.nosing,
            floorToFloor: 3600,
            direction: s.direction,
            ...(s.landing > 0 ? { landingAngle: s.landing } : {}),
          });
          const r = runCage(project);
          const h = r.layout!.helical as HelicalLayout;
          const bound = helicalHeadroomBound({
            riserCount: s.riserCount,
            rise: r.stepping!.rise,
            stepAngle: h.stepAngle,
            walklineRadius: h.walklineRadius,
            treadThickness: project.stair.treads.thickness,
            nosing: s.nosing,
            landingAngle: h.landingAngle,
          });
          const cageMin = r.headroom?.walkline?.min ?? null;
          if (bound.min === null) expect(cageMin).toBeNull();
          else expect(Math.abs(cageMin! - bound.min)).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("hélicoïdal par la cage (F10, P3) — invariants du chemin de cage", () => {
  it("erreurs de tracé ou de découpage seulement ; contours coupés au nez k + 2 ; sous-faces", () => {
    fc.assert(
      fc.property(helicalParityProjectArb, (project) => {
        const r = runCage(project);
        if (r.error) {
          // Aucune exception hors `LayoutError` / `SteppingError` (clé de message).
          expect(["LayoutError", "SteppingError"]).toContain(r.error.error.name);
          expect(r.error.level).not.toBe("N4");
          return;
        }
        const st = r.stepping!;
        const h = r.layout!.helical!;
        const { nosings, treads } = st;
        // CUT devenu invariant (décision (2)) : sous Δθ < 90° (ligne du nez k + 2 qui sépare
        // la marche k du reste du tour), contour de pièce jamais au-delà de cette ligne.
        if (h.stepAngle < Math.PI / 2) {
          for (const t of treads) {
            const next2 = nosings[t.number + 1];
            const front = nosings[t.number - 1];
            if (!next2 || !front) continue;
            const up = V.perpLeft(next2.dir);
            const ahead = V.scale(up, V.dot(V.sub(front.q, next2.q), up) < 0 ? 1 : -1);
            expect(beyond(t.outline, next2, ahead), `marche ${t.number}`).toBeLessThanOrEqual(1e-6);
          }
        }
        // Sous-faces de l'étape d'échappée : une par marche, puis le palier d'arrivée, aux
        // altitudes des marches (z − épaisseur) ; aucune dans le découpage.
        expect("soffits" in st).toBe(false);
        const soffits = r.soffits ?? [];
        const landing = r.layout!.helicalOrigin?.arrivalOutline ? 1 : 0;
        expect(soffits).toHaveLength(treads.length + landing);
        const thickness = project.stair.treads.thickness;
        treads.forEach((t, i) => {
          expect(soffits[i]!.tread).toBe(t.number);
          expect(soffits[i]!.z).toBe(t.z - thickness);
        });
        if (landing)
          expect(soffits[treads.length]!.z).toBe(nosings[nosings.length - 1]!.z - thickness);
      }),
      { numRuns: Number(process.env.HELICAL_CAGE_RUNS ?? 150) },
    );
  }, 600_000);
});
