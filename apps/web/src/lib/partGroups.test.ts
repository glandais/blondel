import { buildModel, parseProjectText, textMessage, type Part } from "@blondel/core";
import { msg, translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import j4Text from "../../../../examples/j4-demi-tournant-acier-garde-corps.blondel.json?raw";
import j5bText from "../../../../examples/j5b-debillarde-soude.blondel.json?raw";
import {
  FASTENER_GROUP_ID,
  FASTENER_GROUP_KEY,
  PART_GROUP_KEYS,
  PART_GROUP_ORDER,
  foldText,
  groupPartCount,
  groupParts,
  groupSummary,
  marksSummary,
  materialSummary,
  matchesPartFilter,
  partGroupOf,
  stockSummary,
} from "./partGroups.js";

const FR = translatorFor("fr");
const EN = translatorFor("en");

/** Pièce minimale (les champs lus par le regroupement et le filtre). */
function part(over: Partial<Part> & Pick<Part, "id" | "mark" | "category">): Part {
  return {
    name: textMessage(over.mark),
    material: "wood-oak",
    solid: { kind: "box" } as unknown as Part["solid"],
    quantities: {},
    ...over,
  } as Part;
}

describe("groupe d'une pièce", () => {
  it("famille garde-corps d'abord, puis catégorie", () => {
    expect(partGroupOf({ family: "guards", category: "post" })).toBe("guards");
    expect(partGroupOf({ family: "guards", category: "handrail" })).toBe("guards");
    expect(partGroupOf({ family: "structure", category: "stringer" })).toBe("stringers");
    expect(partGroupOf({ family: "structure", category: "carriage" })).toBe("stringers");
    expect(partGroupOf({ family: "treads", category: "tread" })).toBe("treads");
    expect(partGroupOf({ family: "treads", category: "landing" })).toBe("treads");
    expect(partGroupOf({ family: "treads", category: "riser" })).toBe("risers");
    expect(partGroupOf({ family: "structure", category: "support" })).toBe("supports");
    expect(partGroupOf({ family: "structure", category: "fixing" })).toBe("plates");
    expect(partGroupOf({ family: "structure", category: "post" })).toBe("posts");
    expect(partGroupOf({ family: "structure", category: "handrail" })).toBe("other");
    expect(partGroupOf({ category: "infill" })).toBe("other");
  });

  it("ordre d'affichage et libellés français", () => {
    expect(PART_GROUP_ORDER.map((id) => FR.t(PART_GROUP_KEYS[id]))).toEqual([
      "Limons",
      "Marches",
      "Contremarches",
      "Supports",
      "Platines",
      "Poteaux",
      "Garde-corps",
      "Autres",
    ]);
    for (const id of PART_GROUP_ORDER) expect(EN.t(PART_GROUP_KEYS[id])).not.toMatch(/ui\.fab/);
  });
});

describe("regroupement", () => {
  const parts = [
    part({ id: "tread-2", mark: "M2", category: "tread", family: "treads" }),
    part({ id: "stringer-outer-1", mark: "LE1", category: "stringer", family: "structure" }),
    part({ id: "tread-1", mark: "M1", category: "tread", family: "treads" }),
    part({ id: "support-1", mark: "CR1", category: "support", family: "structure" }),
    part({ id: "support-2", mark: "CR1", category: "support", family: "structure" }),
    part({ id: "post-g", mark: "PG1", category: "post", family: "guards" }),
  ];

  it("groupes non vides, dans l'ordre d'affichage ; repères distincts dans l'ordre du modèle", () => {
    const groups = groupParts(parts);
    expect(groups.map((g) => g.id)).toEqual(["stringers", "treads", "supports", "guards"]);
    expect(groups.find((g) => g.id === "treads")?.marks).toEqual(["M2", "M1"]);
    expect(groups.find((g) => g.id === "supports")?.parts.length).toBe(2);
    expect(groups.find((g) => g.id === "supports")?.marks).toEqual(["CR1"]);
    expect(groupParts([])).toEqual([]);
  });

  it("toutes les pièces d'un modèle réel sont rangées une fois", () => {
    for (const text of [j4Text, j5bText]) {
      const model = buildModel(parseProjectText(text));
      const groups = groupParts(model.parts);
      expect(groups.reduce((n, g) => n + g.parts.length, 0)).toBe(model.parts.length);
      const order = groups.map((g) => PART_GROUP_ORDER.indexOf(g.id));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(groups.map((g) => g.id)).toContain("stringers");
      expect(groups.map((g) => g.id)).toContain("treads");
    }
    const j4 = groupParts(buildModel(parseProjectText(j4Text)).parts);
    expect(j4.map((g) => g.id)).toContain("guards");
  });
});

describe("résumés", () => {
  it("repères : liste jusqu'à 5, sinon premier … dernier", () => {
    expect(marksSummary(["LE1", "LE2", "LD1"])).toBe("LE1 · LE2 · LD1");
    expect(marksSummary(["A", "B", "C", "D", "E"])).toBe("A · B · C · D · E");
    const many = Array.from({ length: 15 }, (_, i) => `M${i + 1}`);
    expect(marksSummary(many)).toBe("M1 … M15");
    expect(marksSummary(["A", "B", "C"], 2)).toBe("A … C");
    expect(marksSummary([])).toBe("");
  });

  it("matériau : « chêne 40 » si matériau et épaisseur communs, matériau seul, sinon vide", () => {
    const stock = (thickness: number) => ({ length: 900, width: 280, thickness });
    const oak40 = [
      part({ id: "a", mark: "M1", category: "tread", stock: stock(40) }),
      part({ id: "b", mark: "M2", category: "tread", stock: stock(40) }),
    ];
    expect(materialSummary(oak40, FR)).toBe("chêne 40");
    expect(materialSummary(oak40, EN)).toBe("oak 40");
    const mixedThickness = [
      ...oak40,
      part({ id: "c", mark: "M3", category: "tread", stock: stock(45) }),
    ];
    expect(materialSummary(mixedThickness, FR)).toBe("chêne");
    const noStock = [part({ id: "d", mark: "M1", category: "tread" })];
    expect(materialSummary(noStock, FR)).toBe("chêne");
    const mixed = [
      ...oak40,
      part({ id: "e", mark: "L", category: "stringer", material: "steel-raw" }),
    ];
    expect(materialSummary(mixed, FR)).toBe("");
    expect(materialSummary([], FR)).toBe("");
    expect(
      materialSummary([part({ id: "f", mark: "T", category: "tread", stock: stock(40.5) })], FR),
    ).toBe("chêne 40,5");
  });

  it("ligne de résumé d'un groupe : repères · matériau", () => {
    const [g] = groupParts([
      part({
        id: "a",
        mark: "M1",
        category: "tread",
        stock: { length: 1, width: 1, thickness: 40 },
      }),
      part({
        id: "b",
        mark: "M2",
        category: "tread",
        stock: { length: 1, width: 1, thickness: 40 },
      }),
    ]);
    expect(groupSummary(g!, FR)).toBe("M1 · M2 · chêne 40");
    const [steel] = groupParts([
      part({ id: "s", mark: "LE1", category: "stringer", material: "steel-raw" }),
      part({ id: "t", mark: "LE2", category: "stringer", material: "steel-painted" }),
    ]);
    expect(groupSummary(steel!, FR)).toBe("LE1 · LE2");
  });

  it("compte d'un groupe : pièces fabriquées seulement, la pièce composée listée sans être comptée", () => {
    const [g] = groupParts([
      part({ id: "beam", mark: "LC1", category: "carriage" }),
      part({ id: "layer", mark: "LC1-2", category: "carriage", componentOf: "beam" }),
      part({ id: "b1", mark: "LC1-2.1", category: "carriage", componentOf: "layer" }),
      part({ id: "b2", mark: "LC1-2.2", category: "carriage", componentOf: "layer" }),
    ]);
    expect(g!.parts).toHaveLength(4);
    expect(groupPartCount(g!, new Set(["b1", "b2"]))).toBe(2);
  });

  it("section commune (profilés) plutôt que l'épaisseur de débit ; remplissage des garde-corps", () => {
    const angle = textMessage("L 40 × 40 × 4");
    const box = { length: 600, width: 40, thickness: 40 };
    const supports = [
      part({ id: "a", mark: "CR1", category: "support", section: angle, stock: box }),
      part({ id: "b", mark: "CR2", category: "support", section: angle, stock: box }),
    ];
    expect(stockSummary(supports, FR)).toBe("L 40 × 40 × 4");
    // Sections différentes : matériau et épaisseur.
    const other = part({ id: "c", mark: "CR3", category: "support", stock: box });
    expect(stockSummary([...supports, other], FR)).toBe("chêne 40");
    // Garde-corps mélangés : matériau du remplissage.
    const guards = [
      part({ id: "p", mark: "PG1", category: "post", family: "guards", material: "steel-raw" }),
      part({ id: "h", mark: "MC1", category: "handrail", family: "guards" }),
      part({ id: "v", mark: "PN1", category: "infill", family: "guards", material: "glass" }),
    ];
    expect(stockSummary(guards, FR)).toBe(materialSummary([guards[2]!], FR));
    expect(stockSummary(guards, FR)).not.toBe("");
  });
});

describe("filtre", () => {
  const limon = part({
    id: "stringer-inner-curved-2",
    mark: "LD2",
    category: "stringer",
    material: "steel-raw",
    name: msg("structure.steelCurved.part.outerString"),
    section: msg("structure.steel.section.plate", { thickness: "8 mm" }),
  });

  it("insensible à la casse et aux accents", () => {
    expect(foldText("Chêne Élevé")).toBe("chene eleve");
    expect(matchesPartFilter(limon, "", FR)).toBe(true);
    expect(matchesPartFilter(limon, "   ", FR)).toBe(true);
    expect(matchesPartFilter(limon, "ld2", FR)).toBe(true);
    expect(matchesPartFilter(limon, "LD", FR)).toBe(true);
    expect(matchesPartFilter(limon, "acier", FR)).toBe(true);
    expect(matchesPartFilter(limon, "ACIER BRUT", FR)).toBe(true);
    expect(matchesPartFilter(limon, "chene", FR)).toBe(false);
    expect(matchesPartFilter(part({ id: "m", mark: "M1", category: "tread" }), "chene", FR)).toBe(
      true,
    );
    expect(matchesPartFilter(part({ id: "m", mark: "M1", category: "tread" }), "CHÊNE", FR)).toBe(
      true,
    );
  });

  it("désignation et matériau dans la langue de l'interface", () => {
    const name = FR.t(limon.name);
    expect(matchesPartFilter(limon, name.slice(0, 5), FR)).toBe(true);
    expect(matchesPartFilter(limon, "steel", EN)).toBe(true);
    expect(matchesPartFilter(limon, "steel", FR)).toBe(false);
    expect(matchesPartFilter(part({ id: "m", mark: "M1", category: "tread" }), "oak", EN)).toBe(
      true,
    );
  });

  it("section", () => {
    const section = FR.t(limon.section!);
    expect(matchesPartFilter(limon, section, FR)).toBe(true);
  });
});

describe("groupe « Visserie » (QUESTIONS A27)", () => {
  it("identifiant distinct des familles de pièces, libellé traduit", () => {
    expect((PART_GROUP_ORDER as readonly string[]).includes(FASTENER_GROUP_ID)).toBe(false);
    expect(FR.t(FASTENER_GROUP_KEY)).toBe("Visserie");
    expect(EN.t(FASTENER_GROUP_KEY)).toBe("Fixings");
  });
});
