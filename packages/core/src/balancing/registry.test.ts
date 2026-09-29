import { describe, expect, expectTypeOf, it } from "vitest";
import type { BalancingStrategy } from "../model/plugins.js";
import { BalancingSchema, type BalancingMethod } from "../model/project.js";
import { BALANCING_STRATEGIES, type BalancingMethodId } from "./registry.js";

describe("identifiants de balancement : une seule liste", () => {
  it("le registre couvre exactement les méthodes du schéma", () => {
    expect(Object.keys(BALANCING_STRATEGIES).sort()).toEqual(
      [...BalancingSchema.shape.method.unwrap().options].sort(),
    );
    for (const [id, s] of Object.entries(BALANCING_STRATEGIES)) expect(s.id).toBe(id);
  });

  it("BalancingStrategy.id et BalancingMethodId dérivent de BalancingSchema.method", () => {
    expectTypeOf<BalancingStrategy["id"]>().toEqualTypeOf<BalancingMethod>();
    expectTypeOf<BalancingMethodId>().toEqualTypeOf<BalancingMethod>();
    // @ts-expect-error — « M7 » (V2 de SPEC) n'est ni dans le schéma ni dans le registre.
    const phantom: BalancingStrategy["id"] = "M7";
    expect(phantom).toBe("M7");
  });
});
