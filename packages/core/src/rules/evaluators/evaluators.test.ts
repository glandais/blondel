import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RuleResult } from "../../model/derived.js";
import { minWidth, flightsOf } from "../check.js";
import { evaluateCompliance } from "../engine.js";
import {
  makeInput,
  makeStepping,
  type ProjectOptions,
  type SteppingOptions,
} from "../test-fixtures.js";

type Opts = Parameters<typeof makeInput>[0];

function run(o: Opts, id: string): RuleResult[] {
  return evaluateCompliance(makeInput(o)).results.filter((r) => r.ruleId === id);
}
const violations = (o: Opts, id: string) => run(o, id).filter((r) => r.status === "violation");
const status = (o: Opts, id: string) => run(o, id).map((r) => r.status);

const erp: ProjectOptions = { contexts: ["bois_dtu", "erp_neuf", "erp_securite"] };
const rises = (first: number, rest: number, n = 16) => [
  first,
  ...Array.from({ length: n - 1 }, () => rest),
];

describe("hauteurs", () => {
  it("H_MAX_DTU exclut la marche de départ ; les autres maxima non", () => {
    const o: Opts = { stepping: { rises: rises(215, 170) } };
    expect(violations(o, "H_MAX_DTU")).toHaveLength(0);
    const hl = violations(o, "H_MAX_LOGEMENT");
    expect(hl).toHaveLength(1);
    expect(hl[0]).toMatchObject({
      measured: 215,
      max: 180,
      location: { kind: "nosing", index: 0 },
    });
    expect(violations({ stepping: { rises: rises(170, 215) } }, "H_MAX_DTU")).toHaveLength(15);
  });

  it("H_MAX par contexte (ERP neuf 160)", () => {
    expect(
      violations({ project: erp, stepping: { rises: rises(170, 170) } }, "H_MAX_ERP_NEUF"),
    ).toHaveLength(16);
    expect(
      violations({ project: erp, stepping: { rises: rises(160, 160) } }, "H_MAX_ERP_NEUF"),
    ).toHaveLength(0);
  });

  it("H_TOLERANCE_DTU : écart à H/n au-delà de ±5 mm", () => {
    const rs = rises(170, 170);
    rs[5] = 176;
    rs[6] = 164;
    const v = violations({ stepping: { rises: rs } }, "H_TOLERANCE_DTU");
    expect(v.map((r) => r.location)).toEqual([
      { kind: "nosing", index: 5 },
      { kind: "nosing", index: 6 },
    ]);
  });

  it("H_PREMIERE_MARCHE_TOL : −30 … +10 mm", () => {
    // n = 16, somme = 2720 ⇒ h_nom = 170 ; h1 = 138 ⇒ écart −32.
    const rs = rises(138, (2720 - 138) / 15);
    expect(
      violations({ stepping: { rises: rs } }, "H_PREMIERE_MARCHE_TOL")[0]?.measured,
    ).toBeCloseTo(-32, 6);
    const ok = rises(150, (2720 - 150) / 15);
    expect(status({ stepping: { rises: ok } }, "H_PREMIERE_MARCHE_TOL")).toEqual(["ok"]);
  });

  it("H_REGULARITE : écart max − min par volée, hors 1re marche", () => {
    const rs = rises(100, 170);
    rs[3] = 182;
    expect(violations({ stepping: { rises: rs } }, "H_REGULARITE")[0]?.measured).toBe(12);
    expect(status({ stepping: { rises: rises(100, 170) } }, "H_REGULARITE")).toEqual(["ok"]);
  });
});

