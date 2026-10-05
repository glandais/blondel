/**
 * Pièces liées d'une marche et d'une pièce (inspecteurs Marche et Pièce) : pièces fabriquées à
 * la main (les assemblages `assembledWith` du cœur peuvent manquer), ordre du modèle, sans
 * doublon ni la pièce elle-même.
 */
import { textMessage, type Part } from "@blondel/core";
import { msg } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { assembledParts, groupPartLinks, treadLinkedParts } from "./partLinks.js";

function part(id: string, extra: Partial<Part> = {}): Part {
  return {
    id,
    mark: id.toUpperCase(),
    category: "support",
    name: textMessage(id),
    material: "steel-raw",
    solid: { kind: "sweep", path: [], section: { outer: [], holes: [] } },
    quantities: {},
    ...extra,
  };
}

/** Tronçon de limon débité (trait de joint au développé, suffixe -i). */
function segment(id: string): Part {
  return part(id, {
    category: "stringer",
    flat: {
      outline: {
        outer: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        holes: [],
      },
      lines: [{ kind: "joint", a: { x: 10, y: 0 }, b: { x: 10, y: 10 } }],
      thickness: 8,
    },
  });
}

const ids = (parts: readonly Part[]): string[] => parts.map((p) => p.id);

describe("treadLinkedParts", () => {
  it("pièces de la marche puis pièces assemblées, ordre du modèle, sans doublon", () => {
    const model = {
      parts: [
        part("stringer", { category: "stringer", assembledWith: ["s1", "s2", "s3"] }),
        part("s3", { assembledWith: ["tread-2", "stringer"] }),
        part("s2", { assembledWith: ["tread-1", "stringer"] }),
        part("tread-1", {
          category: "tread",
          treadNumber: 1,
          assembledWith: ["s2", "s1", "riser-1"],
        }),
        part("riser-1", { category: "riser", treadNumber: 1, assembledWith: ["tread-1"] }),
        part("s1", { assembledWith: ["tread-1", "stringer"] }),
        part("tread-2", { category: "tread", treadNumber: 2, assembledWith: ["s3"] }),
      ],
    };
    // Second saut : le limon porteur des supports s1, s2 (sans les autres supports du limon).
    expect(ids(treadLinkedParts(model, 1))).toEqual(["tread-1", "riser-1", "stringer", "s2", "s1"]);
    expect(ids(treadLinkedParts(model, 2))).toEqual(["tread-2", "stringer", "s3"]);
    expect(treadLinkedParts(model, 9)).toEqual([]);
  });

  it("sans assemblages déclarés (modèle d'avant l'exposition) : pièces de la marche seules", () => {
    const model = { parts: [part("tread-3", { category: "tread", treadNumber: 3 }), part("x")] };
    expect(ids(treadLinkedParts(model, 3))).toEqual(["tread-3"]);
  });

  it("identifiant inconnu dans assembledWith : ignoré", () => {
    const model = {
      parts: [part("tread-1", { category: "tread", treadNumber: 1, assembledWith: ["ghost"] })],
    };
    expect(ids(treadLinkedParts(model, 1))).toEqual(["tread-1"]);
  });
});

describe("assembledParts", () => {
  it("assembledWith, dans l'ordre du modèle, sans la pièce elle-même", () => {
    const model = {
      parts: [
        part("a", { assembledWith: ["c", "a", "b"] }),
        part("b", { assembledWith: ["a"] }),
        part("c", { assembledWith: ["a"] }),
      ],
    };
    expect(ids(assembledParts(model, "a"))).toEqual(["b", "c"]);
    expect(ids(assembledParts(model, "b"))).toEqual(["a"]);
  });

  it("tronçons voisins d'une pièce débitée (joints), sans assemblage déclaré", () => {
    const model = { parts: [segment("lj-1"), segment("lj-2"), segment("lj-3")] };
    expect(ids(assembledParts(model, "lj-1"))).toEqual(["lj-2"]);
    expect(ids(assembledParts(model, "lj-2"))).toEqual(["lj-1", "lj-3"]);
    expect(ids(assembledParts(model, "lj-3"))).toEqual(["lj-2"]);
  });

  it("autres pièces de la même marche", () => {
    const model = {
      parts: [
        part("tread-4", { category: "tread", treadNumber: 4 }),
        part("riser-4", { category: "riser", treadNumber: 4 }),
        part("tread-5", { category: "tread", treadNumber: 5 }),
      ],
    };
    expect(ids(assembledParts(model, "riser-4"))).toEqual(["tread-4"]);
  });

  it("pièce absente : liste vide ; pièce isolée : liste vide", () => {
    const model = { parts: [part("a")] };
    expect(assembledParts(model, "zz")).toEqual([]);
    expect(assembledParts(model, "a")).toEqual([]);
  });
});

describe("groupPartLinks", () => {
  const angle = msg("structure.common.support.angleWelded");
  const support = (id: string, mark: string, tread: string): Part =>
    part(id, {
      mark,
      category: "support",
      name: msg("structure.common.support.name", { kind: angle, tread, owner: "LE2" }),
      section: textMessage("L 40×40×4"),
    });

  it("supports identiques regroupés : repères distincts triés, genre commun, une ligne", () => {
    const groups = groupPartLinks([
      support("s10", "CR10", "M10"),
      part("plate", { mark: "PH1", category: "fixing", name: textMessage("Platine") }),
      support("s2", "CR2", "M2"),
      support("s3", "CR2", "M3"),
    ]);
    expect(groups.map((g) => g.parts.map((p) => p.id))).toEqual([["s10", "s2", "s3"], ["plate"]]);
    expect(groups[0]!.marks).toEqual(["CR2", "CR10"]);
    expect(groups[0]!.name).toEqual(angle);
    expect(groups[1]!.name).toEqual(textMessage("Platine"));
  });

  it("pièces non répétitives (limons, marches) : une ligne chacune", () => {
    const groups = groupPartLinks([
      part("a", { category: "stringer" }),
      part("b", { category: "stringer" }),
    ]);
    expect(groups.map((g) => g.parts.length)).toEqual([1, 1]);
  });
});
