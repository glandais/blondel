/**
 * Classe d'exécution EN 1090-2 (C §2.1, CNC2M N0169) : la nuance S355 ne fait passer en PC2
 * (donc EXC2) que les éléments soudés ; un élément non soudé reste en PC1 quelle que soit la
 * nuance.
 */
import { describe, expect, it } from "vitest";
import { deduceExecutionClass } from "./steelCommon.js";

describe("deduceExecutionClass", () => {
  it("S235 sans soudure bout à bout : EXC1 ; soudure bout à bout ou formage à chaud : EXC2", () => {
    expect(deduceExecutionClass({ grade: "S235", buttWeld: 0 }).executionClass).toBe("EXC1");
    expect(deduceExecutionClass({ grade: "S235", buttWeld: 120 }).executionClass).toBe("EXC2");
    expect(
      deduceExecutionClass({ grade: "S235", buttWeld: 0, hotForming: true }).executionClass,
    ).toBe("EXC2");
  });

  it("S355 soudé : EXC2 ; S355 sans aucune soudure : EXC1 (PC1, éléments non soudés)", () => {
    const welded = deduceExecutionClass({ grade: "S355", buttWeld: 0, welded: true });
    expect(welded.executionClass).toBe("EXC2");
    expect(welded.reasons).toEqual(["nuance S355 soudée"]);
    const bolted = deduceExecutionClass({ grade: "S355", buttWeld: 0, welded: false });
    expect(bolted).toEqual({ executionClass: "EXC1", reasons: [] });
    // Sans l'information : lecture conservatrice (soudé).
    expect(deduceExecutionClass({ grade: "S355", buttWeld: 0 }).executionClass).toBe("EXC2");
  });
});