describe("girons", () => {
  it("G_MIN par contexte, localisé à la marche, paliers exclus", () => {
    const o: Opts = {
      stepping: { treads: { 4: { going: 230 }, 8: { kind: "landing", going: 100 } } },
    };
    const v = violations(o, "G_MIN_LOGEMENT");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ measured: 230, location: { kind: "tread", number: 4 } });
    expect(violations(o, "G_MIN_DTU")).toHaveLength(0);
  });

  it("G_TOL_DROITE ±5 et G_TOL_BALANCEE ±10 (tournant)", () => {
    const o: Opts = {
      stepping: {
        treads: {
          2: { going: 256 },
          6: { kind: "winder", going: 258 },
          7: { kind: "winder", going: 261 },
        },
      },
    };
    expect(violations(o, "G_TOL_DROITE").map((r) => r.location)).toEqual([
      { kind: "tread", number: 2 },
    ]);
    expect(violations(o, "G_TOL_BALANCEE").map((r) => r.location)).toEqual([
      { kind: "tread", number: 7 },
    ]);
  });

  it("G_BALANCE_VS_DROITE : giron balancé ≥ g_nom − 10", () => {
    const o: Opts = {
      stepping: {
        treads: { 6: { kind: "winder", going: 239 }, 7: { kind: "winder", going: 241 } },
      },
    };
    const v = violations(o, "G_BALANCE_VS_DROITE");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ min: 240, measured: 239 });
  });

  it("G_COLLET_MIN (corde) et G_COLLET_MONOTONE (vallée vers l'angle)", () => {
    const treads: SteppingOptions["treads"] = {
      5: { kind: "winder", colletChord: 200 },
      6: { kind: "winder", colletChord: 150 },
      7: { kind: "winder", colletChord: 90 },
      8: { kind: "winder", colletChord: 120 },
      9: { kind: "winder", colletChord: 110 },
    };
    const o: Opts = { stepping: { treads } };
    expect(violations(o, "G_COLLET_MIN").map((r) => r.location)).toEqual([
      { kind: "tread", number: 7 },
    ]);
    expect(violations(o, "G_COLLET_MONOTONE").map((r) => r.location)).toEqual([
      { kind: "tread", number: 9 },
    ]);
    const good: SteppingOptions["treads"] = { ...treads, 9: { kind: "winder", colletChord: 180 } };
    expect(status({ stepping: { treads: good } }, "G_COLLET_MONOTONE")).toEqual(["ok"]);
  });

  it("G_COLLET_MONOTONE par zone balancée", () => {
    const treads: SteppingOptions["treads"] = {
      2: { kind: "winder", colletChord: 150 },
      3: { kind: "winder", colletChord: 100 },
      4: { kind: "winder", colletChord: 150 },
      5: { kind: "winder", colletChord: 100 },
    };
    const zones = [
      { turn: 0, from: 0, to: 3, method: "M3" },
      { turn: 1, from: 3, to: 6, method: "M3" },
    ];
    expect(status({ stepping: { treads, balancedZones: zones } }, "G_COLLET_MONOTONE")).toEqual([
      "ok",
    ]);
    expect(violations({ stepping: { treads } }, "G_COLLET_MONOTONE")).toHaveLength(1);
  });

  it("G_EXT_MAX_ERP_TOURNANT : g_ext < 420 (strict), seulement en ERP tournant", () => {
    const treads: SteppingOptions["treads"] = {
      5: { kind: "winder", goingOuter: 420 },
      6: { kind: "winder", goingOuter: 419 },
    };
    expect(
      violations({ project: erp, stepping: { treads } }, "G_EXT_MAX_ERP_TOURNANT").map(
        (r) => r.location,
      ),
    ).toEqual([{ kind: "tread", number: 5 }]);
    expect(run({ stepping: { treads } }, "G_EXT_MAX_ERP_TOURNANT")).toHaveLength(0);
  });
});

