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

  it("filtre par famille de règles (QUESTIONS A23) : famille lue dans le cœur", () => {
    const fake = {
      parts: [{ id: "tread-1" }, { id: "guard-1" }, { id: "stringer-1" }],
      compliance: {
        results: [
          {
            ruleId: "G_MIN_DTU",
            status: "violation",
            severity: "bloquant",
            location: { kind: "tread", number: 1 },
          },
          {
            ruleId: "FAB_MARCHE_PORTEE",
            status: "violation",
            severity: "avertissement",
            location: { kind: "part", partId: "stringer-1" },
          },
          {
            ruleId: "GC_GABARIT_T1_2024",
            status: "violation",
            severity: "bloquant",
            location: { kind: "part", partId: "guard-1" },
          },
          {
            ruleId: "GC_OBLIGATOIRE",
            status: "violation",
            severity: "bloquant",
            location: { kind: "point", at: { x: 0, y: 0, z: 100 } },
          },
          {
            ruleId: "H_MAX_DTU",
            status: "violation",
            severity: "bloquant",
            location: { kind: "stair" },
          },
        ],
      },
    } as unknown as Model;
    const all = controlMarkers(fake);
    expect([...all.parts.keys()].sort()).toEqual(["guard-1", "stringer-1", "tread-1"]);
    expect(all.points).toHaveLength(1);
    // Violations localisées seulement (la ligne « escalier » n'a pas de marqueur).
    expect(all.byFamily).toEqual({ geometrie: 1, fabrication: 1, "garde-corps": 2 });
    const noGuards = controlMarkers(fake, new Set(["garde-corps"]));
    expect([...noGuards.parts.keys()].sort()).toEqual(["stringer-1", "tread-1"]);
    expect(noGuards.points).toHaveLength(0);
    // Les comptes du filtre restent ceux d'avant filtrage.
    expect(noGuards.byFamily).toEqual(all.byFamily);
    const fabOnly = controlMarkers(fake, new Set(["geometrie", "garde-corps"]));
    expect([...fabOnly.parts.keys()]).toEqual(["stringer-1"]);
  });
});
