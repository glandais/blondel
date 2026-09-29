import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { StructureKind } from "../model/plugins.js";
import { getStructure, listStructures, registerStructure, unregisterStructure } from "./index.js";

const dummy: StructureKind<{ a: number }> = {
  kind: "test-dummy",
  label: "Essai",
  family: "bois",
  paramsSchema: z.object({ a: z.number().default(1) }),
  defaults: () => ({ a: 1 }),
  build: () => ({ parts: [], checks: [], notes: [] }),
};

describe("registre des structures", () => {
  it("plugins bois intégrés enregistrés", () => {
    const kinds = listStructures().map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(["wood-housed", "wood-cut"]));
    expect(getStructure("wood-housed")?.family).toBe("bois");
  });

  it("enregistre, refuse les doublons et `none`, retire", () => {
    registerStructure(dummy);
    expect(getStructure("test-dummy")).toBe(dummy);
    expect(() => registerStructure(dummy)).toThrow(/déjà/);
    registerStructure(dummy, { replace: true });
    expect(() => registerStructure({ ...dummy, kind: "none" })).toThrow(/réservé/);
    expect(unregisterStructure("test-dummy")).toBe(true);
    expect(getStructure("test-dummy")).toBeUndefined();
  });
});