describe("module de Blondel, pente", () => {
  it("BLONDEL_DTU 580–660, CONFORT_CLASSE h/g ≤ 1,32", () => {
    // 2720 / 16 = 170 ; g = 330 ⇒ 670.
    expect(violations({ stepping: { going: 330 } }, "BLONDEL_DTU")[0]?.measured).toBe(670);
    expect(status({ stepping: { going: 280 } }, "BLONDEL_DTU")).toEqual(["ok"]);
    expect(violations({ stepping: { going: 120 } }, "CONFORT_CLASSE")[0]?.measured).toBeCloseTo(
      170 / 120,
      9,
    );
  });

  it("BLONDEL_ERP_BHC et BLONDEL_INDUSTRIEL selon les contextes", () => {
    expect(run({}, "BLONDEL_ERP_BHC")).toHaveLength(0);
    expect(
      violations({ project: erp, stepping: { going: 250 } }, "BLONDEL_ERP_BHC")[0]?.severity,
    ).toBe("avertissement");
    expect(
      status(
        { project: { contexts: ["industriel"] }, stepping: { going: 280 } },
        "BLONDEL_INDUSTRIEL",
      ),
    ).toEqual(["ok"]);
  });

  it("ANGLE_ECHELLE_MARCHES : 45° à 75°", () => {
    const o: Opts = { project: { contexts: ["echelle_meunier"] }, stepping: { going: 170 } };
    expect(violations(o, "ANGLE_ECHELLE_MARCHES")).toHaveLength(0);
    expect(violations({ ...o, stepping: { going: 250 } }, "ANGLE_ECHELLE_MARCHES")).toHaveLength(1);
  });
});

describe("largeurs et ligne de foulée", () => {
  it("E_MIN_DTU et LARGEUR_MIN_LOGEMENT", () => {
    expect(violations({ project: { width: 690 } }, "E_MIN_DTU")).toHaveLength(1);
    expect(violations({ project: { width: 750 } }, "LARGEUR_MIN_LOGEMENT")).toHaveLength(1);
    expect(run({ project: { width: 900 } }, "LARGEUR_MIN_LOGEMENT")[0]?.message).toMatch(
      /mains courantes/,
    );
  });

  it("LARGEUR_MC_ERP_NEUF : violation certaine si E < min, sinon à vérifier", () => {
    expect(status({ project: { ...erp, width: 1100 } }, "LARGEUR_MC_ERP_NEUF")).toEqual([
      "violation",
    ]);
    expect(status({ project: { ...erp, width: 1300 } }, "LARGEUR_MC_ERP_NEUF")).toEqual([
      "non-evaluee",
    ]);
  });

  it("LF_POSITION_DTU : milieu si E ≤ 1200, 600 mm au-delà", () => {
    expect(status({}, "LF_POSITION_DTU_ETROIT")).toEqual(["ok"]);
    expect(run({}, "LF_POSITION_DTU_LARGE")[0]?.message).toMatch(/Sans objet/);
    expect(
      status({ project: { width: 1400 }, walklineOffset: 600 }, "LF_POSITION_DTU_LARGE"),
    ).toEqual(["ok"]);
    // Sans incidence (aucune marche balancée) : ni mesure ni bornes, la cible est dans le message.
    const off = run({ project: { width: 1400 }, walklineOffset: 700 }, "LF_POSITION_DTU_LARGE")[0];
    expect(off).toMatchObject({ status: "ok", min: null, max: null });
    expect(off?.measured).toBeUndefined();
    expect(off?.message).toContain("attendue à 600 mm");
  });

  it("ligne de conception décalée avec marches balancées : girons contrôlés sur la ligne de mesure (X9)", () => {
    // Données synthétiques : nez parallèles, girons identiques sur toute ligne (voir
    // rules/measurementLine.test.ts pour un vrai tournant).
    const o: Opts = { walklineOffset: 400, stepping: { treads: { 5: { kind: "winder" } } } };
    const r = run(o, "LF_POSITION_DTU_ETROIT");
    expect(r.map((x) => x.status)).toEqual(["ok"]);
    expect(r[0]!.message).toMatch(
      /ligne de mesure à 450 mm .* conformes à G_MIN_DTU, G_TOL_BALANCEE/,
    );
    expect(status({ walklineOffset: 400 }, "LF_POSITION_DTU_ETROIT")).toEqual(["ok"]);
  });

  it("LF_POSITION_ACCESSIBILITE lit la distance 600 de LF_POSITION_DTU_LARGE", () => {
    const r = run(
      {
        project: { width: 1400 },
        walklineOffset: 500,
        stepping: { treads: { 5: { kind: "winder" } } },
      },
      "LF_POSITION_ACCESSIBILITE",
    );
    expect(r[0]!.status).toBe("ok");
    expect(r[0]!.message).toMatch(/ligne de mesure à 600 mm/);
  });
});

