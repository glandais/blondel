/**
 * Parité **hélicoïdal / cage** (F10, sous-lots P1 et P2, ADR-0010) : pour un projet hélicoïdal
 * P, l'ancien chemin hélicoïdal (référence : copie figée `layout/legacyHelical.ts`,
 * `legacyComputeHelicalLayout`, `legacyComputeHelicalStepping`, puis `computeHeadroom` sur
 * `Stepping.soffits`) et le pipeline basculé en P2 (`computeLayout` : `helicalToCage` et moteur
 * de cage d'origine `helical`, plus `Layout.helical` ; `computeStepping` ; `computeHeadroom`)
 * rendent-ils les mêmes tracés, découpages, sous-faces, échappées et cotes ? La parité au
 * niveau du `Model` entier (pièces, contrôle, garde-corps, exports) est dans
 * `pipeline/helicalSwitch.parity.test.ts`.
 *
 * Niveaux (comparateur et tolérances justifiées : `helical-parity-helpers.ts`) :
 * - erreurs de spécification identiques (nom, clé, paramètres, étage) ;
 * - N1 : `Layout` champ à champ, ajouts de cage vérifiés (`sections`, `walklineSide`,
 *   `helicalOrigin`), `Layout.helical` égal au bit, et reconstruit depuis la cage (cohérence) ;
 * - N2 : `Stepping` champ à champ (nez, marches sommet par sommet, remarques, erreurs ; angle des
 *   nez absent des deux côtés) ;
 * - N3 : sous-faces (`Stepping.soffits` des deux chemins, palier d'arrivée compris) ;
 * - N4 : `HeadroomAnalysis` complet ;
 * - N5 : cotes de `mainDimensions` (`pipeline/build.test.ts`) restreintes au tracé, au
 *   découpage et à l'échappée, égalité stricte après arrondis.
 *
 * Écarts attendus **explicites** : chaque cas porte sa table `EXPECTED_GAPS` (chemins en écart,
 * lacune) ; le test exige l'égalité exacte de l'ensemble des chemins en écart avec la table : un
 * écart nouveau échoue, un écart qui disparaît aussi. Lacunes (constat consigné dans
 * `docs/QUESTIONS.md`, F10) :
 * - `CUT` (coupure par la ligne du nez k + 2), **écart voulu** (décision F10 (2), l'ancien moteur
 *   n'est pas retouché) : quand d / sin Δθ > r_i, le contour de pièce de l'hélicoïdal
 *   (`helicalTreadOutline`) déborde au-delà du nez k + 2 sur le bord intérieur ; la cage le
 *   coupe sur cette ligne (`outlineBetween`, paramètre `c`), comme les contremarches. Contours
 *   et sous-faces en écart ; les **valeurs** d'échappée (N4 et N5) restent comparées
 *   strictement. Écart composé « CUT × TIE » (P2, non décidé, question F10) : depuis le
 *   départage du premier minimum en montant, la bande de bord intérieur que seule la référence
 *   couvre peut porter un minimum ex æquo plus tôt en montant ; l'**emplacement** du minimum
 *   (sur Γ ou sur la largeur) peut alors différer, admis seulement sous CUT et si le point de
 *   la cage est un minimum ex æquo de la référence (`tieOnReference`, propriété).
 * - `TIE` (égalité de minima, bruit), **résolu en P2** (décision F10 (3)) : l'échappée minimale
 *   est atteinte avec la même valeur (à 1e-6 près) en plusieurs points, images l'un de l'autre
 *   par le vissage de Δθ, h ; en P1, `selfcover.ts` retenait le premier minimum strict et le
 *   bruit des deux chemins de calcul départageait différemment (8 cas). `selfcover.ts` retient
 *   désormais le premier minimum en montant à `HEADROOM_TIE_TOL` (1e-6 mm) près, pour les deux
 *   moteurs : aucun écart TIE admis (les anciens cas sont marqués `formerTie`).
 * - `HALF` (arrondi d'une valeur au demi-pas, bruit) : une grandeur exactement à mi-chemin de
 *   deux arrondis (0,05 pour `dec` des remarques et r1, 0,005 pour r2) bascule d'un côté ou de
 *   l'autre selon le bruit (valeur brute égale à 1e-6 près, vérifiée).
 *
 * Erreurs (étage du tracé) : depuis P2, la conversion ne contrôle que le domaine de n ; les contrôles de
 * spécification de l'hélicoïdal (R_e > r_i, d_f, Δθ) sont faits par le moteur de cage sous
 * l'origine `helical` (`helicalChecks.ts`, en tête de `computeCageLayout`), mêmes clés, mêmes
 * paramètres, même ordre ; le contrôle de débord (`nosingReaches*`) reste à l'étage découpage
 * (`stepping.ts`, sous `helicalOrigin`). La lacune « contrôles » de P1 (le moteur seul acceptait
 * Δθ ≥ 180°) est levée : un test dédié vérifie que le moteur seul refuse ce cas.
 *
 * Sous-faces : en P1, la cage les portait dans `HeadroomAnalysis.selfCover` (lacune
 * « emplacement des sous-faces ») ; depuis P2, dans `Stepping.soffits` des deux côtés (asserté à
 * part), contenu comparé en N3.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageError } from "@blondel/i18n";
import { helicalHeadroomBound } from "../../headroom/helical.js";
import type { HelicalLayout } from "../../model/derived.js";
import { ProjectSchema, type Project } from "../../model/project.js";
import { computeStepping } from "../../stepping/stepping.js";
import { buildModel } from "../../pipeline/build.js";
import { computeLayout } from "../layout.js";
import {
  compareValues,
  gapPaths,
  gapSummary,
  helicalParity,
  helicalParityProjectArb,
  n5Projection,
  runHelical,
  tieOnReference,
  type Gaps,
  type ParityReport,
} from "./helical-parity-helpers.js";
import {
  FORMER_TIE,
  HELICAL_EXAMPLES,
  HELICAL_PARITY_CASES as CASES,
  HELICAL_PARITY_ERROR_CASES as ERROR_CASES,
  j5a,
  loadExample,
  shape,
  type ParityCase,
} from "./helical-parity-cases-helpers.js";
import { computeCageLayout } from "./cage.js";
import { helicalToCage } from "./fromHelical.js";

/** Chemins en écart attendus d'un cas. */
const expectedOf = (c: ParityCase): string[] =>
  [...new Set(Object.values(c.gaps ?? {}).flat())].sort();

