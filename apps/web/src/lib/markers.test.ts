import { ProjectSchema, buildModel, parseProjectText, type Model } from "@blondel/core";
import { describe, expect, it } from "vitest";
import j4Text from "../../../../examples/j4-acceptance-01-garde-corps.blondel.json?raw";
import { controlMarkers, locatedPartId, worse } from "./markers.js";

const base = parseProjectText(j4Text);

describe("marqueurs du contrôle de conception en 3D", () => {
  it("entraxe de balustres trop grand : balustres marqués « bloquant »", () => {
    const project = ProjectSchema.parse({
      ...base,
      guards: { ...base.guards, infill: { kind: "balusters", spacing: 200 } },
    });
    const model = buildModel(project);
    const m = controlMarkers(model);
    const flagged = [...m.parts.entries()].filter(([, s]) => s === "bloquant");
    expect(flagged.length).toBeGreaterThan(0);
    for (const [id] of flagged) {
      const part = model.parts.find((p) => p.id === id);
      expect(part).toBeDefined();
    }
    expect(
      flagged.some(([id]) => model.parts.find((p) => p.id === id)?.category === "baluster"),
    ).toBe(true);
    expect([...m.rulesByPart.values()].flat()).toContain("GC_GABARIT_T1_2024");
  });

  it("garde-corps désactivés : repères ponctuels au point de chute", () => {
    const project = ProjectSchema.parse({
      ...base,
      guards: { ...base.guards, flight: { enabled: false }, opening: { enabled: false } },
    });
    const m = controlMarkers(buildModel(project));
    const obl = m.points.filter((p) => p.ruleId === "GC_OBLIGATOIRE");
    expect(obl.length).toBeGreaterThanOrEqual(2);
    for (const p of obl) expect(Number.isFinite(p.at.z)).toBe(true);
  });

  it("sévérité la plus grave retenue ; marches désignées par `tread-N`", () => {
    expect(worse("bloquant", "conseil")).toBe(true);
    expect(worse("conseil", "avertissement")).toBe(false);
    expect(worse("conseil", undefined)).toBe(true);
    const ids = new Set(["tread-3"]);
    expect(locatedPartId({ kind: "tread", number: 3 }, ids)).toBe("tread-3");
    expect(locatedPartId({ kind: "tread", number: 4 }, ids)).toBeUndefined();
    expect(locatedPartId({ kind: "part", partId: "zz" }, ids)).toBeUndefined();
    const fake = {
      parts: [{ id: "tread-3" }],
      compliance: {
        results: [
          {
            ruleId: "A",
            status: "violation",
            severity: "conseil",
            location: { kind: "tread", number: 3 },
          },
          {
            ruleId: "B",
            status: "violation",
            severity: "avertissement",
            location: { kind: "part", partId: "tread-3" },
          },
          {
            ruleId: "C",
            status: "ok",
            severity: "bloquant",
            location: { kind: "part", partId: "tread-3" },
          },
        ],
      },
    } as unknown as Model;
    const m = controlMarkers(fake);
    expect(m.parts.get("tread-3")).toBe("avertissement");
    expect(m.rulesByPart.get("tread-3")).toEqual(["A", "B"]);
    expect(controlMarkers(null).points).toEqual([]);
  });
});