describe("échappée", () => {
  it("minimum et recommandations, localisées au point critique", () => {
    const v = violations({ headroom: 1850 }, "ECHAPPEE_MIN_DTU");
    expect(v[0]).toMatchObject({ measured: 1850, location: { kind: "point" } });
    expect(violations({ headroom: 2000 }, "ECHAPPEE_RECO_PRIVATIF")[0]?.severity).toBe("conseil");
    expect(violations({ headroom: 2000 }, "ECHAPPEE_MIN_DTU")).toHaveLength(0);
  });

  it("ECHAPPEE_LARGEUR : non calculée → non évaluée ; non limitée seulement si le pipeline le dit (revue A7)", () => {
    const width = (extra: object) => {
      const input = { ...makeInput(), ...extra };
      return evaluateCompliance(input).results.filter((r) => r.ruleId === "ECHAPPEE_LARGEUR");
    };
    // Trémie présente, échappée sur la largeur absente sans indication : pas « non limitée ».
    expect(width({}).map((r) => r.status)).toEqual(["non-evaluee"]);
    const clear = width({ headroomWidthClear: true });
    expect(clear.map((r) => r.status)).toEqual(["ok"]);
    expect(clear[0]!.message).toMatch(/non limitée/);
  });

  it("non calculée : non évaluée ; sans trémie : sans objet", () => {
    expect(status({ headroom: null }, "ECHAPPEE_MIN_DTU")).toEqual(["non-evaluee"]);
    expect(status({ headroom: null, project: { withOpening: false } }, "ECHAPPEE_MIN_DTU")).toEqual(
      ["ok"],
    );
  });
});

describe("volées et paliers", () => {
  it("VOLEE_MAX_DTU : 25 hauteurs par volée, coupé par les paliers", () => {
    const long: SteppingOptions = { riserCount: 26 };
    expect(
      violations({ project: { floorToFloor: 4420 }, stepping: long }, "VOLEE_MAX_DTU")[0]?.measured,
    ).toBe(26);
    const withLanding: SteppingOptions = {
      riserCount: 26,
      treads: { 13: { kind: "landing", walkingSurface: sq(900) } },
    };
    expect(
      violations({ project: { floorToFloor: 4420 }, stepping: withLanding }, "VOLEE_MAX_DTU"),
    ).toHaveLength(0);
  });

  it("PALIER_LONGUEUR_METIER : dimension du palier ≥ E", () => {
    const small = { treads: { 8: { kind: "landing" as const, walkingSurface: rectP(900, 800) } } };
    expect(violations({ stepping: small }, "PALIER_LONGUEUR_METIER")[0]).toMatchObject({
      measured: 800,
      location: { kind: "tread", number: 8 },
    });
    expect(
      status(
        { stepping: { treads: { 8: { kind: "landing", walkingSurface: sq(900) } } } },
        "PALIER_LONGUEUR_METIER",
      ),
    ).toEqual(["ok"]);
    expect(run({}, "PALIER_LONGUEUR_METIER")[0]?.message).toMatch(/Sans objet/);
  });

  it("ERP tournant : palier intermédiaire interdit", () => {
    const treads: SteppingOptions["treads"] = {
      4: { kind: "winder" },
      9: { kind: "landing", walkingSurface: sq(1200) },
    };
    expect(
      violations({ project: erp, stepping: { treads } }, "ERP_TOURNANT_BALANCEMENT_CONTINU"),
    ).toHaveLength(1);
  });

  it("RECULEMENT : donnée informative", () => {
    expect(run({}, "RECULEMENT")[0]).toMatchObject({ status: "ok", measured: 15 * 250 });
  });
});