const reports = new Map<string, ParityReport>();
const reportOf = (c: ParityCase): ParityReport => {
  let r = reports.get(c.name);
  if (!r) {
    r = helicalParity(c.project());
    reports.set(c.name, r);
  }
  return r;
};

// ------------------------------------------------------------------ tests

describe("parité hélicoïdal / cage (F10, P1) — comparateur", () => {
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

describe("parité hélicoïdal / cage (F10, P1) — cas", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = reportOf(c);
    if (process.env.PARITY_MEASURE) console.log(c.name, JSON.stringify(gapSummary(r.gaps)));
    expect(r.helical.error).toBeUndefined();
    expect(r.cage.error).toBeUndefined();
    expect(gapPaths(r.gaps)).toEqual(expectedOf(c));
  });

  it("emplacement des sous-faces : `Stepping.soffits` des deux côtés (P2)", () => {
    // En P1, la cage les déduisait à l'étape d'échappée (`HeadroomAnalysis.selfCover`) ; depuis
    // la bascule, le découpage les range dans `Stepping.soffits`, comme l'ancien chemin, et
    // l'échappée ne porte pas de `selfCover` (ni `Model.soffits`).
    for (const c of CASES) {
      const r = reportOf(c);
      expect(r.helical.stepping?.soffits, c.name).toBeDefined();
      expect(r.cage.stepping?.soffits, c.name).toBeDefined();
      expect(r.cage.stepping?.soffits?.length, c.name).toBe(r.helical.stepping?.soffits?.length);
      expect(r.helical.headroom?.selfCover, c.name).toBeUndefined();
      expect(r.cage.headroom?.selfCover, c.name).toBeUndefined();
    }
  });

  it("anciens cas TIE (décision F10 (3)) : même minimum, au même point, sur les deux moteurs", () => {
    // Les 8 cas TIE de P1 (minima ex æquo départagés par le bruit) n'ont plus d'écart : le
    // départage du premier minimum en montant (`selfcover.ts`) est commun aux deux moteurs.
    expect(FORMER_TIE.size).toBe(8);
    for (const c of CASES.filter((x) => FORMER_TIE.has(x.name))) {
      const r = reportOf(c);
      const a = r.helical.headroom?.walkline;
      const b = r.cage.headroom?.walkline;
      expect(a, c.name).toBeDefined();
      expect(b, c.name).toBeDefined();
      expect(Math.abs(a!.min - b!.min), c.name).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(a!.s - b!.s), c.name).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(a!.at.z - b!.at.z), c.name).toBeLessThanOrEqual(1e-6);
    }
  });
});

