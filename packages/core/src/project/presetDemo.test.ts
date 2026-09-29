/**
 * Préréglages de démonstration (`presetDemo.ts`) et exemples `examples/demo-*.blondel.json`.
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/presetDemo.test.ts`.
 * Les exports de bout en bout (SVG, DXF, PDF, glTF) de ces exemples sont vérifiés par
 * `packages/exports/src/examples.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import "../structures/index.js";
import { ProjectSchema } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "./parse.js";
import {
  createDemoProject,
  DEMO_PRESET_DESCRIPTIONS,
  DEMO_PRESET_IDS,
  DEMO_PRESET_LABELS,
  isDemoPresetId,
} from "./presetDemo.js";
import { ALL_PRESET_IDS, createProject, PRESET_LABELS } from "./presets.js";
import { serializeProject } from "./serialize.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const exampleFile = (id: string): string => `${id}.blondel.json`;

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const id of DEMO_PRESET_IDS) {
    writeFileSync(join(EXAMPLES_DIR, exampleFile(id)), serializeProject(createDemoProject(id)));
  }
}

describe("préréglages de démonstration", () => {
  it("identifiants distincts des préréglages de base, libellés et descriptions renseignés", () => {
    expect(DEMO_PRESET_IDS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(DEMO_PRESET_IDS).size).toBe(DEMO_PRESET_IDS.length);
    for (const id of DEMO_PRESET_IDS) {
      expect(id.startsWith("demo-")).toBe(true);
      expect(isDemoPresetId(id)).toBe(true);
      expect((ALL_PRESET_IDS as readonly string[]).includes(id)).toBe(false);
      expect(DEMO_PRESET_LABELS[id].length).toBeGreaterThan(0);
      expect(DEMO_PRESET_DESCRIPTIONS[id]).toMatch(/^[A-ZÉ].+\.$/);
      expect(DEMO_PRESET_DESCRIPTIONS[id]).not.toContain("\n");
    }
    for (const id of ALL_PRESET_IDS) expect(isDemoPresetId(id)).toBe(false);
    expect(new Set(Object.values(DEMO_PRESET_LABELS)).size).toBe(DEMO_PRESET_IDS.length);
  });

  it("préréglages de base inchangés : aucune apparence enregistrée", () => {
    for (const id of ALL_PRESET_IDS) {
      const p = createProject(id);
      expect(p.appearance).toBeUndefined();
      expect(p.name).toBe(PRESET_LABELS[id]);
      expect(serializeProject(p)).not.toContain('"appearance"');
    }
  });

  it.each(DEMO_PRESET_IDS)("%s : modèle complet, aucune erreur ni violation bloquante", (id) => {
    const p = createDemoProject(id);
    expect(p.name).toBe(DEMO_PRESET_LABELS[id]);
    expect(p.stair.structure.kind).not.toBe("none");
    expect(p.guards).toBeDefined();
    expect(p.appearance).toBeDefined();
    const m = buildModel(p, { memo: false });
    expect(m.errors).toEqual([]);
    const blocking = m.compliance.results.filter(
      (r) => r.status === "violation" && r.severity === "bloquant",
    );
    expect(blocking.map((r) => r.ruleId)).toEqual([]);
    expect(m.compliance.summary.bloquant).toBe(0);
    for (const part of m.parts) {
      const mass = part.quantities["mass_kg"];
      expect(mass !== undefined && Number.isFinite(mass) && mass > 0, part.id).toBe(true);
    }
  });

  it.each(["demo-helical-glass", "demo-helical-well"] as const)(
    "%s : sortie du palier d'arrivée vers la dalle au moins aussi large que l'emmarchement",
    (id) => {
      const h = buildModel(createDemoProject(id), { memo: false }).layout!.helical!;
      const exit = 2 * h.outerRadius * Math.sin(h.landingAngle / 2);
      expect(exit).toBeGreaterThanOrEqual(h.outerRadius - h.innerRadius);
    },
  );

  it("les matériaux sont ceux du modèle (masses cohérentes), l'apparence ne règle que les teintes", () => {
    const materials = (id: (typeof DEMO_PRESET_IDS)[number]): Set<string> =>
      new Set(buildModel(createDemoProject(id), { memo: false }).parts.map((p) => p.material));
    expect(materials("demo-helical-glass")).toEqual(
      new Set(["steel-painted", "wood-oak", "glass", "stainless-brushed"]),
    );
    expect(materials("demo-u-oak")).toEqual(new Set(["wood-oak"]));
    expect(materials("demo-quarter-landing-ash")).toContain("wood-ash");
    expect(materials("demo-quarter-landing-ash")).not.toContain("wood-oak");
    expect(materials("demo-quarter-landing-ash")).toContain("glass");
    // Tôle pliée : marches en acier (seule la contremarche d'arrivée, contre la dalle, reste
    // en bois : comportement du plugin `steel-flat`).
    const industrial = buildModel(createDemoProject("demo-half-turn-industrial"), { memo: false });
    const treads = industrial.parts.filter((p) => p.category === "tread");
    expect(treads.length).toBeGreaterThan(0);
    expect(new Set(treads.map((p) => p.material))).toEqual(new Set(["steel-painted"]));
    expect(materials("demo-helical-well")).toContain("wood-beech");
    // Acier peint en trois tons distincts : ossature, marches, garde-corps.
    const tones = createDemoProject("demo-half-turn-industrial").appearance!;
    expect(new Set([tones.paintColor, tones.treadPaintColor, tones.guardPaintColor]).size).toBe(3);
  });

  it("chaque démo est un projet canonique : relu et resérialisé à l'identique", () => {
    for (const id of DEMO_PRESET_IDS) {
      const text = serializeProject(createDemoProject(id));
      expect(serializeProject(parseProjectText(text))).toBe(text);
    }
  });

  it("particularités : ERP large à deux mains courantes, loft sans contremarche, jour en arc", () => {
    const erp = createDemoProject("demo-erp-grand");
    expect(erp.stair.layout.width).toBe(1400);
    expect(erp.compliance.contexts).toContain("erp_neuf");
    const m = buildModel(erp, { memo: false });
    // Mains courantes des deux côtés de la volée (pas seulement celle de la trémie).
    const handrails = new Set(m.parts.filter((p) => p.category === "handrail").map((p) => p.id));
    expect(handrails).toContain("guard-inner-1-handrail");
    expect(handrails).toContain("guard-outer-1-handrail");
    // Hélicoïdaux : marches de 80 mm, vide entre marches (sans contremarche) sous la sphère de
    // 100 mm de `VIDE_ENTRE_MARCHES`.
    for (const id of ["demo-helical-glass", "demo-helical-well"] as const) {
      const results = buildModel(createDemoProject(id), { memo: false }).compliance.results;
      const gaps = results.filter((r) => r.ruleId === "VIDE_ENTRE_MARCHES");
      expect(gaps.length, id).toBeGreaterThan(0);
      expect(
        gaps.filter((r) => r.status === "violation"),
        id,
      ).toEqual([]);
    }
    const loft = createDemoProject("demo-straight-loft");
    expect(loft.stair.treads.risers).toBe("none");
    expect(loft.stair.treads.thickness).toBe(80);
    const curved = createDemoProject("demo-quarter-curved");
    expect(curved.stair.layout.turns[0]!.inner.kind).toBe("arc");
    const well = createDemoProject("demo-helical-well");
    expect(well.stair.layout.kind === "helical" && well.stair.layout.core.kind).toBe("well");
  });
});

describe("essence des marches `stair.treads.material` (rétrocompatible)", () => {
  it("absente : chêne, projet sérialisé sans le champ ; présente : marches et contremarches", () => {
    const base = createProject("quarter-left");
    expect(base.stair.treads.material).toBeUndefined();
    expect(serializeProject(base)).not.toMatch(/"treads": \{[^}]*"material"/);
    const oak = buildModel(base, { memo: false }).parts.filter(
      (p) => p.category === "tread" || p.category === "riser",
    );
    expect(new Set(oak.map((p) => p.material))).toEqual(new Set(["wood-oak"]));
    const pine = ProjectSchema.parse({
      ...base,
      stair: { ...base.stair, treads: { ...base.stair.treads, material: "wood-pine" } },
    });
    const parts = buildModel(pine, { memo: false }).parts.filter(
      (p) => p.category === "tread" || p.category === "riser",
    );
    expect(new Set(parts.map((p) => p.material))).toEqual(new Set(["wood-pine"]));
    // Masse cohérente avec l'essence (pin plus léger que le chêne, profil d'atelier).
    const mass = (ps: typeof parts): number =>
      ps.reduce((s, p) => s + (p.quantities["mass_kg"] ?? 0), 0);
    expect(mass(parts)).toBeLessThan(mass(oak));
    expect(
      ProjectSchema.safeParse({
        ...base,
        stair: { ...base.stair, treads: { ...base.stair.treads, material: "steel-raw" } },
      }).success,
    ).toBe(false);
  });
});

describe("champ `appearance` (rétrocompatible)", () => {
  const base = createProject("straight");

  it("absent : projet inchangé ; présent : relu à l'identique", () => {
    expect(ProjectSchema.parse(base).appearance).toBeUndefined();
    const withTint = ProjectSchema.parse({
      ...base,
      appearance: {
        paintColor: "#1F2328",
        treadPaintColor: "#a3a8ab",
        guardPaintColor: "#2e3338",
        woodTone: "dark",
        glassTint: "smoked",
      },
    });
    const text = serializeProject(withTint);
    expect(serializeProject(parseProjectText(text))).toBe(text);
  });

  it("n'agit pas sur le modèle (pièces et matériaux identiques)", () => {
    const tinted = { ...base, appearance: { paintColor: "#ffffff", woodTone: "dark" as const } };
    const a = buildModel(base, { memo: false });
    const b = buildModel(tinted, { memo: false });
    expect(b.parts.map((p) => [p.id, p.material, p.quantities["mass_kg"]])).toEqual(
      a.parts.map((p) => [p.id, p.material, p.quantities["mass_kg"]]),
    );
  });

  it("refuse une couleur mal formée ou une valeur inconnue", () => {
    for (const appearance of [
      { paintColor: "noir" },
      { paintColor: "#12345" },
      { treadPaintColor: "gris" },
      { guardPaintColor: "#1234567" },
      { woodTone: "rouge" },
      { glassTint: "opaque" },
    ]) {
      expect(ProjectSchema.safeParse({ ...base, appearance }).success).toBe(false);
    }
  });
});

describe("examples/demo-*.blondel.json", () => {
  it.each(DEMO_PRESET_IDS)("%s est à jour avec son générateur", (id) => {
    const text = readFileSync(join(EXAMPLES_DIR, exampleFile(id)), "utf8");
    expect(text).toBe(serializeProject(createDemoProject(id)));
  });
});
