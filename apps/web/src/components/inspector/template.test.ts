/**
 * Choix du gabarit de l'inspecteur d'après la sélection partagée (ADR-0009, vague 3) : règle
 * (2c), marche ou nez (2a), pièce (2b), sinon « sans sélection » (2d) ; correspondance nez k ↔
 * marche k + 1, éléments absents du modèle, clé de montage des gabarits.
 */
import { buildModel, createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import type { Selection } from "../../store/projectStore.js";
import { inspectedTread, inspectorTemplate, selectionKey } from "./Inspector.js";

const model = buildModel(createProject("quarter-left"));
const treads = model.stepping.treads.map((t) => t.number);
const first = Math.min(...treads);
const last = Math.max(...treads);
const part = model.parts[0]!;

const at = (location: Selection["location"], ruleId?: string): Selection =>
  ruleId === undefined ? { location } : { location, ruleId };

describe("inspectorTemplate", () => {
  it("aucune sélection : projet (2d), avec ou sans modèle", () => {
    expect(inspectorTemplate(null, model)).toBe("project");
    expect(inspectorTemplate(null, null)).toBe("project");
  });

  it("règle : 2c quelle que soit la localisation, même sans modèle", () => {
    expect(inspectorTemplate(at({ kind: "tread", number: 3 }, "R-x"), model)).toBe("rule");
    expect(inspectorTemplate(at({ kind: "part", partId: part.id }, "R-x"), model)).toBe("rule");
    expect(inspectorTemplate(at({ kind: "stair" }, "R-x"), null)).toBe("rule");
  });

  it("marche existante : 2a ; marche absente : 2d", () => {
    expect(inspectorTemplate(at({ kind: "tread", number: first }), model)).toBe("tread");
    expect(inspectorTemplate(at({ kind: "tread", number: last }), model)).toBe("tread");
    expect(inspectorTemplate(at({ kind: "tread", number: last + 1 }), model)).toBe("project");
    expect(inspectorTemplate(at({ kind: "tread", number: 0 }), model)).toBe("project");
  });

  it("nez k : 2a de la marche k + 1 si elle existe", () => {
    expect(inspectorTemplate(at({ kind: "nosing", index: 0 }), model)).toBe("tread");
    expect(inspectorTemplate(at({ kind: "nosing", index: last - 1 }), model)).toBe("tread");
    // Dernier nez (arrivée) : pas de marche au-dessus.
    expect(inspectorTemplate(at({ kind: "nosing", index: last }), model)).toBe("project");
    expect(inspectedTread(at({ kind: "nosing", index: 2 }), model)).toBe(3);
    expect(inspectedTread(at({ kind: "tread", number: 3 }), model)).toBe(3);
    expect(inspectedTread(at({ kind: "nosing", index: last }), model)).toBeNull();
  });

  it("pièce présente : 2b ; pièce disparue : 2d", () => {
    expect(inspectorTemplate(at({ kind: "part", partId: part.id }), model)).toBe("part");
    expect(inspectorTemplate(at({ kind: "part", partId: "absente" }), model)).toBe("project");
  });

  it("escalier, point, pas de modèle : 2d", () => {
    expect(inspectorTemplate(at({ kind: "stair" }), model)).toBe("project");
    expect(inspectorTemplate(at({ kind: "point", at: { x: 0, y: 0, z: 0 } }), model)).toBe(
      "project",
    );
    expect(inspectorTemplate(at({ kind: "tread", number: 3 }), null)).toBe("project");
    expect(inspectorTemplate(at({ kind: "part", partId: part.id }), null)).toBe("project");
  });
});

describe("selectionKey", () => {
  it("change avec l'élément et la règle, stable sinon", () => {
    const keys = [
      selectionKey(null),
      selectionKey(at({ kind: "tread", number: 3 })),
      selectionKey(at({ kind: "tread", number: 4 })),
      selectionKey(at({ kind: "nosing", index: 3 })),
      selectionKey(at({ kind: "part", partId: "a" })),
      selectionKey(at({ kind: "part", partId: "a" }, "R-1")),
      selectionKey(at({ kind: "part", partId: "a" }, "R-2")),
      selectionKey(at({ kind: "stair" })),
      selectionKey(at({ kind: "point", at: { x: 1, y: 2, z: 3 } })),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(selectionKey(at({ kind: "tread", number: 3 }))).toBe(
      selectionKey(at({ kind: "tread", number: 3 })),
    );
  });
});