describe("parité hélicoïdal / cage (F10, P1) — erreurs", () => {
  it.each(ERROR_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = helicalParity(c.project());
    expect(r.helical.error).toBeDefined();
    const err = r.helical.error!.error.msg;
    expect(typeof err === "string" ? err : err.key).toBe(c.key);
    expect(gapPaths(r.gaps)).toEqual([]);
  });

  it("contrôles dans le moteur : la cage seule refuse Δθ ≥ 180° comme l'hélicoïdal (P2)", () => {
    // Conversion d'un cas valide (400°, n = 16), puis n = 3 sur le projet converti : Δθ = 200°.
    // En P1, le moteur de cage appelé sans les contrôles de `helicalToCage` acceptait ce cas
    // (lacune « contrôles ») ; depuis P2, il le refuse lui-même (`helicalChecks.ts`), avec la
    // même erreur (nom, clé, paramètres) que l'hélicoïdal sur le même projet.
    const conv = helicalToCage(shape({ totalAngle: 400, riserCount: 16 }));
    const p = {
      ...conv.project,
      stair: { ...conv.project.stair, stepping: { ...conv.project.stair.stepping, riserCount: 3 } },
    };
    const ref = runHelical(shape({ totalAngle: 400, riserCount: 3 }));
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
    expect(e.msg).toMatchObject({
      key: "layout.helical.invalidStepAngle",
      params: { angle: "200.0" },
    });
  });

  it("contrôles dans le moteur : ordre de l'hélicoïdal, avant les contrôles de cage", () => {
    // Δθ ≥ 180° avec un balayage hors borne de cage : la clé de l'hélicoïdal sort, pas
    // `layout.cage.*` ; largeur nulle : clé de l'hélicoïdal, pas celle de la largeur de cage.
    for (const c of ERROR_CASES) {
      const project = c.project();
      if (c.key.startsWith("stepping.")) continue;
      const r = helicalParity(project);
      const err = r.cage.error?.error.msg;
      expect(typeof err === "string" ? err : err?.key, c.name).toBe(c.key);
      // Étage du tracé (`computeLayout`) pour tous les contrôles de spécification.
      expect(r.cage.error?.level, c.name).toBe("N1");
    }
  });
});

describe("parité hélicoïdal / cage (F10, P1) — cotes des exemples (N5)", () => {
  // La projection N5 de l'hélicoïdal est celle de `buildModel` (donc des instantanés de
  // `pipeline/build.test.ts`, inchangés) ; la cage la retrouve à l'égalité stricte (cas ci-dessus).
  it.each(HELICAL_EXAMPLES.map((n) => [n] as const))("%s", (name) => {
    const project = loadExample(name);
    const m = buildModel(project, { memo: false });
    const fromModel = {
      ...n5Projection(m.stepping, null),
      headroom: m.headroom ? Math.round(m.headroom.min * 10) / 10 : null,
      headroomWidth: m.headroomWidth
        ? { min: Math.round(m.headroomWidth.min * 10) / 10, nosing: m.headroomWidth.nosing }
        : null,
    };
    const r = helicalParity(project);
    expect(n5Projection(r.helical.stepping!, r.helical.headroom)).toEqual(fromModel);
    expect(n5Projection(r.cage.stepping!, r.cage.headroom)).toEqual(fromModel);
  });
});

