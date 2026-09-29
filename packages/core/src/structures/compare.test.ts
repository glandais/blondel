import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { precheckModel } from "../precheck/stringers.js";
import { buildModel } from "../pipeline/build.js";
import { fmt } from "../rules/check.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { WorkshopProfileSchema } from "../workshop/profile.js";
import { adaptJour, compareVariants, variantCost } from "./compare.js";
import { layoutAccepts } from "../project/newel.js";
import { createProject } from "../project/presets.js";
import "./index.js";

const base = (): Project =>
  makeSteppingProject({
    width: 900,
    legs: ["auto"],
    floorToFloor: 2625,
    stepping: { riserCount: 15, targetRise: 175, targetGoing: 280 },
  });

const KINDS = ["wood-housed", "steel-flat", "steel-profile"] as const;

describe("comparateur de variantes (CHALLENGE P2)", () => {
  const rows = compareVariants(base(), KINDS);

  it("une ligne par variante, même épure (même découpage)", () => {
    expect(rows.map((r) => r.kind)).toEqual([...KINDS]);
    const going = rows.map((r) => r.model.stepping.going);
    expect(new Set(going.map((g) => g.toFixed(6))).size).toBe(1);
    for (const r of rows) {
      expect(r.errors).toEqual([]);
      expect(r.partCount).toBe(r.model.parts.length);
      expect(r.uniqueParts).toBeGreaterThan(0);
      expect(r.uniqueParts).toBeLessThanOrEqual(r.partCount);
      expect(r.massKg).toBeGreaterThan(0);
      expect(r.surfaceM2).toBeGreaterThan(0);
    }
  });

  it("grandeurs physiques : cordons et EXC pour le métal, rien pour le bois", () => {
    const [wood, flat, profile] = rows;
    expect(wood!.executionClass).toBeNull();
    expect(wood!.weldMm).toBe(0);
    expect(flat!.executionClass).toBe("EXC1");
    expect(profile!.executionClass).toBe("EXC1");
    expect(profile!.weldMm).toBeGreaterThan(0);
    expect(profile!.cuts).toBeGreaterThan(0);
    expect(profile!.family).toBe("metal");
  });

  it("prédimensionnement indicatif évalué pour les limons de chaque variante", () => {
    for (const r of rows) expect(r.precheck.beams, r.kind).toBe(2);
    // Le prédimensionnement du plugin profilé n'est pas compté deux fois.
    const profile = rows[2]!;
    const inReport = profile.model.compliance.results.filter((x) =>
      x.ruleId.startsWith("PRECHECK_"),
    );
    expect(inReport.length).toBeGreaterThan(0);
  });

  it("sans barème d'atelier : pas d'euros (null), champs manquants listés", () => {
    for (const r of rows) {
      expect(r.cost).toBeNull();
      expect(r.costMissing).toContain("hourlyRate");
    }
  });

  it("avec un barème complet : coût = matière + main-d'œuvre + finition", () => {
    const p: Project = {
      ...base(),
      workshop: WorkshopProfileSchema.parse({
        costs: {
          hourlyRate: 60,
          minutesPerCut: 2,
          minutesPerWeldMeter: 10,
          minutesPerBend: 1,
          minutesPerHole: 1,
          minutesPerUniquePart: 15,
          steelPricePerKg: 1.5,
          woodPricePerM3: 1800,
          finishPricePerM2: 20,
        },
      }),
    };
    const [wood, , profile] = compareVariants(p, KINDS);
    for (const r of [wood!, profile!]) {
      expect(r.cost).not.toBeNull();
      const c = r.cost!;
      expect(c.total).toBeCloseTo(c.material + c.labour + c.finish, 6);
      expect(c.labour).toBeCloseTo(c.hours * 60, 6);
    }
  });

  it("variantCost : calcul à la main", () => {
    const { cost, missing } = variantCost(
      {
        hourlyRate: 50,
        minutesPerCut: 3,
        minutesPerWeldMeter: 12,
        minutesPerBend: 2,
        minutesPerHole: 1,
        minutesPerUniquePart: 30,
        steelPricePerKg: 2,
      },
      {
        steelKg: 100,
        woodM3: 0,
        surfaceM2: 0,
        cuts: 10,
        weldMm: 5000,
        bends: 0,
        holes: 20,
        uniqueParts: 2,
      },
    );
    expect(missing).toEqual([]);
    // (30 + 60 + 0 + 20 + 60) min = 170 min ; 170/60 × 50 € ; 100 kg × 2 € ; rien à finir.
    expect(cost!.hours).toBeCloseTo(170 / 60, 9);
    expect(cost!.labour).toBeCloseTo((170 / 60) * 50, 9);
    expect(cost!.material).toBe(200);
    expect(cost!.finish).toBe(0);
    const partial = variantCost(
      { hourlyRate: 50 },
      {
        steelKg: 1,
        woodM3: 1,
        surfaceM2: 0,
        cuts: 0,
        weldMm: 0,
        bends: 0,
        holes: 0,
        uniqueParts: 0,
      },
    );
    expect(partial.cost).toBeNull();
    expect(partial.missing).toEqual(
      expect.arrayContaining(["minutesPerCut", "steelPricePerKg", "woodPricePerM3"]),
    );
  });

  it("surface à finir sans prix de finition : pas d'euros (le coût ne l'ignore pas en silence)", () => {
    const rates = {
      hourlyRate: 50,
      minutesPerCut: 3,
      minutesPerWeldMeter: 12,
      minutesPerBend: 2,
      minutesPerHole: 1,
      minutesPerUniquePart: 30,
      steelPricePerKg: 2,
    };
    const m = {
      steelKg: 100,
      woodM3: 0,
      surfaceM2: 5,
      cuts: 10,
      weldMm: 5000,
      bends: 0,
      holes: 20,
      uniqueParts: 2,
    };
    const r = variantCost(rates, m);
    expect(r.cost).toBeNull();
    expect(r.missing).toEqual(["finishPricePerM2"]);
    expect(variantCost({ ...rates, finishPricePerM2: 20 }, m).cost!.finish).toBe(100);
  });

  it("comparateur : acier brut non fini (pas de prix de finition requis), acier peint fini", () => {
    const costs = {
      hourlyRate: 60,
      minutesPerCut: 2,
      minutesPerWeldMeter: 10,
      minutesPerBend: 1,
      minutesPerHole: 1,
      minutesPerUniquePart: 15,
      steelPricePerKg: 1.5,
      woodPricePerM3: 1800,
    };
    const p: Project = { ...base(), workshop: WorkshopProfileSchema.parse({ costs }) };
    const [raw] = compareVariants(p, ["steel-profile"], {
      params: { "steel-profile": { finish: "raw" } },
    });
    expect(raw!.cost).not.toBeNull();
    expect(raw!.cost!.finish).toBe(0);
    const [painted] = compareVariants(p, ["steel-profile"]);
    expect(painted!.cost).toBeNull();
    expect(painted!.costMissing).toEqual(["finishPricePerM2"]);
  });

  it("prédimensionnement du comparateur = celui du plugin (mêmes réglages, même portée)", () => {
    const params = { section: "UPN 100", precheck: { category: "D2" } };
    const [row] = compareVariants(base(), ["steel-profile"], {
      params: { "steel-profile": params },
    });
    const inModel = row!.model.compliance.results.filter(
      (x) => x.ruleId.startsWith("PRECHECK_") && x.status === "violation",
    );
    const bySeverity = { bloquant: 0, avertissement: 0, conseil: 0 };
    for (const x of inModel) bySeverity[x.severity]++;
    expect(bySeverity.bloquant).toBeGreaterThan(0);
    expect(row!.precheck.violations).toEqual(bySeverity);
    // Même portée ; charges permanentes à peine différentes (le plugin compte les supports avant
    // rognage à l'âme, la section n'étant pas encore choisie) : flèches identiques à 1 % près.
    const p: Project = {
      ...base(),
      stair: { ...base().stair, structure: { kind: "steel-profile", params } },
    };
    const pc = precheckModel(p, row!.model, { category: "D2" });
    const plugin = row!.model.compliance.results.filter((x) => x.ruleId === "PRECHECK_FLECHE");
    for (const b of pc.beams) {
      const line = plugin.find((x) => x.location.kind === "part" && x.location.partId === b.partId);
      expect(Math.abs(b.result.deflection - line!.measured!) / line!.measured!).toBeLessThan(0.01);
      const st = row!.model.parts.find((x) => x.id === b.partId)!;
      expect(line!.message).toContain(`L = ${fmt(b.result.length / 1000, 2)} m`);
      expect(st.category).toBe("stringer");
    }
  });

  it("precheckModel : limons en plat (steel-flat) et bois (C24, à valider)", () => {
    for (const kind of ["steel-flat", "wood-housed"]) {
      const p: Project = { ...base(), stair: { ...base().stair, structure: { kind, params: {} } } };
      const m = buildModel(p, { memo: false });
      const pc = precheckModel(p, m);
      expect(pc.beams.length, kind).toBe(2);
      expect(pc.results.filter((r) => r.ruleId === "PRECHECK_FLECHE").length).toBe(2);
      const label = pc.beams[0]!.label;
      expect(label).toMatch(kind === "wood-housed" ? /C24/ : /S235/);
      // Plat mince : déversement non vérifié, signalé.
      expect(pc.notes.some((n) => /déversement/.test(n))).toBe(kind === "steel-flat");
    }
  });
});

describe("adaptJour — poteau élargi des profilés refusé par le tracé", () => {
  it("demi-tournant en IPE : poteau par défaut signalé, variante constructible", () => {
    // Revue : le poteau élargi (IPE, ~160 mm décalé) ne tient pas dans la volée centrale du
    // demi-tournant ; il était posé tel quel et la variante tombait en erreur de tracé.
    const base = createProject("half-turn");
    const r = adaptJour(base, { kind: "steel-profile", params: { family: "IPE" } });
    expect(r.adaptations.map((a) => a.to)).toEqual([
      { kind: "newel", size: 100 },
      { kind: "newel", size: 100 },
    ]);
    expect(r.signals.join(" ")).toMatch(/impossible dans ce tracé : poteau par défaut de 100 mm/);
    expect(layoutAccepts(r.project)).toBe(true);
  });
});
