import { describe, expect, it } from "vitest";
import { textMessage } from "@blondel/i18n";
import { fastenerLines, type Fastener } from "./fasteners.js";

const item = (id: string, mark: string, quantity: number, partIds: string[]): Fastener => ({
  id,
  mark,
  kind: "bolt",
  grade: "8.8",
  diameter: 12,
  length: 100,
  quantity,
  joint: "plateBolted",
  name: textMessage(mark),
  origin: textMessage(id),
  partIds,
  deduced: ["diameter", "quantity"],
});

describe("fastenerLines", () => {
  it("réunit les éléments par repère, additionne les quantités, garde l'ordre", () => {
    const lines = fastenerLines([
      item("a", "VS1", 4, ["p1"]),
      item("b", "VS2", 2, ["p2"]),
      item("c", "VS1", 4, ["p3", "p1"]),
    ]);
    expect(lines.map((l) => [l.mark, l.quantity])).toEqual([
      ["VS1", 8],
      ["VS2", 2],
    ]);
    expect(lines[0]!.fastenerIds).toEqual(["a", "c"]);
    expect(lines[0]!.partIds).toEqual(["p1", "p3"]);
    expect(lines[0]!.joints).toEqual(["plateBolted"]);
  });

  it("liste vide → aucune ligne", () => {
    expect(fastenerLines([])).toEqual([]);
  });
});