describe("parité hélicoïdal / cage (F10, P1) — cas inverse `cage-arc`", () => {
  // L'exemple `cage-arc` (axe en arc de 100°, rayon d'axe 2 150 mm au milieu, E = 900, n = 15)
  // écrit à la main en hélicoïdal (r_i = 1 700, R_e = 2 600, angle 100°, axe au centre de
  // l'arc). Moteur hélicoïdal contre `cage-arc` (`buildModel`, cage saisie, origine `cage`) :
  // en P1, mêmes cotes sauf la nature des marches (cage saisie « ssss… », hélicoïdal
  // « wwww… ») ; depuis la décision F10 (1) (toute marche sur un axe en arc est dansante, cage
  // saisie comprise), mêmes cotes **toutes comprises**, nature des marches et collets inclus.
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
    const ref = runHelical(helical);
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

describe("parité hélicoïdal / cage (F10, P2) — aiguillage vers la cage", () => {
  it("computeLayout et computeStepping passent par la cage d'origine helical", () => {
    const p = j5a();
    const layout = computeLayout(p);
    expect(layout.helicalOrigin).toEqual(expect.objectContaining({ core: "column" }));
    expect(layout.sections?.length).toBe(1);
    expect(layout.sections?.[0]?.kind).toBe("arc");
    expect(layout.cage).toBeUndefined();
    // Champ de compatibilité, égal au bit à l'ancien tracé (copie figée).
    expect(layout.helical).toStrictEqual(runHelical(p).layout!.helical);
    const stepping = computeStepping(p, layout);
    expect(stepping.helical).toBe(true);
    expect(stepping.soffits?.length).toBe(stepping.treads.length + 1);
    expect(stepping.nosings.every((nl) => nl.angle === undefined)).toBe(true);
    const m = buildModel(p, { memo: false });
    expect(m.layout.helicalOrigin).toBeDefined();
    expect(m.soffits).toBeUndefined();
  });
});

describe("parité hélicoïdal / cage (F10, P1) — échappée et règle dérivée", () => {
  // Sous les hypothèses de `helicalHeadroomBound` (hauteurs régulières, aucune trémie, N
  // entier), l'échappée de la cage retrouve la borne dérivée à 1e-6 près, comme l'hélicoïdal
  // (`headroom/helical.test.ts`).
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
          const r = helicalParity(project);
          const h = r.helical.layout!.helical as HelicalLayout;
          const bound = helicalHeadroomBound({
            riserCount: s.riserCount,
            rise: r.helical.stepping!.rise,
            stepAngle: h.stepAngle,
            walklineRadius: h.walklineRadius,
            treadThickness: project.stair.treads.thickness,
            nosing: s.nosing,
            landingAngle: h.landingAngle,
          });
          const cageMin = r.cage.headroom?.walkline?.min ?? null;
          if (bound.min === null) expect(cageMin).toBeNull();
          else expect(Math.abs(cageMin! - bound.min)).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ------------------------------------------------------------------ propriété

/** Valeur à mi-chemin de deux arrondis au pas `step` (à 1e-6 près, relatif au pas). */
const atHalf = (x: number, step: number): boolean => {
  const f = x / step - Math.floor(x / step);
  return Math.abs(f - 0.5) < 1e-6;
};

/**
 * Écarts que prévoient les lacunes pour un tirage (voir l'en-tête) : `allowed` (chemins admis)
 * et `required` (au moins un chemin de chaque groupe doit apparaître).
 */
function predictedGaps(
  project: Project,
  r: ParityReport,
): { allowed: Set<string>; required: string[][] } {
  const allowed = new Set<string>();
  const required: string[][] = [];
  const h = r.helical.layout?.helical;
  const st = r.helical.stepping;
  if (!h || !st) return { allowed, required };
  const d = project.stair.treads.nosing;
  // CUT : la ligne d'appui du nez k + 1 (parallèle à son rayon, décalée de d) coupe le rayon du
  // nez k + 2 au rayon ρ = d / sin Δθ, à l'abscisse d·cot Δθ le long de la ligne : avant le
  // bord intérieur (donc coupure par la cage) si Δθ < 90° et r_i < ρ < R_e.
  const rho = d / Math.sin(h.stepAngle);
  const cut =
    d > 0 &&
    st.riserCount >= 3 &&
    h.stepAngle < Math.PI / 2 &&
    rho > h.innerRadius &&
    rho < h.outerRadius;
  if (cut) {
    const outline = [
      "N2:treads[*].outline.length",
      "N2:treads[*].outline[*].x",
      "N2:treads[*].outline[*].y",
      "N3:soffits[*].outline.length",
      "N3:soffits[*].outline[*].x",
      "N3:soffits[*].outline[*].y",
    ];
    // Contours et sous-faces seulement : l'échappée reste stricte (voir l'en-tête).
    outline.forEach((p) => allowed.add(p));
    required.push(outline);
  }
  // TIE : aucun écart admis depuis la décision F10 (3) (départage commun dans `selfcover.ts`) ;
  // un emplacement de minimum en écart est un écart nouveau, SAUF sous CUT (écart composé
  // « CUT × TIE », non décidé, question F10) : le contour de référence, non coupé, couvre en
  // plus une bande du bord intérieur ; un minimum ex æquo y est atteint plus tôt en montant
  // (même valeur, image par vissage d'un nombre entier de marches), que la cage, coupée, n'a
  // pas. Les **valeurs** restent strictes ; l'emplacement n'est admis que si le point de la cage
  // est un minimum ex æquo de la référence (`tieOnReference`). Mesuré : 7 tirages sur 12 000
  // (graines 1 à 6, 2 000 tirages chacune), tous sous CUT, tous vérifiés.
  const a = r.helical.headroom;
  if (cut) {
    const tie = tieOnReference(r.helical, r.cage);
    if (tie.walkline) {
      for (const k of ["at.x", "at.y", "at.z", "s"]) allowed.add(`N4:headroom.walkline.${k}`);
    }
    if (tie.width) {
      for (const k of ["at.x", "at.y", "at.z", "nosing"]) allowed.add(`N4:headroom.width.${k}`);
      // Cote N5 `headroomWidth` = { min, nosing } : seul l'indice du nez peut différer.
      allowed.add("N5:headroomWidth");
    }
  }
  // HALF : arrondis à mi-pas (remarques au dixième, cotes r1 / r2).
  const deg = 180 / Math.PI;
  const summary: Record<string, number> = {
    stepAngle: h.stepAngle * deg,
    treadsPerTurn: h.treadsPerTurn,
    totalAngle: h.totalAngle * deg,
    going: st.going,
    walklineRadius: h.walklineRadius,
    collet: h.innerRadius * h.stepAngle,
  };
  for (const [k, v] of Object.entries(summary)) {
    if (atHalf(v, 0.1)) allowed.add(`N2:notes[*].params.${k}.num`);
  }
  if (atHalf(st.going, 0.1)) allowed.add("N2:notes[*].params.going.num");
  const r2Keys: Record<string, number> = {
    h: st.rise,
    firstRise: st.rises[0]!,
    g: st.going,
    blondel: st.blondel,
  };
  for (const [k, v] of Object.entries(r2Keys)) if (atHalf(v, 0.01)) allowed.add(`N5:${k}`);
  if (atHalf(st.run, 0.1)) allowed.add("N5:run");
  if (a?.walkline && atHalf(a.walkline.min, 0.1)) allowed.add("N5:headroom");
  if (a?.width && atHalf(a.width.min, 0.1)) allowed.add("N5:headroomWidth");
  if (st.treads.some((t) => atHalf(t.colletChord, 0.1))) {
    allowed.add("N5:colletsChord");
    allowed.add("N5:colletMin");
  }
  return { allowed, required };
}

describe("parité hélicoïdal / cage (F10, P1) — propriété", () => {
  it("chaque tirage tombe sur les écarts prévus par les lacunes, et seulement eux", () => {
    fc.assert(
      fc.property(helicalParityProjectArb, (project) => {
        const r = helicalParity(project);
        const { allowed, required } = predictedGaps(project, r);
        const paths = gapPaths(r.gaps);
        const unexpected = paths.filter((p) => !allowed.has(p));
        expect(unexpected, JSON.stringify(gapSummary(r.gaps))).toEqual([]);
        for (const group of required) {
          expect(
            paths.some((p) => group.includes(p)),
            group.join(", "),
          ).toBe(true);
        }
      }),
      { numRuns: Number(process.env.HELICAL_PARITY_RUNS ?? 250) },
    );
  }, 600_000);
});
