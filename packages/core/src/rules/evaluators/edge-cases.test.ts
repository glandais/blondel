/**
 * Cas limites et dégénérescences relevés en relecture (valeurs non calculables, 1re hauteur hors
 * DTU, volées d'ERP tournant, marches balancées hors zone déclarée).
 */
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr } from "../../i18n.test-helpers.js";
import type { RuleResult } from "../../model/derived.js";
import { guardRailRegime } from "../contexts.js";
import { evaluateCompliance } from "../engine.js";
import { makeInput, type ProjectOptions, type SteppingOptions } from "../test-fixtures.js";

type Opts = Parameters<typeof makeInput>[0];

function run(o: Opts, id: string): RuleResult[] {
  return evaluateCompliance(makeInput(o)).results.filter((r) => r.ruleId === id);
}
const status = (o: Opts, id: string) => run(o, id).map((r) => r.status);
const violations = (o: Opts, id: string) => run(o, id).filter((r) => r.status === "violation");

const erpStraight: ProjectOptions = { contexts: ["erp_neuf", "erp_securite"], floorToFloor: 4420 };

describe("valeurs non calculables", () => {
  it("une mesure NaN sort non-evaluee, jamais ok", () => {
    expect(status({ stepping: { going: Number.NaN } }, "BLONDEL_DTU")).toEqual(["non-evaluee"]);
    const g = run({ stepping: { treads: { 4: { going: Number.NaN } } } }, "G_MIN_LOGEMENT");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ status: "non-evaluee", location: { kind: "tread", number: 4 } });
  });

  it("découpage vide : aucune exception, contremarches extrêmes non évaluées", () => {
    const o: Opts = { project: { contexts: ["erp_neuf"] }, stepping: { rises: [] } };
    expect(status(o, "CONTREMARCHE_EXTREMES")).toEqual(["non-evaluee"]);
    expect(status(o, "H_CONFORT")).toEqual(["non-evaluee"]);
  });

  it("propriété : aucun résultat ok/violation ne porte une mesure NaN, et aucun évaluateur ne lève", () => {
    const num = fc.oneof(
      fc.constant(Number.NaN),
      fc.constant(0),
      fc.double({ min: -500, max: 2000, noNaN: true }),
    );
    fc.assert(
      fc.property(
        fc.array(num, { maxLength: 6 }),
        num,
        fc.option(num, { nil: null }),
        fc.constantFrom<ProjectOptions["risers"]>("full", "open", "none"),
        (rises, going, headroom, risers) => {
          const report = evaluateCompliance(
            makeInput({
              project: {
                contexts: [
                  "bois_dtu",
                  "logement_interieur",
                  "erp_neuf",
                  "erp_securite",
                  "industriel",
                ],
                risers,
              },
              stepping: { rises, going },
              headroom,
            }),
          );
          for (const r of report.results) {
            if (r.status !== "non-evaluee") expect(Number.isNaN(r.measured ?? 0)).toBe(false);
            expect(fr(r.message)).not.toMatch(/^Erreur de l'évaluateur/);
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe("date de référence", () => {
  it("date calendaire impossible : illisible, régime 2024 supposé", () => {
    expect(guardRailRegime("2025-02-30")).toMatchObject({
      regime: "garde_corps_2024",
      assumed: true,
    });
    expect(guardRailRegime("2025-13-01")).toMatchObject({
      regime: "garde_corps_2024",
      assumed: true,
    });
    expect(guardRailRegime("2024-02-29")).toMatchObject({
      regime: "garde_corps_1988",
      assumed: false,
    });
  });
});

describe("H_TOLERANCE_DTU et 1re hauteur", () => {
  const rs = [140, ...Array.from({ length: 15 }, () => (2720 - 140) / 15)];

  it("hors DTU (pas de tolérance propre à la 1re marche) : la 1re hauteur est contrôlée à ±5", () => {
    const v = violations(
      { project: { contexts: ["logement_interieur"] }, stepping: { rises: rs } },
      "H_TOLERANCE_DTU",
    );
    expect(v.map((r) => r.location)).toEqual([{ kind: "nosing", index: 0 }]);
  });

  it("en DTU : la 1re hauteur relève de H_PREMIERE_MARCHE_TOL seulement", () => {
    const o: Opts = { stepping: { rises: rs } };
    expect(violations(o, "H_TOLERANCE_DTU")).toHaveLength(0);
    expect(violations(o, "H_PREMIERE_MARCHE_TOL")).toHaveLength(0);
  });
});

describe("VOLEE_MAX_ERP", () => {
  it("escalier droit d'ERP : 26 hauteurs sans palier = violation", () => {
    expect(
      violations({ project: erpStraight, stepping: { riserCount: 26 } }, "VOLEE_MAX_ERP")[0]
        ?.measured,
    ).toBe(26);
  });

  it("escalier tournant d'ERP : non évaluée (CO 56, balancement continu)", () => {
    const s: SteppingOptions = { riserCount: 26, treads: { 12: { kind: "winder" } } };
    expect(status({ project: erpStraight, stepping: s }, "VOLEE_MAX_ERP")).toEqual(["non-evaluee"]);
  });
});

describe("G_COLLET_MONOTONE", () => {
  it("les marches balancées hors des zones déclarées sont aussi contrôlées", () => {
    const treads: SteppingOptions["treads"] = {
      2: { kind: "winder", colletChord: 150 },
      3: { kind: "winder", colletChord: 100 },
      8: { kind: "winder", colletChord: 150 },
      9: { kind: "winder", colletChord: 100 },
      10: { kind: "winder", colletChord: 160 },
      11: { kind: "winder", colletChord: 120 },
    };
    const zones = [{ turn: 0, from: 1, to: 3, method: "M3" }];
    const v = violations({ stepping: { treads, balancedZones: zones } }, "G_COLLET_MONOTONE");
    expect(v.map((r) => r.location)).toEqual([{ kind: "tread", number: 11 }]);
  });
});

describe("G_COLLET_MONOTONE : marche balancée isolée hors zone déclarée (QUESTIONS D1)", () => {
  // Nez tous les 250 mm dans les fixtures : la marche k va de s = (k − 1)·250 à k·250 ; un
  // tournant dont le milieu est à (k − 0,5)·250 est au droit de la marche k. Marche 4 hors
  // zone, entre les zones nez 0 → 3 et 4 → 7.
  const zones = [
    { turn: 0, from: 0, to: 3, method: "M3" },
    { turn: 1, from: 4, to: 7, method: "M3" },
  ];
  const collets = (c4: number, others = [150, 120, 100, 150]): SteppingOptions["treads"] => ({
    2: { kind: "winder", colletChord: others[0]! },
    3: { kind: "winder", colletChord: others[1]! },
    4: { kind: "winder", colletChord: c4 },
    5: { kind: "winder", colletChord: others[2]! },
    6: { kind: "winder", colletChord: others[3]! },
  });
  const results = (
    treads: SteppingOptions["treads"],
    cornersAt: readonly number[],
    inner: "newel" | "sharp" = "sharp",
  ): RuleResult[] => {
    const i = makeInput({ stepping: { treads, balancedZones: zones } });
    const turns = cornersAt.map((k, index) => ({
      index,
      direction: "left" as const,
      mode: "winders" as const,
      innerCorner: { x: 0, y: 0 },
      outerCorner: { x: 0, y: 0 },
      sStart: (k - 0.5) * 250 - 50,
      sEnd: (k - 0.5) * 250 + 50,
    }));
    const stairLayout = {
      ...i.project.stair.layout,
      kind: "flights",
      turns: turns.map(() => ({
        inner: inner === "newel" ? { kind: "newel", size: 100 } : { kind: "sharp" },
      })),
    };
    const project = {
      ...i.project,
      stair: { ...i.project.stair, layout: stairLayout },
    } as unknown as typeof i.project;
    return evaluateCompliance({
      ...i,
      project,
      layout: { ...i.layout, turns },
    }).results.filter((r) => r.ruleId === "G_COLLET_MONOTONE");
  };
  const flagged = (r: RuleResult[]) =>
    r.filter((x) => x.status === "violation").map((x) => x.location);

  it("avant l'angle : la marche hors zone remonte (150, 120, 130 → 100) → violation", () => {
    const r = results(collets(130), [5]);
    expect(flagged(r)).toEqual([{ kind: "tread", number: 4 }]);
    expect(fr(r[0]!.message)).toMatch(/hors zone déclarée/);
    // Dans la vallée : conforme.
    expect(results(collets(110), [5]).map((x) => x.status)).toEqual(["ok"]);
  });

  it("au droit de l'angle : crête → violation ; au droit d'un poteau : pas de conclusion (B1)", () => {
    const crest = results(collets(130), [4]);
    expect(flagged(crest)).toEqual([{ kind: "tread", number: 4 }]);
    expect(fr(crest[0]!.message)).toMatch(/crête au droit de l'angle/);
    expect(results(collets(130), [4], "newel").map((x) => x.status)).toEqual(["ok"]);
  });

  it("entre deux angles : creux → violation, crête → conforme", () => {
    // Angles au droit des marches 2 et 6 : 150 (angle), 160, [x], 170, 100 (angle).
    const around = [100, 160, 170, 100];
    const dip = results(collets(120, around), [2, 6]);
    expect(flagged(dip)).toEqual([{ kind: "tread", number: 4 }]);
    expect(fr(dip[0]!.message)).toMatch(/creux entre deux angles/);
    expect(results(collets(200, around), [2, 6]).map((x) => x.status)).toEqual(["ok"]);
  });

  it("sans angle repéré : pas de conclusion sur la marche hors zone", () => {
    expect(results(collets(130), []).map((x) => x.status)).toEqual(["ok"]);
  });
});

describe("G_COLLET_MONOTONE par angle du jour", () => {
  // Zone unique de 180° (nez 1 à 10) contournant deux angles : milieux des tournants sur Γ au
  // droit des marches 5 et 7 (nez tous les 250 mm dans les fixtures).
  const collets = [209, 151, 132, 124, 110, 124, 108, 151, 209];
  const treads: SteppingOptions["treads"] = Object.fromEntries(
    collets.map((c, i) => [i + 2, { kind: "winder" as const, colletChord: c }]),
  );
  const zones = [{ turn: 0, from: 1, to: 10, method: "M3" }];
  const turn = (index: number, sMid: number) => ({
    index,
    direction: "left" as const,
    mode: "winders" as const,
    innerCorner: { x: 0, y: 0 },
    outerCorner: { x: 0, y: 0 },
    sStart: sMid - 100,
    sEnd: sMid + 100,
  });
  const input = (turns: ReturnType<typeof turn>[]) => {
    const i = makeInput({ stepping: { treads, balancedZones: zones } });
    return { ...i, layout: { ...i.layout, turns } };
  };
  const results = (turns: ReturnType<typeof turn>[]) =>
    evaluateCompliance(input(turns)).results.filter((r) => r.ruleId === "G_COLLET_MONOTONE");

  it("deux vallées autour de deux angles : conforme", () => {
    const r = results([turn(0, 4.5 * 250), turn(1, 6.5 * 250)]);
    expect(r.map((x) => x.status)).toEqual(["ok"]);
    expect(fr(r[0]!.message)).toContain("2 angle(s)");
    // Anglais : vrai pluriel (ADR-0007).
    expect(translatorFor("en").t(r[0]!.message)).toMatch(/\(2 well corners\)\.$/);
  });

  it("un seul angle repéré (ou aucun tournant) : vallée unique, rupture signalée", () => {
    expect(results([turn(0, 4.5 * 250)]).map((x) => x.location)).toEqual([
      { kind: "tread", number: 7 },
    ]);
    expect(results([]).map((x) => x.location)).toEqual([{ kind: "tread", number: 7 }]);
  });
});