describe("nez et contremarches", () => {
  it("DEBORD_NEZ_ERP ≤ 10 mm ; sans objet sans contremarche", () => {
    expect(violations({ project: { ...erp, nosing: 30 } }, "DEBORD_NEZ_ERP")[0]?.measured).toBe(30);
    expect(status({ project: { ...erp, nosing: 30, risers: "none" } }, "DEBORD_NEZ_ERP")).toEqual([
      "ok",
    ]);
  });

  it("RECOUVREMENT_ERP_SANS_CM et CONTREMARCHE_EXTREMES", () => {
    const o: Opts = { project: { ...erp, nosing: 30, risers: "none" } };
    expect(violations(o, "RECOUVREMENT_ERP_SANS_CM")[0]?.measured).toBe(30);
    expect(violations(o, "CONTREMARCHE_EXTREMES")).toHaveLength(2);
    expect(status({ project: { ...erp, risers: "full" } }, "CONTREMARCHE_EXTREMES")).toEqual([
      "ok",
      "ok",
    ]);
  });

  it("RECOUVREMENT_INDUSTRIEL : 50 sans contremarche, min de la table avec", () => {
    expect(
      violations(
        { project: { contexts: ["industriel"], nosing: 30, risers: "none" } },
        "RECOUVREMENT_INDUSTRIEL",
      )[0]?.min,
    ).toBe(50);
    expect(
      status(
        { project: { contexts: ["industriel"], nosing: 30, risers: "full" } },
        "RECOUVREMENT_INDUSTRIEL",
      ),
    ).toEqual(["ok"]);
  });

  it("VIDE_ENTRE_MARCHES : h − épaisseur < 100 sans contremarche", () => {
    // h = 170, épaisseur 40 ⇒ 130 mm : la sphère passe.
    expect(violations({ project: { risers: "none" } }, "VIDE_ENTRE_MARCHES")).toHaveLength(15);
    expect(status({ project: { risers: "full" } }, "VIDE_ENTRE_MARCHES")).toEqual(["ok"]);
  });

  it("ECHELLE_MEUNIER_HORS_DTU : incompatible avec bois_dtu", () => {
    expect(
      status(
        { project: { contexts: ["echelle_meunier", "bois_dtu"] } },
        "ECHELLE_MEUNIER_HORS_DTU",
      ),
    ).toEqual(["violation"]);
    expect(
      status({ project: { contexts: ["echelle_meunier"] } }, "ECHELLE_MEUNIER_HORS_DTU"),
    ).toEqual(["ok"]);
  });
});

describe("outils", () => {
  it("minWidth d'un rectangle = petit côté (propriété)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 }), (w, d) => {
        expect(minWidth(rectP(w, d))).toBeCloseTo(Math.min(w, d), 6);
      }),
    );
  });

  it("flightsOf : les volées couvrent toutes les hauteurs, somme = H (propriété)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 40 }),
        fc.array(fc.integer({ min: 1, max: 38 }), { maxLength: 4 }),
        (n, landingAt) => {
          const treads: SteppingOptions["treads"] = {};
          for (const k of landingAt) if (k < n) treads[k] = { kind: "landing" };
          const s = makeStepping({ riserCount: n, treads });
          const fl = flightsOf(s);
          expect(fl.flatMap((f) => f.riseIndices)).toEqual(s.rises.map((_, i) => i));
          expect(fl.reduce((a, f) => a + f.height, 0)).toBeCloseTo(2720, 6);
        },
      ),
    );
  });
});

function rectP(w: number, d: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
}
function sq(e: number) {
  return rectP(e, e);
}
